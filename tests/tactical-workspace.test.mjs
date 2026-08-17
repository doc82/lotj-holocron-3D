import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateReading,
  buildTacticalSnapshot,
  classifyTacticalSnapshot,
  fleetMembersForScope,
  resolveDossierShip,
} from "../renderer/src/domain/tacticalWorkspace.ts";

const localObserver = {
  id: "player-ship",
  name: "TeeHee1",
  kind: "ship",
  x: 0,
  y: 0,
  z: 0,
};

const remoteMember = {
  id: "fleet-2",
  name: "TeeHee3",
  role: "wing",
  slot: 2,
  system: "Esstran Sector",
};

const snapshot = {
  type: "system_snapshot",
  observedAt: 100,
  observer: localObserver,
  entities: [{ id: "isd45", name: "ISD45", kind: "ship" }],
  metadata: {
    fleet: {
      kind: "battlegroup",
      active: true,
      members: [
        { id: "fleet-1", name: "TeeHee1", leader: true },
        remoteMember,
      ],
    },
    tacticalViews: {
      "fleet-2": {
        memberId: "fleet-2",
        memberName: "TeeHee3",
        observedAt: 120,
        observer: { ...remoteMember, kind: "ship", x: 0, y: 0, z: 0 },
        entities: [{ id: "isd45", name: "ISD45", kind: "ship" }],
      },
    },
    combatTarget: "ISD45",
  },
};

test("remote tactical snapshots replace the observer without mutating root telemetry", () => {
  const remote = buildTacticalSnapshot(snapshot, "fleet-2");

  assert.equal(remote.observer.name, "TeeHee3");
  assert.equal(remote.observedAt, 120);
  assert.equal(remote.metadata.activeTacticalViewMemberId, "fleet-2");
  assert.equal(snapshot.observer.name, "TeeHee1");
});

test("tactical classification preserves formation, target, and user dispositions", () => {
  const remote = buildTacticalSnapshot(snapshot, "fleet-2");
  const classified = classifyTacticalSnapshot(remote, snapshot, { isd45: "ally" });

  assert.equal(classified.observer.formationMember, true);
  assert.equal(classified.entities[0].combatTarget, true);
  assert.equal(classified.entities[0].disposition, "ally");
});

test("fleet scope selection and aggregate meters remain independent of React state", () => {
  const fleet = snapshot.metadata.fleet;
  assert.deepEqual(fleetMembersForScope(fleet, "wings", []), [remoteMember]);
  assert.deepEqual(fleetMembersForScope(fleet, "selected", [remoteMember]), [remoteMember]);
  assert.deepEqual(fleetMembersForScope(fleet, "local", [remoteMember]), []);
  assert.deepEqual(
    aggregateReading([
      { current: 20, maximum: 50 },
      { current: 30, maximum: 50 },
    ]),
    { current: 50, maximum: 100 },
  );
});

test("dossier resolution merges refreshed fleet data into the requested ship", () => {
  const dossier = resolveDossierShip({
    request: { id: "fleet-2", name: "TeeHee3", seed: { id: "fleet-2", name: "TeeHee3" } },
    localName: "TeeHee1",
    localObserver,
    fleetMembers: [{ ...remoteMember, condition: "disabled" }],
    scenePoints: [],
  });

  assert.equal(dossier.name, "TeeHee3");
  assert.equal(dossier.condition, "disabled");
  assert.equal(dossier.kind, "ship");
});
