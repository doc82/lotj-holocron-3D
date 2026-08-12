#!/usr/bin/env node

import readline from "node:readline";

const PROTOCOL_VERSION = 1;
const demoIntent = process.argv.includes("--demo-intent");
let demoSent = false;

function write(message) {
  process.stdout.write(`${JSON.stringify({ v: PROTOCOL_VERSION, ...message })}\n`);
}

function log(message) {
  write({ type: "bridge_diagnostic", level: "info", message });
}

function handleMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    log("ignored a non-object message");
    return;
  }

  if (message.v !== PROTOCOL_VERSION) {
    log(`unsupported protocol version: ${String(message.v)}`);
    return;
  }

  switch (message.type) {
    case "hello":
      write({ type: "ready", bridge: "mock-bridge" });
      if (demoIntent && !demoSent) {
        demoSent = true;
        setTimeout(() => {
          write({
            type: "intent",
            id: `mock-${Date.now()}`,
            action: "prototype_ping",
            payload: { message: "Mudlet received bridge output" },
          });
        }, 100);
      }
      break;

    case "system_snapshot":
      write({
        type: "snapshot_received",
        sequence: message.sequence,
        entityCount: Array.isArray(message.entities) ? message.entities.length : 0,
      });
      break;

    case "space_state":
      write({
        type: "space_state_received",
        inSpace: message.inSpace === true,
      });
      break;

    case "intent_ack":
      log(`intent ${String(message.id)} was ${String(message.status)}`);
      break;

    case "shutdown":
      log("shutdown requested");
      process.exit(0);
      break;

    default:
      log(`ignored message type: ${String(message.type)}`);
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
    handleMessage(JSON.parse(line));
  } catch (error) {
    log(`invalid JSON: ${error.message}`);
  }
});

input.on("close", () => {
  log("Mudlet pipe closed");
});
