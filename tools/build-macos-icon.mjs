import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") process.exit(0);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets", "icon", "holocron3d-icon.png");
const destination = path.join(root, "assets", "icon", "holocron3d.icns");
if (fs.existsSync(destination) && fs.statSync(destination).mtimeMs >= fs.statSync(source).mtimeMs)
  process.exit(0);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "holocron3d-icon-"));
const iconset = path.join(temporaryRoot, "holocron3d.iconset");
fs.mkdirSync(iconset);
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      const suffix = scale === 2 ? "@2x" : "";
      const output = path.join(iconset, `icon_${size}x${size}${suffix}.png`);
      const resized = spawnSync(
        "sips",
        ["-z", String(pixels), String(pixels), source, "--out", output],
        { stdio: "inherit" },
      );
      if (resized.status !== 0) process.exit(resized.status ?? 1);
    }
  }
  const converted = spawnSync("iconutil", ["-c", "icns", iconset, "-o", destination], {
    stdio: "inherit",
  });
  if (converted.status !== 0) process.exit(converted.status ?? 1);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
