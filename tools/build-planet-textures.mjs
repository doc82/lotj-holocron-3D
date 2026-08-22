import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import assignmentManifest from "../renderer/src/domain/planetTextureAssignments.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(
  process.env.HOLOCRON_PLANET_TEXTURE_SOURCE || path.join(root, "vendor-assets", "shinyman"),
);
const outputRoot = path.resolve(root, "renderer", "public", "planet-textures");
const required = process.argv.includes("--required");
const verifyOutput = process.argv.includes("--verify-output");

const textureKeys = assignmentManifest.assignments.map(({ textureKey }) => textureKey);

const imageExtensions = new Set([".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function imageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return imageFiles(target);
      return imageExtensions.has(path.extname(entry.name).toLowerCase()) ? [target] : [];
    }),
  );
  return files.flat();
}

function chooseMap(files, patterns, exclusions = []) {
  return files.find((file) => {
    const name = path.basename(file).toLowerCase();
    return (
      patterns.some((pattern) => pattern.test(name)) &&
      !exclusions.some((pattern) => pattern.test(name))
    );
  });
}

async function largestSurfaceImage(files) {
  const candidates = files.filter(
    (file) => !/(bump|cloud|elevation|emissive|height|light|mask|normal|rough)/i.test(file),
  );
  const sizes = await Promise.all(
    candidates.map(async (file) => ({ file, size: (await stat(file)).size })),
  );
  return sizes.sort((left, right) => right.size - left.size)[0]?.file;
}

async function convert(source, destination, quality) {
  await sharp(source)
    .resize(1024, 512, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .webp({ quality, smartSubsample: true })
    .toFile(destination);
}

async function verifyGeneratedOutputs() {
  const invalid = [];
  for (const key of textureKeys) {
    for (const suffix of [".webp", "-normal.webp"]) {
      const target = path.join(outputRoot, `${key}${suffix}`);
      if (!(await exists(target))) {
        invalid.push(`${key}${suffix} (missing)`);
        continue;
      }
      const metadata = await sharp(target).metadata();
      if (metadata.format !== "webp" || metadata.width !== 1024 || metadata.height !== 512) {
        invalid.push(
          `${key}${suffix} (${metadata.format || "unknown"} ${metadata.width || 0}x${metadata.height || 0})`,
        );
      }
    }
  }
  if (invalid.length) {
    throw new Error(
      `Prebuilt planet texture bundle is incomplete or invalid: ${invalid.join(", ")}`,
    );
  }
  console.log(`Verified ${textureKeys.length * 2} prebuilt planet texture maps in ${outputRoot}.`);
}

if (verifyOutput) {
  await verifyGeneratedOutputs();
  process.exit(0);
}

if (!(await exists(sourceRoot))) {
  const message = `Shiny_Man source directory not found: ${sourceRoot}`;
  if (required) throw new Error(message);
  console.warn(`${message}\nSkipping optional planet texture generation.`);
  process.exit(0);
}

await sharp.cache(false);
await import("node:fs/promises").then(({ mkdir }) => mkdir(outputRoot, { recursive: true }));

const generated = [];
const missing = [];

for (const key of textureKeys) {
  const packageDirectory = path.join(sourceRoot, key);
  if (!(await exists(packageDirectory))) {
    missing.push(key);
    continue;
  }

  const files = await imageFiles(packageDirectory);
  const diffuse =
    chooseMap(files, [/(^|[^a-z0-9])(albedo|color|diffuse)([^a-z0-9]|$)/i], [/(cloud|mask)/i]) ||
    (await largestSurfaceImage(files));
  const normal = chooseMap(files, [/(^|[^a-z0-9])(bump|normal)([^a-z0-9]|$)/i]);

  if (!diffuse) {
    missing.push(`${key} (diffuse map)`);
    continue;
  }

  if (!normal && required) {
    missing.push(`${key} (bump/normal map)`);
    continue;
  }

  await convert(diffuse, path.join(outputRoot, `${key}.webp`), 84);
  if (normal) await convert(normal, path.join(outputRoot, `${key}-normal.webp`), 90);
  generated.push(`${key}${normal ? " + normal" : ""}`);
}

console.log(`Generated ${generated.length} Shiny_Man planet texture set(s) in ${outputRoot}.`);
if (generated.length) console.log(`  ${generated.join("\n  ")}`);
if (missing.length) console.warn(`Missing optional source set(s): ${missing.join(", ")}`);
if (required && missing.length)
  throw new Error("Required Shiny_Man texture sources are incomplete.");
