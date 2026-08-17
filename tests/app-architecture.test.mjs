import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("App composes feature controllers and presentation panels", async () => {
  const app = await readFile("renderer/src/app/App.tsx", "utf8");

  for (const controller of [
    "usePollingController",
    "useFleetSelection",
    "useNavigationController",
    "useShipCommandController",
    "useHyperspaceController",
    "useShipDossierController",
    "useTacticalInteractionController",
  ]) {
    assert.match(app, new RegExp(`${controller}\\(`));
  }

  for (const view of [
    "TacticalHeader",
    "FleetScopeDrawer",
    "CommandActionPanel",
    "SelectedTargetPanel",
    "CommandIssuerPanel",
    "ContactClusterPanel",
  ]) {
    assert.match(app, new RegExp(`<${view}`));
  }

  assert.doesNotMatch(app, /sendIntent\(/);
  assert.doesNotMatch(app, /onIntentAck\(/);
});

test("feature controllers keep long-lived resources independent from render callback identity", async () => {
  const [navigation, shipCommands, hyperspace, planner, startup, tactical, dossier, timers] =
    await Promise.all([
      readFile("renderer/src/features/commands/useNavigationController.ts", "utf8"),
      readFile("renderer/src/features/commands/useShipCommandController.ts", "utf8"),
      readFile("renderer/src/features/hyperspace/useHyperspaceController.ts", "utf8"),
      readFile("renderer/src/features/hyperspace/HyperspacePlanner.tsx", "utf8"),
      readFile("renderer/src/features/startup/StartupSequence.tsx", "utf8"),
      readFile("renderer/src/features/tactical/useTacticalInteractionController.ts", "utf8"),
      readFile("renderer/src/features/telemetry/useShipDossierController.ts", "utf8"),
      readFile("renderer/src/hooks/useTimeoutRegistry.ts", "utf8"),
    ]);

  for (const controller of [navigation, shipCommands, hyperspace]) {
    assert.match(controller, /const acknowledgementCallbacksRef = useLatestRef/);
    assert.match(controller, /window\.holocron\?\.onIntentAck[\s\S]*?\n\s*\[\],\n\s*\);/);
  }
  assert.match(navigation, /const keyboardStateRef = useLatestRef/);
  assert.match(navigation, /const setStatus = useCallback/);
  assert.match(planner, /const onCancelRef = useLatestRef/);
  assert.match(startup, /const onCompleteRef = useLatestRef/);
  assert.doesNotMatch(navigation, /setTimeout\(/);
  assert.doesNotMatch(shipCommands, /setTimeout\(/);
  assert.match(timers, /for \(const timer of timersRef\.current\) clearTimeout\(timer\)/);
  assert.match(tactical, /viewpointRequestTokenRef\.current !== requestToken/);
  assert.match(dossier, /scanRequestTokenRef\.current !== token/);
});
