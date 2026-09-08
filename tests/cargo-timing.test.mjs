import assert from "node:assert/strict";
import test from "node:test";
import { calculateFreighterRoutes } from "../renderer/src/domain/freighterRoutes.ts";
import { DEFAULT_CARGO_TIMING, cargoTravelLegs } from "../renderer/src/domain/cargoRoutes.ts";
import { readTraderConfig, shipValidation } from "../renderer/src/features/trader/traderConfig.ts";
const planets = [
  { name: "Corellia", galacticCoordinates: { x: 0, y: 0 }, resources: { Food: 1, Ore: 10 } },
  { name: "Coruscant", galacticCoordinates: { x: 35, y: 0 }, resources: { Food: 10, Ore: 1 } },
];
const options = { cargoCapacity: 100, maxJumpsPerLeg: "unlimited", timing: DEFAULT_CARGO_TIMING };
test("35-sector round trip takes 18 minutes, including two market turnarounds", () => {
  const [route] = calculateFreighterRoutes(planets, [], options);
  assert.equal(route.totalDurationSeconds, 18 * 60);
  assert.equal(route.expectedProfit, 1800);
  assert.equal(route.expectedProfitPerHour, 6000);
  const [faster] = calculateFreighterRoutes(planets, [], {
    ...options,
    timing: { ...DEFAULT_CARGO_TIMING, minutesPer35Sectors: 3 },
  });
  assert.equal(faster.totalDurationSeconds, 12 * 60);
});
test("transit overhead is charged per intermediate stop and empty returns still take time", () => {
  const nodes = [
    { ...planets[0], resources: { Food: 1 } },
    { ...planets[1], resources: { Food: 10 } },
    { name: "Lorrd", galacticCoordinates: { x: 17.5, y: 0 }, resources: {} },
  ];
  const [route] = calculateFreighterRoutes(nodes, [], {
    ...options,
    maxDistance: 20,
    timing: { minutesPer35Sectors: 6, tradeStopMinutes: 3, transitStopMinutes: 2 },
  });
  assert.equal(route.totalDurationSeconds, 22 * 60);
  assert.equal(route.legs[1].trade, null);
  assert.equal(route.legs[1].durationSeconds, 11 * 60);
});
test("duration weights include overhead when choosing a path, and explicit travel times are retained", () => {
  const nodes = [
    planets[0],
    { ...planets[1], name: "Wroona" },
    { name: "Lorrd", galacticCoordinates: { x: 17.5, y: 0 }, resources: {} },
  ];
  const edges = [{ from: "Corellia", to: "Wroona", status: "passable", travelSeconds: 400 }];
  const direct = cargoTravelLegs(nodes, edges, options).find((leg) => leg.from === "Corellia");
  assert.deepEqual(direct.path, ["Corellia", "Wroona"]);
  assert.equal(direct.durationSeconds, 580);
  const via = cargoTravelLegs(nodes, edges, {
    ...options,
    timing: { ...DEFAULT_CARGO_TIMING, transitStopMinutes: 0 },
  }).find((leg) => leg.from === "Corellia");
  assert.deepEqual(via.path, ["Corellia", "Lorrd", "Wroona"]);
  assert.equal(via.durationSeconds, 540);
});
test("ship timing persists, old ships retain defaults, and invalid timing is rejected", () => {
  const ship = {
    id: "test",
    name: "Test",
    capacity: 100,
    enterPath: [],
    exitPath: [],
    timing: { minutesPer35Sectors: 4, tradeStopMinutes: 2, transitStopMinutes: 1 },
  };
  assert.deepEqual(
    readTraderConfig(JSON.parse(JSON.stringify({ ships: [ship] }))).ships[0].timing,
    ship.timing,
  );
  assert.equal(readTraderConfig({ ships: [{ ...ship, timing: undefined }] }).ships.length, 1);
  assert.ok(shipValidation({ ...ship, timing: { ...ship.timing, minutesPer35Sectors: 0 } }, []));
  assert.equal(
    calculateFreighterRoutes(planets, [], {
      ...options,
      timing: { ...DEFAULT_CARGO_TIMING, tradeStopMinutes: -1 },
    }).length,
    0,
  );
});
