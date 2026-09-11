import assert from "node:assert/strict";
import test from "node:test";
import { calculateFreighterRoutes } from "../renderer/src/domain/freighterRoutes.ts";
import {
  mergeMarketArchive,
  emptyMarketArchive,
} from "../renderer/src/features/trader/marketArchive.ts";

test("filter recalculation uses stored prices without a refresh or new observations", () => {
  const archive = mergeMarketArchive(emptyMarketArchive, {
    markets: {
      A: { planet: "Corellia", resources: { Food: 1, Ore: 10 }, observedAt: 100 },
      B: { planet: "Coruscant", resources: { Food: 10, Ore: 1 }, observedAt: 100 },
    },
  });
  const planets = Object.values(archive.logistics.markets).map((market, index) => ({
    name: market.planet,
    resources: market.resources,
    galacticCoordinates: { x: index * 30, y: 0 },
  }));
  const options = {
    cargoCapacity: 100,
    maxJumpsPerLeg: "unlimited",
    maxTradeStops: 2,
    maxDistance: 35,
  };
  assert.equal(calculateFreighterRoutes(planets, [], options).length, 1);
  assert.equal(calculateFreighterRoutes(planets, [], { ...options, maxDistance: 20 }).length, 0);
  assert.equal(
    calculateFreighterRoutes(planets, [], { ...options, avoidedPlanets: new Set(["coruscant"]) })
      .length,
    0,
  );
  assert.equal(calculateFreighterRoutes(planets, [], options).length, 1);
  assert.deepEqual(
    Object.values(archive.logistics.markets).map((m) => m.observedAt),
    [100, 100],
  );
  assert.equal(archive.logistics.refresh, undefined);
});

test("live prices supersede a lagging archive without losing stored markets", () => {
  const stored = mergeMarketArchive(emptyMarketArchive, {
    markets: {
      A: { planet: "Corellia", observedAt: 100, resources: { Food: 1 } },
      B: { planet: "Coruscant", observedAt: 100, resources: { Food: 10 } },
    },
  });
  const merged = mergeMarketArchive(stored, {
    markets: { A: { planet: "Corellia", observedAt: 200, resources: { Food: 2 } } },
  });
  assert.equal(merged.logistics.markets.corellia.resources.Food, 2);
  assert.equal(merged.logistics.markets.coruscant.resources.Food, 10);
  assert.equal(stored.logistics.markets.corellia.resources.Food, 1);
});
