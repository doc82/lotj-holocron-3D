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
