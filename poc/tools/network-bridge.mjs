#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const PROTOCOL_VERSION = 1;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_HTTP_PORT = 8788;
const MAX_CLIENTS = 8;
const rendererRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../renderer/dist",
);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

const host = option("host", DEFAULT_HOST);
const requestedPort = Number(option("port", DEFAULT_PORT));
const requestedHttpPort = Number(option("http-port", requestedPort === 0 ? 0 : DEFAULT_HTTP_PORT));
if (
  !Number.isInteger(requestedPort) ||
  requestedPort < 0 ||
  requestedPort > 65535 ||
  !Number.isInteger(requestedHttpPort) ||
  requestedHttpPort < 0 ||
  requestedHttpPort > 65535
) {
  process.stdout.write(
    `${JSON.stringify({
      v: PROTOCOL_VERSION,
      type: "bridge_diagnostic",
      level: "error",
      message: "--port and --http-port must be integers from 0 through 65535",
    })}\n`,
  );
  process.exit(1);
}

let mudletConnected = false;
let serverListening = false;
let httpServerListening = false;
let readySent = false;
let shuttingDown = false;
let websocketUrl = null;
let rendererUrl = null;
let latestSnapshot = null;
let latestSpaceState = null;

function write(message) {
  process.stdout.write(`${JSON.stringify({ v: PROTOCOL_VERSION, ...message })}\n`);
}

function diagnostic(level, message) {
  write({ type: "bridge_diagnostic", level, message });
}

function maybeReady() {
  if (!mudletConnected || !serverListening || !httpServerListening || readySent) return;
  readySent = true;
  write({
    type: "ready",
    bridge: "network-bridge",
    websocketUrl,
    rendererUrl,
  });
}

function broadcast(message) {
  const encoded = JSON.stringify({ v: PROTOCOL_VERSION, ...message });
  for (const client of server.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function validIntent(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "message must be an object";
  }
  if (message.v !== PROTOCOL_VERSION) return "unsupported protocol version";
  if (message.type !== "intent") return "clients may only send intent messages";
  if (typeof message.id !== "string" || !message.id || message.id.length > 128) {
    return "intent id must be a non-empty string no longer than 128 characters";
  }
  if (typeof message.action !== "string" || !message.action) {
    return "intent action must be a non-empty string";
  }
  if (
    message.payload !== undefined &&
    (!message.payload || typeof message.payload !== "object" || Array.isArray(message.payload))
  ) {
    return "intent payload must be an object";
  }
  return null;
}

function handleClientMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    client.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "client_error",
        reason: "invalid JSON",
      }),
    );
    return;
  }

  const error = validIntent(message);
  if (error) {
    client.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "client_error",
        id: typeof message?.id === "string" ? message.id : undefined,
        reason: error,
      }),
    );
    return;
  }

  write({
    type: "intent",
    id: message.id,
    action: message.action,
    payload: message.payload ?? {},
  });
}

const server = new WebSocketServer({
  host,
  port: requestedPort,
  maxPayload: 64 * 1024,
});

server.on("listening", () => {
  const address = server.address();
  const displayHost = host.includes(":") ? `[${host}]` : host;
  websocketUrl = `ws://${displayHost}:${address.port}`;
  serverListening = true;
  maybeReady();
});

server.on("connection", (client) => {
  if (server.clients.size > MAX_CLIENTS) {
    client.close(1013, "too many clients");
    return;
  }

  client.send(
    JSON.stringify({
      v: PROTOCOL_VERSION,
      type: "bridge_ready",
      bridge: "network-bridge",
      websocketUrl,
      rendererUrl,
    }),
  );
  if (latestSpaceState) client.send(JSON.stringify(latestSpaceState));
  if (latestSnapshot) client.send(JSON.stringify(latestSnapshot));

  client.on("message", (raw, isBinary) => {
    if (isBinary) {
      client.close(1003, "binary messages are unsupported");
      return;
    }
    handleClientMessage(client, raw);
  });
  client.on("error", (error) => {
    diagnostic("warn", `WebSocket client error: ${error.message}`);
  });
});

const rendererContentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

const httpServer = http.createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; " +
      "img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'",
  );

  if (pathname === "/config.json") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ v: PROTOCOL_VERSION, websocketUrl }));
    return;
  }
  if (pathname === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok\n");
    return;
  }

  const relativeAsset = pathname === "/" ? "index.html" : pathname.slice(1);
  const assetPath = path.resolve(rendererRoot, relativeAsset);
  if (!assetPath.startsWith(`${rendererRoot}${path.sep}`)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }

  try {
    const body = await readFile(assetPath);
    const contentType =
      rendererContentTypes.get(path.extname(assetPath)) || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
  }
});

httpServer.on("listening", () => {
  const address = httpServer.address();
  const displayHost = host.includes(":") ? `[${host}]` : host;
  rendererUrl = `http://${displayHost}:${address.port}`;
  httpServerListening = true;
  maybeReady();
});

httpServer.on("error", (error) => {
  diagnostic("error", `renderer server error: ${error.message}`);
  if (!httpServerListening) setTimeout(() => process.exit(1), 25);
});

httpServer.listen(requestedHttpPort, host);

server.on("error", (error) => {
  diagnostic("error", `WebSocket server error: ${error.message}`);
  if (!serverListening) setTimeout(() => process.exit(1), 25);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const client of server.clients) client.close(1001, "bridge shutting down");
  let closedServers = 0;
  const closed = () => {
    closedServers += 1;
    if (closedServers === 2) process.exit(0);
  };
  server.close(closed);
  httpServer.close(closed);
  setTimeout(() => process.exit(0), 500).unref();
}

function handleMudletMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    diagnostic("warn", "ignored a non-object message from Mudlet");
    return;
  }
  if (message.v !== PROTOCOL_VERSION) {
    diagnostic("warn", `unsupported protocol version: ${String(message.v)}`);
    return;
  }

  switch (message.type) {
    case "hello":
      mudletConnected = true;
      maybeReady();
      break;

    case "system_snapshot":
      latestSnapshot = message;
      broadcast(message);
      write({
        type: "snapshot_received",
        sequence: message.sequence,
        entityCount: Array.isArray(message.entities) ? message.entities.length : 0,
        polled: message.metadata?.lastCapturePolled === true,
      });
      break;

    case "space_state":
      latestSpaceState = message;
      broadcast(message);
      write({ type: "space_state_received", inSpace: message.inSpace === true });
      break;

    case "intent_ack":
      broadcast(message);
      break;

    case "shutdown":
      shutdown();
      break;

    default:
      diagnostic("warn", `ignored Mudlet message type: ${String(message.type)}`);
  }
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handleMudletMessage(JSON.parse(line));
  } catch (error) {
    diagnostic("error", `invalid JSON from Mudlet: ${error.message}`);
  }
});

input.on("close", shutdown);
