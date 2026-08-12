import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renderer includes the cinematic startup and disconnected uplink states", async () => {
  const [html, app, startup, telemetry, uplink, globalStyles, startupStyles, uplinkStyles] = await Promise.all([
    readFile("renderer/index.html", "utf8"),
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/startup/StartupSequence.tsx", "utf8"),
    readFile("renderer/src/features/telemetry/useTelemetry.ts", "utf8"),
    readFile("renderer/src/features/connection/UplinkNotice.tsx", "utf8"),
    readFile("renderer/styles.css", "utf8"),
    readFile("renderer/src/features/startup/StartupSequence.module.css", "utf8"),
    readFile("renderer/src/features/connection/UplinkNotice.module.css", "utf8"),
  ]);

  assert.match(html, /src="\/src\/main\.tsx"/);
  assert.match(startup, /data-text="Holocron3D"/);
  assert.match(startup, /styles\.threeD/);
  assert.match(startup, /event\.key !== "Escape"/);
  assert.match(startup, /edgeActivation/);
  assert.match(startup, /setPhase\("dissolving"\)/);
  assert.match(startup, /styles\.hyperspace/);
  assert.match(telemetry, /connectionLabel/);
  assert.match(uplink, /Waiting for uplink to your Ship, Captain/);
  assert.match(uplink, /styles\.uplink/);
  assert.match(app, /telemetry\.connected && \(\s*<aside/);
  assert.match(app, /telemetry\.connected && \(\s*<footer/);
  assert.match(startupStyles, /\.title/);
  assert.doesNotMatch(startupStyles, /repeating-radial-gradient/);
  assert.match(uplinkStyles, /\.reticle/);
  assert.match(globalStyles, /prefers-reduced-motion/);
  assert.doesNotMatch(globalStyles, /\.uplink|\.titleStage|\.telemetry/);
});

test("release author and versions remain synchronized", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const mudletPackage = JSON.parse(await readFile("mudlet-package/mfile", "utf8"));
  const bootstrap = await readFile("mudlet-package/src/scripts/holocron3d.bootstrap.lua", "utf8");
  const proxy = await readFile("mudlet/lotj_holocron_proxy.lua", "utf8");
  const forge = await readFile("forge.config.cjs", "utf8");

  assert.equal(packageJson.author, "Veska");
  assert.equal(mudletPackage.author, "Veska");
  assert.equal(packageJson.version, mudletPackage.version);
  assert.match(bootstrap, new RegExp(`Package\\.VERSION = "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(proxy, new RegExp(`VERSION = "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(forge, /authors: "Veska"/);
});

test("tactical rendering sleeps while the scene is idle", async () => {
  const engine = await readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8");

  assert.match(engine, /ACTIVE_FRAME_INTERVAL_MS = 1000 \/ 30/);
  assert.match(engine, /interpolator\.isAnimating\(now\) \|\| this\.camera\.isMoving\(\)/);
  assert.match(engine, /document\.hidden/);
  assert.match(engine, /ResizeObserver/);
  assert.doesNotMatch(
    engine,
    /this\.drawBuffer\(this\.pointBuffer[\s\S]{0,160}requestAnimationFrame/,
  );
});

test("tactical renderer uses a toggleable sensor-range bubble instead of a floor grid", async () => {
  const [engine, app] = await Promise.all([
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/app/App.tsx", "utf8"),
  ]);

  assert.match(engine, /radarSurfaceBuffer/);
  assert.match(engine, /radarWireBuffer/);
  assert.match(engine, /sensorRangeFor\(snapshot\.observer\)/);
  assert.match(engine, /setRadarBubbleEnabled/);
  assert.doesNotMatch(engine, /gridBuffer|rebuildGridBuffer/);
  assert.match(app, /RADAR \{radarBubbleEnabled \? "ON" : "OFF"\}/);
  assert.match(app, /SCAN RANGE/);
});

test("tactical renderer provides a toggleable three-plane world-origin grid", async () => {
  const [engine, app] = await Promise.all([
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/app/App.tsx", "utf8"),
  ]);

  assert.match(engine, /MINIMUM_ORIGIN_GRID_EXTENT = 3_000/);
  assert.match(engine, /niceOriginGridStep/);
  assert.match(engine, /setOriginGridEnabled/);
  assert.match(engine, /this\.originOffset/);
  assert.match(engine, /originGridBuffer/);
  assert.match(app, /ORIGIN GRID \{originGridEnabled \? "ON" : "OFF"\}/);
});

test("colocated ship clusters expose counts and an expandable member grid", async () => {
  const [engine, canvas, app] = await Promise.all([
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/src/app/App.tsx", "utf8"),
  ]);

  assert.match(engine, /onClusterLabels/);
  assert.match(canvas, /styles\.clusterCount/);
  assert.match(canvas, /Open group of/);
  assert.match(app, /COLOCATED CONTACTS/);
  assert.match(app, /styles\.memberGrid/);
  assert.match(app, /onMouseEnter=.*setHoveredMemberId/);
  assert.match(app, /onClick=.*setSelectedId/);
});
