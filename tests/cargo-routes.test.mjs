import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCargoRoutes,
  cargoSystemCoordinates,
  normalizeExcludedNames,
  routePlanetNames,
} from "../renderer/src/domain/cargoRoutes.ts";
test("range resolves catalogue system coordinates, never local planet coordinates", () => {
  const catalog = {
    systems: { "Test System": { x: "3", y: "4", Planet: { x: 9999, y: 9999, z: 9999 } } },
  };
  assert.deepEqual(cargoSystemCoordinates(catalog, " test system "), { x: 3, y: 4 });
  assert.equal(cargoSystemCoordinates(catalog, "Missing"), undefined);
  assert.equal(cargoSystemCoordinates({ systems: { Bad: { x: null, y: 4 } } }, "Bad"), undefined);
  assert.deepEqual(
    cargoSystemCoordinates(
      { ...catalog, customSystems: { "Test System": { x: 0, y: 0 } } },
      "Test System",
    ),
    { x: 0, y: 0 },
  );
});

test("verified multi-jump profit loops respect tax, hop limits and transit exclusions", () => {
  const markets = [
    { name: "Lorrd", resources: { Food: 10 } },
    { name: "Ryloth", resources: { Food: 40 }, taxRate: 5 },
    { name: "Wroona", resources: {}, governedBy: "Transit Clan" },
  ];
  const c = { cargoCapacity: 100, maxJumpsPerLeg: "unlimited" };
  const [r] = calculateCargoRoutes(markets, [], c);
  assert.deepEqual(r.outbound.path, ["Lorrd", "Wroona", "Ryloth"]);
  assert.deepEqual(r.returnLeg.path, ["Ryloth", "Wroona", "Lorrd"]);
  assert.equal(r.expectedProfit, 2800);
  assert.equal(r.totalLoopJumps, 4);
  assert.deepEqual(routePlanetNames(r), ["Lorrd", "Wroona", "Ryloth", "Wroona"]);
  assert.equal(calculateCargoRoutes(markets, [], { ...c, maxJumpsPerLeg: 1 }).length, 0);
  assert.equal(
    calculateCargoRoutes(markets, [], { ...c, avoidedPlanets: normalizeExcludedNames(["Wroona"]) })
      .length,
    0,
  );
  assert.equal(
    calculateCargoRoutes(markets, [], {
      ...c,
      excludedClans: normalizeExcludedNames(["Transit Clan"]),
    }).length,
    0,
  );
});
test("weighted paths prefer a faster verified detour and respect hop limits", () => {
  const markets = [
    { name: "Corellia", resources: { Food: 1 } },
    { name: "Wroona", resources: { Food: 10 } },
    { name: "Lorrd", resources: {} },
  ];
  const lanes = [{ from: "Corellia", to: "Wroona", status: "passable", travelSeconds: 10000 }];
  const [r] = calculateCargoRoutes(markets, lanes, {
    cargoCapacity: 1,
    maxJumpsPerLeg: "unlimited",
  });
  assert.deepEqual(r.outbound.path, ["Corellia", "Lorrd", "Wroona"]);
  assert.equal(r.totalDurationSeconds, 14400);
  const [direct] = calculateCargoRoutes(markets, lanes, { cargoCapacity: 1, maxJumpsPerLeg: 1 });
  assert.deepEqual(direct.outbound.path, ["Corellia", "Wroona"]);
  assert.equal(direct.totalDurationSeconds, 20000);
});
test("range is per hop and inclusive at the exact boundary", () => {
  const markets = [
    { name: "Coruscant", galacticCoordinates: { x: 0, y: 0 }, resources: { Food: 1 } },
    { name: "Corellia", galacticCoordinates: { x: 42, y: 56 }, resources: { Food: 10 } },
    { name: "Lorrd", galacticCoordinates: { x: 21, y: 28 }, resources: {} },
  ];
  const c = { cargoCapacity: 1, maxJumpsPerLeg: "unlimited", maxDistance: 35 };
  assert.deepEqual(calculateCargoRoutes(markets, [], c)[0].outbound.path, [
    "Coruscant",
    "Lorrd",
    "Corellia",
  ]);
  for (const maxDistance of [34.99, 0, -1, NaN, Infinity])
    assert.equal(calculateCargoRoutes(markets, [], { ...c, maxDistance }).length, 0);
  assert.equal(calculateCargoRoutes(markets, [], { ...c, maxJumpsPerLeg: 1 }).length, 0);
  assert.deepEqual(calculateCargoRoutes(markets, [], { ...c, maxDistance: 70 })[0].outbound.path, [
    "Coruscant",
    "Corellia",
  ]);
});
test("topology coordinates supply missing catalog positions; unknown planets remain excluded", () => {
  const c = { cargoCapacity: 1, maxJumpsPerLeg: 1, maxDistance: 35 };
  assert.equal(
    calculateCargoRoutes(
      [
        { name: "Wroona", resources: { Food: 1 } },
        { name: "Lorrd", resources: { Food: 10 } },
      ],
      [],
      c,
    ).length,
    1,
  );
  assert.equal(
    calculateCargoRoutes(
      [
        { name: "Unknown", resources: { Food: 1 } },
        { name: "Lorrd", resources: { Food: 10 } },
      ],
      [],
      c,
    ).length,
    0,
  );
});
