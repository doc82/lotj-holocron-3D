import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createTelemetryHost } from "../electron/shared/protocol.mjs";
import { ensureRelayToken, validateRelayAuth } from "../electron/shared/relay-auth.mjs";
import { appDataPaths } from "../electron/shared/windows-paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Electron telemetry host preserves the Mudlet protocol contract", () => {
  const written = [];
  const emitted = [];
  const broadcasts = [];
  let stopped = false;
  const host = createTelemetryHost({
    write: (message) => written.push(message),
    emit: (type, message) => emitted.push({ type, message }),
    broadcast: (message) => broadcasts.push(message),
    shutdown: () => { stopped = true; },
  });

  host.setWebsocketUrl("ws://127.0.0.1:8787");
  host.handleMudletMessage({ v: 1, type: "hello", source: "test" });
  assert.deepEqual(written[0], {
    v: 1,
    type: "ready",
    bridge: "electron-host",
    websocketUrl: "ws://127.0.0.1:8787",
    renderer: "electron",
  });

  const snapshot = {
    v: 1,
    type: "system_snapshot",
    sequence: 42,
    observer: { id: "player-ship", x: 1, y: 2, z: 3 },
    entities: [{ id: "gore", x: 4, y: 5, z: 6 }],
    metadata: { lastCapturePolled: true },
  };
  host.handleMudletMessage(snapshot);
  assert.equal(emitted.at(-1).type, "snapshot");
  assert.equal(broadcasts.at(-1), snapshot);
  assert.equal(written.at(-1).type, "snapshot_received");
  assert.equal(written.at(-1).polled, true);
  assert.equal(host.initialState().snapshot.sequence, 42);

  const intent = host.handleIntent({
    v: 1,
    type: "intent",
    id: "renderer-1",
    action: "prototype_ping",
    payload: { message: "hello" },
  });
  assert.equal(intent.accepted, true);
  assert.equal(written.at(-1).type, "intent");
  assert.equal(host.handleIntent({ type: "raw_command" }).accepted, false);

  host.handleMudletMessage({ v: 1, type: "shutdown" });
  assert.equal(stopped, true);
});

test("Electron window and preload keep privileged APIs isolated", async () => {
  const main = await readFile(path.resolve(here, "../electron/main/main.mjs"), "utf8");
  const preload = await readFile(path.resolve(here, "../electron/preload/preload.cjs"), "utf8");

  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.doesNotMatch(preload, /ipcRenderer:\s*ipcRenderer/);
  assert.doesNotMatch(preload, /send:\s*ipcRenderer\.send/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("holocron"/);
});

test("relay credentials are persistent and validated", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "holocron-auth-"));
  try {
    const tokenPath = path.join(directory, "bridge-token");
    const first = ensureRelayToken(tokenPath);
    const second = ensureRelayToken(tokenPath);
    assert.equal(first, second);
    assert.equal(first.length, 64);
    assert.equal(validateRelayAuth({ v: 1, type: "relay_auth", token: first }, first), true);
    assert.equal(validateRelayAuth({ v: 1, type: "relay_auth", token: `${first}x` }, first), false);
    assert.equal(validateRelayAuth({ v: 1, type: "hello", token: first }, first), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Windows paths are stable and overridable", () => {
  const paths = appDataPaths({ LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" });
  assert.equal(paths.token, path.win32.join("C:\\Users\\Test\\AppData\\Local", "Holocron3D", "bridge-token"));
  const custom = appDataPaths({ HOLOCRON_DATA_DIR: "D:\\Holocron" });
  assert.equal(custom.relay, path.win32.join("D:\\Holocron", "bin", "holocron-relay.exe"));
  assert.equal(custom.mudletPackage, path.win32.join("D:\\Holocron", "mudlet", "Holocron3D.mpackage"));
});
