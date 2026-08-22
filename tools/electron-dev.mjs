import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
const rendererUrl = "http://127.0.0.1:5173/";
let shuttingDown = false;

const vite = spawn(process.execPath, [viteCli, "--config", "vite.renderer.config.ts"], {
  cwd: root,
  stdio: "inherit",
});

function waitForVite(attempt = 0) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 5173 });
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", () => {
      socket.destroy();
      if (attempt >= 100) reject(new Error("Vite did not become ready on port 5173."));
      else setTimeout(() => resolve(waitForVite(attempt + 1)), 100);
    });
  });
}

function stop(child) {
  if (child && !child.killed) child.kill();
}

let electron;
try {
  await waitForVite();
  const electronEnv = { ...process.env, HOLOCRON_RENDERER_URL: rendererUrl };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronPath, [root], {
    cwd: root,
    stdio: "inherit",
    env: electronEnv,
  });
  electron.once("exit", (code) => {
    shuttingDown = true;
    stop(vite);
    process.exitCode = code ?? 0;
  });
} catch (error) {
  stop(vite);
  throw error;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stop(electron);
  stop(vite);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
vite.once("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    stop(electron);
    process.exitCode = code ?? 1;
  }
});
