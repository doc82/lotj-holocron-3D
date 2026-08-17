import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bumpProjectVersion, incrementVersion } from "../tools/bump-version.mjs";

function versionFixture(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "holocron-version-"));
  fs.mkdirSync(path.join(root, "mudlet-package", "src", "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "mudlet"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, "mudlet-package", "mfile"),
    `${JSON.stringify({ package: "Holocron3D", version }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(root, "mudlet-package", "src", "scripts", "holocron3d.bootstrap.lua"),
    `Package.VERSION = "${version}"\n`,
  );
  fs.writeFileSync(
    path.join(root, "mudlet", "lotj_holocron_proxy.lua"),
    `local Proxy = { VERSION = "${version}" }\n`,
  );
  return root;
}

test("patch, minor, and major increments follow semantic versioning", () => {
  assert.equal(incrementVersion("1.2.9", "patch"), "1.2.10");
  assert.equal(incrementVersion("1.2.9", "minor"), "1.3.0");
  assert.equal(incrementVersion("1.2.9", "major"), "2.0.0");
  assert.throws(() => incrementVersion("1.2.9", "build"), /patch.*minor.*major/);
});

test("a version bump synchronizes every packaged version declaration", () => {
  const root = versionFixture("1.2.9");
  try {
    assert.deepEqual(bumpProjectVersion(root, "minor"), {
      previousVersion: "1.2.9",
      version: "1.3.0",
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version, "1.3.0");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "mudlet-package", "mfile"))).version,
      "1.3.0",
    );
    assert.match(
      fs.readFileSync(
        path.join(root, "mudlet-package", "src", "scripts", "holocron3d.bootstrap.lua"),
        "utf8",
      ),
      /Package\.VERSION = "1\.3\.0"/,
    );
    assert.match(
      fs.readFileSync(path.join(root, "mudlet", "lotj_holocron_proxy.lua"), "utf8"),
      /VERSION = "1\.3\.0"/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("package scripts expose synchronized semantic version bumps", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["version:patch"], "node tools/bump-version.mjs patch");
  assert.equal(packageJson.scripts["version:minor"], "node tools/bump-version.mjs minor");
  assert.equal(packageJson.scripts["version:major"], "node tools/bump-version.mjs major");
});
