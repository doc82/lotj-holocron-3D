import assert from "node:assert/strict";
import test from "node:test";

import { decideRelease } from "../tools/release-version.mjs";

test("release automation runs only for an increasing package version", () => {
  assert.deepEqual(decideRelease({currentVersion: "1.2.3", previousVersion: "1.2.2"}), {
    release: true, version: "1.2.3", tag: "v1.2.3",
  });
  assert.equal(decideRelease({currentVersion: "1.2.3", previousVersion: "1.2.3"}).release, false);
  assert.throws(() => decideRelease({currentVersion: "1.2.2", previousVersion: "1.2.3"}),
    /must increase/);
});

test("manual release resumption must match package.json", () => {
  assert.equal(decideRelease({currentVersion: "1.2.3", manual: true}).tag, "v1.2.3");
  assert.throws(() => decideRelease({
    currentVersion: "1.2.3", requestedVersion: "1.2.4", manual: true,
  }), /does not match/);
});
