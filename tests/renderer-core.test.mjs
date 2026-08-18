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
  pointerToXZVector,
  project,
  projectileVisual,
  sensorRangeFor,
  scenesHaveMotion,
} from "../renderer/src/domain/scene.ts";
import {
  absoluteFormationCenter,
  elevationFromPointer,
  elevationFromWheel,
  formationCenter,
  formationDestination,
  resolveFormationOrigins,
} from "../renderer/src/domain/coursePlot.ts";
import {
  canCommandFormation,
  fleetMemberSelectionKey,
  fleetMembersMatchingSelection,
  localFormationRole,
  selectFleetCommandMember,
  toggleFleetMemberSelection,
} from "../renderer/src/domain/fleet.ts";
import {
  combatVisualStyle,
  planCombatEvent,
  planDestructionEvent,
} from "../renderer/src/domain/combat.ts";
import {
  buildTacticalTargetShortcuts,
  reconcileDismissedTargetNames,
} from "../renderer/src/domain/tacticalTargets.ts";
import {
  normalizeShipDescription,
  sanitizedStatusSections,
  validatedInfoSections,
} from "../renderer/src/domain/shipDossier.ts";

test("squadron leadership is inferred from the local roster member", () => {
  const fleet = {
    kind: "squadron",
    active: true,
    members: [
      { id: "heehee", name: "HeeHee", leader: true, role: "lead" },
      { id: "hhee2", name: "Hhee2", role: "wing" },
    ],
  };
  assert.equal(localFormationRole(fleet, "heehee"), "lead");
  assert.equal(canCommandFormation(fleet, "HeeHee"), true);
  assert.equal(canCommandFormation(fleet, "Hhee2"), false);
});

test("fleet selection treats ships with colliding transport ids as separate cards", () => {
  const members = [
    { id: "unknown", name: "TeeHee1" },
    { id: "unknown", name: "TeeHee2" },
    { id: "teehee3", name: "TeeHee3" },
  ];
  const allSelected = new Set(members.map(fleetMemberSelectionKey));

  const next = toggleFleetMemberSelection(allSelected, members[0]);

  assert.deepEqual(
    fleetMembersMatchingSelection(members, next).map((member) => member.name),
    ["TeeHee2", "TeeHee3"],
  );
  assert.equal(next.size, 2, "one card click should deselect exactly one ship");
});

test("clicking a remote ship from all deselects only that ship", () => {
  const members = [
    { id: "observer", name: "HeeHee", leader: true },
    { id: "wing-one", name: "Wing One", slot: 1 },
    { id: "wing-two", name: "Wing Two", slot: 2 },
  ];
  const allSelected = new Set(members.map(fleetMemberSelectionKey));

  const selected = selectFleetCommandMember(members, allSelected, members[2], "all");
  assert.equal(selected.scope, "selected");
  assert.deepEqual(
    fleetMembersMatchingSelection(members, selected.selectionKeys).map((member) => member.name),
    ["HeeHee", "Wing One"],
    "a roster click from all must preserve every other selected ship",
  );

  const multiSelected = selectFleetCommandMember(
    members,
    selected.selectionKeys,
    members[1],
    "selected",
  );
  assert.equal(multiSelected.scope, "selected");
  assert.deepEqual(
    fleetMembersMatchingSelection(members, multiSelected.selectionKeys).map(
      (member) => member.name,
    ),
    ["HeeHee"],
    "another roster click must toggle only that ship",
  );
});

test("the observer toggles independently through a two-ship fleet selection", () => {
  const members = [
    { id: "observer", name: "HeeHee", leader: true },
    { id: "wing-one", name: "Wing One", slot: 1 },
  ];
  const allSelected = new Set(members.map(fleetMemberSelectionKey));

  const observerOnly = selectFleetCommandMember(members, allSelected, members[1], "all");
  assert.equal(observerOnly.scope, "selected");
  assert.deepEqual(
    fleetMembersMatchingSelection(members, observerOnly.selectionKeys).map((member) => member.name),
    ["HeeHee"],
  );

  const all = selectFleetCommandMember(members, observerOnly.selectionKeys, members[1], "selected");
  assert.equal(all.scope, "all");
  assert.deepEqual(
    fleetMembersMatchingSelection(members, all.selectionKeys).map((member) => member.name),
    ["HeeHee", "Wing One"],
  );

  const wingOnly = selectFleetCommandMember(members, all.selectionKeys, members[0], "all");
  assert.equal(wingOnly.scope, "selected");
  assert.deepEqual(
    fleetMembersMatchingSelection(members, wingOnly.selectionKeys).map((member) => member.name),
    ["Wing One"],
  );

  const restored = selectFleetCommandMember(
    members,
    wingOnly.selectionKeys,
    members[0],
    "selected",
  );
  assert.equal(restored.scope, "all");
  assert.deepEqual(
    fleetMembersMatchingSelection(members, restored.selectionKeys).map((member) => member.name),
    ["HeeHee", "Wing One"],
  );
});

test("target dismissals survive transient polling gaps and reset after confirmed absence", () => {
  const dismissed = new Set(["isd45"]);
  const firstGap = reconcileDismissedTargetNames(dismissed, new Map(), []);
  assert.deepEqual([...firstGap.dismissedNames], ["isd45"]);
  assert.equal(firstGap.absentSnapshots.get("isd45"), 1);

  const restored = reconcileDismissedTargetNames(
    firstGap.dismissedNames,
    firstGap.absentSnapshots,
    ["ISD45"],
  );
  assert.deepEqual([...restored.dismissedNames], ["isd45"]);
  assert.equal(restored.absentSnapshots.size, 0);

  const absentOnce = reconcileDismissedTargetNames(restored.dismissedNames, new Map(), []);
  const absentTwice = reconcileDismissedTargetNames(
    absentOnce.dismissedNames,
    absentOnce.absentSnapshots,
    [],
  );
  assert.equal(absentTwice.dismissedNames.size, 0);
});

test("formation movement lines share one destination", () => {
  const origins = [
    [-120, 10, 40],
    [40, -30, 80],
    [80, 20, -20],
  ];
  assert.deepEqual(formationCenter(origins), [-20, -5, 30]);
  assert.deepEqual(formationDestination(origins, [100, 25, -50]), [80, 20, -20]);
  assert.deepEqual(formationDestination([[15, 5, -10]], [100, 25, -50]), [115, 30, -60]);
  assert.deepEqual(absoluteFormationCenter([1_000, 2_000, 3_000], origins), [980, 1_995, 3_030]);
});

test("remote scan range always includes the 500-unit base", () => {
  assert.equal(sensorRangeFor(undefined), 500);
  assert.equal(sensorRangeFor({ id: "player-ship", sensorArray: 0 }), 500);
  assert.equal(sensorRangeFor({ id: "player-ship", sensorArray: 7 }), 570);
});

test("every ship category has a unique military marker and experimental pixel width", () => {
  const classes = [
    ["Vehicle", 1],
    ["Starfighter", 1],
    ["Transport", 3],
    ["Freighter", 4],
    ["Gunboat", 5],
    ["Corvette", 6],
    ["Frigate", 7],
    ["Cruiser", 8],
    ["Battleship", 9],
    ["Battlestation", 10],
    ["Platform", 11],
  ];
  const scene = buildScene({
    observer: { id: "player-ship", shipCategory: "Cruiser", x: 0, y: 0, z: 0 },
    entities: classes.map(([shipCategory], index) => ({
      id: String(shipCategory).toLowerCase(),
      name: String(shipCategory),
      kind: "ship",
      shipCategory: String(shipCategory),
      disposition: index % 3 === 0 ? "ally" : index % 3 === 1 ? "enemy" : "neutral",
      x: index + 1,
      y: 0,
      z: 0,
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
  assert.deepEqual(scene.points[0].color, [0.68, 0.3, 1]);
  assert.deepEqual(markers[0].color, [0.16, 0.58, 1]);
  assert.deepEqual(markers[1].color, [1, 0.16, 0.2]);
  assert.deepEqual(markers[2].color, [1, 0.76, 0.12]);
});

test("formation purple overrides disposition until that ship is the combat target", () => {
  const scene = buildScene({
    observer: { id: "player-ship", x: 0, y: 0, z: 0 },
    entities: [
      {
        id: "wing",
        name: "Wing",
        kind: "ship",
        x: 10,
        y: 0,
        z: 0,
        disposition: "enemy",
        formationMember: true,
      },
      {
        id: "targeted-wing",
        name: "Targeted Wing",
        kind: "ship",
        x: 20,
        y: 0,
        z: 0,
        disposition: "ally",
        formationMember: true,
        combatTarget: true,
      },
    ],
  });
  assert.deepEqual(findScenePoint(scene, "wing")?.color, [0.68, 0.3, 1]);
  assert.deepEqual(findScenePoint(scene, "targeted-wing")?.color, [1, 0.13, 0.18]);
});

test("target shortcuts group shared targets and retain scope ownership", () => {
  const shortcuts = buildTacticalTargetShortcuts({
    observerName: "TeeHee",
    combatTargets: {
      local: { key: "local", scope: "local", targetName: "Wayfarer" },
      wings: { key: "wings", scope: "wings", targetName: "wayfarer" },
      fleet: { key: "fleet", scope: "all", targetName: "Unknown Contact" },
    },
    scenePoints: [
      {
        id: "wayfarer",
        name: "Wayfarer",
        kind: "ship",
        condition: "Disabled",
        x: 100,
        y: 0,
        z: 0,
      },
    ],
  });
  assert.equal(shortcuts.length, 2);
  assert.deepEqual(shortcuts[0].ownerLabels, ["YOUR SHIP'S TARGET", "WING TARGET"]);
  assert.deepEqual(
    shortcuts[0].owners.map(({ key, scope }) => ({ key, scope })),
    [
      { key: "local", scope: "local" },
      { key: "wings", scope: "wings" },
    ],
  );
  assert.equal(shortcuts[0].targetName, "Wayfarer");
  assert.equal(shortcuts[0].ship?.condition, "Disabled");
  assert.equal(shortcuts[1].targetName, "Unknown Contact");
  assert.equal(shortcuts[1].ship, undefined);
});

test("target shortcuts recover a legacy local target without duplicating scoped local telemetry", () => {
  const legacy = buildTacticalTargetShortcuts({
    localTarget: "Wayfarer",
    observerName: "TeeHee",
    fleetMembers: [{ id: "wayfarer", name: "Wayfarer" }],
  });
  assert.equal(legacy.length, 1);
  assert.deepEqual(legacy[0].ownerLabels, ["YOUR SHIP'S TARGET"]);
  assert.deepEqual(
    legacy[0].owners.map(({ key, scope }) => ({ key, scope })),
    [{ key: "local", scope: "local" }],
  );
  assert.equal(legacy[0].ship?.id, "wayfarer");

  const scoped = buildTacticalTargetShortcuts({
    localTarget: "Stale Target",
    combatTargets: {
      local: { key: "local", scope: "local", targetName: "Wayfarer" },
    },
  });
  assert.deepEqual(
    scoped.map((target) => target.targetName),
    ["Wayfarer"],
  );
});

test("ship dossiers keep only static validated info fields in canonical order", () => {
  const sections = validatedInfoSections([
    {
      title: "SYSTEMS",
      rows: [
        { label: "Sensor Array", value: "  50  " },
        { label: "4200 Max Shields", value: "4200" },
        { label: "Maximum Speed", value: "55" },
        { label: "Communications", value: "{Tone: none}" },
      ],
    },
    {
      title: "WEAPONS",
      rows: [
        { label: "Maximum Torpedoes", value: "80" },
        { label: "Turbolasers", value: "27" },
        { label: "Unknown Weapon", value: "999" },
      ],
    },
  ]);
  assert.deepEqual(sections, [
    {
      title: "WEAPONS",
      rows: [
        { label: "Turbolasers", value: "27" },
        { label: "Maximum Torpedoes", value: "80" },
      ],
    },
    {
      title: "SYSTEMS",
      rows: [
        { label: "Maximum Speed", value: "55" },
        { label: "Sensor Array", value: "50" },
      ],
    },
  ]);
});

test("formation movement origins resolve every scoped ship without falling back to the player", () => {
  const members = [
    { id: "leader", name: "Leader" },
    { id: "wing-one", name: "Roster One", x: 140, y: 10, z: -20 },
    { id: "wing-two", name: "Roster Two", x: 160, y: 30, z: -40 },
  ];
  const points = [
    { id: "player-ship", name: "Leader", position3d: [0, 0, 0] },
    { id: "wing-one", name: "Radar Alias", position3d: [40, 10, -20] },
  ];
  const observer = { id: "player-ship", name: "Leader", worldPosition: [100, 0, 0] };
  assert.deepEqual(resolveFormationOrigins(members, points, observer), [
    [0, 0, 0],
    [40, 10, -20],
    [60, 30, -40],
  ]);
  assert.deepEqual(resolveFormationOrigins(members.slice(1), points, observer), [
    [40, 10, -20],
    [60, 30, -40],
  ]);
  assert.deepEqual(
    resolveFormationOrigins([{ id: "unknown-wing", name: "Unknown Wing" }], points, observer),
    [],
  );
});

test("status dossiers split turret summaries and discard Mudlet prompt fields", () => {
  const sections = sanitizedStatusSections([
    {
      title: "WEAPONS",
      rows: [{ label: "Total Turrets", value: "2. Damaged Turrets: [ (All turrets working) ]" }],
    },
    {
      title: "STORAGE",
      rows: [
        { label: "Escape Pods", value: "30/30" },
        { label: "{Tone", value: "none } {Time: night } {Ambience: quiet }" },
        { label: "{Health", value: "1100/1100} {OOC:||||||} [ ] {Movement: 1990/1990} []" },
      ],
    },
  ]);
  assert.deepEqual(sections, [
    {
      title: "WEAPONS",
      rows: [
        { label: "Total Turrets", value: "2" },
        { label: "Damaged Turrets", value: "[ (All turrets working) ]" },
      ],
    },
    { title: "STORAGE", rows: [{ label: "Escape Pods", value: "30/30" }] },
  ]);
});

test("ship dossier descriptions collapse into one paragraph and remove prompt blocks", () => {
  assert.equal(
    normalizeShipDescription([
      "The Victory-class Destroyer is a direct predecessor",
      "to the Imperial-class.   ",
      "{Tone: none } {Time: dawn }",
    ]),
    "The Victory-class Destroyer is a direct predecessor to the Imperial-class.",
  );
});

test("missiles, torpedoes, and rockets have distinct tactical signatures", () => {
  const signatures = [
    projectileVisual({ name: "A Concussion Missile" }),
    projectileVisual({ name: "A Proton Torpedo" }),
    projectileVisual({ name: "A Heavy Rocket" }),
  ];
  assert.equal(new Set(signatures.map(({ shape }) => shape)).size, 3);
  assert.equal(new Set(signatures.map(({ color }) => color.join(":"))).size, 3);
  assert.ok(
    signatures.every(({ pixels }) => pixels >= 12),
    "live ordnance should remain visible at strategic radar zoom",
  );
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

test("enemy volleys animate from the firing ship to the hit ship", () => {
  const points = [
    { name: "Player Ship", kind: "observer", position3d: [0, 0, 0] },
    { name: "ISD45", kind: "ship", position3d: [-200, 30, 40] },
    { name: "TeeHee3", kind: "ship", position3d: [200, 30, 40] },
  ];
  const now = 10_000;
  const ion = planCombatEvent(
    {
      id: 41,
      type: "impact",
      weapon: "ion",
      sourceName: "ISD45",
      targetName: "TeeHee3",
      outcome: "hit",
      count: 7,
    },
    points,
    now,
  );
  const shots = ion.filter((effect) => effect.type === "projectile");
  const hits = ion.filter((effect) => effect.type === "impact");

  assert.equal(shots.length, 7);
  assert.equal(hits.length, 7);
  assert.ok(
    shots.every(
      (effect) =>
        effect.weapon === "ion" && effect.outcome === "hit" && effect.targetName === "TeeHee3",
    ),
  );
  assert.ok(
    shots.every(
      (effect) =>
        JSON.stringify(effect.from) === JSON.stringify([-200, 30, 40]) &&
        JSON.stringify(effect.to) === JSON.stringify([200, 30, 40]),
    ),
  );
  assert.ok(hits.every((effect) => JSON.stringify(effect.to) === JSON.stringify([200, 30, 40])));
  assert.equal(shots[0].start, now);
  assert.equal(
    hits[0].start,
    now + 420,
    "impact flashes should follow the incoming projectile travel",
  );

  const turbolasers = planCombatEvent(
    {
      id: 45,
      type: "impact",
      weapon: "turbolaser",
      sourceName: "ISD45",
      targetName: "TeeHee3",
      outcome: "hit",
      count: 7,
    },
    points,
    now,
  );
  assert.equal(turbolasers.filter((effect) => effect.type === "projectile").length, 7);
  assert.equal(turbolasers.filter((effect) => effect.type === "impact").length, 7);
  assert.ok(
    turbolasers.every(
      (effect) => effect.weapon === "turbolaser" && effect.targetName === "TeeHee3",
    ),
  );
});

test("remote rockets and return fire preserve source, target, count, and outcome", () => {
  const points = [
    { name: "Player Ship", kind: "observer", position3d: [0, 0, 0] },
    { name: "ISD45", kind: "ship", position3d: [-200, 30, 40] },
    { name: "TeeHee3", kind: "ship", position3d: [200, 30, 40] },
  ];
  const rockets = planCombatEvent(
    {
      id: 42,
      type: "launch",
      weapon: "rocket",
      sourceName: "ISD45",
      targetName: "TeeHee3",
      count: 2,
    },
    points,
    20_000,
  );
  assert.equal(rockets.length, 2);
  assert.ok(
    rockets.every(
      (effect) =>
        effect.type === "launch" && effect.weapon === "rocket" && effect.targetName === "TeeHee3",
    ),
  );
  assert.deepEqual(
    rockets.map((effect) => effect.from),
    [
      [-200, 30, 40],
      [-200, 30, 40],
    ],
  );
  assert.deepEqual(
    rockets.map((effect) => effect.to),
    [
      [200, 30, 40],
      [200, 30, 40],
    ],
  );
  assert.deepEqual(
    rockets.map((effect) => effect.start),
    [20_000, 20_085],
  );

  const returnFire = planCombatEvent(
    {
      id: 43,
      type: "impact",
      weapon: "ion",
      sourceName: "TeeHee3",
      targetName: "ISD45",
      outcome: "hit",
      count: 4,
    },
    points,
    30_000,
  );
  assert.equal(returnFire.filter((effect) => effect.type === "projectile").length, 4);
  assert.equal(returnFire.filter((effect) => effect.type === "impact").length, 4);
  assert.deepEqual(returnFire[0].from, [200, 30, 40]);
  assert.deepEqual(returnFire[0].to, [-200, 30, 40]);

  const miss = planCombatEvent(
    {
      id: 44,
      type: "impact",
      weapon: "turbolaser",
      sourceName: "ISD45",
      targetName: "TeeHee3",
      outcome: "miss",
      count: 1,
    },
    points,
    40_000,
  );
  assert.equal(miss.length, 2);
  assert.ok(miss.every((effect) => effect.weapon === "turbolaser" && effect.outcome === "miss"));
  const missImpact = miss.find((effect) => effect.type === "impact");
  const hitStyle = combatVisualStyle(returnFire.find((effect) => effect.type === "impact"));
  const missStyle = combatVisualStyle(missImpact);
  assert.equal(missImpact.duration, 340);
  assert.ok(missStyle.impactRadius < hitStyle.impactRadius / 4);
  assert.ok(missStyle.pointSize < hitStyle.pointSize / 4);
  assert.ok(missStyle.opacity < hitStyle.opacity / 2);
  assert.ok(missStyle.trailFraction < hitStyle.trailFraction / 2);
});

test("destroyed ships explode at their last world position after map removal", () => {
  const effect = planDestructionEvent(
    {
      id: 9,
      phase: "destroyed",
      shipName: "ISD45",
      x: -200,
      y: 30,
      z: 40,
    },
    [{ name: "Player Ship", kind: "observer", position3d: [0, 0, 0] }],
    [-20, -30, -40],
    50_000,
  );

  assert.ok(effect, "event coordinates should survive removal of the scene contact");
  assert.equal(effect.shipName, "ISD45");
  assert.deepEqual(effect.origin, [-220, 0, 0]);
  assert.equal(effect.start, 50_000);
  assert.equal(effect.duration, 2_400);
});

test("orthographic tactical scale projects ten pixels per distance unit", () => {
  const height = 800;
  const halfHeight = height / (2 * 10);
  const matrix = orthographic(-halfHeight, halfHeight, -halfHeight, halfHeight, 0.1, 100);
  const origin = project([0, 0, -1], matrix, height, height);
  const oneUnit = project([1, 0, -1], matrix, height, height);
  assert.ok(origin && oneUnit);
  assert.ok(Math.abs(oneUnit.x - origin.x - 10) < 0.0001);
  const gridPixelSpan = (6_000 * matrix[0] * height) / 2;
  assert.ok(
    Math.abs(gridPixelSpan - 60_000) < 0.01,
    "the ±3,000-unit grid should span 60,000 pixels at the 10 px/unit reference scale",
  );
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
    (camera.distance * 2) / height,
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

test("course elevation starts at the dropped plot height and follows vertical movement", () => {
  const initialElevation = 240;
  const droppedPointerY = 315;
  const unitsPerPixel = 0.5;

  assert.equal(
    elevationFromPointer(initialElevation, droppedPointerY, droppedPointerY, unitsPerPixel),
    initialElevation,
    "engaging Shift must not jump Y to a canvas-centered value",
  );
  assert.equal(
    elevationFromPointer(initialElevation, droppedPointerY, droppedPointerY - 40, unitsPerPixel),
    260,
    "moving upward should raise the plotted Y coordinate",
  );
  assert.equal(
    elevationFromPointer(initialElevation, droppedPointerY, droppedPointerY + 40, unitsPerPixel),
    220,
    "moving downward should lower the plotted Y coordinate",
  );
});

test("Shift-wheel course elevation follows scroll direction", () => {
  assert.equal(
    elevationFromWheel(100, -30, 0.5),
    115,
    "scrolling upward should raise the plotted Y coordinate",
  );
  assert.equal(
    elevationFromWheel(100, 30, 0.5),
    85,
    "scrolling downward should lower the plotted Y coordinate",
  );
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

test("disabled ship condition survives scene construction", () => {
  const scene = buildScene({
    observer: { id: "player-ship", x: 0, y: 0, z: 0 },
    entities: [
      { id: "disabled", name: "TeeHee2", kind: "ship", x: 10, y: 0, z: 0, condition: "Disabled" },
    ],
  });
  assert.equal(findScenePoint(scene, "disabled")?.condition, "Disabled");
});

test("orbit camera cannot detach from the player focus", () => {
  const camera = new OrbitCamera();
  camera.fit(500, true);
  assert.ok(
    camera.minimumDistance <= 1.25,
    "close tactical zoom should be substantially deeper than fit view",
  );
  camera.orbit(100, -10_000);
  camera.zoom(-1_000_000);
  camera.update(1);

  assert.equal(camera.targetPitch, 1.45);
  assert.equal(camera.targetDistance, camera.minimumDistance);
  assert.ok(Math.abs(Math.hypot(...camera.eye()) - camera.distance) < 0.0001);
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
  assert.ok(easeOutCubic(0.25) - easeOutCubic(0) > easeOutCubic(1) - easeOutCubic(0.75));
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
  assert.equal(
    scene.points.length,
    3,
    "observer, nearby ship, and combined contact cluster should render",
  );
  const cluster = scene.points.find((point) => point.kind === "cluster");
  assert.ok(cluster);
  assert.equal(cluster.memberCount, 3);
  assert.equal(cluster.memberSummary, "2 SHIPS, 1 PLANET");
  assert.deepEqual(
    cluster.members.map((member) => member.id),
    ["gore", "moon", "strega"],
  );
  assert.equal(findScenePoint(scene, "strega").name, "Strega");
  assert.equal(findScenePoint(scene, "moon").kind, "celestial");
  assert.equal(
    scene.points.some((point) => point.id === "nearby"),
    true,
  );
  assert.equal(
    scene.points.some((point) => point.id === "moon"),
    false,
    "the celestial contact should remain selectable inside the cluster rather than overlap it",
  );
});

test("the observer participates in a colocated contact cluster without losing its camera anchor", () => {
  const scene = buildScene({
    observer: { id: "player-ship", name: "TeeHee1", x: 0, y: 0, z: 0 },
    entities: [
      { id: "teehee3", name: "TeeHee3", kind: "ship", x: 0, y: 0, z: 0 },
      { id: "korriban", name: "Korriban", kind: "planet", x: 0, y: 0, z: 0 },
      { id: "nearby", name: "Nearby", kind: "ship", x: 0, y: 0, z: 1 },
    ],
  });

  assert.equal(scene.points[0].kind, "observer", "the camera anchor remains a top-level point");
  assert.equal(scene.points[0].id, "player-ship");
  const cluster = scene.points.find((point) => point.kind === "cluster");
  assert.ok(cluster, "the orbital position should expose a contact picker");
  assert.equal(cluster.memberCount, 3);
  assert.equal(cluster.memberSummary, "2 SHIPS, 1 PLANET");
  assert.deepEqual(
    cluster.members.map((member) => member.id),
    ["korriban", "player-ship", "teehee3"],
  );
  assert.equal(
    scene.points.some((point) => point.id === "teehee3"),
    false,
    "the other ship should be selected through the cluster instead of hiding under the observer",
  );
  assert.equal(findScenePoint(scene, "teehee3").name, "TeeHee3");
  assert.equal(findScenePoint(scene, "korriban").kind, "planet");
});

test("camera reports motion only while it is converging", () => {
  const camera = new OrbitCamera();
  assert.equal(camera.isMoving(), false);
  camera.orbit(20, 0);
  assert.equal(camera.isMoving(), true);
  for (let frame = 0; frame < 120; frame += 1) camera.update(1 / 30);
  assert.equal(camera.isMoving(), false);
});
