import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2] === "make" ? "make" : "package";
const platform = process.argv[3] || process.platform;
const arch = process.argv[4] || process.arch;
if (platform === "darwin" && process.platform !== "darwin") {
  throw new Error("macOS application and DMG artifacts must be built on macOS.");
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: command.toLowerCase().endsWith(".cmd"),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [
  "node_modules/vite/bin/vite.js",
  "build",
  "--config",
  "vite.renderer.config.ts",
]);
run(process.execPath, ["tools/build-relay.mjs", platform, arch]);
run(process.execPath, ["tools/build-mudlet-package.mjs"]);
if (platform === "darwin") run(process.execPath, ["tools/build-macos-icon.mjs"]);
const forgeAction = platform === "darwin" && action === "make" ? "package" : action;
run(
  process.execPath,
  [
    "node_modules/@electron-forge/cli/dist/electron-forge.js",
    forgeAction,
    `--platform=${platform}`,
    `--arch=${arch}`,
  ],
  {
    ...process.env,
    HOLOCRON_TARGET_PLATFORM: platform,
    HOLOCRON_TARGET_ARCH: arch,
  },
);
if (platform === "darwin" && action === "make") {
  run(process.execPath, ["tools/build-dmg.mjs", arch]);
}
