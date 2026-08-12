import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renderer includes the cinematic startup and disconnected uplink states", async () => {
  const [html, startup, telemetry, uplink, globalStyles, startupStyles, uplinkStyles] = await Promise.all([
    readFile("renderer/index.html", "utf8"),
    readFile("renderer/src/features/startup/StartupSequence.tsx", "utf8"),
    readFile("renderer/src/features/telemetry/useTelemetry.ts", "utf8"),
    readFile("renderer/src/features/connection/UplinkNotice.tsx", "utf8"),
    readFile("renderer/styles.css", "utf8"),
    readFile("renderer/src/features/startup/StartupSequence.module.css", "utf8"),
    readFile("renderer/src/features/connection/UplinkNotice.module.css", "utf8"),
  ]);

  assert.match(html, /src="\/src\/main\.tsx"/);
  assert.match(startup, /data-text="Holocron3D"/);
  assert.match(startup, /styles\.threeD/);
  assert.match(startup, /event\.key !== "Escape"/);
  assert.match(startup, /edgeActivation/);
  assert.match(startup, /setPhase\("dissolving"\)/);
  assert.match(startup, /styles\.hyperspace/);
  assert.match(telemetry, /connectionLabel/);
  assert.match(uplink, /Waiting for uplink to your Ship, Captain/);
  assert.match(uplink, /styles\.uplink/);
  assert.match(startupStyles, /\.title/);
  assert.doesNotMatch(startupStyles, /repeating-radial-gradient/);
  assert.match(uplinkStyles, /\.reticle/);
  assert.match(globalStyles, /prefers-reduced-motion/);
  assert.doesNotMatch(globalStyles, /\.uplink|\.titleStage|\.telemetry/);
});

test("release author and versions remain synchronized", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const mudletPackage = JSON.parse(await readFile("mudlet-package/mfile", "utf8"));
  const bootstrap = await readFile("mudlet-package/src/scripts/holocron3d.bootstrap.lua", "utf8");
  const proxy = await readFile("mudlet/lotj_holocron_proxy.lua", "utf8");
  const forge = await readFile("forge.config.cjs", "utf8");

  assert.equal(packageJson.author, "Veska");
  assert.equal(mudletPackage.author, "Veska");
  assert.equal(packageJson.version, mudletPackage.version);
  assert.match(bootstrap, new RegExp(`Package\\.VERSION = "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(proxy, new RegExp(`VERSION = "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(forge, /authors: "Veska"/);
});
