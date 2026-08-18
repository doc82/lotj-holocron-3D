import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateHyperspaceIntercept,
  calculateHyperspaceTravelTime,
  observeMotionTracks,
  velocityForTrack,
} from "../renderer/src/domain/hyperspacePrediction.ts";

test("LOTJ hyperspace ticks include distance, even-second rounding, and the fixed delay", () => {
  assert.equal(calculateHyperspaceTravelTime(10_000, 5), 23);
  assert.equal(calculateHyperspaceTravelTime(10_000, 5, true), 21);
  assert.equal(calculateHyperspaceTravelTime(100, 0), null);
});

test("motion history only advances on authoritative radar and GMCP fixes", () => {
  const first = observeMotionTracks(new Map(), {
    observedAt: 100,
    observer: { id: "player-ship", name: "Lead", x: 0, y: 0, z: 0 },
    entities: [{ id: "target", name: "Target", kind: "ship", x: 1_000, y: 0, z: 0 }],
    metadata: { sources: { radar: 100, ship_gmcp: 100 } },
  });
  const duplicate = observeMotionTracks(first, {
    observedAt: 101,
    observer: { id: "player-ship", name: "Lead", x: 0, y: 0, z: 0 },
    entities: [{ id: "target", name: "Target", kind: "ship", x: 1_000, y: 0, z: 0 }],
    metadata: { sources: { radar: 100, ship_gmcp: 100 } },
  });
  assert.equal(duplicate, first);
  const second = observeMotionTracks(first, {
    observedAt: 110,
    observer: { id: "player-ship", name: "Lead", x: 0, y: 0, z: 0 },
    entities: [{ id: "target", name: "Target", kind: "ship", x: 1_100, y: 0, z: 0 }],
    metadata: { sources: { radar: 110, ship_gmcp: 110 } },
  });
  assert.deepEqual(velocityForTrack(second.get("target")), [10, 0, 0]);
});

test("intercept prediction ages radar and iterates distance until the LOTJ tick is stable", () => {
  const target = {
    id: "target",
    name: "Target",
    previous: { position: [1_000, 0, 0], observedAt: 90 },
    current: { position: [1_100, 0, 0], observedAt: 100 },
  };
  const observer = {
    id: "player-ship",
    name: "Lead",
    previous: { position: [0, 0, 0], observedAt: 90 },
    current: { position: [0, 0, 0], observedAt: 100 },
  };
  const solution = calculateHyperspaceIntercept({
    target,
    observer,
    hyperspeed: 5,
    now: 102,
  });
  assert.ok(solution);
  assert.equal(solution.travelTime, 15);
  assert.equal(solution.radarAge, 2);
  assert.deepEqual(solution.targetPosition, [1_270, 0, 0]);
  assert.deepEqual(solution.observerPosition, [0, 0, 0]);
});
