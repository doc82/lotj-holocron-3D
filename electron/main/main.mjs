import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import {
  MAX_LINE_BYTES,
  PROTOCOL_VERSION,
  createTelemetryHost,
  validateIntent,
} from "../shared/protocol.mjs";
import { ensureRelayToken, validateRelayAuth } from "../shared/relay-auth.mjs";
import { appDataPaths } from "../shared/app-paths.mjs";

const root = app.getAppPath();
const rendererEntry = path.join(root, "renderer", "dist", "index.html");
const rendererDevUrl = !app.isPackaged ? process.env.HOLOCRON_RENDERER_URL : undefined;
const preloadEntry = path.join(root, "electron", "preload", "preload.cjs");
const appIcon = path.join(root, "assets", "icon", "holocron3d-icon.png");
const requestedPort = Number(process.env.HOLOCRON_WS_PORT || 8787);
const requestedRelayPort = Number(process.env.HOLOCRON_RELAY_PORT || 8786);
const paths = appDataPaths();
const relayToken = ensureRelayToken(paths.token);
fs.mkdirSync(paths.logs, { recursive: true });
let mainWindow = null;
let closing = false;
let mudletSocket = null;

function debug(message) {
  try {
    fs.appendFileSync(paths.log, `${JSON.stringify({ at: new Date().toISOString(), level: "debug", message })}\n`);
  } catch {
    // A logging failure must never prevent the renderer from starting.
  }
  if (process.env.HOLOCRON_DEBUG_STDERR === "1") {
    process.stderr.write(`[Holocron3D/Electron] ${message}\n`);
  }
}

function write(message) {
  if (mudletSocket && !mudletSocket.destroyed) {
    mudletSocket.write(`${JSON.stringify(message)}\n`);
  }
}

function sendToRenderer(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(`holocron:${channel}`, value);
  }
}

function broadcast(message) {
  const encoded = JSON.stringify(message);
  for (const client of websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function shutdown() {
  if (closing) return;
  debug("shutdown requested");
  closing = true;
  mudletSocket?.destroy();
  relayServer.close();
  for (const client of websocketServer.clients) client.close(1001, "app shutting down");
  websocketServer.close(() => app.quit());
  setTimeout(() => app.quit(), 500).unref();
}

const host = createTelemetryHost({
  write,
  emit: sendToRenderer,
  broadcast,
  shutdown,
});

const automationLeaseTimer = setInterval(() => {
  write({ v: PROTOCOL_VERSION, type: "automation_lease", expiresInSeconds: 6 });
}, 2_000);
automationLeaseTimer.unref();

const websocketServer = new WebSocketServer({
  host: "127.0.0.1",
  port: requestedPort,
  maxPayload: 64 * 1024,
});

const relayServer = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.setNoDelay(true);
  socket.setTimeout(3000, () => socket.destroy(new Error("relay authentication timed out")));
  let buffer = "";
  let authenticated = false;

  function reply(message) {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  }

  socket.on("data", (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES * 2) {
      socket.destroy(new Error("relay input buffer exceeded limit"));
      return;
    }
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        reply({ v: PROTOCOL_VERSION, type: "bridge_diagnostic", level: "error", message: "oversized Mudlet message discarded" });
        continue;
      }
      try {
        const message = JSON.parse(line);
        if (!authenticated) {
          if (!validateRelayAuth(message, relayToken)) {
            debug("rejected unauthenticated relay connection");
            socket.destroy();
            return;
          }
          authenticated = true;
          socket.setTimeout(0);
          if (mudletSocket && !mudletSocket.destroyed) mudletSocket.destroy();
          mudletSocket = socket;
          debug("authenticated Mudlet relay connected");
          continue;
        }
        host.handleMudletMessage(message);
      } catch (error) {
        reply({ v: PROTOCOL_VERSION, type: "bridge_diagnostic", level: "error", message: `invalid JSON from Mudlet: ${error.message}` });
      }
    }
  });
  socket.on("close", () => {
    if (authenticated && mudletSocket === socket) {
      mudletSocket = null;
      host.disconnectMudlet();
    }
  });
  socket.on("end", () => socket.end());
  socket.on("error", (error) => debug(`Mudlet relay error: ${error.message}`));
});

relayServer.listen(requestedRelayPort, "127.0.0.1", () => {
  debug(`Mudlet relay listening on 127.0.0.1:${requestedRelayPort}`);
});

websocketServer.on("listening", () => {
  const address = websocketServer.address();
  host.setWebsocketUrl(`ws://127.0.0.1:${address.port}`);
});

websocketServer.on("connection", (client) => {
  client.send(JSON.stringify({
    v: PROTOCOL_VERSION,
    type: "bridge_ready",
    bridge: "electron-host",
  }));
  const initial = host.initialState();
  if (initial.spaceState) client.send(JSON.stringify(initial.spaceState));
  if (initial.snapshot) client.send(JSON.stringify(initial.snapshot));

  client.on("message", (raw, binary) => {
    if (binary) {
      client.close(1003, "binary messages are unsupported");
      return;
    }
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      client.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "client_error", reason: "invalid JSON" }));
      return;
    }
    const result = host.handleIntent(message);
    if (!result.accepted) {
      client.send(JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "client_error",
        id: typeof message?.id === "string" ? message.id : undefined,
        reason: result.reason,
      }));
    }
  });
});

websocketServer.on("error", (error) => {
  debug(`WebSocket compatibility endpoint unavailable: ${error.message}`);
  write({
    v: PROTOCOL_VERSION,
    type: "bridge_diagnostic",
    level: "error",
    message: `WebSocket server error: ${error.message}`,
  });
});

function validRenderer(frame) {
  if (!frame?.url) return false;
  try {
    const expected = rendererDevUrl || pathToFileURL(rendererEntry).href;
    const actual = new URL(frame.url);
    actual.hash = "";
    return actual.href === expected;
  } catch {
    return false;
  }
}

ipcMain.handle("holocron:get-initial-state", (event) => {
  if (!validRenderer(event.senderFrame)) return null;
  return host.initialState();
});

ipcMain.handle("holocron:get-app-version", (event) => {
  if (!validRenderer(event.senderFrame)) return null;
  return app.getVersion();
});

ipcMain.handle("holocron:send-intent", (event, request) => {
  if (!validRenderer(event.senderFrame)) return { accepted: false, reason: "invalid sender" };
  const message = {
    v: PROTOCOL_VERSION,
    type: "intent",
    id: `renderer-${Date.now()}-${randomUUID()}`,
    action: request?.action,
    payload: request?.payload,
  };
  const error = validateIntent(message);
  return error ? { accepted: false, reason: error } : { ...host.handleIntent(message), id: message.id };
});

function createWindow() {
  const rendererUrl = rendererDevUrl || pathToFileURL(rendererEntry).href;
  debug(`creating renderer window from ${rendererUrl} (production entry exists=${fs.existsSync(rendererEntry)})`);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#03050a",
    title: "LotJ Holocron 3D",
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadEntry,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== rendererUrl) event.preventDefault();
  });
  if (rendererDevUrl) mainWindow.loadURL(rendererDevUrl);
  else mainWindow.loadFile(rendererEntry);
  mainWindow.webContents.on("did-finish-load", () => debug("renderer loaded"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    debug(`renderer load failed ${code}: ${description}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    debug(`renderer process exited: ${details.reason}`);
  });
  mainWindow.on("closed", () => {
    debug("renderer window closed");
    mainWindow = null;
    shutdown();
  });
}

const gotLock = app.requestSingleInstanceLock();
debug(`single instance lock: ${gotLock}`);
if (!gotLock) {
  app.quit();
} else {
  app.setAppUserModelId("com.veska.holocron3d");
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => {
    debug("app ready");
    createWindow();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on("before-quit", () => { closing = true; });
