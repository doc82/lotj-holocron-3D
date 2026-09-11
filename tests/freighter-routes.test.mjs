import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFreighterRoutes,
  freighterStops,
} from "../renderer/src/domain/freighterRoutes.ts";
import { cargoRouteIdentity } from "../renderer/src/domain/cargoRoutes.ts";
import { readTraderConfig, savedRouteId } from "../renderer/src/features/trader/traderConfig.ts";
import {
  cargoExecutionReducer,
  initialCargoExecutionState,
} from "../renderer/src/domain/cargoRouteExecution.ts";
const constraints = { cargoCapacity: 10, maxJumpsPerLeg: "unlimited", maxTradeStops: "unlimited" };

test("Lorrd to Ryloth circuits use the verified Corellia transit in both directions", () => {
  const planets = [
    { name: "Lorrd", resources: { Food: 1, Ore: 10 } },
    { name: "Ryloth", resources: { Food: 10, Ore: 1 } },
    { name: "Corellia", resources: {} },
  ];
  const [route] = calculateFreighterRoutes(planets, [], constraints);
  assert.deepEqual(
    route.legs.map((leg) => leg.path),
    [
      ["Lorrd", "Corellia", "Ryloth"],
      ["Ryloth", "Corellia", "Lorrd"],
    ],
  );
  assert.deepEqual(
    freighterStops(route).map((stop) => stop.planet),
    ["Lorrd", "Corellia", "Ryloth", "Corellia"],
  );
  assert.equal(
    calculateFreighterRoutes(planets, [], { ...constraints, maxJumpsPerLeg: 1 }).length,
    0,
  );
  assert.equal(
    calculateFreighterRoutes(planets, [], { ...constraints, avoidedPlanets: new Set(["corellia"]) })
      .length,
    0,
  );
});

test("a round trip carries independently chosen return cargo and accounts for tax", () => {
  const routes = calculateFreighterRoutes(
    [
      { name: "Corellia", resources: { Food: 1, Ore: 10 }, taxRate: 10 },
      { name: "Coruscant", resources: { Food: 6, Ore: 2 }, taxRate: 20 },
    ],
    [],
    constraints,
  );
  assert.equal(routes.length, 1);
  const [route] = routes;
  assert.deepEqual(
    route.legs.map((leg) => leg.trade.resource),
    ["Food", "Ore"],
  );
  assert.equal(route.purchaseCost, 30);
  assert.equal(route.saleRevenue, 138);
  assert.equal(route.expectedProfit, 108);
  assert.equal(route.expectedProfitPerHour, 54);
  const stops = freighterStops(route);
  assert.deepEqual(
    stops.map((stop) => stop.planet),
    ["Corellia", "Coruscant"],
  );
  assert.deepEqual(stops[1].actions, ["Sell 10 units of Food", "Buy 10 units of Ore"]);
  assert.ok(stops[0].actions.includes("On return, sell 10 units of Ore"));
});

const triangle = [
  { name: "Corellia", resources: { Food: 1, Ore: 10, Water: 5 } },
  { name: "Coruscant", resources: { Food: 10, Ore: 5, Water: 1 } },
  { name: "Lorrd", resources: { Food: 5, Ore: 1, Water: 10 } },
];
test("three-market circuits can outrank all two-market circuits without rotation duplicates", () => {
  const routes = calculateFreighterRoutes(triangle, [], constraints);
  assert.equal(routes[0].legs.length, 3);
  assert.equal(routes[0].expectedProfit, 270);
  assert.ok(
    routes[0].expectedProfitPerHour >
      Math.max(
        ...routes
          .filter((route) => route.legs.length === 2)
          .map((route) => route.expectedProfitPerHour),
      ),
  );
  assert.equal(new Set(routes.map(cargoRouteIdentity)).size, routes.length);
  assert.equal(routes.filter((route) => route.legs.length === 3).length, 2);
  assert.ok(
    calculateFreighterRoutes(triangle, [], { ...constraints, maxTradeStops: 2 }).every(
      (route) => route.legs.length === 2,
    ),
  );
});
test("empty return is explicit when no return commodity is profitable after tax", () => {
  const [route] = calculateFreighterRoutes(
    [
      { name: "Corellia", resources: { Food: 1, Ore: 5 }, taxRate: 90 },
      { name: "Coruscant", resources: { Food: 5, Ore: 1 } },
    ],
    [],
    constraints,
  );
  assert.equal(route.legs[1].trade, null);
  assert.equal(route.expectedProfit, 40);
  assert.ok(freighterStops(route)[1].actions.includes("Depart empty"));
});
test("all circuit legs obey range, jump limits and transit exclusions", () => {
  const planets = [
    { name: "Corellia", resources: { Food: 1, Ore: 5 }, galacticCoordinates: { x: 0, y: 0 } },
    { name: "Coruscant", resources: { Food: 5, Ore: 1 }, galacticCoordinates: { x: 60, y: 0 } },
    { name: "Lorrd", resources: {}, galacticCoordinates: { x: 30, y: 0 } },
  ];
  const opts = { ...constraints, maxDistance: 35 };
  const [route] = calculateFreighterRoutes(planets, [], opts);
  assert.deepEqual(
    route.legs.map((leg) => leg.path),
    [
      ["Corellia", "Lorrd", "Coruscant"],
      ["Coruscant", "Lorrd", "Corellia"],
    ],
  );
  assert.equal(freighterStops(route).filter((stop) => stop.actions.length === 0).length, 2);
  assert.equal(calculateFreighterRoutes(planets, [], { ...opts, maxJumpsPerLeg: 1 }).length, 0);
  assert.equal(
    calculateFreighterRoutes(planets, [], { ...opts, avoidedPlanets: new Set(["lorrd"]) }).length,
    0,
  );
});
test("circuit cargo survives storage and distinct circuits have distinct saved identities", () => {
  const routes = calculateFreighterRoutes(triangle, [], constraints);
  const saved = routes.map((route) => ({ ...route, id: savedRouteId(route), name: "Circuit" }));
  assert.equal(new Set(saved.map((route) => route.id)).size, saved.length);
  const config = readTraderConfig(JSON.parse(JSON.stringify({ routes: saved })));
  assert.deepEqual(
    config.routes.map((route) => route.legs),
    routes.map((route) => route.legs),
  );
  assert.equal(readTraderConfig({ routes: [{ ...saved[0], legs: [null] }] }).routes.length, 0);
  const state = cargoExecutionReducer(initialCargoExecutionState, {
    type: "arm",
    route: routes[0],
    routeId: "test",
  });
  assert.equal(state.phase, "blocked");
});
