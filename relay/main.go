package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const maxLineBytes = 256 * 1024

func defaultTokenPath() string {
	if configured := os.Getenv("HOLOCRON_RELAY_TOKEN_FILE"); configured != "" {
		return configured
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserCacheDir()
	}
	return filepath.Join(base, "Holocron3D", "bridge-token")
}

func authenticate(connection net.Conn, tokenPath string) error {
	token, err := os.ReadFile(tokenPath)
	if err != nil {
		return fmt.Errorf("read relay credential: %w", err)
	}
	line := fmt.Sprintf("{\"v\":1,\"type\":\"relay_auth\",\"token\":%q}\n", string(bytesTrimSpace(token)))
	_, err = io.WriteString(connection, line)
	return err
}

func bytesTrimSpace(value []byte) []byte {
	start, end := 0, len(value)
	for start < end && (value[start] == ' ' || value[start] == '\r' || value[start] == '\n' || value[start] == '\t') {
		start++
	}
	for end > start && (value[end-1] == ' ' || value[end-1] == '\r' || value[end-1] == '\n' || value[end-1] == '\t') {
		end--
	}
	return value[start:end]
}

func launch(appPath, appDirectory, squirrelExecutable string) error {
	if appPath == "" {
		return nil
	}
	abs, err := filepath.Abs(appPath)
	if err != nil {
		return err
	}
	args := []string{}
	if squirrelExecutable != "" {
		args = append(args, "--processStart", squirrelExecutable)
	} else if appDirectory != "" {
		args = append(args, appDirectory)
	}
	command := exec.Command(abs, args...)
	command.Stdin = nil
	command.Stdout = nil
	command.Stderr = nil
	return command.Start()
}

func connect(address string, timeout time.Duration) (net.Conn, error) {
	deadline := time.Now().Add(timeout)
	var lastError error
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", address, 500*time.Millisecond)
		if err == nil {
			return connection, nil
		}
		lastError = err
		time.Sleep(150 * time.Millisecond)
	}
	return nil, lastError
}

func copyInput(connection net.Conn) error {
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), maxLineBytes)
	writer := bufio.NewWriter(connection)
	for scanner.Scan() {
		if _, err := writer.WriteString(scanner.Text() + "\n"); err != nil {
			return err
		}
		if err := writer.Flush(); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if tcpConnection, ok := connection.(*net.TCPConn); ok {
		return tcpConnection.CloseWrite()
	}
	return nil
}

func run() error {
	address := flag.String("address", "127.0.0.1:8786", "Electron relay address")
	appPath := flag.String("app", "", "Electron executable to start when unavailable")
	appDirectory := flag.String("app-dir", "", "development Electron application directory")
	squirrelExecutable := flag.String("squirrel-exe", "", "installed executable name for a Squirrel Update.exe launcher")
	timeout := flag.Duration("timeout", 10*time.Second, "connection timeout")
	tokenPath := flag.String("token-file", defaultTokenPath(), "per-user relay credential")
	flag.Parse()

	connection, firstError := net.DialTimeout("tcp", *address, 300*time.Millisecond)
	if firstError != nil {
		if err := launch(*appPath, *appDirectory, *squirrelExecutable); err != nil {
			return fmt.Errorf("start Holocron 3D: %w", err)
		}
		var err error
		connection, err = connect(*address, *timeout)
		if err != nil {
			return fmt.Errorf("connect to Holocron 3D: %w", err)
		}
	}
	defer connection.Close()
	if err := authenticate(connection, *tokenPath); err != nil {
		return err
	}

	inputDone := make(chan error, 1)
	go func() { inputDone <- copyInput(connection) }()
	_, outputError := io.Copy(os.Stdout, connection)
	inputError := <-inputDone
	if outputError != nil && !errors.Is(outputError, net.ErrClosed) {
		return outputError
	}
	if inputError != nil && !errors.Is(inputError, net.ErrClosed) {
		return inputError
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Holocron3D relay:", err)
		os.Exit(1)
	}
}
