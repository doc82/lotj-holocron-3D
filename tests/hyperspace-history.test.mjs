import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveHyperspeed,
  normalizedHyperspaceLoad,
  parseHyperspaceHistory,
  sanitizeHyperspaceHistoryEntry,
  serializeHyperspaceHistory,
  sortHyperspaceHistory,
} from "../renderer/src/domain/hyperspaceHistory.ts";

const entry = (overrides = {}) => ({
  id: "jump-1",
  completedAt: 1_700_000_000,
  mode: "local",
  distance: 10_000,
  hyperspeed: 5,
  navigatorApplied: false,
  calculationSeconds: 6,
  flightSeconds: 20,
  source: "observed",
  ...overrides,
});

test("hyperspace history persists only valid versioned calibration rows", () => {
  const valid = entry();
  const invalid = entry({ id: "bad", flightSeconds: 0 });
  const parsed = parseHyperspaceHistory(
    JSON.stringify({ version: 1, entries: [valid, invalid, null] }),
  );
  assert.deepEqual(parsed, [valid]);
  assert.deepEqual(parseHyperspaceHistory(serializeHyperspaceHistory(parsed)), [valid]);
  assert.deepEqual(parseHyperspaceHistory('{"version":2,"entries":[]}'), []);
  assert.equal(sanitizeHyperspaceHistoryEntry(invalid), null);
});

test("history normalizes different drive ratings and sorts computed columns", () => {
  const ratingFive = entry({ id: "rating-5", distance: 10_000, hyperspeed: 5 });
  const ratingTen = entry({ id: "rating-10", distance: 20_000, hyperspeed: 10 });
  const navigator = entry({
    id: "navigator",
    distance: 26_000,
    hyperspeed: 10,
    navigatorApplied: true,
    flightSeconds: 18,
  });
  assert.equal(normalizedHyperspaceLoad(ratingFive), 2_000);
  assert.equal(normalizedHyperspaceLoad(ratingTen), 2_000);
  assert.equal(effectiveHyperspeed(navigator), 13);
  assert.equal(normalizedHyperspaceLoad(navigator), 2_000);
  assert.deepEqual(
    sortHyperspaceHistory([ratingFive, navigator], "flightSeconds", "asc").map(
      (candidate) => candidate.id,
    ),
    ["navigator", "rating-5"],
  );
});
