package main

import (
	"bufio"
	"encoding/json"
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
