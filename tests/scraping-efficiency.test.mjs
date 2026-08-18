import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("automatic polling derives proximity instead of issuing prox commands", async () => {
  const scraper = await readFile("mudlet/lotj_holocron_scraper.lua", "utf8");
  const scene = await readFile("renderer/src/domain/scene.ts", "utf8");
  const pollCommands = scraper.match(/POLL_COMMANDS\s*=\s*\{([^}]*)\}/)?.[1] || "";

  assert.doesNotMatch(pollCommands, /"radar"/);
  assert.doesNotMatch(pollCommands, /"fleetradar"/);
  assert.doesNotMatch(pollCommands, /"prox(?: velocity)?"/);
  assert.match(scraper, /local function refreshDerivedDistances/);
  assert.match(scraper, /entity\.distance = math\.floor\(math\.sqrt/);
  assert.match(scene, /distance: Math\.round\(Math\.hypot\(\.\.\.position3d\)\)/);
  assert.match(scraper, /proximity is derived from coordinates/);
  assert.match(scraper, /AUTOMATIC_COMMAND_DEDUP_SECONDS = 3/);
  assert.match(scraper, /automaticCommandRepeatDelay\(command, now\)/);
  assert.match(scraper, /SENSOR_TICK_FALLBACK_SECONDS = 4/);
  assert.match(scraper, /releasePendingSensorPoll\("gmcp"/);
  assert.match(scraper, /COMBAT_RADAR_INTERVAL_SECONDS = 3/);
  assert.match(scraper, /FLEETRADAR_INTERVAL_SECONDS = 6/);
  assert.match(scraper, /COMBAT_FLEETRADAR_INTERVAL_SECONDS = 12/);
  assert.match(scraper, /RADAR_RECONCILE_INTERVAL_SECONDS = 60/);
});

test("sector arrivals queue a deduplicated full radar refresh", async () => {
  const scraper = await readFile("mudlet/lotj_holocron_scraper.lua", "utf8");
  assert.match(scraper, /function Scraper\.handleSectorArrival\(text\)/);
  assert.match(scraper, /enters the starsystem, coming out of its hyperjump at/);
  assert.match(scraper, /Scraper\.handleSectorArrival\(line or ""\)/);
  assert.match(scraper, /if Scraper\.polling\.radarRefreshPending then\s+command = "radar"/);
  assert.match(scraper, /radarRefreshIssuedGeneration/);
  assert.match(scraper, /automaticCommandRepeatDelay\(command, now\)/);
});
