import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLANET_TEXTURE_ASSIGNMENTS,
  planetVisual,
  resolvePlanetAssetUrl,
} from "../renderer/src/domain/planetVisuals.ts";

const CONFIRMED_PLANETS = [
  "Alderaan",
  "Arkania",
  "Bespin",
  "Corellia",
  "Coruscant",
  "Dantooine",
  "Dromund Kaas",
  "Hapes",
  "Ithor",
  "Kashyyyk",
  "Korriban",
  "Lorrd",
  "Mandalore",
  "Mon Cala",
  "Mustafar",
  "Nal Hutta",
  "Nar Shaddaa",
  "Ryloth",
  "Tatooine",
  "Wroona",
];

test("every confirmed world has its own texture and bump-map pair", () => {
  assert.deepEqual(
    PLANET_TEXTURE_ASSIGNMENTS.map(({ planet }) => planet),
    CONFIRMED_PLANETS,
  );
  const keys = CONFIRMED_PLANETS.map((name) => planetVisual(name).textureKey);
  assert.equal(new Set(keys).size, CONFIRMED_PLANETS.length);
  for (const name of CONFIRMED_PLANETS) {
    const visual = planetVisual(name);
    assert.equal(visual.exact, true, name);
    assert.match(visual.textureUrl, /^\.\/planet-textures\/[a-z-]+\.webp$/);
    assert.match(visual.normalUrl, /^\.\/planet-textures\/[a-z-]+-normal\.webp$/);
  }
});

test("alternate names resolve to the same physical world", () => {
  assert.equal(planetVisual("Moraband").textureKey, planetVisual("Korriban").textureKey);
  assert.equal(planetVisual("Dac").textureKey, planetVisual("Mon Cala").textureKey);
});

test("planet texture URLs resolve from the renderer document instead of its CSS bundle", () => {
  assert.equal(
    resolvePlanetAssetUrl(
      "./planet-textures/dromund-kaas.webp",
      "file:///application/resources/app.asar/renderer/dist/index.html",
    ),
    "file:///application/resources/app.asar/renderer/dist/planet-textures/dromund-kaas.webp",
  );
});

test("unknown planets receive a stable procedural visual without borrowing an assigned texture", () => {
  assert.deepEqual(planetVisual("A New World"), planetVisual("A New World"));
  assert.equal(planetVisual("A New World").exact, false);
  assert.equal(planetVisual("A New World").textureKey, undefined);
  assert.equal(planetVisual("A New World").textureUrl, undefined);
});

test("the shared planet sphere is used by tactical, local, and galactic views", async () => {
  const [canvas, engine, planner, localView, builder] = await Promise.all([
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/features/hyperspace/HyperspacePlanner.tsx", "utf8"),
    readFile("renderer/src/features/hyperspace/LocalHyperspaceView.tsx", "utf8"),
    readFile("tools/build-planet-textures.mjs", "utf8"),
  ]);
  assert.match(canvas, /<PlanetSphere/);
  assert.match(engine, /onPlanetSprites/);
  assert.match(engine, /publishPlanetSprites/);
  assert.match(planner, /<PlanetSphere name=\{planet\.name\}/);
  assert.match(localView, /<TacticalCanvas/);
  assert.match(builder, /planetTextureAssignments\.json/);
  assert.match(builder, /bump\/normal map/);
});
