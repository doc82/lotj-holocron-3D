import assert from "node:assert/strict";
import test from "node:test";
import { createYt1000 } from "../tools/models/yt-1000.mjs";
import { createAurek } from "../tools/models/aurek-light-fighter.mjs";
import { createBulwark } from "../tools/models/bulwark-class-cruiser.mjs";
import { createSprint } from "../tools/models/sprint-class-rescue-craft.mjs";
import { createValor } from "../tools/models/valor-class-cruiser.mjs";
import { createGolanIII } from "../tools/models/golan-iii-station.mjs";
import { createPraetorian } from "../tools/models/praetorian-frigate.mjs";
import { createFlashfire } from "../tools/models/flashfire-starfighter.mjs";
import { createHash } from "node:crypto";
import { decodeGlb, encodeShipGlb } from "../tools/ship-glb.mjs";
import { configuredShipModelIdFor } from "../renderer/src/domain/shipModels.ts";
import catalog from "../renderer/src/domain/shipModelCatalog.json" with { type: "json" };

test("new ships resolve by class, including shared Naboo identity and named freighters", () => {
  for (const alias of ["Naboo Fighter", "Naboo N-1 Starfighter", "Naboo N1 Starfighter"]) {
    assert.equal(configuredShipModelIdFor(alias), "naboo-n1-starfighter");
  }
  assert.equal(configuredShipModelIdFor("JumpMaster 5000", "Planet Jumper Six"), "jumpmaster-5000");
  assert.equal(
    configuredShipModelIdFor("YT-1000 Light Freighter", "Fast Hauler Three"),
    "yt-1000-light-freighter",
  );
  assert.equal(configuredShipModelIdFor("YT-2400 Light Freighter"), "yt-2400-light-freighter");
});

test("new downloaded models retain verified attribution and explicit bow orientation", () => {
  const naboo = catalog.models.find((m) => m.id === "naboo-n1-starfighter");
  const jumpmaster = catalog.models.find((m) => m.id === "jumpmaster-5000");
  assert.deepEqual(naboo.orientation, { lateral: 0, vertical: 1, longitudinal: 2, forwardSign: 1 });
  assert.deepEqual(jumpmaster.orientation, {
    lateral: 0,
    vertical: 2,
    longitudinal: 1,
    forwardSign: -1,
  });
  assert.equal(naboo.attribution.license, "CC BY 4.0");
  assert.equal(jumpmaster.attribution.license, "CC BY-NC");
  assert.equal(jumpmaster.source.entry, "Jumpmaster5000.STL");
});

test("Aurek aliases select the original fighter without changing other fighter defaults", () => {
  for (const alias of [
    "Aurek Light Fighter",
    "Aurek Light Fighter:",
    "Aurek-class Tactical Strikefighter",
    "Aurek Starfighter",
  ]) {
    assert.equal(configuredShipModelIdFor(alias, "Red Flight One"), "aurek-light-fighter");
  }
  assert.equal(configuredShipModelIdFor("Unknown Fighter", "", "starfighter"), "x-wing");
  assert.equal(configuredShipModelIdFor("Naboo Fighter"), "naboo-n1-starfighter");
});

test("Bulwark releases use original geometry with no downloaded source dependency", () => {
  const model = catalog.models.find((m) => m.id === "bulwark-class-cruiser");
  assert.equal(model.category, "cruiser");
  assert.deepEqual(model.source, {
    kind: "generated",
    filename: "tools/models/bulwark-class-cruiser.mjs",
  });
  assert.equal(model.releaseEligible, true);
  assert.match(model.attribution.license, /^Original project geometry/);
  assert.equal(model.attribution.author, "LotJ Holocron project");
  assert.doesNotMatch(JSON.stringify(model), /PopFeverMiniatures|cults3d|\.zip|\.STL/);
  for (const alias of [
    "Bulwark-Class Cruiser",
    "Bulwark Class Cruiser",
    "Bulwark Mark I Warship",
  ]) {
    assert.equal(configuredShipModelIdFor(alias, "Bulwark Test Ship"), model.id);
  }
  assert.equal(configuredShipModelIdFor("Unknown Cruiser", "", "cruiser"), "quasar-fire");
  assert.notEqual(configuredShipModelIdFor("Bulwark Mark III"), model.id);
  assert.notEqual(
    catalog.models.find((m) => m.id === "aurek-light-fighter").releaseEligible,
    false,
  );
});

test("Sprint rescue aliases resolve to original release geometry without overriding other transports", () => {
  const model = catalog.models.find((m) => m.id === "sprint-class-rescue-craft");
  assert.equal(model.category, "transport");
  assert.equal(model.releaseEligible, true);
  assert.deepEqual(model.source, {
    kind: "generated",
    filename: "tools/models/sprint-class-rescue-craft.mjs",
  });
  assert.match(model.attribution.license, /^Original project geometry/);
  for (const alias of [
    ...model.aliases,
    "Sprint Class Rescue Craft",
    "Sprint-Class Rescue Craft:",
  ]) {
    assert.equal(configuredShipModelIdFor(alias, "Bright Flight"), model.id);
  }
  assert.notEqual(configuredShipModelIdFor("Unknown Transport", "", "transport"), model.id);
  assert.notEqual(configuredShipModelIdFor("Gamma-class Assault Shuttle"), model.id);
  assert.notEqual(configuredShipModelIdFor("Unknown Class", "Bright Flight"), model.id);
});

test("Valor aliases select original release geometry without replacing cruiser defaults", () => {
  const model = catalog.models.find((m) => m.id === "valor-class-cruiser");
  assert.deepEqual(model.source, {
    kind: "generated",
    filename: "tools/models/valor-class-cruiser.mjs",
  });
  assert.equal(model.releaseEligible, true);
  assert.match(model.attribution.license, /^Original project geometry/);
  for (const alias of [...model.aliases, "Valor Class Cruiser", "Valor-Class Cruiser:"])
    assert.equal(configuredShipModelIdFor(alias, "Republic One"), model.id);
  assert.equal(configuredShipModelIdFor("Unknown Cruiser", "", "cruiser"), "quasar-fire");
  assert.notEqual(configuredShipModelIdFor("Unknown Class", "Valor"), model.id);
});

test("Valor geometry is deterministic, symmetric and has six suspended aft engines", () => {
  const parts = createValor();
  assert.deepEqual(parts, createValor());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.length / 9 > 1000 && positions.length / 9 < 18000);
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  const engines = parts.filter((p) => p.name.startsWith("Engine aperture"));
  assert.equal(engines.length, 6);
  for (const engine of engines)
    for (let i = 0; i < engine.positions.length; i += 3) {
      assert.ok(engine.positions[i + 1] < -0.12);
      assert.ok(engine.positions[i + 2] < -0.94);
    }
});

test("All installations use Golan III without changing ordinary ship matching", () => {
  const model = catalog.models.find((m) => m.id === "golan-iii-station");
  assert.equal(model.releaseEligible, true);
  assert.equal(model.source.kind, "generated");
  assert.match(model.attribution.license, /^Original project geometry/);
  for (const alias of [model.displayName, ...model.aliases])
    assert.equal(configuredShipModelIdFor(alias), model.id);
  for (const category of ["battlestation", "platform", "BattleStation"]) {
    for (const [cls, name] of [
      ["Black Market Station", "Rust Ring"],
      ["Orbital Shipyard", "Deep Space One"],
      ["Unknown Installation", "X-wing"],
      ["YT-1000 Light Freighter", "Pollution"],
      ["", ""],
    ])
      assert.equal(configuredShipModelIdFor(cls, name, category), model.id);
  }
  assert.equal(
    configuredShipModelIdFor("YT-1000 Light Freighter", "Station Runner", "freighter"),
    "yt-1000-light-freighter",
  );
  assert.equal(configuredShipModelIdFor("Unknown Cruiser", "", "cruiser"), "quasar-fire");
});

test("Golan III geometry has twin towers, a lower spire and no propulsion engines", () => {
  const parts = createGolanIII();
  assert.deepEqual(parts, createGolanIII());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.length / 9 > 1000 && positions.length / 9 < 18000);
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  assert.equal(parts.filter((p) => p.name.endsWith("tower shaft")).length, 2);
  assert.equal(parts.filter((p) => p.name.endsWith("primary hangar")).length, 2);
  assert.ok(!parts.some((p) => /engine|exhaust/i.test(p.name)));
  const spire = parts.find((p) => p.name === "Ventral spire");
  assert.ok(spire.positions.filter((_, i) => i % 3 === 1).every((y) => y < -0.3));
});

test("Praetorian replaces the unverified STL while retaining frigate matching", () => {
  const model = catalog.models.find((m) => m.id === "praetorian-frigate");
  assert.deepEqual(model.source, {
    kind: "generated",
    filename: "tools/models/praetorian-frigate.mjs",
  });
  assert.equal(model.releaseEligible, true);
  assert.match(model.attribution.license, /^Original project geometry/);
  assert.doesNotMatch(JSON.stringify(model), /cults3d|\.stl|Unknown creator/);
  for (const alias of [...model.aliases, " Praetorian-class Frigate ", "Praetorian Class Frigate:"])
    assert.equal(configuredShipModelIdFor(alias, "Republic Escort"), model.id);
  assert.equal(configuredShipModelIdFor("Unknown Frigate", "", "frigate"), model.id);
  assert.notEqual(configuredShipModelIdFor("Praetor-class Battlecruiser"), model.id);
});

test("Praetorian geometry is symmetric, deterministic and correctly oriented", () => {
  const parts = createPraetorian();
  assert.deepEqual(parts, createPraetorian());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  assert.ok(positions.length / 9 > 1000 && positions.length / 9 < 18000);
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  const engines = parts.filter((p) => p.name.endsWith("engine aperture"));
  assert.equal(engines.length, 4);
  for (const p of engines)
    assert.ok(p.positions.filter((_, i) => i % 3 === 2).every((z) => z < -1));
  const pods = parts.filter((p) => p.name.endsWith("forward command pod"));
  assert.equal(pods.length, 2);
  for (const p of pods) assert.ok(p.positions.filter((_, i) => i % 3 === 2).every((z) => z > 0.7));
});

test("Flashfire aliases select original release geometry without changing fighter defaults", () => {
  const model = catalog.models.find((m) => m.id === "flashfire-starfighter");
  assert.deepEqual(model.source, {
    kind: "generated",
    filename: "tools/models/flashfire-starfighter.mjs",
  });
  assert.equal(model.releaseEligible, true);
  for (const alias of [...model.aliases, " Flashfire Starfighter ", "Flashfire Starfighter:"])
    assert.equal(configuredShipModelIdFor(alias, "Blue Flight"), model.id);
  assert.equal(configuredShipModelIdFor("Unknown Fighter", "", "starfighter"), "x-wing");
  for (const alias of ["NovaDive", "S-13 Sting", "IL-5 Skybolt"])
    assert.notEqual(configuredShipModelIdFor(alias), model.id);
});

test("Flashfire is symmetric, deterministic, bounded and has forward guns and aft engines", () => {
  const parts = createFlashfire();
  assert.deepEqual(parts, createFlashfire());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  assert.ok(positions.length / 9 > 500 && positions.length / 9 < 8000);
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  const guns = parts.filter((p) => p.name.endsWith("laser muzzle"));
  assert.equal(guns.length, 2);
  for (const p of guns) assert.ok(p.positions.filter((_, i) => i % 3 === 2).every((z) => z > 0.3));
  const engine = parts.find((p) => p.name === "Axial engine aperture");
  assert.ok(engine.positions.filter((_, i) => i % 3 === 2).every((z) => z < -0.9));
});

test("Sprint is deterministic, symmetric, unarmed and has a low wide hull", () => {
  const parts = createSprint();
  assert.deepEqual(parts, createSprint());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  assert.ok(parts.every((p) => !/(cannon|turret|weapon|missile|barrel)/i.test(p.name)));
  const positions = parts.flatMap((p) => p.positions);
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.length / 9 > 500 && positions.length / 9 < 10000);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  const axes = [0, 1, 2].map((a) => positions.filter((_, i) => i % 3 === a));
  const spans = axes.map((values) => Math.max(...values) - Math.min(...values));
  assert.ok(spans[0] > spans[1] * 2);
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  assert.equal(parts.filter((p) => p.name.endsWith("docking collar")).length, 2);
  const engines = parts.filter((p) => p.name.endsWith("exhaust aperture"));
  assert.equal(engines.length, 2);
  for (const engine of engines)
    for (let i = 2; i < engine.positions.length; i += 3) assert.ok(engine.positions[i] < -0.9);
  const bay = parts.find((p) => p.name === "Fore rescue bay door");
  for (let i = 2; i < bay.positions.length; i += 3) assert.ok(bay.positions[i] > 0.9);
});

test("original Bulwark is deterministic, symmetric, bounded and has its hangar forward", () => {
  const parts = createBulwark();
  assert.deepEqual(parts, createBulwark());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.length / 9 > 500 && positions.length / 9 < 18000);
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  const hangar = parts.find((p) => p.name === "Forward hangar recess");
  for (let i = 2; i < hangar.positions.length; i += 3) assert.ok(hangar.positions[i] > 0.9);
  const engines = parts.filter((p) => p.name.includes("engine aperture"));
  assert.equal(engines.length, 3);
  for (const engine of engines)
    for (let i = 2; i < engine.positions.length; i += 3) assert.ok(engine.positions[i] < -0.8);
});

test("Aurek geometry is symmetric, bounded, deterministic and below its triangle budget", () => {
  const parts = createAurek();
  assert.deepEqual(parts, createAurek());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.length / 9 > 500 && positions.length / 9 < 8000);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  const key = (x, y, z) => [x, y, z].map((v) => Math.round(v * 1e7)).join(",");
  const vertices = new Set();
  for (let i = 0; i < positions.length; i += 3) vertices.add(key(...positions.slice(i, i + 3)));
  for (let i = 0; i < positions.length; i += 3)
    assert.ok(vertices.has(key(-positions[i], positions[i + 1], positions[i + 2])));
  const cockpit = parts.find((p) => p.name === "Cockpit glazing");
  for (let i = 2; i < cockpit.positions.length; i += 3) assert.ok(cockpit.positions[i] < 0);
  assert.equal(parts.filter((p) => p.name.endsWith("cannon barrel")).length, 2);
  assert.equal(parts.filter((p) => p.name.endsWith("engine housing")).length, 2);
});

test("shared primitives preserve the approved YT-1000 runtime geometry exactly", () => {
  const positions = new Float32Array(createYt1000().flatMap((p) => p.positions));
  assert.equal(
    createHash("sha256").update(Buffer.from(positions.buffer)).digest("hex"),
    "a33e35de7af1e7f1d09b2b07507fca6897decd69de1f77ed086a81194a29456b",
  );
});

test("original YT-1000 is deterministic, bounded, and has cockpit forward and engines aft", () => {
  const parts = createYt1000();
  assert.deepEqual(parts, createYt1000());
  assert.equal(new Set(parts.map((p) => p.name)).size, parts.length);
  const positions = parts.flatMap((p) => p.positions);
  assert.equal(positions.length % 9, 0);
  assert.ok(positions.length / 9 < 12000);
  assert.ok(positions.every((v) => Number.isFinite(v) && Math.abs(v) < 1.1));
  const cockpit = parts.find((p) => p.name === "Cockpit shell");
  for (let i = 0; i < cockpit.positions.length; i += 3) {
    assert.ok(Math.abs(cockpit.positions[i]) <= 0.15);
    assert.ok(cockpit.positions[i + 2] >= 0.45);
  }
  const engines = parts.filter((p) => p.name.endsWith("engine housing"));
  assert.equal(engines.length, 2);
  for (const engine of engines)
    for (let i = 2; i < engine.positions.length; i += 3) assert.ok(engine.positions[i] <= -0.5);
});

for (const [name, createModel] of [
  ["YT-1000", createYt1000],
  ["Aurek", createAurek],
  ["Bulwark", createBulwark],
  ["Sprint", createSprint],
  ["Valor", createValor],
  ["Golan III", createGolanIII],
  ["Praetorian", createPraetorian],
  ["Flashfire", createFlashfire],
]) {
  test(`${name} GLB round trips all named parts with finite normalized normals and exact position bounds`, () => {
    const parts = createModel();
    const encoded = encodeShipGlb(parts);
    const { gltf, binary } = decodeGlb(encoded);
    assert.equal(gltf.meshes.length, parts.length);
    assert.equal(gltf.buffers[0].byteLength, binary.length);
    for (const [index, part] of parts.entries()) {
      assert.equal(gltf.nodes[index].name, part.name);
      const primitive = gltf.meshes[index].primitives[0];
      const read = (index) => {
        const a = gltf.accessors[index];
        const view = gltf.bufferViews[a.bufferView];
        assert.ok(view.byteOffset + view.byteLength <= binary.length);
        return Array.from({ length: a.count * 3 }, (_, i) =>
          binary.readFloatLE(view.byteOffset + i * 4),
        );
      };
      const positions = read(primitive.attributes.POSITION);
      assert.deepEqual(positions, part.positions.map(Math.fround));
      const normals = read(primitive.attributes.NORMAL);
      for (let i = 0; i < normals.length; i += 3)
        assert.ok(Math.abs(Math.hypot(...normals.slice(i, i + 3)) - 1) < 1e-6);
      const accessor = gltf.accessors[primitive.attributes.POSITION];
      for (let axis = 0; axis < 3; axis++) {
        const coordinates = positions.filter((_, i) => i % 3 === axis);
        assert.equal(accessor.min[axis], Math.min(...coordinates));
        assert.equal(accessor.max[axis], Math.max(...coordinates));
      }
    }
  });
}
test("GLB importer rejects malformed headers, truncation and invalid chunk sizes", () => {
  const bytes = encodeShipGlb(createYt1000());
  assert.throws(() => decodeGlb(bytes.subarray(0, 10)), /Invalid GLB/);
  assert.throws(() => decodeGlb(bytes.subarray(0, bytes.length - 4)), /Invalid GLB/);
  const badVersion = Buffer.from(bytes);
  badVersion.writeUInt32LE(1, 4);
  assert.throws(() => decodeGlb(badVersion), /Invalid GLB/);
  const badChunk = Buffer.from(bytes);
  badChunk.writeUInt32LE(bytes.length, 12);
  assert.throws(() => decodeGlb(badChunk), /chunk length/);
  const badFirstChunk = Buffer.from(bytes);
  badFirstChunk.writeUInt32LE(0x004e4942, 16);
  assert.throws(() => decodeGlb(badFirstChunk), /JSON must be first/);
});
