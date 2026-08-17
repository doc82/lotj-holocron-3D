import assert from "node:assert/strict";
import test from "node:test";

import {
  conservativeJumpRange,
  escapeDestinationInRange,
  galacticDistance,
  hyperspaceClearance,
} from "../renderer/src/domain/hyperspace.ts";

const destinations = [
  { system: "Mandalore Sector", distanceParsecs: 49.5, reachable: true },
  { system: "Gaulus Sector", distanceParsecs: 40, reachable: true },
  { system: "Wroona System", distanceParsecs: 67.1, reachable: false },
];

test("escape planning uses the ship's conservative confirmed jump range", () => {
  assert.equal(conservativeJumpRange(destinations), 49.5);
  assert.equal(galacticDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(
    escapeDestinationInRange({ x: 0, y: 0 }, { x: 30, y: 0 }, destinations).allowed,
    true,
  );
  assert.equal(
    escapeDestinationInRange({ x: 0, y: 0 }, { x: 50, y: 0 }, destinations).allowed,
    false,
  );
});

test("known out-of-range and unconfirmed local escape systems are blocked", () => {
  const outOfRange = escapeDestinationInRange(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    destinations,
    "Wroona System",
    true,
  );
  assert.equal(outOfRange.allowed, false);
  assert.match(outOfRange.reason, /out of range/i);

  const unknown = escapeDestinationInRange(
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    destinations,
    "Private Sector",
    true,
  );
  assert.equal(unknown.allowed, false);
  assert.match(unknown.reason, /not been confirmed/i);
});

test("hyperdrive clearance requires a fresh spatial fix and 500 units from contacts", () => {
  const base = {
    observer: { id: "player-ship", x: 0, y: 0, z: 0 },
    metadata: { sources: { radar: 1_000 } },
  };
  assert.equal(hyperspaceClearance({ ...base, entities: [] }, 1_005).allowed, true);
  const blocked = hyperspaceClearance(
    { ...base, entities: [{ id: "frigate", name: "Frigate", kind: "ship", x: 300, y: 0, z: 0 }] },
    1_005,
  );
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.nearestDistance, 300);
  assert.equal(
    hyperspaceClearance(
      { ...base, entities: [{ id: "planet", name: "Planet", kind: "planet", x: 500, y: 0, z: 0 }] },
      1_005,
    ).allowed,
    true,
  );
  assert.equal(hyperspaceClearance(base, 1_020).known, false);
});
