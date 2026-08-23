import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function linuxArchiveName(version, arch) {
  return `LotJ-Holocron-3D-${version}-linux-${arch}.tar.gz`;
}

export function linuxArchivePath(version, arch) {
  return path.join(root, "out", "make", "tar.gz", "linux", arch, linuxArchiveName(version, arch));
}

export function buildLinuxArchive(arch = process.arch) {
  if (process.platform !== "linux") {
    throw new Error("Linux application archives must be built on Linux.");
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageName = `LotJ Holocron 3D-linux-${arch}`;
  const packageDirectory = path.join(root, "out", packageName);
  const executable = path.join(packageDirectory, "Holocron3D");
  if (!fs.existsSync(executable)) {
    throw new Error(`Packaged Linux application is missing: ${executable}`);
  }

  const archive = linuxArchivePath(manifest.version, arch);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.rmSync(archive, { force: true });

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "holocron-linux-archive-"));
  try {
    fs.cpSync(packageDirectory, path.join(stagingRoot, "Holocron3D"), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    const result = spawnSync("tar", ["-czf", archive, "-C", stagingRoot, "Holocron3D"], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  if (!fs.existsSync(archive) || fs.statSync(archive).size === 0) {
    throw new Error(`Linux application archive was not created: ${archive}`);
  }

  process.stdout.write(`${archive}\n`);
  return archive;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  buildLinuxArchive(process.argv[2] || process.arch);
}
