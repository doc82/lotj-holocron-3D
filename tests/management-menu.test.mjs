import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Escape management exposes editable hyperspace calibration history", async () => {
  const [app, menu, historyHook, controller, scraper] = await Promise.all([
    readFile("renderer/src/app/App.tsx", "utf8"),
    readFile("renderer/src/features/management/ManagementMenu.tsx", "utf8"),
    readFile("renderer/src/features/management/useHyperspaceHistory.ts", "utf8"),
    readFile("renderer/src/features/hyperspace/useHyperspaceController.ts", "utf8"),
    readFile("mudlet/lotj_holocron_scraper.lua", "utf8"),
  ]);

  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /<ManagementMenu/);
  assert.match(app, /keyboardEnabled=\{!hyperspacePlanner && !managementOpen\}/);
  assert.match(menu, /HYPERSPACE HISTORY/);
  assert.match(menu, /sortHyperspaceHistory/);
  assert.match(menu, /\+ ADD RECORD/);
  assert.match(menu, /onRemove\(entry\.id\)/);
  assert.match(menu, /Are you sure you want to delete your hyperspace database\?/);
  assert.match(historyHook, /window\.localStorage/);
  assert.match(historyHook, /MAX_HYPERSPACE_HISTORY_ENTRIES/);
  assert.match(controller, /recordHyperspaceHistory/);
  assert.match(controller, /state\.phase !== "arrived"/);
  assert.match(controller, /source: "observed"/);
  assert.match(scraper, /navigatorApplied = true/);
});
