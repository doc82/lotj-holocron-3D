import assert from "node:assert/strict";
import test from "node:test";
import { calculateFreighterRoutes } from "../renderer/src/domain/freighterRoutes.ts";
import { manualCargoRoute, routeReviewStops } from "../renderer/src/domain/manualCargoRoute.ts";
import { cargoMission } from "../renderer/src/domain/cargoAutopilot.ts";
import { cargoRouteIdentity } from "../renderer/src/domain/cargoRoutes.ts";
import { readTraderConfig } from "../renderer/src/features/trader/traderConfig.ts";
const markets = ["Corellia", "Coruscant", "Lorrd"].map((name, i) => ({
  name,
  resources: { Food: i + 1, Ore: 4 - i },
  taxRate: 20,
  galacticCoordinates: { x: i * 5, y: 0 },
}));
const opts = { cargoCapacity: 10, maxJumpsPerLeg: "unlimited", maxTradeStops: 3, maxDistance: 35 };
test("origin filter searches and anchors circuits at the requested planet, including later alphabetical origins", () => {
  for (const startingPlanet of ["Lorrd", "Coruscant", "Corellia"]) {
    const routes = calculateFreighterRoutes(markets, [], { ...opts, startingPlanet });
    assert.ok(routes.length > 0);
    assert.ok(
      routes.every((r) => r.legs[0].from === startingPlanet && r.legs.at(-1).to === startingPlanet),
    );
  }
  assert.equal(
    calculateFreighterRoutes(markets, [], { ...opts, startingPlanet: "Unknown" }).length,
    0,
  );
});
test("review preserves transit occurrences, return cargo and stop-local pads/modes through save and mission compilation", () => {
  const route = manualCargoRoute(
    [
      { planet: "Corellia", action: "buy", resource: "Food" },
      { planet: "Coruscant", action: "transit", resource: "" },
      { planet: "Lorrd", action: "sell_buy", resource: "Ore" },
      { planet: "Coruscant", action: "transit", resource: "" },
    ],
    markets,
    10,
    35,
  );
  const edit = routeReviewStops(route);
  assert.deepEqual(
    edit.map((s) => s.planet),
    ["Corellia", "Coruscant", "Lorrd", "Coruscant"],
  );
  edit[0].tradeMode = "contraband";
  edit[0].pad = "Outbound pad";
  edit[1].pad = "First visit";
  edit[2].tradeMode = "contraband";
  edit[3].pad = "Second visit";
  const updated = manualCargoRoute(edit, markets, 10, 35, undefined, {
    planet: "Corellia",
    pad: "Return pad",
    tradeMode: "cargo",
  });
  assert.equal(updated.legs[0].trade.saleRevenue, 30);
  assert.equal(updated.legs.at(-1).trade.saleRevenue, 32);
  assert.notEqual(cargoRouteIdentity(route), cargoRouteIdentity(updated));
  const stored = readTraderConfig(JSON.parse(JSON.stringify({ routes: [updated] }))).routes[0];
  assert.deepEqual(
    stored.stopSettings,
    updated.stopSettings.map((s) => JSON.parse(JSON.stringify(s))),
  );
  const mission = cargoMission(
    stored,
    "review",
    { name: "Ship", enterPath: ["n"], exitPath: ["s"] },
    (name) => ({
      name,
      system: name,
      galaxy: { x: 0, y: 0 },
      arrival: { kind: "planet", pad: "Default" },
    }),
  );
  assert.deepEqual(
    mission.stops.map((s) => s.destination.arrival.pad),
    ["Outbound pad", "First visit", "Default", "Second visit", "Return pad"],
  );
  assert.equal(mission.stops[0].actions[0].payload.tradeMode, "contraband");
  assert.ok(mission.stops[2].actions.every((a) => a.payload.tradeMode === "contraband"));
  assert.equal(mission.stops.at(-1).actions[0].payload.tradeMode, "cargo");
  assert.equal(
    readTraderConfig({ routes: [{ ...updated, stopSettings: [null] }] }).routes.length,
    0,
  );
});
test("analyzer route survives review without changing profit, paths or cargo", () => {
  const r = calculateFreighterRoutes(markets, [], { ...opts, startingPlanet: "Lorrd" })[0];
  const reviewed = manualCargoRoute(routeReviewStops(r), markets, r.quantity, 35);
  assert.deepEqual(
    reviewed.legs.map((l) => [l.path, l.trade?.resource]),
    r.legs.map((l) => [l.path, l.trade?.resource]),
  );
  assert.equal(reviewed.expectedProfit, r.expectedProfit);
});
