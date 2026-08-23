import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Muddler project declares the Holocron3D bootstrap and command alias", async () => {
  const mfile = JSON.parse(await readFile("mudlet-package/mfile", "utf8"));
  const scripts = JSON.parse(await readFile("mudlet-package/src/scripts/scripts.json", "utf8"));
  const aliases = JSON.parse(await readFile("mudlet-package/src/aliases/aliases.json", "utf8"));
  const bootstrap = await readFile("mudlet-package/src/scripts/holocron3d.bootstrap.lua", "utf8");
  const build = await readFile("tools/build-mudlet-package.mjs", "utf8");

  assert.equal(mfile.package, "Holocron3D");
  assert.equal(scripts[0].name, "holocron3d.bootstrap");
  assert.equal(aliases[0].name, "holocron3d.command");
  assert.match(aliases[0].regex, /h3d/);
  assert.match(aliases[0].regex, /dev/);
  assert.match(aliases[0].regex, /profile/);
  assert.match(aliases[0].regex, /confirmations/);
  assert.match(aliases[0].regex, /debug/);
  assert.match(aliases[0].regex, /pause/);
  assert.match(aliases[0].regex, /resume/);
  assert.match(bootstrap, /Holocron3D\.exe/);
  assert.match(bootstrap, /Package\.setDevelopmentMode/);
  assert.match(bootstrap, /Package\.profile/);
  assert.match(bootstrap, /h3d profile start \| report \| stop/);
  assert.doesNotMatch(bootstrap, /Lua CPU/);
  assert.match(bootstrap, /capture response window/);
  assert.match(bootstrap, /automatic command duplicates suppressed/);
  assert.match(bootstrap, /holocron3d-dev-app-path\.txt/);
  assert.match(bootstrap, /path \.\. "\/LotJ Holocron 3D-win32-x64\/Holocron3D\.exe"/);
  assert.match(bootstrap, /out\/LotJ Holocron 3D-win32-x64\/Holocron3D\.exe/);
  assert.match(bootstrap, /LotJ Holocron 3D\.app\/Contents\/MacOS\/Holocron3D/);
  assert.match(bootstrap, /LotJ Holocron 3D-linux-x64\/Holocron3D/);
  assert.match(bootstrap, /function resolveDevRelay\(executable\)/);
  assert.match(bootstrap, /directory \.\. "\/resources\/holocron-relay\.exe"/);
  assert.match(bootstrap, /relay = devRelay/);
  assert.match(bootstrap, /XDG_DATA_HOME/);
  assert.match(bootstrap, /desktop-launcher/);
  assert.match(bootstrap, /Package\.settingsPath/);
  assert.match(bootstrap, /h3d confirmations on \| off/);
  assert.match(bootstrap, /h3d debug on \| off/);
  assert.match(bootstrap, /Package\.setPollingPaused/);
  assert.match(bootstrap, /scraper\.setup\(lotjHolocron3D, \{ polling = false \}\)/);
  assert.match(bootstrap, /scraper\.startStartupPolling\(\)/);
  assert.match(bootstrap, /lotjHolocron3D\.onDisconnect/);
  assert.match(bootstrap, /lotjHolocron3D\.isReady/);
  assert.match(bootstrap, /bridge started; waiting for desktop connection/);
  assert.match(bootstrap, /h3d pause \| resume/);
  assert.match(
    bootstrap,
    /if level ~= "error" and level ~= "warn" and not Package\.settings\.debug then\s+return\s+end/,
  );
  assert.doesNotMatch(bootstrap, /tempTimer\(0, function\(\)\s+Package\.start\(\)/);
  assert.match(
    bootstrap,
    /tempTimer\(0, function\(\)\s+Package\.stop\(true\)\s+say\("yellow", "waiting for h3d start to begin Holocron3D"\)\s+end\)/,
  );
  for (const source of ["parsers", "proxy", "scraper"]) {
    assert.match(build, new RegExp(`lotj_holocron_${source}\\.lua`));
  }
});
