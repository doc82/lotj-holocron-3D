import assert from "node:assert/strict";
import test from "node:test";
import {
  navigationJump,
  validateNavigationPath,
  navigationTopology,
  navigationNode,
  navigationWaypoint,
} from "../renderer/src/domain/navigationTopology.ts";
import { cargoTravelLegs } from "../renderer/src/domain/cargoRoutes.ts";
test("Ryloth to Lorrd uses the verified Lodestar refueling detour", () => {
  assert.equal(navigationJump("Ryloth", "Lorrd", [], true).allowed, false);
  assert.equal(navigationJump("Ryloth", "Eeropha", []).allowed, true);
  assert.equal(navigationJump("Eeropha", "Lorrd", []).allowed, true);
  const planets = ["Ryloth", "Lorrd"].map((name) => ({ name, resources: { Food: 1 } }));
  const leg = cargoTravelLegs(planets, [], { cargoCapacity: 1, maxJumpsPerLeg: 2 }).find(
    (leg) => leg.from === "Ryloth" && leg.to === "Lorrd",
  );
  assert.deepEqual(leg.path, ["Ryloth", "Eeropha", "Lorrd"]);
  assert.equal(navigationWaypoint("Eeropha").refuelStation, "Lodestar Utopia Refueling Station");
  assert.throws(() => validateNavigationPath(["Ryloth", "Lorrd"], true), /No Path/);
});
test("audited directions replace gateway assumptions without inventing returns", () => {
  for (const [a, b] of [
    ["Wroona", "Lorrd"],
    ["Corellia", "Alderaan"],
    ["Corellia", "Mon Cala"],
    ["Ryloth", "Bespin"],
  ])
    assert.equal(navigationJump(a, b, []).allowed, true);
  for (const [a, b] of [
    ["Bespin", "Ryloth"],
    ["Lorrd", "Wroona"],
    ["Lorrd", "Ryloth"],
    ["Wroona", "Tatooine"],
    ["Missing", "Corellia"],
  ])
    assert.equal(navigationJump(a, b, []).allowed, false);
  assert.equal(navigationJump("Bespin", "Ryloth", [], true).allowed, true);
  assert.equal(navigationJump("Lorrd", "Ryloth", [], true).allowed, false);
});
test("all temporary controls work both ways and require fresh passable evidence", () => {
  for (const c of navigationTopology.temporaryControls) {
    const expand = (id) => navigationTopology.regions[id]?.members ?? [id];
    for (const a of expand(c.from))
      for (const b of expand(c.to))
        for (const [from, to] of [
          [a, b],
          [b, a],
        ]) {
          assert.equal(navigationJump(from, to, []).allowed, false);
          for (const status of ["passable", "no_route", "unknown", "stale"]) {
            const lane = { from: c.monitor[1], to: c.monitor[0], status };
            assert.equal(navigationJump(from, to, [lane]).allowed, status === "passable");
            assert.equal(navigationJump(from, to, [lane], true).allowed, status === "passable");
          }
        }
  }
  assert.equal(
    navigationJump("Corellia", "Wroona", [
      { from: "Corellia", to: "Wroona", status: "passable" },
      { from: "Wroona", to: "Corellia", status: "stale" },
    ]).allowed,
    false,
  );
});
test("aliases and systems resolve; non-control monitor entries cannot invent connections", () => {
  assert.equal(navigationNode("Europhea").name, "Eeropha");
  assert.equal(navigationJump("Corellian System", "Mon-Cal", []).allowed, true);
  assert.equal(
    navigationJump("Alderaan", "Mon Cala", [
      { from: "Alderaan", to: "Mon Cala", status: "passable" },
    ]).allowed,
    false,
  );
  assert.equal(
    navigationJump("Hutt Space", "Tatooine", [
      { from: "Tatooine", to: "Nal Hutta", status: "passable" },
    ]).allowed,
    true,
  );
});
test("planner uses verified transit and responds to changing lane states", () => {
  const planets = ["Lorrd", "Ryloth", "Corellia"].map((name) => ({ name, resources: { Food: 1 } }));
  const constraints = { cargoCapacity: 1, maxJumpsPerLeg: "unlimited" };
  assert.deepEqual(
    cargoTravelLegs(planets, [], constraints).find((l) => l.from === "Lorrd" && l.to === "Ryloth")
      .path,
    ["Lorrd", "Corellia", "Ryloth"],
  );
  const pair = ["Corellia", "Wroona"].map((name) => ({ name, resources: { Food: 1 } }));
  assert.equal(cargoTravelLegs(pair, [], constraints).length, 0);
  assert.equal(
    cargoTravelLegs(pair, [{ from: "Wroona", to: "Corellia", status: "passable" }], constraints)
      .length,
    2,
  );
});

test("manual validation rejects known blocked hops before saving but preserves exploration", () => {
  assert.throws(
    () => validateNavigationPath(["Corellia", "Tatooine", "Corellia"], true),
    /No Path/,
  );
  assert.doesNotThrow(() => validateNavigationPath(["Bespin", "Ryloth"], true));
  assert.throws(() => validateNavigationPath(["Bespin", "Ryloth"], false), /not been verified/);
  assert.doesNotThrow(() => validateNavigationPath(["Corellia", "Wroona", "Corellia"], true));
});
