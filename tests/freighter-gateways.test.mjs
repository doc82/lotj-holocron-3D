import assert from "node:assert/strict";
import test from "node:test";
import { calculateFreighterRoutes } from "../renderer/src/domain/freighterRoutes.ts";
test("unverified return directions prevent invented gateway circuits", () => {
  const markets = [
    { name: "Ryloth", resources: { Food: 1 } },
    { name: "Bespin", resources: { Food: 10 } },
    { name: "Arkania", resources: {} },
  ];
  assert.equal(
    calculateFreighterRoutes(markets, [], { cargoCapacity: 10, maxJumpsPerLeg: "unlimited" })
      .length,
    0,
  );
});
