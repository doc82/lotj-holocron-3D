import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import assignmentManifest from "../renderer/src/domain/planetTextureAssignments.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fileId = process.env.HOLOCRON_PLANET_ASSET_FILE_ID?.trim();
const expectedSha256 = process.env.HOLOCRON_PLANET_ASSET_SHA256?.trim().toLowerCase();
const accessToken = process.env.HOLOCRON_GOOGLE_DRIVE_TOKEN?.trim();

if (!fileId) throw new Error("HOLOCRON_PLANET_ASSET_FILE_ID is required.");
if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "")) {
  throw new Error("HOLOCRON_PLANET_ASSET_SHA256 must be a 64-character SHA-256 digest.");
}
if (!accessToken) throw new Error("HOLOCRON_GOOGLE_DRIVE_TOKEN is required.");

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "holocron-planet-assets-"));
const archivePath = path.join(temporaryRoot, "holocron-planet-runtime.zip");
const publicRoot = path.join(root, "renderer", "public");
const textureRoot = path.join(publicRoot, "planet-textures");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  console.log("Downloading private planet runtime bundle from Google Drive...");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Google Drive download failed: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
  const actualSha256 = await sha256(archivePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Planet asset SHA-256 mismatch. Expected ${expectedSha256}, received ${actualSha256}.`,
    );
  }

  await mkdir(publicRoot, { recursive: true });
  const extraction = spawnSync("tar", ["-xf", archivePath, "-C", publicRoot], {
    cwd: root,
    encoding: "utf8",
  });
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) {
    throw new Error(extraction.stderr || extraction.stdout || "Could not extract planet assets.");
  }

  const missing = [];
  for (const { textureKey } of assignmentManifest.assignments) {
    for (const suffix of [".webp", "-normal.webp"]) {
      try {
        await stat(path.join(textureRoot, `${textureKey}${suffix}`));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        missing.push(`${textureKey}${suffix}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(`Planet runtime bundle is incomplete: ${missing.join(", ")}`);
  }

  console.log(
    `Verified and extracted ${assignmentManifest.assignments.length * 2} planet runtime maps.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
