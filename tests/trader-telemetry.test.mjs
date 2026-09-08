import assert from "node:assert/strict";
import test from "node:test";
import { mergeInitial, receiveSnapshot } from "../renderer/src/features/telemetry/useTelemetry.ts";

const landed = {
  connected: true,
  connectionLabel: "MUDLET LINK",
  snapshot: null,
  logisticsSnapshot: null,
  spaceState: { inSpace: false },
  galaxyCatalog: null,
};
const marketSnapshot = {
  metadata: {
    inSpace: false,
    logistics: { markets: { ithor: { planet: "Ithor", resources: { Food: 10 } } } },
  },
};

test("landed market snapshots reach Trader without restoring tactical telemetry", () => {
  const state = receiveSnapshot(landed, marketSnapshot);
  assert.equal(state.snapshot, null);
  assert.equal(state.logisticsSnapshot.metadata.logistics.markets.ithor.resources.Food, 10);
  assert.equal(state.spaceState.inSpace, false);
});

test("initial landed state restores logistics without activating the space view", () => {
  const state = mergeInitial(landed, { connected: true, snapshot: marketSnapshot });
  assert.equal(state.snapshot, null);
  assert.equal(state.logisticsSnapshot, marketSnapshot);
});

test("a late initial response cannot replace a newer logistics snapshot", () => {
  const current = receiveSnapshot(landed, marketSnapshot);
  const state = mergeInitial(current, { connected: true, snapshot: { metadata: {} } });
  assert.equal(state.logisticsSnapshot, marketSnapshot);
});
