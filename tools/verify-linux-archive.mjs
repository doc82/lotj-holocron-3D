import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { linuxArchivePath } from "./build-linux-archive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function requireFile(filePath, executable = false) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Required archive file is empty: ${filePath}`);
  if (executable && (stat.mode & 0o111) === 0) {
    throw new Error(`Required archive file is not executable: ${filePath}`);
  }
}

export function verifyLinuxArchive(arch = process.arch) {
  if (process.platform !== "linux") {
    throw new Error("Linux application archives must be verified on Linux.");
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const archive = linuxArchivePath(manifest.version, arch);
  requireFile(archive);

  const extractionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "holocron-linux-archive-"));
  try {
    run("tar", ["-xzf", archive, "-C", extractionRoot]);
    const application = path.join(extractionRoot, "Holocron3D");
    requireFile(path.join(application, "Holocron3D"), true);
    requireFile(path.join(application, "resources", "app.asar"));
    requireFile(path.join(application, "resources", "holocron-relay"), true);
    requireFile(path.join(application, "resources", "Holocron3D.mpackage"));
  } finally {
    fs.rmSync(extractionRoot, { recursive: true, force: true });
  }

  process.stdout.write(`Verified Linux ${arch} application archive: ${archive}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  verifyLinuxArchive(process.argv[2] || process.arch);
}
