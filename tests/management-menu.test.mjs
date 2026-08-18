import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Escape management documents log-based hyperspace diagnostics", async () => {
  const [app, menu, controller, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/management/ManagementMenu.tsx", "utf8"),
    readFile("renderer/src/features/hyperspace/useHyperspaceController.ts", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);

  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /<ManagementMenu/);
  assert.match(app, /keyboardEnabled=\{!hyperspacePlanner && !managementOpen\}/);
  assert.match(menu, /HYPERSPACE DIAGNOSTICS/);
  assert.match(menu, /NO CALIBRATION DATABASE/);
  assert.match(menu, /\[Holocron3D\]\[HyperspaceSample\]/);
  assert.doesNotMatch(app, /useHyperspaceHistory/);
  assert.doesNotMatch(controller, /recordHyperspaceHistory/);
  assert.match(controller, /calculateHyperspaceTravelTime/);
  assert.match(scraper, /event == "destination_reached"/);
  assert.match(scraper, /arrival_error_units/);
  assert.match(scraper, /navigatorApplied = true/);
});
