import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyMarketArchive,
  mergeMarketArchive,
  marketObservations,
  observationId,
} from "../renderer/src/features/trader/marketArchive.ts";
const market = {
  planet: "A",
  system: "A System",
  resources: { Food: 10, Ore: 20 },
  taxRate: 5,
  observedAt: 100,
};
test("stored markets, catalogue and lane context survive an offline reload", () => {
  const catalog = { systems: { "A System": { x: 10, y: 20 } } };
  const archive = mergeMarketArchive(
    emptyMarketArchive,
    {
      markets: { A: market },
      planets: [{ name: "A", system: "A System" }],
      hyperlanes: [{ from: "A", to: "B", status: "passable" }],
      hyperlanesObservedAt: 100,
      refresh: { phase: "refreshing", startedAt: 90, total: 10, completed: 1 },
    },
    catalog,
  );
  const restored = mergeMarketArchive(JSON.parse(JSON.stringify(archive)));
  assert.deepEqual(restored, archive);
  assert.equal(restored.logistics.refresh, undefined);
  assert.equal(restored.logistics.markets.a.resources.Food, 10);
  assert.equal(restored.catalog.systems["A System"].x, 10);
});
test("partial and older updates cannot erase a newer market or lane observation", () => {
  const archive = mergeMarketArchive(emptyMarketArchive, {
    markets: { A: market },
    hyperlanes: [{ from: "A", to: "B", status: "no_route" }],
    hyperlanesObservedAt: 100,
  });
  const updated = mergeMarketArchive(archive, {
    markets: {
      A: { ...market, observedAt: 90, resources: { Food: 1 } },
      B: { ...market, planet: "B", observedAt: 110 },
    },
    hyperlanes: [{ from: "A", to: "B", status: "passable" }],
    hyperlanesObservedAt: 90,
  });
  assert.equal(updated.logistics.markets.a.resources.Food, 10);
  assert.equal(updated.logistics.markets.b.observedAt, 110);
  assert.equal(updated.logistics.hyperlanes[0].status, "no_route");
});
test("history identities deduplicate repeated telemetry but retain unchanged later scans", () => {
  assert.equal(
    observationId(market),
    observationId({ ...market, resources: { Ore: 20, Food: 10 } }),
  );
  assert.notEqual(observationId(market), observationId({ ...market, observedAt: 200 }));
  assert.notEqual(observationId(market), observationId({ ...market, taxRate: 10 }));
  assert.equal(
    marketObservations({
      markets: {
        bad: { ...market, resources: { Food: NaN } },
        unknown: { ...market, observedAt: undefined },
        good: market,
      },
    }).length,
    1,
  );
});
