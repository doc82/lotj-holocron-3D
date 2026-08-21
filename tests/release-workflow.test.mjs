import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pull requests run isolated Lua behavior tests with explicit pnpm setup", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /pnpm\/action-setup@v6/);
  assert.match(workflow, /pnpm check/);
  assert.match(workflow, /pnpm test/);
  assert.match(workflow, /pnpm relay:test/);
  assert.match(workflow, /pnpm test:lua/);
  assert.doesNotMatch(workflow, /corepack/);
});

test("trusted pull requests test the private planet bundle without publishing it", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");
  const fetcher = await readFile("tools/fetch-planet-assets.mjs", "utf8");
  assert.match(workflow, /name: Private planet asset pipeline/);
  assert.match(workflow, /head\.repo\.full_name == github\.repository/);
  assert.match(workflow, /github\.actor != 'dependabot\[bot\]'/);
  assert.match(workflow, /google-github-actions\/auth@v3/);
  assert.match(workflow, /secrets\.GOOGLE_DRIVE_CREDENTIALS/);
  assert.match(workflow, /vars\.HOLOCRON_PLANET_ASSET_FILE_ID/);
  assert.match(workflow, /vars\.HOLOCRON_PLANET_ASSET_SHA256/);
  assert.match(workflow, /tools\/fetch-planet-assets\.mjs/);
  assert.match(workflow, /build-planet-textures\.mjs --verify-output/);
  assert.match(workflow, /pnpm renderer:build/);
  assert.match(workflow, /tools\/verify-renderer-planet-assets\.mjs/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /upload-artifact/);
  assert.match(fetcher, /extractZip\(archivePath/);
  assert.doesNotMatch(fetcher, /spawnSync\("tar"/);
});

test("main version bumps gate release publication on tests and all installers", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /tools\/release-version\.mjs/);
  assert.match(workflow, /needs: \[prepare, verify, windows, macos\]/);
  assert.match(workflow, /Holocron3D-Setup\.exe/);
  assert.match(workflow, /arm64\.dmg/);
  assert.match(workflow, /x64\.dmg/);
  assert.match(workflow, /Holocron3D\.mpackage/);
  assert.match(workflow, /verify-packaged-planet-assets\.mjs win32 x64/);
  assert.match(workflow, /verify-packaged-planet-assets\.mjs darwin \$\{\{ matrix\.arch \}\}/);
  assert.match(workflow, /HOLOCRON_PLANET_TEXTURES_PREBUILT: "1"/);
  assert.match(workflow, /tools\/fetch-planet-assets\.mjs/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /pnpm test:lua/);
  assert.match(workflow, /muddle-shadow-\$env:MUDDLER_VERSION/);
  assert.match(workflow, /--strip-components=1/);
  assert.doesNotMatch(workflow, /\$home\s*=/i);
  assert.match(workflow, /--draft=false/);
  assert.doesNotMatch(workflow, /corepack/);
});
