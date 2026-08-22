import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import assignmentManifest from "../renderer/src/domain/planetTextureAssignments.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildTextureRoot = path.join(root, "renderer", "dist", "planet-textures");
const textureKeys = assignmentManifest.assignments.map(({ textureKey }) => textureKey);
const expectedFiles = textureKeys.flatMap((key) => [`${key}.webp`, `${key}-normal.webp`]);
const missingOrEmpty = [];

for (const filename of expectedFiles) {
  const target = path.join(buildTextureRoot, filename);
  try {
    if ((await stat(target)).size === 0) missingOrEmpty.push(`${filename} (empty)`);
  } catch (error) {
    if (error?.code === "ENOENT") {
      missingOrEmpty.push(`${filename} (missing)`);
      continue;
    }
    throw error;
  }
}

if (missingOrEmpty.length) {
  throw new Error(
    `Renderer build is missing required planet texture maps: ${missingOrEmpty.join(", ")}`,
  );
}

console.log(
  `Verified ${expectedFiles.length} planet texture maps in the renderer build at ${buildTextureRoot}.`,
);
