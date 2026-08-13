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
  assert.match(startup, /setPhase\("lotjDeparting"\), 4_000/);
  assert.match(startup, /setPhase\("intro"\), 4_550/);
  assert.match(startup, /setPhase\("jumping"\);\s*\}, 8_450\)/);
  assert.match(startup, /A long time ago in a galaxy far, far away/);
  assert.match(startup, /Legends of<br \/>the Jedi/);
  assert.match(startup, /The Galaxy Awaits/);
  assert.match(startup, /Crafted by Veska/);
  assert.doesNotMatch(startup, /LOTJ TACTICAL SYSTEMS|NAVIGATION CORE INITIALIZING|styles\.rule/);
  assert.doesNotMatch(startupStyles, /\.rule|startup-rule|\.kicker|\.status/);
  assert.match(startup, /styles\.threeD/);
  assert.match(startup, /event\.key !== "Escape"/);
  assert.match(startup, /edgeActivation/);
  assert.doesNotMatch(startup, /dissolving/);
  assert.match(startup, /styles\.hyperspace/);
  assert.match(telemetry, /connectionLabel/);
  assert.match(uplink, /Waiting for uplink to your Ship, Captain/);
  assert.match(uplink, /styles\.uplink/);
  assert.match(app, /telemetry\.connected && \(\s*<nav/);
  assert.match(app, /telemetry\.connected && \(\s*<footer/);
  assert.match(startupStyles, /\.title/);
  assert.match(startupStyles, /\.lotjTitle/);
  assert.match(startupStyles, /#fbbf24/);
  assert.match(startupStyles, /#3b82f6/);
  assert.match(startupStyles, /lotj-starfield/);
  assert.doesNotMatch(startupStyles, /hyperspace-title/);
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
  assert.match(app, /Hide" : "Show"\} radar bubble/);
  assert.match(app, /sensorRange === null/);
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
  assert.match(app, /Hide" : "Show"\} origin grid/);
  assert.doesNotMatch(engine, /setOriginGridEnabled\(enabled: boolean\)[\s\S]{0,160}camera\.fit/);
});

test("colocated contact clusters expose counts and an expandable member grid", async () => {
  const [engine, canvas, app] = await Promise.all([
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/src/app/App.tsx", "utf8"),
  ]);

  assert.match(engine, /onClusterLabels/);
  assert.match(engine, /point\.kind === "cluster" && closest\.kind !== "cluster"/);
  assert.match(canvas, /styles\.clusterCount/);
  assert.match(canvas, /Open group of/);
  assert.match(canvas, /onPointerEnter=.*setTooltip/s);
  assert.match(canvas, /tooltip\.groupSummary \|\| tooltip\.name/);
  assert.match(app, /COLOCATED CONTACTS/);
  assert.match(app, /styles\.memberGrid/);
  assert.match(app, /onMouseEnter=.*setHoveredMemberId/);
  assert.match(app, /onClick=.*setSelectedId/);
});

test("contacts expose persistent disposition controls, shaped markers, and rich health hover cards", async () => {
  const [app, engine, canvas] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
  ]);
  assert.match(app, /holocron3d\.ship-dispositions\.v1/);
  assert.match(app, /set_ship_disposition/);
  assert.match(app, /TODO\(Veska\).*targeting the observer/);
  assert.match(engine, /a_shape/);
  assert.match(engine, /a_heading/);
  assert.match(engine, /headingPosition/);
  assert.match(engine, /v_forward/);
  assert.match(engine, /DEFAULT_PIXELS_PER_DISTANCE_UNIT/);
  assert.match(engine, /orthographic/);
  assert.match(engine, /u_markerScale/);
  assert.match(engine, /markerReferencePixelsPerUnit/);
  assert.match(engine, /max\(2\.0 \* u_pixelRatio/);
  assert.match(canvas, /UNKNOWN \/\/ \?/);
  assert.match(canvas, /CLASS \{tooltip\.shipCategory\.toUpperCase\(\)\}/);
  assert.match(canvas, /HealthBar label="SHIELD"/);
  assert.match(canvas, /HealthBar label="HULL"/);
  assert.match(canvas, /YOUR SHIP <span>\/\/ \{snapshot\.observer\?\.name/);
  assert.match(app, /if \(!id \|\| id === "player-ship"\)/);
  assert.match(app, /setSelectedId\(\(current\) => current === id \? null : id\)/);
  assert.match(app, /styles\.playerVessel/);
});

test("strategic zoom cross-fades glowing contacts into procedural class hulls", async () => {
  const [app, engine, canvas, models] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/src/domain/shipModels.ts", "utf8"),
  ]);
  for (const category of ["vehicle", "starfighter", "transport", "freighter", "gunboat",
    "corvette", "frigate", "cruiser", "battleship", "battlestation", "platform"]) {
    assert.match(models, new RegExp(`\\b${category}: \\{`));
  }
  assert.match(engine, /STRATEGIC_DOT_PPU/);
  assert.match(engine, /MODEL_DETAIL_PPU/);
  assert.match(engine, /rebuildShipMeshBuffer/);
  assert.match(engine, /gl\.TRIANGLES, false, modelBlend/);
  assert.match(engine, /gl\.POINTS, true, Math\.max\(0\.12, 1 - modelBlend\)/);
  assert.match(engine, /sectorView\(\): void/);
  assert.match(app, /aria-label="Open strategic sector view"/);
  assert.match(canvas, /STRATEGIC CONTACTS/);
  assert.match(canvas, /MODEL DETAIL/);
});

test("Homeworld-style shell separates commands, selected vessel, and fleet telemetry", async () => {
  const [app, css] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/app/App.module.css", "utf8"),
  ]);
  assert.match(app, /styles\.commandBank/);
  assert.match(app, /styles\.selectedVessel/);
  assert.match(app, /styles\.fleetBank/);
  assert.match(app, /COMMAND \/\/ \{\(navigableTarget\?\.name \|\| observer\.name\)\.toUpperCase\(\)\}/);
  assert.match(app, /FORMATION \/\/ ROSTER/);
  assert.match(app, /aria-label=\{`Select \$\{observer\.name\}`\}/);
  assert.match(app, /onClick=\{\(\) => selectContact\(observer\.id\)\}/);
  assert.match(css, /\.fleetShip\[aria-pressed="true"\]/);
  const commandBank = app.indexOf('className={styles.commandBank}');
  const speedControl = app.indexOf('className={styles.speedControl}');
  const fleetBank = app.indexOf('className={styles.fleetBank}');
  assert.ok(commandBank < speedControl && speedControl < fleetBank,
    "speed controls should belong to the player command bank, not the formation roster");
  assert.doesNotMatch(app.slice(fleetBank), /styles\.speedControl|styles\.deckStats/);
  assert.match(app, /<ViewIcon type="radar"/);
  assert.match(app, /<ViewIcon type="grid"/);
  assert.match(app, /<ViewIcon type="sector"/);
  assert.match(css, /grid-template-columns: minmax\(230px, 0\.82fr\).*minmax\(360px, 1\.45fr\).*minmax\(250px, 0\.9fr\)/);
  assert.match(css, /\.commandDeck \{[^}]*height: 252px/s);
  assert.match(css, /\.compactReadouts dt,[^}]*font-size: 11px/s);
  assert.match(css, /\.speedControl label[^}]*font: 9px/s);
  assert.match(css, /\.orderActions button,[^}]*font: 700 10px/s);
});

test("player navigation supports vector, target, away, and speed orders", async () => {
  const [app, engine, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);
  assert.match(app, /event\.key\.toLowerCase\(\) === "m"/);
  assert.match(app, /Course away from selected contact/);
  assert.match(app, /\{navigableTarget \? <>/);
  assert.match(app, /SELECT TO OR AWAY \/\/ \{navigableTarget\.name\.toUpperCase\(\)\}/);
  assert.match(app, /type="range"/);
  assert.match(app, /sendIntent\("navigate_ship"/);
  assert.match(app, /sendIntent\("set_ship_speed"/);
  assert.match(app, /sendIntent\("probe_space"/);
  assert.match(app, /payload\.departureSpeed = requestedSpeed/);
  assert.match(app, /navigationMode !== "idle" && observerSpeed === 0/);
  assert.match(app, /COURSE REQUIRES DEPARTURE SPEED/);
  assert.match(app, /knownMaximumSpeed/);
  assert.match(app, /AWAITING STATUS \/ INFO FOR SPEED LIMIT/);
  assert.match(app, /data-tooltip="BACK \/ ESC" onClick=\{cancelNavigation\}><CommandIcon type="back"/);
  assert.match(app, /onIntentAck/);
  assert.match(app, /styles\.commandAlert/);
  assert.match(app, /if \(!commandAlert\) return;\s*const timer = setTimeout\(\(\) => setCommandAlert\(""\), 5_000\)/);
  assert.match(app, /setNavigationStatus\(""\);\s*setCommandAlert\(""\)/);
  assert.match(app, /navigationMode !== "idle" && observerSpeed === 0 \? "DEPARTURE SPEED" : `PLAYER SPEED \/\/ \$\{observer\.name\.toUpperCase\(\)\}`/);
  assert.doesNotMatch(app, /!selectedShip && <div className=\{styles\.speedControl\}>/);
  assert.match(engine, /rebuildCourseBuffer/);
  assert.match(engine, /event\.shiftKey/);
  assert.match(engine, /this\.movementInteractive && event\.button !== 1/);
  assert.ok(engine.indexOf("if (this.drag) {") < engine.indexOf("if (this.movementInteractive) {", engine.indexOf("private onPointerMove")),
    "middle-mouse camera orbit should take priority over course-vector updates");
  assert.match(engine, /!this\.movementInteractive && button === 0 && !moved/);
  assert.match(app, /SHIFT ELEVATION \/\/ MMB ORBIT/);
  assert.match(engine, /onMovementCommit/);
  assert.match(engine, /publishCourseLabel/);
  assert.match(engine, /value - this\.originOffset\[index\]/);
  assert.match(app, /SHIFT ELEVATION \/\/ MMB ORBIT/);
  const canvas = await readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8");
  assert.match(canvas, /className=\{styles\.courseLabel\}/);
  assert.match(canvas, /X \{formatCoordinate\(courseLabel\.worldPosition\[0\]\)\}/);
  assert.match(canvas, /Y \{formatCoordinate\(courseLabel\.worldPosition\[1\]\)\}/);
  assert.match(canvas, /Z \{formatCoordinate\(courseLabel\.worldPosition\[2\]\)\}/);
  assert.match(scraper, /registerIntentHandler\("navigate_ship"/);
  assert.match(scraper, /registerIntentHandler\("set_ship_speed"/);
  assert.match(scraper, /registerIntentHandler\("probe_space"/);
  assert.match(scraper, /registerIntentHandler\("set_autotrack"/);
  assert.match(scraper, /autotracking%s\+on/);
  assert.match(scraper, /autotracking%s\+off/);
  assert.match(app, /sendIntent\("set_autotrack"/);
  assert.match(app, /data-tooltip=\{`AUTOTRACK/);
  assert.match(scraper, /if departureSpeed then send\("speed " \.\. tostring\(departureSpeed\)\) end\s*send\(command\)/);
  assert.match(scraper, /Scraper\.state\.observer\.speed\.current = value/);
  assert.match(scraper, /finished its current maneuver/);
  assert.match(scraper, /Maneuver complete\./);
  assert.match(scraper, /publishIntentAck\(intentId, status, reason\)/);
  assert.match(scraper, /resolvePendingCommand\("rejected"/);
  assert.match(app, /ack\.status === "completed"/);
  assert.match(app, /MANEUVER IN PROGRESS/);
  assert.match(scraper, /course relative %d %d %d/);
  assert.match(scraper, /"course away " \.\. name/);
  assert.match(scraper, /send\("speed " \.\. tostring\(math\.floor\(requestedSpeed \+ 0\.5\)\)\)/);
});

test("selected ships can be manually scanned without waiting for the poller", async () => {
  const [app, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);
  assert.match(app, /sendIntent\("scan_ship"/);
  assert.match(app, /data-tooltip="SCAN".*<CommandIcon type="scan"/);
  assert.match(app, /data-tooltip="INFO".*<CommandIcon type="info"/);
  assert.match(app, /TELEMETRY UPDATED/);
  assert.match(scraper, /registerIntentHandler\("scan_ship"/);
  assert.match(app, /COMMAND \/\/ \{\(navigableTarget\?\.name \|\| observer\.name\)\.toUpperCase\(\)\}/);
  assert.match(app, /sendIntent\("target_ship"/);
  assert.match(app, /observerHasNoWeapons \? "This ship has no weapons"/);
  assert.match(app, /TARGET \/\/ WEAPON LOCK IS AN AGGRESSIVE ACT/);
  assert.match(app, /targetIntentShipsRef/);
  assert.match(scraper, /registerIntentHandler\("target_ship"/);
  assert.match(scraper, /"target " \.\. name/);
  assert.match(scraper, /target\.disposition = "enemy"/);
  assert.match(scraper, /observer\.hasWeapons == false/);
  assert.match(scraper, /superseded by manual/);
  assert.match(scraper, /Target is outside sensor range/);
});
