import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renderer includes the cinematic startup and disconnected uplink states", async () => {
  const [html, app, startup, hyperspaceField, telemetry, uplink, canvas, globalStyles, startupStyles, uplinkStyles] = await Promise.all([
    readFile("renderer/index.html", "utf8"),
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/startup/StartupSequence.tsx", "utf8"),
    readFile("renderer/src/features/hyperspace/HyperspaceField.tsx", "utf8"),
    readFile("renderer/src/features/telemetry/useTelemetry.ts", "utf8"),
    readFile("renderer/src/features/connection/UplinkNotice.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/styles.css", "utf8"),
    readFile("renderer/src/features/startup/StartupSequence.module.css", "utf8"),
    readFile("renderer/src/features/connection/UplinkNotice.module.css", "utf8"),
  ]);

  assert.match(html, /src="\/src\/main\.tsx"/);
  assert.match(startup, /setPhase\("lotjDeparting"\), 4_000/);
  assert.match(startup, /setPhase\("intro"\), 4_550/);
  assert.match(startup, /setPhase\("jumping"\), 8_450/);
  assert.match(startup, /A long time ago in a galaxy far, far away/);
  assert.match(startup, /Legends of<br \/>the Jedi/);
  assert.match(startup, /The Galaxy Awaits/);
  assert.match(startup, /Crafted by Veska/);
  assert.doesNotMatch(startup, /LOTJ TACTICAL SYSTEMS|NAVIGATION CORE INITIALIZING|styles\.rule/);
  assert.doesNotMatch(startupStyles, /\.rule|startup-rule|\.kicker|\.status/);
  assert.match(startup, /styles\.threeD/);
  assert.match(startup, /event\.key !== "Escape"/);
  assert.match(startup, /HyperspaceField/);
  assert.match(uplink, /paused \? "SPACE TELEMETRY PAUSED" : "STANDBY"/);
  assert.match(uplink, /Launch your ship to resume tactical rendering/);
  assert.match(app, /const spaceTelemetryActive = telemetry\.connected && reportedInSpace === true\s*&& telemetry\.snapshot\?\.metadata\?\.inSpace === true/);
  assert.match(app, /if \(!spaceTelemetryActive\) return \(/);
  const standbyReturn = app.indexOf("if (!spaceTelemetryActive) return (");
  assert.ok(standbyReturn < app.indexOf("<TacticalCanvas", standbyReturn),
    "paused space telemetry must return the standby page before mounting WebGL");
  assert.match(canvas, /engine\.dispose\(\)/);
  assert.match(telemetry, /function receiveSpaceState[\s\S]*snapshot: null/);
  assert.match(telemetry, /spaceState\?\.inSpace === false[\s\S]*snapshot: null/);
  assert.match(telemetry, /!connected \? \{ snapshot: null, spaceState: null \}/);
  assert.match(hyperspaceField, /edgeActivation/);
  assert.doesNotMatch(startup, /dissolving/);
  assert.match(startup, /styles\.hyperspace/);
  assert.match(telemetry, /connectionLabel/);
  assert.match(uplink, /Waiting for uplink to your Ship, Captain/);
  assert.match(uplink, /styles\.uplink/);
  assert.match(app, /telemetry\.connected && \(\s*<div className=\{styles\.controlStack\}>/);
  assert.match(app, /telemetry\.connected && \(\s*<div className=\{styles\.commandDeckFrame\}>/);
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
  assert.match(app, /radarBubbleEnabled=\{radarBubbleEnabled\}/);
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
  const [app, engine, canvas, rangeMeter] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/src/features/telemetry/RangeMeter.tsx", "utf8"),
  ]);
  assert.match(app, /holocron3d\.ship-dispositions\.v1/);
  assert.match(app, /set_ship_disposition/);
  assert.match(app, /entity\.disposition === "enemy"/);
  assert.match(app, /hostileNames/);
  assert.match(engine, /a_shape/);
  assert.match(engine, /a_heading/);
  assert.match(engine, /headingPosition/);
  assert.match(engine, /v_forward/);
  assert.match(engine, /DEFAULT_PIXELS_PER_DISTANCE_UNIT/);
  assert.match(engine, /orthographic/);
  assert.match(engine, /u_markerScale/);
  assert.match(engine, /markerReferencePixelsPerUnit/);
  assert.match(engine, /max\(2\.0 \* u_pixelRatio/);
  assert.match(rangeMeter, /UNKNOWN \/\/ \?/);
  assert.match(rangeMeter, /data-tooltip=\{tooltip\}/);
  assert.match(rangeMeter, /\/\/ \$\{formatCoordinate\(reading\?\.current\)\} \/ \$\{formatCoordinate\(reading\?\.maximum\)\}/);
  assert.match(canvas, /CLASS \{tooltip\.shipCategory\.toUpperCase\(\)\}/);
  assert.match(canvas, /RangeMeter label="SHIELD"/);
  assert.match(canvas, /RangeMeter label="HULL"/);
  assert.match(canvas, /YOUR SHIP <span>\/\/ \{snapshot\.observer\?\.name/);
  assert.match(canvas, /style=\{\{ left: playerShipLabel\.x, top: playerShipLabel\.y \}\}/);
  assert.match(engine, /project\(\[0, 0, 0\], this\.viewProjection/);
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
  assert.doesNotMatch(canvas, /MODEL DETAIL/);
  assert.match(canvas, /fidelity === "strategic".*STRATEGIC CONTACTS/);
});

test("Homeworld-style shell separates commands, selected vessel, and fleet telemetry", async () => {
  const [app, css, speedControl, fleetRoster, fleetCommands, squadronCommands] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/app/App.module.css", "utf8"),
    readFile("renderer/src/features/commands/ShipSpeedControl.tsx", "utf8"),
    readFile("renderer/src/features/fleet/FleetRoster.tsx", "utf8"),
    readFile("renderer/src/features/fleet/FleetCommandPanel.tsx", "utf8"),
    readFile("renderer/src/features/fleet/SquadronCommandPanel.tsx", "utf8"),
  ]);
  assert.match(app, /styles\.commandBank/);
  assert.match(app, /styles\.commandDeckFrame/);
  assert.match(app, /commandToasts\.length > 0 && <div className=\{styles\.commandToasts\} role="log"/);
  assert.match(app, /styles\.selectedVessel/);
  assert.match(app, /styles\.vesselRanges/);
  assert.match(app, /RangeMeter label="SPEED"/);
  assert.match(app, /RangeMeter label="ENERGY"/);
  assert.doesNotMatch(app, /"PLAYER SHIP"/);
  assert.match(app, /styles\.vesselTags/);
  assert.match(app, /styles\.ownershipTag/);
  assert.match(app, /!hasSelectedContact && <span className=\{styles\.ownershipTag\}>YOUR SHIP<\/span>/);
  assert.doesNotMatch(app, /\["TYPE", point\.kind/);
  assert.doesNotMatch(app, /"RELATIVE XYZ"/);
  assert.match(css, /--command-deck-columns:\s*minmax\(280px, 1fr\) minmax\(320px, 420px\) minmax\(300px, 1fr\)/);
  assert.match(app, /styles\.fleetBank/);
  assert.match(app, /COMMAND \/\/ \{\(navigableTarget\?\.name \|\| observer\.name\)\.toUpperCase\(\)\}/);
  assert.match(app, /<FleetRoster fleet=\{fleet\}/);
  assert.match(fleetRoster, /fleet\.members\.map/);
  assert.match(fleetRoster, /LOW S/);
  assert.match(fleetRoster, /fleet\.assist === undefined \? "UNKNOWN" : fleet\.assist \? "ACTIVE" : "OFF"/);
  assert.match(fleetRoster, /"local", "all", "wings"/);
  assert.match(fleetRoster, /orderResult\.status\.toUpperCase/);
  assert.match(fleetRoster, /fleetOrder\?\.order !== "autopilot"/);
  assert.match(fleetRoster, /AUTOPILOT \/\/ \{autopilotLabel\}/);
  assert.match(app, /fleetOrder\.rejectedCount/);
  assert.match(fleetCommands, /autopilotState/);
  assert.match(fleetCommands, /data-state=\{state\}/);
  assert.match(fleetRoster, /AUTOPILOT \/\/ \{autopilotLabel\}/);
  assert.match(app, /sendIntent\("fleet_order"/);
  assert.match(fleetCommands, /SYNCHRONIZE TARGET/);
  assert.match(fleetCommands, /RECHARGE SHIELDS/);
  assert.doesNotMatch(fleetCommands, /TOGGLE FIRE ASSIST|AIM ION|SQUADRON MIRRORS/);
  assert.match(fleetCommands, /WEAPONS\.map/);
  assert.match(fleetCommands, /WeaponOrderButton/);
  assert.match(fleetCommands, /weapon="all"/);
  assert.match(fleetCommands, /className=\{styles\.weaponButton\}/);
  assert.ok(fleetCommands.indexOf("<span>DEFENSE</span>") < fleetCommands.indexOf("<span>WEAPONS</span>"),
    "formation weapons should be the bottom command group, matching the player ship layout");
  assert.match(fleetRoster, /scope === "selected"/);
  assert.match(app, /payload\.memberName = selectedFleetMember\.name/);
  const commandBank = app.indexOf('className={styles.commandBank}');
  const playerSpeedControl = app.indexOf('<ShipSpeedControl');
  const fleetBank = app.indexOf('className={styles.fleetBank}');
  assert.ok(commandBank < playerSpeedControl && playerSpeedControl < fleetBank,
    "speed controls should belong to the player command bank, not the formation roster");
  assert.doesNotMatch(app.slice(fleetBank), /ShipSpeedControl|styles\.deckStats/);
  assert.match(app, /fleet\.kind === "squadron" \? <SquadronCommandPanel/);
  assert.match(fleetRoster, /fleet\.kind === "squadron" \? "SQUADRON" : "ALL FLEET"/);
  assert.match(squadronCommands, /FIRE ASSIST/);
  assert.match(squadronCommands, /AIM_SYSTEMS = \["laser", "ion", "launcher", "tractor", "turret"\]/);
  assert.match(squadronCommands, /chooseAim\("none"\)/);
  assert.match(squadronCommands, /onOrder\("roll"\)/);
  assert.match(squadronCommands, /onOrder\("chaff"\)/);
  assert.match(squadronCommands, /<WeaponsPanel/);
  assert.match(squadronCommands, /1 SELECT AND TARGET \/\/ 2 FIRE FROM THE LEAD \/\/ ASSIST MIRRORS THE VOLLEY/);
  assert.match(app, /<ViewIcon type="radar"/);
  assert.match(app, /<ViewIcon type="grid"/);
  assert.match(app, /<ViewIcon type="sector"/);
  assert.match(css, /\.commandDeck \{[^}]*height: 252px/s);
  assert.match(css, /\.topbar \{[^}]*overflow: visible/s);
  assert.doesNotMatch(css, /\.topbar \{[^}]*clip-path/s);
  assert.match(css, /\.commandToasts \{[^}]*flex-direction: column;[^}]*gap: 5px;[^}]*transform: translateY\(calc\(-100% - 5px\)\)/s);
  assert.match(app, /\[\.\.\.current, \{ id, message, tone \}\]\.slice\(-4\)/);
  assert.match(css, /\.compactReadouts dt,[^}]*font-size: 11px/s);
  assert.match(speedControl, /type="range"/);
  assert.match(css, /\.orderActions button \{[^}]*font: 700 10px/s);
});

test("player navigation supports vector, target, away, and speed orders", async () => {
  const [app, engine, scraper, drawer, drawerCss, speedControl] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
    readFile("renderer/src/features/commands/NavigationDrawer.tsx", "utf8"),
    readFile("renderer/src/features/commands/NavigationDrawer.module.css", "utf8"),
    readFile("renderer/src/features/commands/ShipSpeedControl.tsx", "utf8"),
  ]);
  assert.match(app, /event\.key\.toLowerCase\(\) === "m"/);
  assert.match(app, /Course away from selected contact/);
  assert.match(app, /\{navigableTarget \? <>/);
  assert.match(app, /SELECT TO OR AWAY \/\/ \{navigableTarget\.name\.toUpperCase\(\)\}/);
  assert.match(speedControl, /type="range"/);
  assert.match(app, /navigationFleetScope \? "fleet_order" : "navigate_ship"/);
  assert.match(app, /sendIntent\("set_ship_speed"/);
  assert.match(app, /sendIntent\("probe_space"/);
  assert.match(app, /payload\.departureSpeed = requestedSpeed/);
  assert.match(app, /navigationMode !== "idle"/);
  assert.match(drawer, /DEPARTURE SPEED REQUIRED/);
  assert.match(app, /knownMaximumSpeed/);
  assert.match(speedControl, /AWAITING STATUS \/ INFO FOR SPEED LIMIT/);
  assert.match(app, /setNavigationTargetId\(navigableTarget\.id\)/);
  assert.match(app, /setNavigationTargetId\(null\)/);
  assert.match(app, /WAITING FOR CONFIRMATION/);
  assert.match(app, /CANCEL COMMAND/);
  assert.match(drawer, /aria-label="Navigation command wizard"/);
  assert.match(drawer, /const departureSpeedMissing = observerStopped && speed <= 0/);
  assert.match(drawer, /const confirmDisabled = commandLocked \|\| targetMissing \|\| departureSpeedMissing/);
  assert.match(drawer, /onClick=\{needsVectorLock \? onStageVector : onConfirm\}/);
  assert.match(drawer, /onClick=\{onCancel\}/);
  assert.match(drawerCss, /animation: drawer-enter/);
  assert.match(app, /onIntentAck/);
  assert.match(app, /styles\.commandToasts/);
  assert.match(app, /if \(!commandAlert\) return;\s*const timer = setTimeout\(\(\) => setCommandAlert\(""\), 5_000\)/);
  assert.match(app, /setNavigationStatus\(""\);[\s\S]{0,120}setCommandAlert\(""\)/);
  assert.match(app, /label=\{`PLAYER SPEED \/\/ \$\{observer\.name\.toUpperCase\(\)\}`\}/);
  assert.match(app, /observerStopped=\{observerSpeed === 0\}/);
  assert.match(engine, /rebuildCourseBuffer/);
  assert.match(engine, /event\.shiftKey/);
  assert.match(engine, /elevationFromPointer\(/);
  assert.match(engine, /const guideStart: Vector3 = \[endpoint\[0\], lowerY, endpoint\[2\]\]/);
  assert.match(engine, /const guideEnd: Vector3 = \[endpoint\[0\], upperY, endpoint\[2\]\]/);
  assert.match(engine, /const markerLeft = endpoint\.map/);
  assert.match(engine, /const markerRight = endpoint\.map/);
  assert.match(engine, /this\.drawBuffer\(this\.heightGuideBuffer/);
  assert.match(engine, /event\.key\.toLowerCase\(\) === "shift"\) this\.endElevationAdjustment\(\)/);
  assert.match(engine, /HEIGHT_GUIDE_FADE_MS/);
  assert.match(engine, /elevationFromWheel\(this\.movementVector\[1\], event\.deltaY, unitsPerPixel\)/);
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
  assert.match(app, /CameraIcon type="player"/);
  assert.match(app, /CameraIcon type="rts"/);
  assert.match(app, /CameraIcon type="selection"/);
  assert.match(app, /beginMovementPlanning/);
  assert.match(app, /finishMovementPlanning/);
  assert.match(app, /movementOriginsForScope/);
  assert.match(app, /centerOfPositions\(origins\)/);
  assert.match(engine, /export type TacticalCameraMode = "player" \| "rts" \| "selection"/);
  assert.match(engine, /savedCameraState/);
  assert.match(engine, /this\.cameraMode === "rts" && \["w", "a", "s", "d", "q", "e"\]/);
  assert.match(engine, /for \(const \[originIndex, origin\] of this\.movementOrigins\.entries\(\)\)/);
  assert.match(engine, /this\.callbacks\.onCameraModeChange\(saved\.mode\)/);
  assert.match(app, /event\.key === "Escape" && navigationMode !== "idle"\) cancelNavigation\(\)/);
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
  assert.match(scraper, /pendingCommandKind == "target"/);
  assert.match(scraper, /tempTrigger\("Target Locked\."/);
  assert.match(scraper, /You are being targeted by/);
  assert.match(scraper, /handleIncomingTargeting/);
  assert.match(app, /entity\.disposition === "enemy"/);
  assert.match(app, /localStorage\.setItem\(DISPOSITION_STORAGE_KEY/);
  assert.match(scraper, /Your concentration is broken\. You fail to lock on to your target\./);
  assert.match(scraper, /denyCurrentSend/);
  assert.match(scraper, /target locked but autotrack could not be enabled/);
  assert.match(scraper, /"target " \.\. name/);
  assert.match(scraper, /target\.disposition = "enemy"/);
  assert.match(scraper, /observer\.hasWeapons == false/);
  assert.match(scraper, /superseded by manual/);
  assert.match(scraper, /Target is outside sensor range/);
});

test("combat exposes installed weapon controls and telemetry-driven projectile effects", async () => {
  const [app, panel, panelCss, canvas, engine, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/weapons/WeaponsPanel.tsx", "utf8"),
    readFile("renderer/src/features/weapons/WeaponsPanel.module.css", "utf8"),
    readFile("renderer/src/features/tactical/TacticalCanvas.tsx", "utf8"),
    readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);
  assert.match(app, /<WeaponsPanel/);
  assert.doesNotMatch(app, /M \/\/ SET COURSE VECTOR/);
  assert.match(app, /combatTargetName \? \(\s*<WeaponsPanel/);
  assert.match(app, /sendIntent\("fire_weapon"/);
  assert.match(panel, /FIRE ALL/);
  assert.match(panel, /\{WEAPONS\.map\(\(weapon\) =>/);
  assert.match(panel, /INSTALLATION UNCONFIRMED \/\/ LOTJ WILL VALIDATE/);
  assert.match(panel, /<button type="button" disabled=\{disabled\}/);
  assert.doesNotMatch(panel, /disabled=\{disabled \|\| installed\.length === 0\}/);
  assert.doesNotMatch(panel, /disabled=\{disabled \|\| !available \|\| recharging \|\| depleted\}/);
  assert.match(app, /disabled=\{landed\}\s+onFire=\{fireWeapon\}/);
  for (const weapon of ["autoblaster", "laser", "turbolaser", "ion", "missile", "torpedo", "rocket", "burst"]) {
    assert.match(panel, new RegExp(`type: "${weapon}"`));
  }
  assert.match(panelCss, /weapons-enter/);
  assert.match(panelCss, /grid-template-columns: repeat\(auto-fit, minmax\(21px, 1fr\)\)/);
  assert.match(panelCss, /\.panel button::after \{[^}]*left: 0;[^}]*z-index: 1000;/s);
  assert.doesNotMatch(panelCss.match(/\.panel \{[^}]*\}/s)?.[0] || "", /position: absolute|bottom:|left:|min-width:/);
  assert.match(panel, /setRumbleToken/);
  assert.match(panel, /styles\.rumbleOdd/);
  assert.match(panelCss, /weapons-rumble-odd/);
  assert.match(panelCss, /weapons-rumble-even/);
  assert.match(canvas, /pushCombatEvent/);
  assert.match(canvas, /for \(const event of combatEvents/);
  assert.match(panel, /lastEventIdRef/);
  assert.match(engine, /rebuildCombatBuffers/);
  assert.match(engine, /combatEffects/);
  assert.match(engine, /type: projectile \? "launch" : "projectile"/);
  assert.match(engine, /duration: projectile \? 460 : 1_100/);
  assert.match(engine, /const confirmedHits = Math\.max\(1, Math\.min\(12, Number\(event\.count\) \|\| 1\)\)/);
  assert.match(engine, /start: now \+ index \* 85/);
  assert.match(engine, /if \(now < effect\.start\) continue/);
  assert.match(engine, /const namedSource = this\.findPointByName\(event\.sourceName\)/);
  assert.match(engine, /from: sourcePosition/);
  assert.doesNotMatch(engine, /from: projectile \? sourcePosition : \[0, 0, 0\]/);
  assert.match(engine, /const burstLength = Math\.max\(14, Math\.min\(60, targetDistance \* 0\.08\)\)/);
  assert.match(engine, /const rays = 5/);
  assert.match(engine, /const tailProgress = Math\.max\(0, \(progress - 0\.24\) \/ 0\.76\)/);
  assert.match(engine, /coreSize \* 2\.35/);
  assert.match(engine, /targetName: target\.name/);
  assert.match(engine, /this\.findPointByName\(effect\.targetName\)/);
  assert.match(engine, /liveTarget\?\.position3d \?\? effect\.to/);
  assert.match(engine, /point\.kind !== "projectile"/);
  assert.doesNotMatch(engine, /coveredProjectileIds|projectileRoutes/);
  assert.match(engine, /weapon === "torpedo".*\[0\.72, 0\.3, 1\]/s);
  assert.match(engine, /weapon === "rocket".*\[1, 0\.14, 0\.06\]/s);
  assert.match(scraper, /registerIntentHandler\("fire_weapon"/);
  assert.match(scraper, /handleCombatLine/);
  assert.match(scraper, /handleProjectileSummary/);
  assert.match(scraper, /"radar projectiles"/);
  assert.match(scraper, /You fail to lock on to your target/);
  assert.match(scraper, /Missile\|Torpedo\|Rocket/);
  assert.match(scraper, /publishLaunchEvent/);
  assert.match(scraper, /can%s\+only%s\+fire%s\+forwards/);
  assert.match(scraper, /Forward arc blocked \/\/ turn ship/);
  assert.match(scraper, /launcher%\(s%\)%s\+reloaded/);
  assert.match(scraper, /fully%s\+charged/);
  assert.match(scraper, /but%s\+miss/);
});

test("reconnecting hydrates missing player telemetry before combat polling", async () => {
  const [app, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);
  assert.match(app, /sendIntent\("probe_space"\)/);
  assert.match(app, /scheduleSpaceProbeRetry/);
  assert.match(app, /reason\.includes\("target lock"\)/);
  assert.match(scraper, /hydrationQueue = \{\}/);
  assert.match(scraper, /table\.insert\(queue, "status"\)/);
  assert.match(scraper, /table\.insert\(queue, "info"\)/);
  assert.ok(scraper.indexOf("if hydrationCommand then") < scraper.indexOf("elseif combatRadarDue then"),
    "observer hydration must take priority over combat radar");
});

test("shield automation activates on launch and safely recharges to full", async () => {
  const [app, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);
  assert.match(app, /sendIntent\("recharge_shields"/);
  assert.match(app, /sendIntent\("set_auto_recharge"/);
  assert.match(app, /SHIELDS AT PEAK POWER/);
  assert.match(app, /AUTO RECHARGE/);
  assert.match(scraper, /send, "shields on", false/);
  assert.match(scraper, /Recharging shields\.\./);
  assert.match(scraper, /The shields are already at peak power\./);
  assert.match(scraper, /Scraper\.shields\.attempts >= 10/);
  assert.match(scraper, /tempTimer\(3/);
  assert.match(scraper, /Critical power overload\.\.\. Shields down!/);
  assert.match(scraper, /registerIntentHandler\("recharge_shields"/);
  assert.match(scraper, /registerIntentHandler\("set_auto_recharge"/);
});
