import assert from "node:assert/strict";
import test from "node:test";

import {
  OrbitCamera,
  SceneInterpolator,
  buildScene,
  findScenePoint,
  lookAt,
  multiply,
  perspective,
  project,
  sensorRangeFor,
  scenesHaveMotion,
} from "../renderer/src/domain/scene.ts";

test("remote scan range always includes the 500-unit base", () => {
  assert.equal(sensorRangeFor(undefined), 500);
  assert.equal(sensorRangeFor({ id: "player-ship", sensorArray: 0 }), 500);
  assert.equal(sensorRangeFor({ id: "player-ship", sensorArray: 7 }), 570);
});

test("renderer scene stays centered on the observer", () => {
  const scene = buildScene({
    sequence: 12,
    observer: { id: "player-ship", name: "Forrestal", x: 100, y: -50, z: 25 },
    entities: [
      { id: "gore", name: "Gore", kind: "ship", x: 130, y: -40, z: 20 },
      { id: "dromund-kaas", name: "Dromund Kaas", kind: "celestial", x: 0, y: 0, z: 0 },
    ],
    metadata: { system: "Esstran Sector" },
  });

  assert.deepEqual(scene.points[0].position3d, [0, 0, 0]);
  assert.deepEqual(scene.points[0].worldPosition, [100, -50, 25]);
  assert.equal(scene.points[0].name, "Forrestal");
  assert.deepEqual(scene.points[1].position3d, [30, 10, -5]);
  assert.equal(scene.system, "Esstran Sector");
  assert.equal(scene.sequence, 12);
});

test("orbit camera cannot detach from the player focus", () => {
  const camera = new OrbitCamera();
  camera.fit(500, true);
  camera.orbit(100, -10_000);
  camera.zoom(-1_000_000);
  camera.update(1);

  assert.equal(camera.targetPitch, 1.45);
  assert.equal(camera.targetDistance, camera.minimumDistance);
  assert.ok(Math.abs(Math.hypot(...camera.eye()) - camera.distance) < 0.0001);

  const matrix = multiply(
    perspective(Math.PI / 3, 16 / 9, 0.1, 10_000),
    lookAt(camera.eye()),
  );
  const center = project([0, 0, 0], matrix, 1600, 900);
  assert.ok(center);
  assert.ok(Math.abs(center.x - 800) < 0.001);
  assert.ok(Math.abs(center.y - 450) < 0.001);
});

test("scene interpolation eases contacts between telemetry ticks", () => {
  const first = buildScene({
    observer: { x: 0, y: 0, z: 0 },
    entities: [{ id: "gore", name: "Gore", kind: "ship", x: 0, y: 0, z: 0 }],
  });
  const second = buildScene({
    observer: { x: 10, y: 0, z: 0 },
    entities: [{ id: "gore", name: "Gore", kind: "ship", x: 100, y: 20, z: 0 }],
  });
  assert.equal(scenesHaveMotion(first, second), true);

  const interpolator = new SceneInterpolator(first);
  interpolator.setTarget(second, 1_000, 1_000);
  assert.equal(interpolator.isAnimating(1_500), true);
  assert.equal(interpolator.isAnimating(2_000), false);
  const halfway = interpolator.sample(1_500);
  const observer = halfway.points.find((point) => point.id === "player-ship");
  const gore = halfway.points.find((point) => point.id === "gore");

  assert.deepEqual(observer.position3d, [0, 0, 0]);
  assert.deepEqual(observer.worldPosition, [5, 0, 0]);
  assert.deepEqual(gore.position3d, [45, 10, 0]);
  assert.deepEqual(interpolator.sample(2_000).points[1].position3d, [90, 20, 0]);
});

test("exactly colocated ships collapse into a stable selectable cluster", () => {
  const scene = buildScene({
    observer: { id: "player-ship", x: 100, y: 100, z: 100 },
    entities: [
      { id: "gore", name: "Gore", kind: "ship", x: 0, y: 0, z: 0 },
      { id: "strega", name: "Strega", kind: "ship", x: 0, y: 0, z: 0 },
      { id: "moon", name: "Moon", kind: "celestial", x: 0, y: 0, z: 0 },
      { id: "nearby", name: "Nearby", kind: "ship", x: 0, y: 0, z: 1 },
    ],
  });

  assert.equal(scene.contactCount, 4);
  assert.equal(scene.points.length, 4, "observer, celestial, nearby ship, and cluster should render");
  const cluster = scene.points.find((point) => point.kind === "cluster");
  assert.ok(cluster);
  assert.equal(cluster.memberCount, 2);
  assert.deepEqual(cluster.members.map((member) => member.id), ["gore", "strega"]);
  assert.equal(findScenePoint(scene, "strega").name, "Strega");
  assert.equal(scene.points.some((point) => point.id === "nearby"), true);
  assert.equal(scene.points.some((point) => point.id === "moon"), true);
});

test("camera reports motion only while it is converging", () => {
  const camera = new OrbitCamera();
  assert.equal(camera.isMoving(), false);
  camera.orbit(20, 0);
  assert.equal(camera.isMoving(), true);
  for (let frame = 0; frame < 120; frame += 1) camera.update(1 / 30);
  assert.equal(camera.isMoving(), false);
});
