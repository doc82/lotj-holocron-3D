import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const modulePath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(modulePath), "..");
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function incrementVersion(version, releaseType) {
  const match = VERSION_PATTERN.exec(String(version || "").trim());
  if (!match) throw new Error(`Invalid project version: ${version || "nothing"}.`);

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (releaseType === "patch") return `${major}.${minor}.${patch + 1}`;
  if (releaseType === "minor") return `${major}.${minor + 1}.0`;
  if (releaseType === "major") return `${major + 1}.0.0`;
  throw new Error(
    `Version increment must be "patch", "minor", or "major"; received ${releaseType || "nothing"}.`,
  );
}

function updateJsonVersion(content, version, label) {
  const manifest = JSON.parse(content);
  if (!VERSION_PATTERN.test(String(manifest.version || ""))) {
    throw new Error(`${label} does not contain a numeric MAJOR.MINOR.PATCH version.`);
  }
  manifest.version = version;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function replaceSingle(content, pattern, replacement, label) {
  const matches = content.match(pattern);
  if (matches?.length !== 1) {
    throw new Error(`${label} must contain exactly one version declaration.`);
  }
  return content.replace(pattern, replacement);
}

export function bumpProjectVersion(root, releaseType) {
  const files = {
    packageJson: path.join(root, "package.json"),
    mudletManifest: path.join(root, "mudlet-package", "mfile"),
    bootstrap: path.join(root, "mudlet-package", "src", "scripts", "holocron3d.bootstrap.lua"),
    proxy: path.join(root, "mudlet", "lotj_holocron_proxy.lua"),
  };
  const currentPackage = fs.readFileSync(files.packageJson, "utf8");
  const currentVersion = JSON.parse(currentPackage).version;
  const nextVersion = incrementVersion(currentVersion, releaseType);
  const updates = [
    [files.packageJson, updateJsonVersion(currentPackage, nextVersion, "package.json")],
    [
      files.mudletManifest,
      updateJsonVersion(fs.readFileSync(files.mudletManifest, "utf8"), nextVersion, "mfile"),
    ],
    [
      files.bootstrap,
      replaceSingle(
        fs.readFileSync(files.bootstrap, "utf8"),
        /Package\.VERSION = "\d+\.\d+\.\d+"/g,
        `Package.VERSION = "${nextVersion}"`,
        "Mudlet bootstrap",
      ),
    ],
    [
      files.proxy,
      replaceSingle(
        fs.readFileSync(files.proxy, "utf8"),
        /VERSION = "\d+\.\d+\.\d+"/g,
        `VERSION = "${nextVersion}"`,
        "Mudlet proxy",
      ),
    ],
  ];

  for (const [file, content] of updates) fs.writeFileSync(file, content);
  return { previousVersion: currentVersion, version: nextVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const result = bumpProjectVersion(repositoryRoot, process.argv[2]);
  process.stdout.write(`Version bumped: ${result.previousVersion} -> ${result.version}\n`);
}
