import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "mudlet-package");
const resources = path.join(packageRoot, "src", "resources");
let muddlerHome = process.env.MUDDLER_HOME;
const siblingMuddler = path.resolve(root, "..", "AutoPilot", "muddler");
if (!muddlerHome && fs.existsSync(siblingMuddler)) muddlerHome = siblingMuddler;
if (!muddlerHome) throw new Error("Set MUDDLER_HOME to a Muddler distribution directory.");

const candidates =
  process.platform === "win32"
    ? [path.join(muddlerHome, "bin", "muddle.bat")]
    : [path.join(muddlerHome, "bin", "muddle"), path.join(muddlerHome, "bin", "muddle.sh")];
const launcher = candidates.find(fs.existsSync);
if (!launcher) throw new Error(`Muddler launcher was not found beneath ${muddlerHome}`);

fs.mkdirSync(resources, { recursive: true });
for (const name of [
  "lotj_holocron_parsers.lua",
  "lotj_holocron_proxy.lua",
  "lotj_holocron_scraper.lua",
]) {
  fs.copyFileSync(path.join(root, "mudlet", name), path.join(resources, name));
}
const result = spawnSync(launcher, [], {
  cwd: packageRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const built = path.join(packageRoot, "build", "Holocron3D.mpackage");
if (!fs.existsSync(built)) throw new Error(`Muddler did not produce ${built}`);
const outputDirectory = path.join(root, "out", "mudlet");
fs.mkdirSync(outputDirectory, { recursive: true });
const output = path.join(outputDirectory, "Holocron3D.mpackage");
fs.copyFileSync(built, output);
process.stdout.write(`${output}\n`);
