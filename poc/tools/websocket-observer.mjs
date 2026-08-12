#!/usr/bin/env node

import { WebSocket } from "ws";

const url = process.argv[2] || "ws://127.0.0.1:8787";
const socket = new WebSocket(url);

socket.on("open", () => {
  process.stdout.write(`Connected to ${url}\n`);
});

socket.on("message", (raw) => {
  try {
    process.stdout.write(`${JSON.stringify(JSON.parse(raw.toString()), null, 2)}\n`);
  } catch {
    process.stdout.write(`${raw.toString()}\n`);
  }
});

socket.on("error", (error) => {
  process.stderr.write(`WebSocket error: ${error.message}\n`);
  process.exitCode = 1;
});

socket.on("close", (code, reason) => {
  process.stdout.write(`Disconnected (${code}${reason.length ? `: ${reason}` : ""})\n`);
});

process.on("SIGINT", () => socket.close(1000, "observer stopped"));
