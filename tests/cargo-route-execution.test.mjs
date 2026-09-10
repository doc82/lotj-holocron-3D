import assert from "node:assert/strict";
import test from "node:test";
import { calculateCargoRoutes } from "../renderer/src/domain/cargoRoutes.ts";
import {
  cargoExecutionReducer,
  initialCargoExecutionState,
  restoreCargoCheckpoint,
} from "../renderer/src/domain/cargoRouteExecution.ts";

function routeFixture() {
  return calculateCargoRoutes(
    [
      { name: "Lorrd", resources: { Textiles: 10 } },
      { name: "Corellia", resources: { Textiles: 20 } },
      { name: "Ryloth", resources: { Textiles: 40 } },
    ],
    [
      { from: "Lorrd", to: "Ryloth", status: "no_route" },
      { from: "Lorrd", to: "Corellia", status: "passable" },
      { from: "Corellia", to: "Ryloth", status: "passable" },
    ],
    { maxJumpsPerLeg: 2, cargoCapacity: 100 },
  ).find((route) => route.buyPlanet === "Lorrd" && route.sellPlanet === "Ryloth");
}

test("requires arrival and both refuel checkpoints at a transit stop", () => {
  const route = routeFixture();
  assert.ok(route);
  let state = cargoExecutionReducer(initialCargoExecutionState, {
    type: "arm",
    route,
    routeId: "route-1",
    now: 1,
  });

  assert.equal(state.phase, "armed");
  assert.equal(state.stops[1].planet, "Corellia");
  assert.equal(state.stops[1].purpose, "transit");

  state = cargoExecutionReducer(state, { type: "arrived", planet: "Lorrd", now: 2 });
  state = cargoExecutionReducer(state, { type: "refuel_on_exit", now: 3 });
  state = cargoExecutionReducer(state, { type: "ship_exited", now: 4 });
  state = cargoExecutionReducer(state, { type: "ship_entered", now: 5 });
  state = cargoExecutionReducer(state, { type: "refuel_on_entry", now: 6 });
  assert.equal(state.phase, "commerce");

  state = cargoExecutionReducer(state, { type: "commerce_complete", now: 7 });
  assert.equal(state.phase, "plotting");
  state = cargoExecutionReducer(state, { type: "leg_plotted", now: 8 });
  state = cargoExecutionReducer(state, { type: "leg_engaged", now: 9 });
  state = cargoExecutionReducer(state, { type: "leg_arrived", planet: "Corellia", now: 10 });
  assert.equal(state.phase, "arrived");

  state = cargoExecutionReducer(state, { type: "refuel_on_exit", now: 11 });
  state = cargoExecutionReducer(state, { type: "ship_exited", now: 12 });
  state = cargoExecutionReducer(state, { type: "ship_entered", now: 13 });
  state = cargoExecutionReducer(state, { type: "refuel_on_entry", now: 14 });
  assert.equal(state.phase, "transit");
});

test("pause and resume preserve a checkpoint for reconciliation", () => {
  const route = routeFixture();
  assert.ok(route);
  let state = cargoExecutionReducer(initialCargoExecutionState, {
    type: "arm",
    route,
    routeId: "route-1",
    now: 1,
  });
  state = cargoExecutionReducer(state, { type: "pause", now: 2 });
  assert.equal(state.phase, "paused");
  assert.equal(state.checkpoint?.stopIndex, 0);
  const restored = restoreCargoCheckpoint(route, state.checkpoint);
  assert.equal(restored.phase, "paused");
  const resumed = cargoExecutionReducer(restored, { type: "resume", now: 3 });
  assert.equal(resumed.phase, "arrived");
  assert.equal(resumed.pendingAction, "reconcile_current_planet_and_cargo");
});

test("unexpected arrivals block execution instead of advancing the route", () => {
  const route = routeFixture();
  assert.ok(route);
  const armed = cargoExecutionReducer(initialCargoExecutionState, {
    type: "arm",
    route,
    routeId: "route-1",
  });
  const blocked = cargoExecutionReducer(armed, { type: "arrived", planet: "Tatooine" });
  assert.equal(blocked.phase, "blocked");
  assert.match(blocked.error, /unexpected arrival/i);
});
