import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgePath = path.resolve(here, "../tools/mock-bridge.mjs");

function createMessageReader(stream) {
  const messages = [];
  const waiters = [];
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  lines.on("line", (line) => {
    const message = JSON.parse(line);
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

  function waitFor(predicate, timeoutMs = 2000) {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("timed out waiting for bridge message"));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  return { waitFor };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify({ v: 1, ...message })}\n`);
}

test("mock bridge exercises handshake, snapshots, and reverse intents", async (t) => {
  const child = spawn(process.execPath, [bridgePath, "--demo-intent"], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  t.after(() => {
    if (!child.killed) child.kill();
  });

  const output = createMessageReader(child.stdout);

  send(child, { type: "hello", source: "test" });

  const ready = await output.waitFor((message) => message.type === "ready");
  assert.equal(ready.v, 1);
  assert.equal(ready.bridge, "mock-bridge");

  const intent = await output.waitFor((message) => message.type === "intent");
  assert.equal(intent.action, "prototype_ping");
  assert.equal(typeof intent.id, "string");

  send(child, {
    type: "system_snapshot",
    sequence: 42,
    observer: { id: "player-ship", x: 0, y: 0, z: 0 },
    entities: [{ id: "contact-1", x: 1, y: 2, z: 3 }],
  });

  const receipt = await output.waitFor(
    (message) => message.type === "snapshot_received" && message.sequence === 42,
  );
  assert.equal(receipt.entityCount, 1);

  send(child, {
    type: "space_state",
    inSpace: false,
    reason: "landing sequence complete",
  });
  const spaceStateReceipt = await output.waitFor(
    (message) => message.type === "space_state_received",
  );
  assert.equal(spaceStateReceipt.inSpace, false);

  send(child, { type: "intent_ack", id: intent.id, status: "accepted" });
  const diagnostic = await output.waitFor(
    (message) => message.type === "bridge_diagnostic" && message.message.includes(intent.id),
  );
  assert.match(diagnostic.message, /accepted/);

  send(child, { type: "shutdown" });
  const [exitCode] = await once(child, "exit");
  assert.equal(exitCode, 0);
});
