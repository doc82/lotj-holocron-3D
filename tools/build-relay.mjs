import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedPlatform = process.argv[2] || process.platform;
const requestedArch = process.argv[3] || process.arch;
const goos = requestedPlatform === "win32" ? "windows" : requestedPlatform === "darwin" ? "darwin" : "linux";
const goarch = requestedArch === "arm64" ? "arm64" : "amd64";
const extension = goos === "windows" ? ".exe" : "";
const outputDirectory = path.join(root, "relay", "bin", `${goos}-${requestedArch}`);
const output = path.join(outputDirectory, `holocron-relay${extension}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const result = spawnSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "."], {
  cwd: path.join(root, "relay"),
  env: { ...process.env, GOOS: goos, GOARCH: goarch },
  stdio: "inherit",
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (goos !== "windows") fs.chmodSync(output, 0o755);
process.stdout.write(`${output}\n`);
