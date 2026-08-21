import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hyperspace planners expose local, galactic, fuel-safety, and escape flows", async () => {
  const app = [
    await readFile("renderer/src/app/App.tsx", "utf8"),
    await readFile("renderer/src/app/WorkspacePanels.tsx", "utf8"),
  ].join("\n");
  const controller = await readFile(
    "renderer/src/features/hyperspace/useHyperspaceController.ts",
    "utf8",
  );
  const planner = await readFile("renderer/src/features/hyperspace/HyperspacePlanner.tsx", "utf8");
  const localPlanner = await readFile(
    "renderer/src/features/hyperspace/LocalHyperspaceView.tsx",
    "utf8",
  );
  const navigation = await readFile(
    "renderer/src/features/commands/useNavigationController.ts",
    "utf8",
  );
  const tacticalCanvas = await readFile(
    "renderer/src/features/tactical/TacticalCanvas.tsx",
    "utf8",
  );
  const tacticalEngine = await readFile("renderer/src/features/tactical/TacticalEngine.ts", "utf8");
  const hyperspaceDomain = await readFile("renderer/src/domain/hyperspace.ts", "utf8");
  const computer = await readFile(
    "renderer/src/features/hyperspace/NavigationComputer.tsx",
    "utf8",
  );
  const transit = await readFile("renderer/src/features/hyperspace/HyperspaceTransit.tsx", "utf8");
  const field = await readFile("renderer/src/features/hyperspace/HyperspaceField.tsx", "utf8");
  const scraper = await readFile("mudlet/lotj_holocron_scraper.lua", "utf8");

  assert.match(controller, /plot_hyperspace/);
  assert.match(controller, /engage_hyperdrive/);
  assert.match(controller, /HYPERSPACE CALCULATION READY/);
  assert.match(controller, /NAVIGATION COMPUTER IS STILL CALCULATING/);
  assert.match(app, /openHyperspacePlanner/);
  assert.match(controller, /routeScope/);
  assert.match(app, /ROUTE APPLIES TO/);
  assert.match(controller, /activeRoute as unknown as Record<string, unknown>/);
  assert.match(app, /recipientLabel=\{hyperspacePlanner\.routeScope\.recipientLabel/);
  assert.match(planner, /FOR\{" "\}\s*\{recipientLabel\.toUpperCase\(\)\}/);
  assert.match(controller, /escape_hyperspace/);
  assert.match(app, /HyperspaceTransit/);
  assert.match(controller, /escapePlan\.triggerGalaxy/);
  assert.match(controller, /needsCatalog/);
  assert.match(controller, /needsPosition/);
  assert.match(controller, /command: "navstat"/);
  assert.match(controller, /refreshMissingNavigationData/);
  assert.match(
    controller,
    /\["engaging", "hyperspace", "reentry", "arrived"\]\.includes\(state\.phase \|\| "idle"\)/,
  );
  assert.match(controller, /HYPERDRIVE REJECTED/);
  assert.match(controller, /plotIntentIdsRef/);
  assert.match(controller, /ROUTE REJECTED/);
  assert.match(controller, /setActiveRoute\(null\)/);
  assert.match(app, /\["engaging", "hyperspace", "reentry", "arrived"\]\.includes/);
  assert.match(controller, /2_500/);
  assert.match(hyperspaceDomain, /SECTOR_COORDINATE_LIMIT = 50_000/);
  assert.match(planner, /ARM ESCAPE PLAN/);
  assert.doesNotMatch(planner, /mode === "galactic" && <div className=\{styles\.escape\}/);
  assert.match(planner, /reachableEscapeSystems/);
  assert.match(planner, /ROUTE BLOCKED/);
  assert.match(planner, /ACQUIRING RANGE DATA/);
  assert.match(planner, /ACQUIRING GALAXY CATALOG/);
  assert.match(planner, /catalogPending/);
  assert.match(planner, /occupiedSystem \? `YOU \/\/ \$\{occupiedSystem\.name\}` : "YOU"/);
  assert.match(planner, /system === occupiedSystem/);
  assert.match(planner, /styles\.galaxyPosition/);
  assert.match(planner, /normalized|Math\.cos/);
  assert.doesNotMatch(planner, /localGrid/);
  assert.match(planner, /LocalHyperspaceView/);
  assert.match(localPlanner, /TacticalCanvas/);
  assert.match(localPlanner, /FOLLOW TARGET/);
  assert.match(localPlanner, /PLOT POINT \[M\]/);
  assert.match(localPlanner, /beginMovementPlanning/);
  assert.match(localPlanner, /coordinate \+ origin\[index\]/);
  assert.match(localPlanner, /HOLD SHIFT FOR Y/);
  assert.match(localPlanner, /route:destination/);
  assert.match(localPlanner, /ZOOM TARGET/);
  assert.match(localPlanner, /renderColor: \[1, 0\.72, 0\.08\]/);
  assert.match(localPlanner, /hyperspaceDestinationMarkerSize/);
  assert.match(localPlanner, /renderScaleWithZoom: true/);
  assert.match(planner, /clampSectorCoordinate\(numeric\(event\.target\.value\)\)/);
  assert.match(localPlanner, /point\.kind === "cluster"/);
  assert.match(localPlanner, /PLOT \+ TRACK MOVING TARGET/);
  assert.match(localPlanner, /NAVIGATOR \+30%/);
  assert.match(localPlanner, /prediction:target/);
  assert.match(planner, /const updateLocalDestination = useCallback/);
  assert.match(planner, /planetTargetName=\{selectedPlanetName\}/);
  assert.match(planner, /shipTargetName=\{selectedShipTargetName\}/);
  assert.match(planner, /SECTOR CONTACT SEARCH/);
  assert.match(planner, /type="search"/);
  assert.match(planner, /KNOWN SECTOR SHIPS/);
  assert.match(planner, /ship\.name \|\| ship\.id/);
  assert.match(planner, /ship\.class \|\| ""/);
  assert.match(planner, /ship\.shipCategory \|\| ""/);
  assert.match(planner, /setSelectedShipTargetName\(ship\.name \|\| ship\.id\)/);
  assert.match(planner, /RANDOM LOCATION/);
  assert.match(planner, /\[500, 1000, 2000\]/);
  assert.match(planner, /randomSectorDestinationBeyond\(selectedPlanetPosition, arrivalDistance\)/);
  assert.match(planner, /!planetArrivalClear/);
  assert.doesNotMatch(planner, /if \(!selectedPlanet\) return;[\s\S]*?setX\(/);
  assert.match(localPlanner, /if \(!selected \|\| requestedTargetName\) return;/);
  assert.match(
    localPlanner,
    /if \(!requestedTargetName\) return;[\s\S]*?shipTargetName \? \["ship"\] : \["celestial", "planet"\][\s\S]*?\.flatMap\(\(point\) => point\.members \?\? \[point\]\)[\s\S]*?selectPoint\(target\.id\)/,
  );
  assert.match(
    localPlanner,
    /const selectPoint = useCallback[\s\S]*?setSelectedId\(point\.id\)[\s\S]*?onDestinationChange\(point\.worldPosition\)/,
  );
  assert.match(localPlanner, /prediction:observer/);
  assert.match(controller, /observeMotionTracks/);
  assert.match(controller, /planner: livePlanner/);
  assert.match(controller, /movementOriginsForScope\(planner\.routeScope\.scope \|\| "local"\)/);
  assert.match(controller, /refresh_local_hyperspace_radar/);
  assert.match(controller, /setInterval\(refreshRadar, 4_000\)/);
  assert.match(controller, /hyperspaceReplotRequired/);
  assert.match(controller, /TARGET MOVED/);
  assert.match(controller, /trackingUpdate\.targetObservedAt/);
  assert.match(planner, /PLOT \+ TRACK/);
  assert.match(computer, /RECALCULATE BEYOND/);
  assert.match(app, /keyboardEnabled=\{!hyperspacePlanner && !managementOpen\}/);
  assert.match(navigation, /!current\.keyboardEnabled/);
  assert.match(tacticalCanvas, /setKeyboardEnabled\(keyboardEnabled\)/);
  assert.match(tacticalCanvas, /focusPoint: \(targetId\)/);
  assert.match(tacticalEngine, /focusPoint\(targetId: string\)/);
  assert.match(tacticalEngine, /Math\.sqrt\(this\.camera\.distance \/ distance\)/);
  assert.match(tacticalEngine, /if \(!this\.keyboardEnabled\) return/);
  assert.match(scraper, /registerIntentHandler\("refresh_local_hyperspace_radar"/);
  assert.match(scraper, /REMOTE_LOCAL_HYPERSPACE_CALC_SECONDS = 2/);
  assert.match(scraper, /scheduleHyperspaceCalculationEstimate/);
  assert.match(scraper, /Checking hyperspace course integrity/);
  assert.match(scraper, /Navigation Computer is calculating the route/);
  assert.match(computer, /INSUFFICIENT FUEL/);
  assert.match(computer, /ENGAGE ANYWAY/);
  assert.match(computer, /ESTIMATED CALCULATION WINDOW COMPLETE/);
  assert.match(computer, /CALCULATIONS COMPLETE \/\/ HYPERDRIVE COMMAND AVAILABLE/);
  assert.match(computer, /PLEASE WAIT BEFORE ENGAGING/);
  assert.match(computer, /VERIFYING.*CLEARANCE/);
  assert.match(computer, /HYPERSPACE BLOCKED/);
  assert.match(computer, /disabled=\{!clearance\.allowed \|\| trackingRecalculationPending\}/);
  assert.match(transit, /Escape hyperspace/);
  assert.match(transit, /EMERGENCY HYPERDRIVE CUTOFF/);
  assert.match(transit, /HyperspaceField engaged/);
  assert.match(transit, /transition: "opacity 5s ease-out, filter 5s ease-out"/);
  assert.match(transit, /arrived && reentryFadeStarted \? 0 : 1/);
  assert.match(transit, /setHidden\(true\), 5_000/);
  assert.match(field, /edgeActivation/);
  assert.match(scraper, /calc stop/);
  assert.match(scraper, /"hyper off", false/);
  assert.match(scraper, /escape_hyperspace/);
  assert.match(scraper, /automation lease expired/i);
  assert.match(scraper, /Galaxy 1/);
  assert.match(scraper, /refresh_galaxy_catalog/);
  assert.match(scraper, /send, "planets", false/);
  assert.match(scraper, /galaxyCatalogRequestAt/);
  assert.match(scraper, /another telemetry refresh is active/);
  assert.match(scraper, /must be at a nav computer/);
  assert.match(controller, /navigationRefreshBlocked/);
  assert.match(controller, /battlegroupClearanceExemptions/);
  assert.match(controller, /activeRoute\.scope === "all" \|\|/);
  assert.match(controller, /fleet\?\.active && fleet\.kind === "battlegroup"/);
  assert.match(controller, /fleet\.members\.map\(\(member\) => member\.name\)/);
  assert.match(scraper, /capture\.followupRadar/);
  assert.match(scraper, /lotj\.galaxyMap\.systems/);
  assert.match(scraper, /Destination reached\. Initiating realspace reentry/);
  assert.match(scraper, /The ship lurches slightly as it comes out of hyperspace/);
  assert.match(scraper, /queueImmediateWorldRefresh\("own ship realspace lurch", true\)/);
  assert.match(scraper, /completeOwnHyperspaceArrival\("fresh radar"\)/);
  assert.match(scraper, /checkHyperspaceClearance/);
  assert.match(scraper, /scopedHyperspaceCommands/);
  assert.match(
    scraper,
    /recipient\.localShip[\s\S]*?table\.insert\(commands, localCommand\)[\s\S]*?battlegroup nav " \.\. recipient\.selector/,
  );
  assert.match(scraper, /routeIncludesLocalShip/);
  assert.match(scraper, /MIN_HYPERSPACE_CLEARANCE = 500/);
  assert.match(await readFile("mudlet/lotj_holocron_parsers.lua", "utf8"), /\[%dsmh%s\]\+/);
});
