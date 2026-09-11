import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareMission,
  resumeMission,
  pauseMission,
  restoreMission,
  nextRouteOperation,
  confirmRouteOperation,
  abortMission,
} from "../renderer/src/domain/routeAutopilot.ts";
import { cargoMission, cargoActionPreflight } from "../renderer/src/domain/cargoAutopilot.ts";
import { calculateFreighterRoutes } from "../renderer/src/domain/freighterRoutes.ts";
import { RouteRunner } from "../renderer/src/features/autopilot/RouteRunner.ts";
const resolve = (name) => ({
  name,
  system: name + " System",
  galaxy: { x: 10, y: 20 },
  position: { x: 100, y: 200, z: 300 },
  arrival: { kind: "planet" },
});
const ship = { name: "Hauler", enterPath: ["n"], exitPath: ["s"] };
const mission = {
  id: "tour",
  ship,
  stops: ["Corellia", "Coruscant"].map((name) => ({
    destination: resolve(name),
    actions: [],
    refuel: true,
  })),
  repetitions: 1,
};
const evidence = (op) => ({
  runId: op.runId,
  operationId: op.id,
  outcome: "completed",
  location: { ship: "Hauler", destination: op.destination.name, landedOrDocked: true },
  interruptedOutcome: "not_started",
});

test("continuous circuits reconcile each lap, preserve unique operations and restore paused", async () => {
  const looping = { ...structuredClone(mission), repeatUntilStopped: true };
  looping.stops.push(structuredClone(looping.stops[0]));
  looping.stops[0].actions.push({
    kind: "cargo.buy",
    label: "Buy Food",
    payload: { resource: "Food", quantity: 10 },
  });
  looping.stops[1].actions.push({
    kind: "cargo.sell",
    label: "Sell Food",
    payload: { resource: "Food", quantity: 10 },
  });
  const operations = [];
  let block = true;
  let saved;
  const runner = new RouteRunner(
    prepareMission(looping, "continuous"),
    {
      execute: async (op) => {
        operations.push(op);
        if (block && op.lap === 100) throw new Error("Connection lost");
        return evidence(op);
      },
    },
    {
      save: async (state) => {
        saved = state;
      },
    },
    () => {},
  );
  await runner.resume();
  assert.equal(runner.state.status, "paused");
  assert.equal(runner.state.lap, 100);
  assert.equal(new Set(operations.map((op) => op.id)).size, operations.length);
  assert.equal(operations.filter((op) => op.kind === "reconcile").length, 101);
  assert.equal(operations.filter((op) => op.action?.kind === "cargo.buy").length, 100);
  assert.equal(operations.filter((op) => op.action?.kind === "cargo.sell").length, 100);
  assert.equal(restoreMission(JSON.parse(JSON.stringify(saved))).status, "paused");
  assert.equal(saved.mission.repeatUntilStopped, true);
  block = false;
  await runner.resume(false);
  assert.equal(runner.state.status, "completed");
  assert.equal(runner.state.lap, 100);
  assert.equal(runner.state.mission.repeatUntilStopped, false);
});

test("continuous missions must return to their origin", () => {
  assert.throws(
    () => prepareMission({ ...mission, repeatUntilStopped: true }, "open"),
    /return to their origin/,
  );
});

test("session accounting excludes pauses, deduplicates totals and survives restore", async () => {
  let now = 0;
  let dispatch;
  const ready = () =>
    new Promise((resolve) => {
      dispatch = resolve;
    });
  let issued = ready();
  let saved;
  const runner = new RouteRunner(
    prepareMission(mission, "finance"),
    {
      execute: () => {
        dispatch();
        return new Promise(() => {});
      },
    },
    {
      save: async (state) => {
        saved = state;
      },
    },
    () => {},
    100000,
    () => now,
  );
  const first = runner.resume();
  await issued;
  now = 60000;
  await runner.track({ revision: 3, revenue: 2000, cargo: 1000, fuel: 100, tax: 50 });
  await runner.track({ revision: 3, revenue: 2000, cargo: 1000, fuel: 100, tax: 50 });
  await runner.pause();
  await first;
  assert.equal(saved.runningMs, 60000);
  now += 3600000;
  await runner.track();
  assert.equal(saved.runningMs, 60000);
  issued = ready();
  const second = runner.resume();
  await issued;
  now += 30000;
  await runner.abort();
  await second;
  assert.equal(saved.runningMs, 90000);
  assert.equal(
    saved.accounts.revenue - saved.accounts.cargo - saved.accounts.fuel - saved.accounts.tax,
    850,
  );
  const restored = restoreMission(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.runningMs, 90000);
  assert.deepEqual(restored.accounts, saved.accounts);
});

test("autopilot requires both access paths or explicit direct cockpit access", () => {
  for (const access of [
    { enterPath: [], exitPath: [] },
    { enterPath: ["n"], exitPath: [] },
    { enterPath: [], exitPath: ["s"] },
    { enterPath: ["n"], exitPath: ["s"], directCockpit: true },
  ])
    assert.throws(
      () => prepareMission({ ...mission, ship: { ...ship, ...access } }, "run"),
      /cockpit/,
    );
  assert.doesNotThrow(() =>
    prepareMission(
      { ...mission, ship: { ...ship, enterPath: [], exitPath: [], directCockpit: true } },
      "run",
    ),
  );
});

test("preparation rejects invalid paths and cargo quantities before any commerce", () => {
  for (const field of ["enterPath", "exitPath"]) {
    assert.throws(
      () => prepareMission({ ...mission, ship: { ...ship, [field]: ["typo"] } }, "run"),
      /movement directions/,
    );
  }
  for (const quantity of [NaN, Infinity, 0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = structuredClone(mission);
    invalid.stops[0].actions = [
      { kind: "cargo.buy", label: "buy", payload: { resource: "Test Food", quantity } },
    ];
    assert.throws(() => prepareMission(invalid, "run"), /quantities/);
  }
});

test("manual range is checked for every leg before the first purchase", () => {
  const draft = structuredClone(mission);
  draft.routingMode = "manual";
  draft.maxDistance = 35;
  draft.stops.push({
    ...structuredClone(draft.stops[1]),
    destination: { ...resolve("Far Test Planet"), galaxy: { x: 99, y: 99 } },
  });
  assert.throws(() => prepareMission(draft, "run"), /exceeds the maximum/);
  draft.stops.pop();
  assert.doesNotThrow(() => prepareMission(draft, "run"));
  for (const maximum of [0, -1, NaN, Infinity]) {
    draft.maxDistance = maximum;
    assert.throws(() => prepareMission(draft, "run"), /finite positive/);
  }
});

test("immediate resume waits for the cancelled driver before dispatching again", async () => {
  let issued;
  const started = new Promise((resolve) => {
    issued = resolve;
  });
  let first = true;
  const runner = new RouteRunner(
    prepareMission(mission, "run"),
    {
      execute: async (op) => {
        if (first) {
          first = false;
          issued();
          return new Promise(() => {});
        }
        return evidence(op);
      },
    },
    { save: async () => {} },
    () => {},
  );
  const original = runner.resume();
  await started;
  const paused = runner.pause();
  const resumed = runner.resume();
  await Promise.all([original, paused, resumed]);
  assert.equal(runner.state.status, "completed");
});

test("non-cargo navigation runs without cargo and journals each intent before dispatch", async () => {
  const saved = [];
  const sent = [];
  const runner = new RouteRunner(
    prepareMission(mission, "run"),
    {
      execute: async (op) => {
        assert.equal(saved.at(-1).pending.id, op.id);
        sent.push(op.kind);
        return evidence(op);
      },
    },
    {
      save: async (s) => {
        saved.push(s);
      },
    },
    () => {},
  );
  await runner.resume();
  assert.equal(runner.state.status, "completed");
  assert.deepEqual(sent, ["reconcile", "refuel", "navigate", "refuel"]);
});
test("hyperspace arrival is not landed arrival and unrelated confirmations do not advance", () => {
  let { state, operation } = nextRouteOperation(resumeMission(prepareMission(mission, "run")));
  assert.equal(
    confirmRouteOperation(state, { ...evidence(operation), operationId: "other" }),
    state,
  );
  state = confirmRouteOperation(state, {
    ...evidence(operation),
    location: { ship: "Hauler", destination: "Corellia", landedOrDocked: false },
  });
  assert.equal(state.status, "blocked");
});
test("cargo adapter sells before buying, returns to sell once, and preserves transit stops", () => {
  const [route] = calculateFreighterRoutes(
    [
      { name: "Corellia", resources: { Food: 1, Ore: 10 } },
      { name: "Coruscant", resources: { Food: 10, Ore: 1 } },
    ],
    [],
    { cargoCapacity: 10, maxJumpsPerLeg: 2 },
  );
  const compiled = cargoMission(route, "cargo", ship, resolve, 2);
  assert.deepEqual(
    compiled.stops.map((s) => s.actions.map((a) => a.kind)),
    [["cargo.buy"], ["cargo.sell", "cargo.buy"], ["cargo.sell"]],
  );
  assert.deepEqual(
    compiled.stops.map((s) => s.destination.name),
    ["Corellia", "Coruscant", "Corellia"],
  );
  assert.throws(() => cargoMission(route, "cargo", ship, () => undefined), /missing/);
});
test("uncertain purchases survive restore and are reconciled without automatic replay", () => {
  const tradeMission = {
    ...mission,
    stops: [
      {
        ...mission.stops[0],
        actions: [{ kind: "cargo.buy", label: "Buy", payload: { resource: "Food", quantity: 10 } }],
      },
    ],
  };
  let state = resumeMission(prepareMission(tradeMission, "run"));
  for (let i = 0; i < 2; i++) {
    const issued = nextRouteOperation(state);
    state = confirmRouteOperation(issued.state, evidence(issued.operation));
  }
  const purchase = nextRouteOperation(state);
  assert.equal(purchase.operation.kind, "stop_action");
  state = resumeMission(restoreMission(purchase.state));
  const reconciliation = nextRouteOperation(state);
  assert.equal(reconciliation.state.interrupted.id, purchase.operation.id);
  state = confirmRouteOperation(reconciliation.state, {
    ...evidence(reconciliation.operation),
    interruptedOutcome: "completed",
  });
  assert.equal(nextRouteOperation(state).state.status, "completed");
});
test("unknown reconciliation remains blocked and can be attempted again", () => {
  let step = nextRouteOperation(resumeMission(prepareMission(mission, "run")));
  let state = confirmRouteOperation(step.state, {
    ...evidence(step.operation),
    interruptedOutcome: "unknown",
  });
  assert.equal(state.status, "blocked");
  step = nextRouteOperation(resumeMission(state));
  assert.equal(step.operation.kind, "reconcile");
});
test("pause, abort, rejected commands and storage failures prevent further dispatch", async () => {
  let calls = 0;
  const runner = new RouteRunner(
    prepareMission(mission, "run"),
    {
      execute: async (op) => {
        calls++;
        return evidence(op);
      },
    },
    {
      save: async () => {
        throw Error("disk full");
      },
    },
    () => {},
  );
  await runner.resume();
  assert.equal(calls, 0);
  assert.equal(runner.state.status, "paused");
  const issued = nextRouteOperation(resumeMission(prepareMission(mission, "other")));
  assert.equal(nextRouteOperation(pauseMission(issued.state)).operation, undefined);
  const aborted = abortMission(issued.state);
  assert.equal(confirmRouteOperation(aborted, evidence(issued.operation)), aborted);
  const rejected = confirmRouteOperation(issued.state, {
    ...evidence(issued.operation),
    outcome: "rejected",
  });
  assert.equal(rejected.status, "blocked");
});
test("timeouts preserve uncertainty instead of resending", async () => {
  let calls = 0;
  const runner = new RouteRunner(
    prepareMission(mission, "run"),
    {
      execute: () => {
        calls++;
        return new Promise(() => {});
      },
    },
    { save: async () => {} },
    () => {},
    5,
  );
  await runner.resume();
  assert.equal(calls, 1);
  assert.equal(runner.state.status, "paused");
  assert.ok(runner.state.pending);
});
test("cargo affordability and actual inventory gate commerce", () => {
  const action = { kind: "cargo.buy", label: "buy", payload: { resource: "Food", quantity: 10 } };
  const actual = { credits: 100, capacity: 10, used: 0, cargo: {}, unitPrice: 5 };
  assert.equal(cargoActionPreflight(action, actual), null);
  assert.match(cargoActionPreflight(action, { ...actual, credits: 1 }), /credits/);
  assert.match(cargoActionPreflight(action, { ...actual, used: 5 }), /space/);
  assert.match(cargoActionPreflight({ ...action, kind: "cargo.sell" }, actual), /not in the hold/);
});
