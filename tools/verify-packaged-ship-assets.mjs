import { extractFile, listPackage } from "@electron/asar";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { evaluationShipModels, releaseShipModels } from "./ship-asset-validation.mjs";
import { archiveExtractionPath, packagedAsarPath } from "./verify-packaged-planet-assets.mjs";

export function packagedShipAssetPaths() {
  return [
    "/renderer/dist/ship-models/manifest.json",
    "/renderer/dist/ship-models/ATTRIBUTION.md",
    ...releaseShipModels.map((model) => `/renderer/dist/ship-models/${model.id}.mesh`),
  ];
}

function normalizedArchivePath(entry) {
  const normalized = entry.replaceAll("\\", "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function validatePackagedShipEntries(entries) {
  const normalized = new Set(entries.map(normalizedArchivePath));
  const missing = packagedShipAssetPaths().filter((entry) => !normalized.has(entry));
  const forbidden = evaluationShipModels
    .map((model) => `/renderer/dist/ship-models/${model.id}.mesh`)
    .filter((entry) => normalized.has(entry));
  if (missing.length || forbidden.length) {
    const problems = [];
    if (missing.length) problems.push(`missing: ${missing.join(", ")}`);
    if (forbidden.length) problems.push(`evaluation-only: ${forbidden.join(", ")}`);
    throw new Error(`Packaged ship asset validation failed (${problems.join("; ")}).`);
  }
}

export function verifyPackagedShipAssets(archivePath) {
  const entries = listPackage(archivePath, { isPack: false });
  validatePackagedShipEntries(entries);
  const empty = packagedShipAssetPaths().filter((entry) => {
    const extractionPath = archiveExtractionPath(entries, entry);
    return !extractionPath || extractFile(archivePath, extractionPath).byteLength === 0;
  });
  if (empty.length) throw new Error(`Packaged ship assets are empty: ${empty.join(", ")}`);

  const manifestEntry = archiveExtractionPath(entries, "/renderer/dist/ship-models/manifest.json");
  const manifest = JSON.parse(extractFile(archivePath, manifestEntry).toString("utf8"));
  const expectedIds = releaseShipModels.map((model) => model.id).sort();
  const actualIds = manifest.models?.map((model) => model.id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error("Packaged ship manifest does not match the releasable catalog.");
  }

  console.log(`Verified ${releaseShipModels.length} attributed ship meshes in ${archivePath}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2] || process.platform;
  const arch = process.argv[3] || process.arch;
  verifyPackagedShipAssets(packagedAsarPath(platform, arch));
}
