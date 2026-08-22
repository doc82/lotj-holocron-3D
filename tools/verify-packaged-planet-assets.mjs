import { extractFile, listPackage } from "@electron/asar";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import assignmentManifest from "../renderer/src/domain/planetTextureAssignments.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function packagedPlanetAssetPaths() {
  return assignmentManifest.assignments.flatMap(({ textureKey }) => [
    `/renderer/dist/planet-textures/${textureKey}.webp`,
    `/renderer/dist/planet-textures/${textureKey}-normal.webp`,
  ]);
}

function normalizedArchivePath(entry) {
  const normalized = entry.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function archiveExtractionPath(entries, expected) {
  const normalizedExpected = normalizedArchivePath(expected);
  const entry = entries.find(
    (candidate) => normalizedArchivePath(candidate) === normalizedExpected,
  );
  return entry?.replace(/^[/\\]+/, "");
}

export function validatePackagedPlanetEntries(entries) {
  const normalized = new Set(entries.map(normalizedArchivePath));
  const missing = packagedPlanetAssetPaths().filter((entry) => !normalized.has(entry));
  const forbiddenPrefixes = ["/.codex-tmp", "/vendor-assets", "/renderer/public"];
  const forbidden = [...normalized].filter((entry) =>
    forbiddenPrefixes.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`)),
  );

  if (missing.length || forbidden.length) {
    const problems = [];
    if (missing.length) problems.push(`missing: ${missing.join(", ")}`);
    if (forbidden.length) problems.push(`forbidden: ${forbidden.join(", ")}`);
    throw new Error(`Packaged planet texture validation failed (${problems.join("; ")}).`);
  }
}

export function packagedAsarPath(platform, arch) {
  const packageRoot = path.join(root, "out", `LotJ Holocron 3D-${platform}-${arch}`);
  return platform === "darwin"
    ? path.join(packageRoot, "LotJ Holocron 3D.app", "Contents", "Resources", "app.asar")
    : path.join(packageRoot, "resources", "app.asar");
}

export function verifyPackagedPlanetAssets(archivePath) {
  const entries = listPackage(archivePath, { isPack: false });
  validatePackagedPlanetEntries(entries);

  const empty = packagedPlanetAssetPaths().filter((entry) => {
    const extractionPath = archiveExtractionPath(entries, entry);
    return !extractionPath || extractFile(archivePath, extractionPath).byteLength === 0;
  });
  if (empty.length) throw new Error(`Packaged planet texture maps are empty: ${empty.join(", ")}`);

  console.log(
    `Verified ${packagedPlanetAssetPaths().length} optimized planet texture maps in ${archivePath}.`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || process.arch;
  verifyPackagedPlanetAssets(packagedAsarPath(platform, arch));
}
