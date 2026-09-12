import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import catalog from "../renderer/src/domain/shipModelCatalog.json" with { type: "json" };

export const releaseShipModels = catalog.models.filter((model) => model.releaseEligible !== false);
export const evaluationShipModels = catalog.models.filter(
  (model) => model.releaseEligible === false,
);

function expectedLicenseMarker(license) {
  if (license === "CC BY 4.0") return "CC-BY-4.0";
  if (license === "CC BY-NC-SA 4.0") return "CC-BY-NC-SA-4.0";
  if (license === "CC BY-NC") return "CC-BY-NC";
  return null;
}

export async function validateShipAssetDirectory(assetRoot) {
  const manifestPath = path.join(assetRoot, "manifest.json");
  const attributionPath = path.join(assetRoot, "ATTRIBUTION.md");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const attribution = await readFile(attributionPath, "utf8");
  if (manifest.version !== 1 || !Array.isArray(manifest.models)) {
    throw new Error(`${manifestPath}: unsupported or malformed ship manifest.`);
  }
  if (!attribution.trim()) throw new Error(`${attributionPath}: attribution is empty.`);

  const expectedIds = new Set(releaseShipModels.map((model) => model.id));
  const actualIds = new Set(manifest.models.map((model) => model.id));
  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  const unexpected = [...actualIds].filter((id) => !expectedIds.has(id));
  if (missing.length || unexpected.length || manifest.models.length !== expectedIds.size) {
    throw new Error(
      `Ship runtime manifest does not match the releasable catalog (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`,
    );
  }

  const expectedFiles = new Set([
    "manifest.json",
    "ATTRIBUTION.md",
    ...releaseShipModels.map((model) => `${model.id}.mesh`),
  ]);
  const directoryEntries = await readdir(assetRoot, { withFileTypes: true });
  const extraFiles = directoryEntries
    .filter((entry) => entry.isDirectory() || !expectedFiles.has(entry.name))
    .map((entry) => entry.name);
  if (extraFiles.length) {
    throw new Error(`Ship runtime bundle contains unexpected files: ${extraFiles.join(", ")}.`);
  }

  for (const expected of releaseShipModels) {
    const model = manifest.models.find((candidate) => candidate.id === expected.id);
    const expectedFile = `${expected.id}.mesh`;
    if (model.file !== expectedFile) {
      throw new Error(
        `${expected.id}: expected runtime file ${expectedFile}, received ${model.file}.`,
      );
    }
    const size = (await stat(path.join(assetRoot, expectedFile))).size;
    if (size === 0 || size % 36 !== 0) {
      throw new Error(`${expectedFile}: mesh is empty or not composed of complete triangles.`);
    }
    const marker =
      expected.source.kind === "generated"
        ? expected.attribution.license
        : expectedLicenseMarker(expected.attribution.license);
    if (
      !model.attribution ||
      model.attribution.source !== expected.attribution.source ||
      !String(model.attribution.author).includes(expected.attribution.author) ||
      !marker ||
      !String(model.attribution.license).includes(marker)
    ) {
      throw new Error(`${expected.id}: runtime attribution does not match the committed catalog.`);
    }
    if (!attribution.includes(expected.attribution.source)) {
      throw new Error(`${expected.id}: source URL is missing from ATTRIBUTION.md.`);
    }
  }

  for (const model of evaluationShipModels) {
    try {
      await stat(path.join(assetRoot, `${model.id}.mesh`));
      throw new Error(`${model.id}: evaluation-only mesh must not be present in a release bundle.`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return releaseShipModels.length;
}
