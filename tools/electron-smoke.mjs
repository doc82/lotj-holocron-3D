import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const profile = path.join(root, ".electron-smoke-profile");
const tokenFile = path.join(profile, "bridge-token");
const packagedExecutable = process.env.HOLOCRON_ELECTRON_EXECUTABLE;
const executable = packagedExecutable || path.join(
  root, "node_modules", "electron", "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);
const arguments_ = [`--user-data-dir=${profile}`];
if (!packagedExecutable) arguments_.push(root);
const child = spawn(executable, arguments_, {
  cwd: root,
  stdio: ["ignore", "inherit", "inherit"],
  env: {
    ...process.env,
    HOLOCRON_DEBUG_STDERR: "1",
    HOLOCRON_DATA_DIR: profile,
    HOLOCRON_RELAY_TOKEN_FILE: tokenFile,
  },
});

let relay = null;

function send(message) {
  relay.write(`${JSON.stringify({ v: 1, ...message })}\n`);
}

const messages = [
  { type: "hello", source: "electron-smoke" },
  { type: "space_state", inSpace: true, reason: "smoke-test telemetry" },
  {
  type: "system_snapshot",
  sequence: 1,
  observer: {
    id: "player-ship",
    kind: "ship",
    name: "Forrestal",
    class: "Rojan-class Invincible Firespray Patrol Craft",
    x: -107,
    y: -259,
    z: 450,
    speed: { current: 50, maximum: 200 },
    sensorArray: 7,
    radarRange: 570,
  },
  entities: [
    { id: "dromund-kaas", kind: "celestial", name: "Dromund Kaas", x: 0, y: 0, z: 0 },
    { id: "pollution", kind: "ship", name: "Pollution", class: "Imperial-II Class Star Destroyer", x: -51, y: 62, z: 32, position: "Ctr" },
    { id: "mk1af19", kind: "ship", name: "MK1AF19", class: "Mark-I Assault Frigate", x: -369, y: -34, z: -120 },
  ],
  metadata: {
    system: "Esstran Sector",
    inSpace: true,
    polling: { enabled: true, command: "radar" },
  },
  },
];

function connect(attempt = 1) {
  relay = net.createConnection({ host: "127.0.0.1", port: 8786 });
  relay.setEncoding("utf8");
  relay.on("connect", async () => {
    const token = (await readFile(tokenFile, "utf8")).trim();
    send({ type: "relay_auth", token });
    for (const message of messages) send(message);
  });
  relay.on("data", (chunk) => process.stdout.write(chunk));
  relay.on("error", () => {
    relay.destroy();
    if (attempt < 30) setTimeout(() => connect(attempt + 1), 100);
    else child.kill();
  });
}
setTimeout(connect, 100);

const close = () => {
  if (!child.killed) {
    if (relay && !relay.destroyed) {
      send({ type: "shutdown" });
      relay.end();
    } else {
      child.kill();
    }
  }
};

process.on("SIGINT", close);
process.on("SIGTERM", close);
child.on("exit", (code) => process.exit(code ?? 0));
setTimeout(close, 3000).unref();
