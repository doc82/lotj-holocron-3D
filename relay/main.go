package main

import (
	"bufio"
	"encoding/json"
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

var errReconnectRequested = errors.New("desktop reconnect requested")

type inputEvent struct {
	line string
	err  error
}

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

func scanInput(input io.Reader) (<-chan inputEvent, <-chan error) {
	events := make(chan inputEvent, 64)
	done := make(chan error, 1)
	go func() {
		defer close(events)
		defer close(done)
		scanner := bufio.NewScanner(input)
		scanner.Buffer(make([]byte, 4096), maxLineBytes)
		for scanner.Scan() {
			events <- inputEvent{line: scanner.Text()}
		}
		if err := scanner.Err(); err != nil {
			events <- inputEvent{err: err}
			done <- err
			return
		}
		done <- nil
	}()
	return events, done
}

func messageType(line string) string {
	var message struct {
		Type string `json:"type"`
	}
	if json.Unmarshal([]byte(line), &message) != nil {
		return ""
	}
	return message.Type
}

func bridgeSession(
	connection net.Conn,
	tokenPath string,
	input <-chan inputEvent,
	output io.Writer,
	helloLine *string,
) (bool, error) {
	if err := authenticate(connection, tokenPath); err != nil {
		return false, err
	}

	writer := bufio.NewWriter(connection)
	if *helloLine != "" {
		if _, err := writer.WriteString(*helloLine + "\n"); err != nil {
			return false, err
		}
		if err := writer.Flush(); err != nil {
			return false, err
		}
	}

	outputDone := make(chan error, 1)
	go func() {
		_, err := io.Copy(output, connection)
		if err == nil {
			err = io.EOF
		}
		outputDone <- err
	}()

	for {
		select {
		case event, ok := <-input:
			if !ok {
				return true, nil
			}
			if event.err != nil {
				return true, event.err
			}
			if messageType(event.line) == "hello" {
				*helloLine = event.line
			}
			if messageType(event.line) == "bridge_reconnect" {
				return false, errReconnectRequested
			}
			if _, err := writer.WriteString(event.line + "\n"); err != nil {
				return false, err
			}
			if err := writer.Flush(); err != nil {
				return false, err
			}
		case err := <-outputDone:
			return false, err
		}
	}
}

func writeDiagnostic(output io.Writer, level, message string) error {
	return json.NewEncoder(output).Encode(map[string]any{
		"v":       1,
		"type":    "bridge_diagnostic",
		"level":   level,
		"message": message,
	})
}

func relay(
	address string,
	timeout time.Duration,
	appPath string,
	appDirectory string,
	squirrelExecutable string,
	tokenPath string,
	input io.Reader,
	output io.Writer,
) error {
	events, inputDone := scanInput(input)
	helloLine := ""
	reconnecting := false
	launchAttempted := false
	for {
		dialTimeout := timeout
		if dialTimeout <= 0 || dialTimeout > 500*time.Millisecond {
			dialTimeout = 500 * time.Millisecond
		}
		connection, connectError := net.DialTimeout("tcp", address, dialTimeout)
		if connectError != nil {
			// --app is retained for compatibility with older Mudlet packages. New
			// packages launch the desktop explicitly with --launch-only.
			if appPath != "" && !launchAttempted {
				if err := launch(appPath, appDirectory, squirrelExecutable); err != nil {
					return fmt.Errorf("start Holocron 3D: %w", err)
				}
				launchAttempted = true
			}
			select {
			case inputError := <-inputDone:
				return inputError
			case <-time.After(250 * time.Millisecond):
				continue
			}
		}
		if reconnecting {
			if err := writeDiagnostic(output, "info", "desktop bridge reconnected"); err != nil {
				connection.Close()
				return err
			}
		}

		stdinClosed, sessionError := bridgeSession(connection, tokenPath, events, output, &helloLine)
		connection.Close()
		if stdinClosed {
			return sessionError
		}
		if err := writeDiagnostic(
			output,
			"warn",
			"desktop bridge disconnected; reconnecting",
		); err != nil {
			return err
		}
		reconnecting = true
	}
}

func run() error {
	address := flag.String("address", "127.0.0.1:8786", "Electron relay address")
	appPath := flag.String("app", "", "Electron executable to start when unavailable")
	appDirectory := flag.String("app-dir", "", "development Electron application directory")
	squirrelExecutable := flag.String("squirrel-exe", "", "installed executable name for a Squirrel Update.exe launcher")
	launchOnly := flag.Bool("launch-only", false, "start or focus Electron without running the telemetry relay")
	timeout := flag.Duration("timeout", 500*time.Millisecond, "individual connection-attempt timeout")
	tokenPath := flag.String("token-file", defaultTokenPath(), "per-user relay credential")
	flag.Parse()
	if *launchOnly {
		if *appPath == "" {
			return errors.New("--launch-only requires --app")
		}
		return launch(*appPath, *appDirectory, *squirrelExecutable)
	}

	return relay(
		*address,
		*timeout,
		*appPath,
		*appDirectory,
		*squirrelExecutable,
		*tokenPath,
		os.Stdin,
		os.Stdout,
	)
}

func main() {
	if err := run(); err != nil {
		_ = writeDiagnostic(os.Stdout, "error", "relay stopped: "+err.Error())
		os.Exit(1)
	}
}
