import assert from "node:assert/strict";
import test from "node:test";
import { manualCargoRoute } from "../renderer/src/domain/manualCargoRoute.ts";
import { cargoMission } from "../renderer/src/domain/cargoAutopilot.ts";
import { readTraderConfig, savedRouteId } from "../renderer/src/features/trader/traderConfig.ts";

const markets = ["Lorrd", "Eeropha", "Ryloth"].map((name, i) => ({
  name,
  system: name + " System",
  galacticCoordinates: { x: i * 10, y: 0 },
  resources: { Food: 10 + i, Water: 20 - i },
}));
const row = (planet, action = "transit", resource = "") => ({ planet, action, resource });
const stops = [
  row("Lorrd", "buy", "Food"),
  row("Eeropha"),
  row("Ryloth", "sell_buy", "Water"),
  row("Eeropha"),
];
test("manual circuits retain every transit stop and both cargo deliveries", () => {
  const route = manualCargoRoute(stops, markets, 10);
  assert.deepEqual(
    route.legs.map((leg) => leg.path),
    [
      ["Lorrd", "Eeropha", "Ryloth"],
      ["Ryloth", "Eeropha", "Lorrd"],
    ],
  );
  const mission = cargoMission(
    route,
    "manual",
    { name: "Hauler", enterPath: ["n"], exitPath: ["s"] },
    (name) => ({ name, system: name, galaxy: { x: 0, y: 0 }, arrival: { kind: "planet" } }),
  );
  assert.equal(mission.routingMode, "manual");
  assert.equal(mission.maxDistance, 35);
  assert.deepEqual(
    mission.stops.map((stop) => stop.actions.map((action) => action.kind)),
    [["cargo.buy"], [], ["cargo.sell", "cargo.buy"], [], ["cargo.sell"]],
  );
});
test("manual routes skip graph inference but enforce distance including the return", () => {
  const route = manualCargoRoute([row("Lorrd"), row("Ryloth")], markets, 10);
  assert.deepEqual(route.outbound.path, ["Lorrd", "Ryloth"]);
  assert.throws(
    () => manualCargoRoute([row("Lorrd"), row("Eeropha"), row("Ryloth")], markets, 10, 15),
    /Ryloth.*Lorrd.*exceeds/,
  );
});
test("manual trade validation catches invalid cargo sequences and duplicate final origins", () => {
  assert.throws(
    () => manualCargoRoute([row("Lorrd", "sell"), row("Ryloth")], markets, 10),
    /no planned cargo/,
  );
  assert.throws(
    () =>
      manualCargoRoute([row("Lorrd", "buy", "Food"), row("Ryloth", "buy", "Water")], markets, 10),
    /Sell the carried cargo/,
  );
  assert.throws(
    () => manualCargoRoute([...stops, row("Lorrd")], markets, 10),
    /added automatically/,
  );
  assert.throws(() => manualCargoRoute(stops, markets, 0), /quantity/);
});
test("manual transit circuits and unavailable estimates survive saved-route reload", () => {
  const route = manualCargoRoute([row("Lorrd"), row("Ryloth")], markets, 10);
  const saved = { ...route, id: savedRouteId(route), name: "My exact path" };
  assert.deepEqual(readTraderConfig({ routes: [saved] }).routes[0], {
    ...saved,
    shipId: undefined,
  });
  const unknown = manualCargoRoute(
    stops,
    markets.map((m) => ({ ...m, resources: {} })),
    10,
  );
  assert.equal(unknown.estimateAvailable, false);
  assert.notEqual(savedRouteId(route), savedRouteId({ ...route, quantity: 20 }));
});
