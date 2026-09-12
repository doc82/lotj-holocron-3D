import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import extractZip from "extract-zip";
import { decodeGlb } from "./ship-glb.mjs";
import { createYt1000 } from "./models/yt-1000.mjs";
import { createAurek } from "./models/aurek-light-fighter.mjs";
import { createBulwark } from "./models/bulwark-class-cruiser.mjs";
import { createSprint } from "./models/sprint-class-rescue-craft.mjs";
import { createValor } from "./models/valor-class-cruiser.mjs";
import { createGolanIII } from "./models/golan-iii-station.mjs";
import { createPraetorian } from "./models/praetorian-frigate.mjs";
import catalog from "../renderer/src/domain/shipModelCatalog.json" with { type: "json" };
import {
  buildCacheIsCurrent,
  createBuildFingerprint,
  writeBuildCache,
} from "./asset-build-cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builderPath = fileURLToPath(import.meta.url);
const catalogPath = path.join(root, "renderer", "src", "domain", "shipModelCatalog.json");
const vendorRoot = path.join(root, "vendor-assets", "ships");
const outputRoot = path.join(root, "renderer", "public", "ship-models");
const cachePath = path.join(vendorRoot, ".ship-model-build-cache.json");
const releaseBuild = process.argv.includes("--release");
const forceBuild = process.argv.includes("--force");
const downloadArgument = process.argv.find((argument) => argument.startsWith("--downloads="));
const downloadsRoot = downloadArgument
  ? path.resolve(downloadArgument.slice("--downloads=".length))
  : path.join(os.homedir(), "Downloads");

const sources = releaseBuild
  ? catalog.models.filter((model) => model.releaseEligible !== false)
  : catalog.models;

const componentReaders = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
};
const componentCounts = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function multiply(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[column * 4 + row] += left[index * 4 + row] * right[column * 4 + index];
      }
    }
  }
  return result;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const xx = x * x;
  const xy = x * y;
  const xz = x * z;
  const xw = x * w;
  const yy = y * y;
  const yz = y * z;
  const yw = y * w;
  const zz = z * z;
  const zw = z * w;
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + zw) * sx,
    2 * (xz - yw) * sx,
    0,
    2 * (xy - zw) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + xw) * sy,
    0,
    2 * (xz + yw) * sz,
    2 * (yz - xw) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

async function findFile(directory, filename) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, filename);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return candidate;
    }
  }
  return null;
}

async function loadGltf(gltfPath) {
  const isGlb = path.extname(gltfPath).toLowerCase() === ".glb";
  const decoded = isGlb ? decodeGlb(await fs.readFile(gltfPath)) : null;
  const gltf = decoded?.gltf ?? JSON.parse(await fs.readFile(gltfPath, "utf8"));
  const buffers = await Promise.all(
    gltf.buffers.map(async (buffer, index) => {
      if (!buffer.uri && decoded && index === 0) {
        const bytes = decoded.binary;
        if (buffer.byteLength > bytes.length) throw new Error("Truncated GLB buffer.");
        return new DataView(bytes.buffer, bytes.byteOffset, buffer.byteLength);
      }
      if (!buffer.uri || buffer.uri.startsWith("data:")) {
        throw new Error(`${gltfPath}: embedded data buffers are not supported.`);
      }
      const bytes = await fs.readFile(path.resolve(path.dirname(gltfPath), buffer.uri));
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }),
  );

  function readAccessor(index) {
    const accessor = gltf.accessors[index];
    const bufferView = gltf.bufferViews[accessor.bufferView];
    const component = componentReaders[accessor.componentType];
    const count = componentCounts[accessor.type];
    if (!component || !count || accessor.sparse) {
      throw new Error(`${gltfPath}: unsupported accessor ${index}.`);
    }
    const view = buffers[bufferView.buffer];
    const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = bufferView.byteStride ?? component.bytes * count;
    return Array.from({ length: accessor.count }, (_, item) =>
      Array.from({ length: count }, (_, part) =>
        component.read(view, start + item * stride + part * component.bytes),
      ),
    );
  }

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const triangles = [];
  const scene = gltf.scenes[gltf.scene ?? 0];

  function visit(nodeIndex, parentMatrix) {
    const node = gltf.nodes[nodeIndex];
    const world = multiply(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4 || primitive.attributes.POSITION === undefined) continue;
        const positions = readAccessor(primitive.attributes.POSITION);
        const indices =
          primitive.indices === undefined
            ? positions.map((_, index) => [index])
            : readAccessor(primitive.indices);
        for (let index = 0; index + 2 < indices.length; index += 3) {
          for (let corner = 0; corner < 3; corner += 1) {
            const position = positions[indices[index + corner][0]];
            triangles.push(...transformPoint(world, position));
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  }

  for (const node of scene.nodes ?? []) visit(node, identity);
  return triangles;
}

async function loadStl(stlPath) {
  const bytes = await fs.readFile(stlPath);
  if (bytes.length >= 84) {
    const triangleCount = bytes.readUInt32LE(80);
    const expectedBytes = 84 + triangleCount * 50;
    if (triangleCount > 0 && expectedBytes <= bytes.length) {
      const triangles = [];
      for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const triangleOffset = 84 + triangle * 50;
        for (let corner = 0; corner < 3; corner += 1) {
          const vertexOffset = triangleOffset + 12 + corner * 12;
          triangles.push(
            bytes.readFloatLE(vertexOffset),
            bytes.readFloatLE(vertexOffset + 4),
            bytes.readFloatLE(vertexOffset + 8),
          );
        }
      }
      return triangles;
    }
  }

  const triangles = [];
  const text = bytes.toString("utf8");
  for (const match of text.matchAll(/\bvertex\s+([-+\d.e]+)\s+([-+\d.e]+)\s+([-+\d.e]+)/gi)) {
    triangles.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  if (triangles.length === 0 || triangles.length % 9 !== 0) {
    throw new Error(`${stlPath}: unsupported or malformed STL file.`);
  }
  return triangles;
}

function bounds(positions) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], positions[index + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[index + axis]);
    }
  }
  return { minimum, maximum, extents: minimum.map((value, axis) => maximum[axis] - value) };
}

function normalizeOrientation(positions, orientation) {
  const sourceBounds = bounds(positions);
  const axes = [0, 1, 2].sort(
    (left, right) => sourceBounds.extents[right] - sourceBounds.extents[left],
  );
  const longitudinal = orientation?.longitudinal ?? axes[0];
  const vertical = orientation?.vertical ?? axes[2];
  const lateral = orientation?.lateral ?? axes[1];
  const center = sourceBounds.minimum.map(
    (value, axis) => (value + sourceBounds.maximum[axis]) / 2,
  );
  const length = Math.max(0.000001, sourceBounds.extents[longitudinal]);
  const endBand = length * 0.16;
  let minimumRadius = 0;
  let maximumRadius = 0;
  let minimumCount = 0;
  let maximumCount = 0;
  for (let index = 0; index < positions.length; index += 3) {
    const along = positions[index + longitudinal];
    const radial =
      Math.abs(positions[index + lateral] - center[lateral]) +
      Math.abs(positions[index + vertical] - center[vertical]);
    if (along <= sourceBounds.minimum[longitudinal] + endBand) {
      minimumRadius += radial;
      minimumCount += 1;
    }
    if (along >= sourceBounds.maximum[longitudinal] - endBand) {
      maximumRadius += radial;
      maximumCount += 1;
    }
  }
  minimumRadius /= Math.max(1, minimumCount);
  maximumRadius /= Math.max(1, maximumCount);
  const forwardSign = orientation?.forwardSign ?? (minimumRadius <= maximumRadius ? -1 : 1);
  const unit = length / 2;
  const normalized = [];
  for (let index = 0; index < positions.length; index += 3) {
    normalized.push(
      (positions[index + lateral] - center[lateral]) / unit,
      (positions[index + vertical] - center[vertical]) / unit,
      ((positions[index + longitudinal] - center[longitudinal]) / unit) * forwardSign,
    );
  }
  return {
    positions: normalized,
    sourceExtents: sourceBounds.extents,
    axisMapping: { lateral, vertical, longitudinal, forwardSign },
  };
}

function clusterTriangles(positions, divisions) {
  const result = [];
  const seen = new Set();
  const quantize = (value) => Math.round(((value + 1) / 2) * divisions);
  const restore = (value) => (value / divisions) * 2 - 1;
  for (let index = 0; index < positions.length; index += 9) {
    const keys = [];
    const points = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const offset = index + corner * 3;
      const quantized = [
        quantize(positions[offset]),
        quantize(positions[offset + 1]),
        quantize(positions[offset + 2]),
      ];
      keys.push(quantized.join(","));
      points.push(quantized.map(restore));
    }
    if (new Set(keys).size < 3) continue;
    const triangleKey = [...keys].sort().join("|");
    if (seen.has(triangleKey)) continue;
    seen.add(triangleKey);
    result.push(...points.flat());
  }
  return result;
}

function optimize(positions, targetTriangles) {
  const originalTriangles = positions.length / 9;
  if (originalTriangles <= targetTriangles) return { positions, divisions: null };
  let best = positions;
  let bestDivisions = null;
  for (const divisions of [160, 128, 104, 84, 68, 56, 46, 38, 32, 26, 22, 18, 14, 10, 8]) {
    const candidate = clusterTriangles(positions, divisions);
    best = candidate;
    bestDivisions = divisions;
    if (candidate.length / 9 <= targetTriangles) break;
  }
  return { positions: best, divisions: bestDivisions };
}

function parseLicense(text) {
  const value = (label) => text.match(new RegExp(`^\\* ${label}:\\s*(.+)$`, "mi"))?.[1]?.trim();
  return {
    title: value("title") ?? "Unknown model",
    source: value("source") ?? "",
    author: value("author") ?? "Unknown creator",
    license: value("license type") ?? "Unknown license",
  };
}

const sourcePaths = sources
  .filter((source) => source.source.kind !== "generated")
  .map((source) => path.join(downloadsRoot, source.source.filename));
const outputFiles = [
  path.join(outputRoot, "manifest.json"),
  path.join(outputRoot, "ATTRIBUTION.md"),
  ...sources.map((source) => path.join(outputRoot, `${source.id}.mesh`)),
];
const fingerprint = await createBuildFingerprint({
  values: { releaseBuild, downloadsRoot: path.resolve(downloadsRoot) },
  contentFiles: [
    builderPath,
    catalogPath,
    path.join(root, "tools", "ship-glb.mjs"),
    path.join(root, "tools", "models", "yt-1000.mjs"),
    path.join(root, "tools", "models", "aurek-light-fighter.mjs"),
    path.join(root, "tools", "models", "bulwark-class-cruiser.mjs"),
    path.join(root, "tools", "models", "sprint-class-rescue-craft.mjs"),
    path.join(root, "tools", "models", "valor-class-cruiser.mjs"),
    path.join(root, "tools", "models", "golan-iii-station.mjs"),
    path.join(root, "tools", "models", "praetorian-frigate.mjs"),
    path.join(root, "tools", "models", "mesh-primitives.mjs"),
  ],
  statFiles: sourcePaths,
});
if (!forceBuild && (await buildCacheIsCurrent({ cachePath, fingerprint, outputs: outputFiles }))) {
  console.log(
    `Ship meshes are up to date; skipped ${sources.length} ${releaseBuild ? "release" : "local preview"} triangle optimizations. Use --force to rebuild.`,
  );
  process.exit(0);
}

await fs.mkdir(vendorRoot, { recursive: true });
await fs.rm(cachePath, { force: true });
await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
const models = [];

for (const source of sources) {
  const sourcePath =
    source.source.kind === "generated" ? null : path.join(downloadsRoot, source.source.filename);
  if (sourcePath) await fs.access(sourcePath);
  const sourceDirectory = path.join(vendorRoot, source.id);
  await fs.rm(sourceDirectory, { recursive: true, force: true });
  await fs.mkdir(sourceDirectory, { recursive: true });
  let originalPositions;
  let attribution;
  if (source.source.kind === "generated") {
    const generator = {
      "yt-1000-light-freighter": createYt1000,
      "aurek-light-fighter": createAurek,
      "bulwark-class-cruiser": createBulwark,
      "sprint-class-rescue-craft": createSprint,
      "valor-class-cruiser": createValor,
      "golan-iii-station": createGolanIII,
      "praetorian-frigate": createPraetorian,
    }[source.id];
    if (!generator) throw new Error(`${source.id}: unknown original model generator.`);
    originalPositions = generator().flatMap((part) => part.positions);
    attribution = source.attribution;
  } else if (source.source.kind === "stl-archive") {
    await extractZip(sourcePath, { dir: sourceDirectory });
    const stlPath = await findFile(sourceDirectory, source.source.entry);
    if (!stlPath) throw new Error(`${source.source.filename}: ${source.source.entry} missing.`);
    // Select the complete hull, never combine the duplicate front/back print variants.
    originalPositions = await loadStl(stlPath);
    attribution = {
      ...source.attribution,
      license: source.attribution.license.startsWith("CC ")
        ? source.attribution.license.replaceAll(" ", "-")
        : source.attribution.license,
    };
  } else if (source.source.kind === "file" && path.extname(sourcePath).toLowerCase() === ".glb") {
    const { gltf } = decodeGlb(await fs.readFile(sourcePath));
    attribution = gltf.asset.extras;
    if (
      !attribution ||
      attribution.source !== source.attribution.source ||
      !attribution.author?.includes(source.attribution.author) ||
      !attribution.license?.includes(source.attribution.license.replaceAll(" ", "-"))
    ) {
      throw new Error(`${source.source.filename}: embedded attribution does not match catalog.`);
    }
    originalPositions = await loadGltf(sourcePath);
  } else if (source.source.kind === "archive") {
    await extractZip(sourcePath, { dir: sourceDirectory });
    const gltfPath = await findFile(sourceDirectory, "scene.gltf");
    const licensePath = await findFile(sourceDirectory, "license.txt");
    if (!gltfPath || !licensePath) {
      throw new Error(`${source.source.filename}: scene.gltf or license.txt missing.`);
    }
    const licenseText = await fs.readFile(licensePath, "utf8");
    if (!licenseText.includes("CC-BY-4.0") && !licenseText.includes("CC-BY-NC-SA-4.0")) {
      throw new Error(
        `${source.source.filename}: expected a supported embedded Creative Commons license.`,
      );
    }
    originalPositions = await loadGltf(gltfPath);
    attribution = parseLicense(licenseText);
  } else if (source.source.kind === "file" && path.extname(sourcePath).toLowerCase() === ".stl") {
    const localSource = path.join(sourceDirectory, source.source.filename);
    await fs.copyFile(sourcePath, localSource);
    originalPositions = await loadStl(localSource);
    attribution = {
      title: source.displayName,
      source: source.attribution?.source ?? "",
      author: source.attribution?.author ?? "Unknown creator",
      license: source.attribution?.license ?? "Unverified; local evaluation only",
    };
  } else {
    throw new Error(`${source.source.filename}: unsupported ship-model source format.`);
  }

  if (
    !originalPositions.length ||
    originalPositions.length % 9 ||
    !originalPositions.every(Number.isFinite)
  )
    throw new Error(`${source.id}: invalid geometry.`);
  const oriented =
    source.source.kind === "generated"
      ? {
          positions: originalPositions,
          sourceExtents: bounds(originalPositions).extents,
          axisMapping: { lateral: 0, vertical: 1, longitudinal: 2, forwardSign: 1 },
        }
      : normalizeOrientation(originalPositions, source.orientation);
  const optimized = optimize(oriented.positions, source.targetTriangles);
  const floatPositions = new Float32Array(optimized.positions);
  await fs.writeFile(
    path.join(outputRoot, `${source.id}.mesh`),
    new Uint8Array(floatPositions.buffer, floatPositions.byteOffset, floatPositions.byteLength),
  );
  models.push({
    id: source.id,
    displayName: source.displayName,
    file: `${source.id}.mesh`,
    category: source.category,
    scale: source.scale,
    triangleCount: optimized.positions.length / 9,
    originalTriangleCount: originalPositions.length / 9,
    sourceExtents: oriented.sourceExtents,
    axisMapping: oriented.axisMapping,
    clusteringDivisions: optimized.divisions,
    attribution,
  });
  console.log(
    `${source.id}: ${originalPositions.length / 9} -> ${optimized.positions.length / 9} triangles`,
  );
}

await fs.writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), models }, null, 2)}\n`,
);
await fs.writeFile(
  path.join(outputRoot, "ATTRIBUTION.md"),
  [
    releaseBuild ? "# Ship asset attribution" : "# Local ship preview attribution",
    "",
    ...models.flatMap((model) => [
      `- **${model.attribution.title}** — ${model.attribution.author}; ${model.attribution.license}; ${model.attribution.source}`,
    ]),
    "",
  ].join("\n"),
);
await writeBuildCache({ cachePath, fingerprint, outputs: outputFiles });

console.log(
  `Built ${models.length} ${releaseBuild ? "release" : "local preview"} meshes in ${path.relative(root, outputRoot)}.`,
);
