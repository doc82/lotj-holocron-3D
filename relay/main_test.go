package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAuthenticateSendsCredentialBeforeTelemetry(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "bridge-token")
	if err := os.WriteFile(tokenPath, []byte("test-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	client, server := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- authenticate(client, tokenPath) }()
	var message map[string]any
	if err := json.NewDecoder(bufio.NewReader(server)).Decode(&message); err != nil {
		t.Fatal(err)
	}
	if message["type"] != "relay_auth" || message["token"] != "test-secret" {
		t.Fatalf("unexpected auth message: %#v", message)
	}
	server.Close()
	client.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestConnectRetriesUntilServerIsAvailable(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()

	ready := make(chan net.Listener, 1)
	go func() {
		time.Sleep(100 * time.Millisecond)
		server, listenError := net.Listen("tcp", address)
		if listenError != nil {
			ready <- nil
			return
		}
		ready <- server
	}()

	connection, err := connect(address, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	connection.Close()
	server := <-ready
	if server == nil {
		t.Fatal("test server did not start")
	}
	server.Close()
}

func TestBridgeSessionReturnsWhenDesktopSocketClosesWhileInputStaysOpen(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "bridge-token")
	if err := os.WriteFile(tokenPath, []byte("test-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	client, server := net.Pipe()
	inputReader, inputWriter := io.Pipe()
	defer inputReader.Close()
	defer inputWriter.Close()
	events, _ := scanInput(inputReader)
	helloLine := ""
	done := make(chan error, 1)
	go func() {
		_, err := bridgeSession(client, tokenPath, events, io.Discard, &helloLine)
		done <- err
	}()

	var authentication map[string]any
	if err := json.NewDecoder(bufio.NewReader(server)).Decode(&authentication); err != nil {
		t.Fatal(err)
	}
	server.Close()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected a closed desktop socket to end the bridge session")
		}
	case <-time.After(time.Second):
		t.Fatal("bridge session remained blocked on open stdin after the desktop socket closed")
	}
}

func TestBridgeSessionReconnectControlIsNotForwardedToDesktop(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "bridge-token")
	if err := os.WriteFile(tokenPath, []byte("test-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	client, server := net.Pipe()
	events := make(chan inputEvent, 1)
	events <- inputEvent{line: `{"v":1,"type":"bridge_reconnect"}`}
	helloLine := ""
	done := make(chan error, 1)
	go func() {
		_, err := bridgeSession(client, tokenPath, events, io.Discard, &helloLine)
		done <- err
	}()

	var authentication map[string]any
	if err := json.NewDecoder(bufio.NewReader(server)).Decode(&authentication); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, errReconnectRequested) {
			t.Fatalf("expected reconnect request, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("bridge session did not process reconnect control")
	}
	server.Close()
	close(events)
}

func TestRelayWaitsForDesktopUntilInputCloses(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "bridge-token")
	if err := os.WriteFile(tokenPath, []byte("test-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	reserved, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reserved.Addr().String()
	reserved.Close()

	inputReader, inputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- relay(address, 50*time.Millisecond, "", "", "", tokenPath, inputReader, io.Discard)
	}()

	select {
	case relayError := <-done:
		t.Fatalf("relay exited while waiting for the desktop: %v", relayError)
	case <-time.After(300 * time.Millisecond):
	}

	listener, err := net.Listen("tcp", address)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if tcpListener, ok := listener.(*net.TCPListener); ok {
		tcpListener.SetDeadline(time.Now().Add(2 * time.Second))
	}
	connection, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	var authentication map[string]any
	if err := json.NewDecoder(bufio.NewReader(connection)).Decode(&authentication); err != nil {
		t.Fatal(err)
	}
	if authentication["type"] != "relay_auth" {
		t.Fatalf("unexpected first relay message: %#v", authentication)
	}

	inputWriter.Close()
	connection.Close()
	select {
	case relayError := <-done:
		if relayError != nil {
			t.Fatal(relayError)
		}
	case <-time.After(time.Second):
		t.Fatal("relay did not stop after Mudlet input closed")
	}
}

func TestBridgeSessionReplaysHelloAfterReconnect(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "bridge-token")
	if err := os.WriteFile(tokenPath, []byte("test-secret\n"), 0600); err != nil {
		t.Fatal(err)
	}
	client, server := net.Pipe()
	events := make(chan inputEvent)
	helloLine := `{"v":1,"type":"hello","source":"mudlet"}`
	done := make(chan error, 1)
	go func() {
		_, err := bridgeSession(client, tokenPath, events, io.Discard, &helloLine)
		done <- err
	}()

	decoder := json.NewDecoder(bufio.NewReader(server))
	var authentication map[string]any
	if err := decoder.Decode(&authentication); err != nil {
		t.Fatal(err)
	}
	var hello map[string]any
	if err := decoder.Decode(&hello); err != nil {
		t.Fatal(err)
	}
	if hello["type"] != "hello" || hello["source"] != "mudlet" {
		t.Fatalf("unexpected replayed hello: %#v", hello)
	}
	server.Close()
	if err := <-done; err == nil {
		t.Fatal("expected the closed test socket to end the bridge session")
	}
}

func TestDiagnosticsAreAlwaysProtocolJSON(t *testing.T) {
	var output bytes.Buffer
	if err := writeDiagnostic(&output, "warn", "write tcp 127.0.0.1: connection reset"); err != nil {
		t.Fatal(err)
	}
	var message map[string]any
	if err := json.Unmarshal(bytesTrimSpace(output.Bytes()), &message); err != nil {
		t.Fatal(err)
	}
	if message["type"] != "bridge_diagnostic" || message["level"] != "warn" {
		t.Fatalf("unexpected diagnostic message: %#v", message)
	}
}
