import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { WebSocket } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.resolve(here, "../tools/network-bridge.mjs");

function messageReader(subscribe) {
  const messages = [];
  const waiters = [];
  subscribe((message) => {
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.predicate(message)) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });

  return {
    waitFor(predicate, timeoutMs = 2000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("timed out waiting for message"));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

function pipeReader(stream) {
  return messageReader((emit) => {
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    lines.on("line", (line) => emit(JSON.parse(line)));
  });
}

function websocketReader(socket) {
  return messageReader((emit) => {
    socket.on("message", (raw) => emit(JSON.parse(raw.toString())));
  });
}

function sendPipe(child, message) {
  child.stdin.write(`${JSON.stringify({ v: 1, ...message })}\n`);
}

test("network bridge proxies snapshots and serves the renderer", async (t) => {
  const child = spawn(process.execPath, [bridgePath, "--port=0", "--http-port=0"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const sockets = [];
  t.after(() => {
    for (const socket of sockets) socket.close();
    if (!child.killed) child.kill();
  });

  const pipe = pipeReader(child.stdout);
  sendPipe(child, { type: "hello", source: "test" });
  const ready = await pipe.waitFor((message) => message.type === "ready");
  assert.equal(ready.bridge, "network-bridge");
  assert.match(ready.websocketUrl, /^ws:\/\/127\.0\.0\.1:\d+$/);
  assert.match(ready.rendererUrl, /^http:\/\/127\.0\.0\.1:\d+$/);

  const rendererResponse = await fetch(ready.rendererUrl);
  assert.equal(rendererResponse.status, 200);
  assert.match(await rendererResponse.text(), /HOLOCRON 3D/);
  const configResponse = await fetch(`${ready.rendererUrl}/config.json`);
  assert.deepEqual(await configResponse.json(), {
    v: 1,
    websocketUrl: ready.websocketUrl,
  });

  const client = new WebSocket(ready.websocketUrl);
  sockets.push(client);
  const clientMessages = websocketReader(client);
  await once(client, "open");
  const clientReady = await clientMessages.waitFor(
    (message) => message.type === "bridge_ready",
  );
  assert.equal(clientReady.v, 1);
  assert.equal(clientReady.rendererUrl, ready.rendererUrl);

  sendPipe(child, {
    type: "system_snapshot",
    sequence: 7,
    observer: { id: "player-ship", x: 10, y: 20, z: 30 },
    entities: [{ id: "gore", kind: "ship", x: 0, y: 0, z: 0 }],
    metadata: { system: "Esstran Sector", inSpace: true },
  });
  const snapshot = await clientMessages.waitFor(
    (message) => message.type === "system_snapshot" && message.sequence === 7,
  );
  assert.equal(snapshot.metadata.system, "Esstran Sector");
  assert.equal(snapshot.entities[0].id, "gore");
  await pipe.waitFor(
    (message) => message.type === "snapshot_received" && message.sequence === 7,
  );

  sendPipe(child, {
    type: "space_state",
    inSpace: false,
    reason: "landing sequence complete",
  });
  const landed = await clientMessages.waitFor(
    (message) => message.type === "space_state" && message.inSpace === false,
  );
  assert.equal(landed.reason, "landing sequence complete");

  client.send(JSON.stringify({
    v: 1,
    type: "intent",
    id: "third-party-1",
    action: "prototype_ping",
    payload: { message: "network round trip" },
  }));
  const intent = await pipe.waitFor(
    (message) => message.type === "intent" && message.id === "third-party-1",
  );
  assert.equal(intent.action, "prototype_ping");

  sendPipe(child, {
    type: "intent_ack",
    id: "third-party-1",
    status: "accepted",
  });
  const ack = await clientMessages.waitFor(
    (message) => message.type === "intent_ack" && message.id === "third-party-1",
  );
  assert.equal(ack.status, "accepted");

  client.send(JSON.stringify({ v: 1, type: "raw_command", command: "fire" }));
  const rejected = await clientMessages.waitFor(
    (message) => message.type === "client_error",
  );
  assert.match(rejected.reason, /only send intent/);

  const lateClient = new WebSocket(ready.websocketUrl);
  sockets.push(lateClient);
  const lateMessages = websocketReader(lateClient);
  await once(lateClient, "open");
  const replayedState = await lateMessages.waitFor(
    (message) => message.type === "space_state",
  );
  const replayedSnapshot = await lateMessages.waitFor(
    (message) => message.type === "system_snapshot",
  );
  assert.equal(replayedState.inSpace, false);
  assert.equal(replayedSnapshot.sequence, 7);

  client.close();
  lateClient.close();
  await Promise.all([once(client, "close"), once(lateClient, "close")]);
  sendPipe(child, { type: "shutdown" });
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0);
});
