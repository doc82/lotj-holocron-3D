import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createBuildFingerprint({ values, contentFiles = [], statFiles = [] }) {
  const contents = [];
  for (const filename of contentFiles) {
    const resolved = path.resolve(filename);
    contents.push({ path: resolved, sha256: digest(await readFile(resolved)) });
  }
  const sources = [];
  for (const filename of statFiles) {
    const resolved = path.resolve(filename);
    const metadata = await stat(resolved);
    sources.push({ path: resolved, size: metadata.size, mtimeMs: metadata.mtimeMs });
  }
  return digest(JSON.stringify({ values, contents, sources }));
}

export async function buildCacheIsCurrent({ cachePath, fingerprint, outputs }) {
  try {
    const cache = JSON.parse(await readFile(cachePath, "utf8"));
    if (cache.version !== 1 || cache.fingerprint !== fingerprint) return false;
    for (const filename of outputs) {
      const resolved = path.resolve(filename);
      const metadata = await stat(resolved);
      const cached = cache.outputs[resolved];
      if (!cached || metadata.size <= 0 || cached.size !== metadata.size) return false;
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function writeBuildCache({ cachePath, fingerprint, outputs }) {
  const outputMetadata = {};
  for (const filename of outputs) {
    const resolved = path.resolve(filename);
    const metadata = await stat(resolved);
    outputMetadata[resolved] = { size: metadata.size };
  }
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    `${JSON.stringify({ version: 1, fingerprint, outputs: outputMetadata }, null, 2)}\n`,
  );
}
