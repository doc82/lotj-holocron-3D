import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  packagedPlanetAssetPaths,
  validatePackagedPlanetEntries,
} from "../tools/verify-packaged-planet-assets.mjs";

import { createTelemetryHost } from "../electron/shared/protocol.mjs";
import { ensureRelayToken, validateRelayAuth } from "../electron/shared/relay-auth.mjs";
import { appDataPaths } from "../electron/shared/app-paths.mjs";

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
    shutdown: () => {
      stopped = true;
    },
  });

  // The primary authenticated Mudlet pipe must become ready even when the
  // optional third-party WebSocket endpoint could not bind.
  host.handleMudletMessage({ v: 1, type: "hello", source: "test" });
  assert.deepEqual(written[0], {
    v: 1,
    type: "ready",
    bridge: "electron-host",
    renderer: "electron",
  });
  host.setWebsocketUrl("ws://127.0.0.1:8787");
  assert.equal(host.initialState().websocketUrl, "ws://127.0.0.1:8787");

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

  const galaxy = { v: 1, type: "galaxy_catalog", systems: { "Esstran Sector": { x: 92, y: 12 } } };
  host.handleMudletMessage(galaxy);
  assert.equal(emitted.at(-1).type, "galaxy-catalog");
  assert.equal(host.initialState().galaxyCatalog, galaxy);

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
  assert.match(preload, /contextBridge\.exposeInMainWorld\(\s*"holocron"/);
});

test("Electron packaging applies Holocron3D branding across Windows surfaces", async () => {
  const main = await readFile(path.resolve(here, "../electron/main/main.mjs"), "utf8");
  const forge = await readFile(path.resolve(here, "../forge.config.cjs"), "utf8");
  const png = await readFile(path.resolve(here, "../assets/icon/holocron3d-icon.png"));
  const ico = await readFile(path.resolve(here, "../assets/icon/holocron3d.ico"));

  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
  assert.match(main, /icon: appIcon/);
  assert.match(main, /setAppUserModelId\("com\.veska\.holocron3d"\)/);
  assert.match(forge, /icon: appIcon/);
  assert.match(forge, /setupIcon: appIcon/);
});

test("Electron packaging includes only built planet textures", async () => {
  const forge = await readFile(path.resolve(here, "../forge.config.cjs"), "utf8");

  assert.match(forge, /\.codex-tmp\|vendor-assets/);
  assert.match(forge, /renderer\\\/\(public\|src/);
  assert.doesNotMatch(forge, /renderer\\\/\(dist\|/);
});

test("release verification requires every optimized texture and rejects source assets", () => {
  const expected = packagedPlanetAssetPaths();
  assert.equal(expected.length, 38);
  assert.doesNotThrow(() => validatePackagedPlanetEntries(expected));
  assert.throws(
    () => validatePackagedPlanetEntries(expected.slice(1)),
    /missing: \/renderer\/dist\/planet-textures\/alderaan\.webp/,
  );
  assert.throws(
    () => validatePackagedPlanetEntries([...expected, "/vendor-assets/shinyman/alderaan/raw.png"]),
    /forbidden: \/vendor-assets/,
  );
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
  const paths = appDataPaths(
    { LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" },
    "win32",
    "C:\\Users\\Test",
  );
  assert.equal(
    paths.token,
    path.win32.join("C:\\Users\\Test\\AppData\\Local", "Holocron3D", "bridge-token"),
  );
  const custom = appDataPaths({ HOLOCRON_DATA_DIR: "D:\\Holocron" }, "win32");
  assert.equal(custom.relay, path.win32.join("D:\\Holocron", "bin", "holocron-relay.exe"));
  assert.equal(
    custom.mudletPackage,
    path.win32.join("D:\\Holocron", "mudlet", "Holocron3D.mpackage"),
  );
});

test("macOS paths use Application Support and an extensionless relay", () => {
  const paths = appDataPaths({}, "darwin", "/Users/Test");
  assert.equal(
    paths.base,
    path.posix.join("/Users/Test", "Library", "Application Support", "Holocron3D"),
  );
  assert.equal(paths.relay, path.posix.join(paths.base, "bin", "holocron-relay"));
  assert.equal(paths.mudletPackage, path.posix.join(paths.base, "mudlet", "Holocron3D.mpackage"));
});

test("release tooling builds native macOS relays and DMG artifacts without extra package policy", async () => {
  const [forge, release, dmg, manifest] = await Promise.all([
    readFile(path.resolve(here, "../forge.config.cjs"), "utf8"),
    readFile(path.resolve(here, "../tools/release-build.mjs"), "utf8"),
    readFile(path.resolve(here, "../tools/build-dmg.mjs"), "utf8"),
    readFile(path.resolve(here, "../package.json"), "utf8"),
  ]);
  assert.match(forge, /darwin/);
  assert.match(forge, /holocron-relay/);
  assert.match(release, /build-dmg\.mjs/);
  assert.match(dmg, /hdiutil/);
  assert.match(dmg, /package\.json/);
  assert.match(dmg, /\$\{version\}/);
  assert.doesNotMatch(dmg, /LotJ-Holocron-3D-\d+\.\d+\.\d+/);
  assert.match(manifest, /make:mac:arm64/);
  assert.match(manifest, /make:mac:x64/);
});
