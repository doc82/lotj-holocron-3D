import assert from "node:assert/strict";
import test from "node:test";

import {
  OrbitCamera,
  SceneInterpolator,
  buildScene,
  easeOutCubic,
  findScenePoint,
  lookAt,
  multiply,
  orthographic,
  perspective,
  pointerToXZVector,
  project,
  projectileVisual,
  sensorRangeFor,
  scenesHaveMotion,
} from "../renderer/src/domain/scene.ts";

test("remote scan range always includes the 500-unit base", () => {
  assert.equal(sensorRangeFor(undefined), 500);
  assert.equal(sensorRangeFor({ id: "player-ship", sensorArray: 0 }), 500);
  assert.equal(sensorRangeFor({ id: "player-ship", sensorArray: 7 }), 570);
});

test("every ship category has a unique military marker and experimental pixel width", () => {
  const classes = [
    ["Vehicle", 1], ["Starfighter", 1], ["Transport", 3], ["Freighter", 4],
    ["Gunboat", 5], ["Corvette", 6], ["Frigate", 7], ["Cruiser", 8],
    ["Battleship", 9], ["Battlestation", 10], ["Platform", 11],
  ];
  const scene = buildScene({
    observer: { id: "player-ship", shipCategory: "Cruiser", x: 0, y: 0, z: 0 },
    entities: classes.map(([shipCategory], index) => ({
      id: String(shipCategory).toLowerCase(), name: String(shipCategory), kind: "ship",
      shipCategory: String(shipCategory), disposition: index % 3 === 0 ? "ally" : index % 3 === 1 ? "enemy" : "neutral",
      x: index + 1, y: 0, z: 0,
    })),
  });
  const markers = classes.map(([shipCategory, pixels]) => {
    const marker = findScenePoint(scene, String(shipCategory).toLowerCase());
    assert.equal(marker.pointSize, pixels);
    return marker;
  });
  assert.equal(new Set(markers.map((marker) => marker.markerShape)).size, 11);
  assert.equal(scene.points[0].pointSize, 8);
  assert.equal(scene.points[0].markerShape, 8);
  assert.deepEqual(scene.points[0].color, [0.5, 0.96, 1]);
  assert.deepEqual(markers[0].color, [0.16, 0.58, 1]);
  assert.deepEqual(markers[1].color, [1, 0.16, 0.2]);
  assert.deepEqual(markers[2].color, [1, 0.76, 0.12]);
});

test("missiles, torpedoes, and rockets have distinct tactical signatures", () => {
  const signatures = [
    projectileVisual({ name: "A Concussion Missile" }),
    projectileVisual({ name: "A Proton Torpedo" }),
    projectileVisual({ name: "A Heavy Rocket" }),
  ];
  assert.equal(new Set(signatures.map(({ shape }) => shape)).size, 3);
  assert.equal(new Set(signatures.map(({ color }) => color.join(":"))).size, 3);
  assert.ok(signatures.every(({ pixels }) => pixels >= 12),
    "live ordnance should remain visible at strategic radar zoom");
  const scene = buildScene({
    observer: { id: "player-ship", x: 0, y: 0, z: 0 },
    entities: [
      { id: "missile", name: "A Concussion Missile", kind: "projectile", x: 10, y: 0, z: 0 },
      { id: "torpedo", name: "A Proton Torpedo", kind: "projectile", x: 20, y: 0, z: 0 },
      { id: "rocket", name: "A Heavy Rocket", kind: "projectile", x: 30, y: 0, z: 0 },
    ],
  });
  assert.equal(new Set(scene.points.slice(1).map(({ markerShape }) => markerShape)).size, 3);
});

test("orthographic tactical scale projects ten pixels per distance unit", () => {
  const height = 800;
  const halfHeight = height / (2 * 10);
  const matrix = orthographic(-halfHeight, halfHeight, -halfHeight, halfHeight, 0.1, 100);
  const origin = project([0, 0, -1], matrix, height, height);
  const oneUnit = project([1, 0, -1], matrix, height, height);
  assert.ok(origin && oneUnit);
  assert.ok(Math.abs(oneUnit.x - origin.x - 10) < 0.0001);
  const gridPixelSpan = 6_000 * matrix[0] * height / 2;
  assert.ok(Math.abs(gridPixelSpan - 60_000) < 0.01,
    "the ±3,000-unit grid should span 60,000 pixels at the 10 px/unit reference scale");
});

test("course plotting keeps the X/Z vector endpoint under the pointer", () => {
  const camera = new OrbitCamera();
  camera.distance = 100;
  const width = 1_000;
  const height = 800;
  const deltaX = 120;
  const deltaY = 80;
  const vector = pointerToXZVector(
    deltaX,
    deltaY,
    camera.distance * 2 / height,
    camera.yaw,
    camera.pitch,
  );
  const matrix = multiply(
    orthographic(-125, 125, -100, 100, 0.05, 2_000),
    lookAt(camera.eye(1_000)),
  );
  const endpoint = project(vector, matrix, width, height);
  assert.ok(endpoint);
  assert.ok(Math.abs(endpoint.x - (width / 2 + deltaX)) < 0.001);
  assert.ok(Math.abs(endpoint.y - (height / 2 + deltaY)) < 0.001);
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
  assert.ok(camera.minimumDistance <= 1.25, "close tactical zoom should be substantially deeper than fit view");
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
  assert.deepEqual(observer.worldPosition, [8.75, 0, 0]);
  assert.deepEqual(gore.position3d, [78.75, 17.5, 0]);
  assert.deepEqual(interpolator.sample(2_000).points[1].position3d, [90, 20, 0]);
});

test("telemetry interpolation starts promptly and decelerates into its target", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(0.5), 0.875);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.25) - easeOutCubic(0)
    > easeOutCubic(1) - easeOutCubic(0.75));
});

test("exactly colocated ships and celestial bodies share a stable selectable cluster", () => {
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
  assert.equal(scene.points.length, 3, "observer, nearby ship, and combined contact cluster should render");
  const cluster = scene.points.find((point) => point.kind === "cluster");
  assert.ok(cluster);
  assert.equal(cluster.memberCount, 3);
  assert.equal(cluster.memberSummary, "2 SHIPS, 1 PLANET");
  assert.deepEqual(cluster.members.map((member) => member.id), ["gore", "moon", "strega"]);
  assert.equal(findScenePoint(scene, "strega").name, "Strega");
  assert.equal(findScenePoint(scene, "moon").kind, "celestial");
  assert.equal(scene.points.some((point) => point.id === "nearby"), true);
  assert.equal(scene.points.some((point) => point.id === "moon"), false,
    "the celestial contact should remain selectable inside the cluster rather than overlap it");
});

test("camera reports motion only while it is converging", () => {
  const camera = new OrbitCamera();
  assert.equal(camera.isMoving(), false);
  camera.orbit(20, 0);
  assert.equal(camera.isMoving(), true);
  for (let frame = 0; frame < 120; frame += 1) camera.update(1 / 30);
  assert.equal(camera.isMoving(), false);
});
