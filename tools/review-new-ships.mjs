// Offline review images: actual triangles, not AI-generated concept images.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createYt1000 } from "./models/yt-1000.mjs";
import { createAurek } from "./models/aurek-light-fighter.mjs";
import { createBulwark } from "./models/bulwark-class-cruiser.mjs";
import { createSprint } from "./models/sprint-class-rescue-craft.mjs";
import { createValor } from "./models/valor-class-cruiser.mjs";
import { createGolanIII } from "./models/golan-iii-station.mjs";
import { createPraetorian } from "./models/praetorian-frigate.mjs";
import { createFlashfire } from "./models/flashfire-starfighter.mjs";
import { encodeShipGlb } from "./ship-glb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "vendor-assets", "ships", "review");
const selectedId = process.argv
  .find((argument) => argument.startsWith("--model="))
  ?.slice("--model=".length);
const reviewIds = [
  "naboo-n1-starfighter",
  "jumpmaster-5000",
  "yt-1000-light-freighter",
  "aurek-light-fighter",
  "bulwark-class-cruiser",
  "sprint-class-rescue-craft",
  "valor-class-cruiser",
  "golan-iii-station",
  "praetorian-frigate",
  "flashfire-starfighter",
];
if (selectedId && !reviewIds.includes(selectedId))
  throw new Error(`Unknown review model: ${selectedId}`);
await fs.mkdir(output, { recursive: true });
const originals = {
  "yt-1000-light-freighter": createYt1000(),
  "aurek-light-fighter": createAurek(),
  "bulwark-class-cruiser": createBulwark(),
  "sprint-class-rescue-craft": createSprint(),
  "valor-class-cruiser": createValor(),
  "golan-iii-station": createGolanIII(),
  "praetorian-frigate": createPraetorian(),
  "flashfire-starfighter": createFlashfire(),
};
if (!selectedId || selectedId === "yt-1000-light-freighter")
  await fs.writeFile(
    path.join(output, "yt-1000.glb"),
    encodeShipGlb(originals["yt-1000-light-freighter"]),
  );
if (!selectedId || selectedId === "aurek-light-fighter")
  await fs.writeFile(
    path.join(output, "aurek-light-fighter.glb"),
    encodeShipGlb(originals["aurek-light-fighter"]),
  );
if (!selectedId || selectedId === "bulwark-class-cruiser")
  await fs.writeFile(
    path.join(output, "bulwark-class-cruiser.glb"),
    encodeShipGlb(originals["bulwark-class-cruiser"]),
  );
if (!selectedId || selectedId === "sprint-class-rescue-craft")
  await fs.writeFile(
    path.join(output, "sprint-class-rescue-craft.glb"),
    encodeShipGlb(originals["sprint-class-rescue-craft"]),
  );
if (!selectedId || selectedId === "valor-class-cruiser")
  await fs.writeFile(
    path.join(output, "valor-class-cruiser.glb"),
    encodeShipGlb(originals["valor-class-cruiser"]),
  );
if (!selectedId || selectedId === "golan-iii-station")
  await fs.writeFile(
    path.join(output, "golan-iii-station.glb"),
    encodeShipGlb(originals["golan-iii-station"]),
  );
if (!selectedId || selectedId === "praetorian-frigate")
  await fs.writeFile(
    path.join(output, "praetorian-frigate.glb"),
    encodeShipGlb(originals["praetorian-frigate"]),
  );
if (!selectedId || selectedId === "flashfire-starfighter")
  await fs.writeFile(
    path.join(output, "flashfire-starfighter.glb"),
    encodeShipGlb(originals["flashfire-starfighter"]),
  );
const manifest = JSON.parse(
  // Each review requires the matching built runtime geometry.
  await fs.readFile(path.join(root, "renderer", "public", "ship-models", "manifest.json"), "utf8"),
);
const views = [
  { label: "BOW / THREE-QUARTER", yaw: -0.65, elevation: 0.65 },
  { label: "TOP / BOW UP", yaw: 0, elevation: Math.PI / 2 },
  { label: "STERN / THREE-QUARTER", yaw: 2.5, elevation: 0.45 },
];
for (const id of reviewIds.filter((id) => !selectedId || id === selectedId)) {
  const model = manifest.models.find((m) => m.id === id);
  if (!model) throw new Error(`Build ship assets first: ${id} missing.`);
  const bytes = await fs.readFile(path.join(root, "renderer", "public", "ship-models", model.file));
  const floats = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const parts = originals[id] ?? [{ positions: Array.from(floats), color: [0.64, 0.71, 0.75] }];
  const pixels = Buffer.alloc(1800 * 760 * 4);
  const depthBuffer = new Float64Array(1800 * 760).fill(-Infinity);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="760"><rect width="1800" height="760" fill="#101920"/><g font-family="sans-serif"><text x="48" y="56" fill="#edf3f6" font-size="28">${model.displayName} / MODEL REVIEW</text><text x="48" y="88" fill="#96aeba" font-size="16">${model.triangleCount.toLocaleString()} triangles · +Z bow · ${originals[id] ? "Original first-pass geometry / GLB preview materials" : "Imported geometry / tactical materials"}</text>`;
  for (let viewIndex = 0; viewIndex < views.length; viewIndex++) {
    const { label, yaw, elevation } = views[viewIndex];
    const project = ([x, y, z]) => {
      const lateral = x * Math.cos(yaw) + z * Math.sin(yaw);
      const along = -x * Math.sin(yaw) + z * Math.cos(yaw);
      if (viewIndex === 1) return [x, z, y];
      return [
        lateral,
        y * Math.cos(elevation) - along * Math.sin(elevation),
        y * Math.sin(elevation) + along * Math.cos(elevation),
      ];
    };
    const faces = [];
    for (const part of parts)
      for (let i = 0; i < part.positions.length; i += 9) {
        const points = [0, 3, 6].map((j) => project(part.positions.slice(i + j, i + j + 3)));
        const [a, b, c] = points;
        const u = b.map((v, j) => v - a[j]);
        const v = c.map((v, j) => v - a[j]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const len = Math.hypot(...n) || 1;
        const shade = 0.4 + 0.6 * Math.abs((n[0] * -0.3 + n[1] * 0.7 + n[2] * 0.65) / len);
        const color = part.color.map((v) => Math.round(Math.min(255, v * 255 * shade)));
        faces.push({ points, depth: points.reduce((sum, p) => sum + p[2], 0) / 3, color });
      }
    const cx = viewIndex * 600 + 300;
    svg += `<text x="${viewIndex * 600 + 32}" y="140" fill="#8cc4d2" font-size="16">${label}</text>`;
    for (const face of faces) {
      const [a, b, c] = face.points.map((p) => [cx + p[0] * 220, 425 - p[1] * 220, p[2]]);
      const edge = (p, q, x, y) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const area = edge(a, b, c[0], c[1]);
      if (Math.abs(area) < 1e-8) continue;
      const minX = Math.max(viewIndex * 600, Math.floor(Math.min(a[0], b[0], c[0])));
      const maxX = Math.min(viewIndex * 600 + 599, Math.ceil(Math.max(a[0], b[0], c[0])));
      const minY = Math.max(160, Math.floor(Math.min(a[1], b[1], c[1])));
      const maxY = Math.min(699, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const w0 = edge(b, c, x + 0.5, y + 0.5) / area;
          const w1 = edge(c, a, x + 0.5, y + 0.5) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-8 || w1 < -1e-8 || w2 < -1e-8) continue;
          const depth = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const offset = y * 1800 + x;
          if (depth <= depthBuffer[offset]) continue;
          depthBuffer[offset] = depth;
          for (let channel = 0; channel < 3; channel++)
            pixels[offset * 4 + channel] = face.color[channel];
          pixels[offset * 4 + 3] = 255;
        }
    }
  }
  svg += `<text x="48" y="726" fill="#96aeba" font-size="15">Review render from mesh geometry. Holocron currently uses geometry-only faction shading, not these material colors.</text></g></svg>`;
  await sharp(Buffer.from(svg))
    .composite([{ input: pixels, raw: { width: 1800, height: 760, channels: 4 } }])
    .png()
    .toFile(path.join(output, `${id}.png`));
}
console.log(`Review renders and editable original-ship GLBs: ${output}`);
