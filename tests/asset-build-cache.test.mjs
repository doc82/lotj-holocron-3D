import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCacheIsCurrent,
  createBuildFingerprint,
  writeBuildCache,
} from "../tools/asset-build-cache.mjs";

test("asset build cache tracks configuration, source metadata, and required outputs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "holocron-asset-cache-"));
  const source = path.join(directory, "source.zip");
  const builder = path.join(directory, "builder.mjs");
  const output = path.join(directory, "ship.mesh");
  const cachePath = path.join(directory, "cache.json");
  await writeFile(source, "source-v1");
  await writeFile(builder, "builder-v1");
  await writeFile(output, "mesh-v1");

  const fingerprint = await createBuildFingerprint({
    values: { release: true },
    contentFiles: [builder],
    statFiles: [source],
  });
  assert.equal(await buildCacheIsCurrent({ cachePath, fingerprint, outputs: [output] }), false);

  await writeBuildCache({ cachePath, fingerprint, outputs: [output] });
  assert.equal(await buildCacheIsCurrent({ cachePath, fingerprint, outputs: [output] }), true);

  await writeFile(output, "mesh-v2-with-a-different-size");
  assert.equal(await buildCacheIsCurrent({ cachePath, fingerprint, outputs: [output] }), false);

  const differentMode = await createBuildFingerprint({
    values: { release: false },
    contentFiles: [builder],
    statFiles: [source],
  });
  assert.notEqual(differentMode, fingerprint);
});

test("ship packaging is incremental by default and exposes explicit rebuild commands", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const builder = await readFile("tools/build-ship-models.mjs", "utf8");
  const releaseBuilder = await readFile("tools/release-build.mjs", "utf8");

  assert.equal(packageJson.scripts["assets:ships"], "node tools/build-ship-models.mjs");
  assert.match(packageJson.scripts["assets:ships:rebuild"], /--force/);
  assert.match(packageJson.scripts["assets:ships:release"], /--release$/);
  assert.match(packageJson.scripts["assets:ships:release:rebuild"], /--release --force/);
  assert.match(builder, /buildCacheIsCurrent/);
  assert.match(builder, /process\.exit\(0\)/);
  assert.match(releaseBuilder, /build-ship-models\.mjs", "--release"/);
  assert.doesNotMatch(releaseBuilder, /build-ship-models\.mjs", "--release", "--force"/);
});
