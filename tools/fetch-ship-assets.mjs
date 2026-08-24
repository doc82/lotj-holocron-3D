import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import extractZip from "extract-zip";

import { validateShipAssetDirectory } from "./ship-asset-validation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fileId = process.env.HOLOCRON_SHIP_ASSET_FILE_ID?.trim();
const expectedSha256 = process.env.HOLOCRON_SHIP_ASSET_SHA256?.trim().toLowerCase();
const accessToken = process.env.HOLOCRON_GOOGLE_DRIVE_TOKEN?.trim();

if (!fileId) throw new Error("HOLOCRON_SHIP_ASSET_FILE_ID is required.");
if (!/^[a-f0-9]{64}$/.test(expectedSha256 || "")) {
  throw new Error("HOLOCRON_SHIP_ASSET_SHA256 must be a 64-character SHA-256 digest.");
}
if (!accessToken) throw new Error("HOLOCRON_GOOGLE_DRIVE_TOKEN is required.");

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "holocron-ship-assets-"));
const archivePath = path.join(temporaryRoot, "holocron-ship-runtime.zip");
const extractionRoot = path.join(temporaryRoot, "extracted");
const extractedAssetRoot = path.join(extractionRoot, "ship-models");
const publicRoot = path.join(root, "renderer", "public");
const assetRoot = path.join(publicRoot, "ship-models");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  console.log("Downloading private ship runtime bundle from Google Drive...");
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
      `Ship asset SHA-256 mismatch. Expected ${expectedSha256}, received ${actualSha256}.`,
    );
  }

  await mkdir(extractionRoot, { recursive: true });
  await extractZip(archivePath, { dir: extractionRoot });
  const count = await validateShipAssetDirectory(extractedAssetRoot);
  await mkdir(publicRoot, { recursive: true });
  await rm(assetRoot, { recursive: true, force: true });
  await cp(extractedAssetRoot, assetRoot, { recursive: true });
  console.log(`Verified and extracted ${count} attributed ship runtime meshes.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
