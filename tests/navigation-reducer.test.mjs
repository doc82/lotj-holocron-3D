import assert from "node:assert/strict";
import test from "node:test";

import {
  initialNavigationState,
  navigationReducer,
} from "../renderer/src/features/commands/navigationReducer.ts";

test("navigation reducer stages vector and targeted courses", () => {
  const vectorCourse = navigationReducer(initialNavigationState, {
    type: "begin-vector",
    fleetScope: "fleet",
  });
  assert.equal(vectorCourse.mode, "vector");
  assert.equal(vectorCourse.commandMode, "relative");
  assert.equal(vectorCourse.fleetScope, "fleet");

  const staged = navigationReducer(vectorCourse, { type: "stage" });
  assert.equal(staged.mode, "confirm");

  const intercept = navigationReducer(initialNavigationState, {
    type: "arm-target",
    mode: "target",
    targetId: "isd45",
    fleetScope: null,
  });
  assert.equal(intercept.mode, "target");
  assert.equal(intercept.targetId, "isd45");
});

test("navigation reducer reconciles observed speed and resets transient state", () => {
  const observed = navigationReducer(initialNavigationState, {
    type: "observe-speed",
    speed: 75,
    maximum: 100,
  });
  assert.equal(observed.requestedSpeed, 75);
  assert.equal(observed.knownMaximumSpeed, 100);

  const reset = navigationReducer(
    { ...observed, mode: "away", targetId: "target", fleetScope: "selected" },
    { type: "reset", speed: 40 },
  );
  assert.equal(reset.mode, "idle");
  assert.equal(reset.commandMode, "relative");
  assert.equal(reset.targetId, null);
  assert.equal(reset.fleetScope, null);
  assert.equal(reset.requestedSpeed, 40);
});
