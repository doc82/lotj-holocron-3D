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

test("main version bumps gate release publication on tests and all installers", async () => {
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /tools\/release-version\.mjs/);
  assert.match(workflow, /needs: \[prepare, verify, windows, macos\]/);
  assert.match(workflow, /Holocron3D-Setup\.exe/);
  assert.match(workflow, /arm64\.dmg/);
  assert.match(workflow, /x64\.dmg/);
  assert.match(workflow, /Holocron3D\.mpackage/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /pnpm test:lua/);
  assert.match(workflow, /muddle-shadow-\$env:MUDDLER_VERSION/);
  assert.match(workflow, /--strip-components=1/);
  assert.doesNotMatch(workflow, /\$home\s*=/i);
  assert.match(workflow, /--draft=false/);
  assert.doesNotMatch(workflow, /corepack/);
});
