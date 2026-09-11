import assert from "node:assert/strict";
import test from "node:test";
import { MudletRouteTransport } from "../renderer/src/features/autopilot/MudletRouteTransport.ts";
import { RouteRunner } from "../renderer/src/features/autopilot/RouteRunner.ts";
import { prepareMission } from "../renderer/src/domain/routeAutopilot.ts";

function apiFixture() {
  const snapshots = new Set();
  const acks = new Set();
  const sent = [];
  return {
    snapshots,
    acks,
    sent,
    onSnapshot: (cb) => {
      snapshots.add(cb);
      return () => snapshots.delete(cb);
    },
    onIntentAck: (cb) => {
      acks.add(cb);
      return () => acks.delete(cb);
    },
    sendIntent: async (action, payload) => {
      sent.push({ action, payload });
      return { accepted: true, id: String(sent.length) };
    },
    publish: (navigation) => {
      for (const cb of snapshots) cb({ metadata: { routeNavigation: navigation } });
    },
  };
}
const ship = { name: "Sunrise", enterPath: ["n"], exitPath: ["s"] };
const destination = {
  name: "Corellia",
  system: "Corellia System",
  galaxy: { x: 10, y: 20 },
  arrival: { kind: "planet" },
};
const checkpoint = () =>
  prepareMission(
    { id: "test", ship, repetitions: 1, stops: [{ destination, refuel: true, actions: [] }] },
    "run",
  );
const operation = { id: "run:1", runId: "run", kind: "reconcile", destination };
const confirmation = (op) => ({
  operationId: op.id,
  runId: op.runId,
  outcome: "completed",
  interruptedOutcome: "not_started",
  location: { ship: ship.name, destination: op.destination.name, landedOrDocked: true },
});

test("transport waits for matching physical confirmation and removes listeners", async () => {
  const api = apiFixture();
  const pending = new MudletRouteTransport(api).execute(
    operation,
    checkpoint(),
    new AbortController().signal,
  );
  let finished = false;
  void pending.then(() => {
    finished = true;
  });
  api.publish({
    operationId: "old",
    runId: "run",
    status: "completed",
    confirmation: confirmation(operation),
  });
  await Promise.resolve();
  assert.equal(finished, false);
  api.publish({
    operationId: operation.id,
    runId: "run",
    status: "completed",
    confirmation: confirmation(operation),
  });
  assert.deepEqual(await pending, confirmation(operation));
  assert.equal(api.snapshots.size, 0);
  assert.equal(api.acks.size, 0);
});

test("cancellation sends a stop for this run and ignores late success", async () => {
  const api = apiFixture();
  const abort = new AbortController();
  const pending = new MudletRouteTransport(api).execute(operation, checkpoint(), abort.signal);
  abort.abort();
  await assert.rejects(pending, /Stopped/);
  assert.deepEqual(api.sent.at(-1), { action: "route_stop", payload: { runId: "run" } });
  assert.equal(api.snapshots.size, 0);
});

test("runner connects journal, Mudlet intents and confirmation snapshots", async () => {
  const api = apiFixture();
  const writes = [];
  api.sendIntent = async (action, payload) => {
    api.sent.push({ action, payload });
    const op = payload.operation;
    assert.equal(writes.at(-1).pending.id, op.id);
    queueMicrotask(() =>
      api.publish({
        operationId: op.id,
        runId: op.runId,
        status: "completed",
        confirmation: confirmation(op),
      }),
    );
    return { accepted: true, id: op.id };
  };
  const runner = new RouteRunner(
    checkpoint(),
    new MudletRouteTransport(api),
    {
      save: async (state) => {
        writes.push(state);
      },
    },
    () => {},
  );
  await runner.resume();
  assert.equal(runner.state.status, "completed");
  assert.deepEqual(
    api.sent.map((entry) => entry.payload.operation.kind),
    ["reconcile", "refuel"],
  );
  assert.equal(writes.at(-1).status, "completed");
});
