import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("DMG artifacts must be built on macOS.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const arch = process.argv[2] || process.arch;
const appName = "LotJ Holocron 3D.app";
const application = path.join(root, "out", `LotJ Holocron 3D-darwin-${arch}`, appName);
if (!fs.existsSync(application))
  throw new Error(`Packaged application not found at ${application}`);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "holocron3d-dmg-"));
const outputDirectory = path.join(root, "out", "make", "dmg", "darwin", arch);
const output = path.join(outputDirectory, `LotJ-Holocron-3D-${version}-${arch}.dmg`);
fs.mkdirSync(outputDirectory, { recursive: true });
try {
  fs.cpSync(application, path.join(staging, appName), { recursive: true });
  fs.symlinkSync("/Applications", path.join(staging, "Applications"));
  const result = spawnSync(
    "hdiutil",
    [
      "create",
      "-volname",
      "LotJ Holocron 3D",
      "-srcfolder",
      staging,
      "-ov",
      "-format",
      "ULFO",
      output,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
process.stdout.write(`${output}\n`);
