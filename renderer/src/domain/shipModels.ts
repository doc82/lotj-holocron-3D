import type { Vector3 } from "../types/telemetry";
import assignmentData from "./shipModelAssignments.json" with { type: "json" };
import catalogData from "./shipModelCatalog.json" with { type: "json" };

export interface ShipModel {
  id?: string;
  triangles: Vector3[];
  scale: number;
}

interface ShipModelAssignments {
  version: number;
  exactNames: Record<string, string>;
  categoryFallbacks: Record<string, string>;
}

interface ShipModelCatalog {
  version: number;
  models: Array<{
    id: string;
    displayName: string;
    category: string;
    aliases: string[];
  }>;
}

export type ShipModelMatch =
  | "explicit-name"
  | "exact-class"
  | "exact-name"
  | "partial-class"
  | "partial-name"
  | "category-fallback";

export interface ShipModelResolution {
  modelId: string;
  match: ShipModelMatch;
  matchedValue: string;
}

interface ImportedShipManifest {
  version: number;
  models: Array<{
    id: string;
    file: string;
    category: string;
    scale: number;
    triangleCount: number;
  }>;
}

const triangle = (a: Vector3, b: Vector3, c: Vector3): Vector3[] => [a, b, c];

function box(
  width: number,
  height: number,
  length: number,
  z = 0,
  xOffset = 0,
  yOffset = 0,
): Vector3[] {
  const x = width / 2;
  const y = height / 2;
  const front = z + length / 2;
  const back = z - length / 2;
  const p: Vector3[] = [
    [-x + xOffset, -y + yOffset, back],
    [x + xOffset, -y + yOffset, back],
    [x + xOffset, y + yOffset, back],
    [-x + xOffset, y + yOffset, back],
    [-x + xOffset, -y + yOffset, front],
    [x + xOffset, -y + yOffset, front],
    [x + xOffset, y + yOffset, front],
    [-x + xOffset, y + yOffset, front],
  ];
  return [
    ...triangle(p[4], p[5], p[6]),
    ...triangle(p[4], p[6], p[7]),
    ...triangle(p[1], p[0], p[3]),
    ...triangle(p[1], p[3], p[2]),
    ...triangle(p[0], p[4], p[7]),
    ...triangle(p[0], p[7], p[3]),
    ...triangle(p[5], p[1], p[2]),
    ...triangle(p[5], p[2], p[6]),
    ...triangle(p[3], p[7], p[6]),
    ...triangle(p[3], p[6], p[2]),
    ...triangle(p[0], p[1], p[5]),
    ...triangle(p[0], p[5], p[4]),
  ];
}

function wedge(width = 1, height = 0.35, length = 2): Vector3[] {
  const x = width / 2;
  const y = height / 2;
  const front: Vector3 = [0, 0, length / 2];
  const back = -length / 2;
  const p: Vector3[] = [
    [-x, -y, back],
    [x, -y, back],
    [x, y, back],
    [-x, y, back],
  ];
  return [
    ...triangle(p[0], p[1], front),
    ...triangle(p[1], p[2], front),
    ...triangle(p[2], p[3], front),
    ...triangle(p[3], p[0], front),
    ...triangle(p[1], p[0], p[3]),
    ...triangle(p[1], p[3], p[2]),
  ];
}

function diamond(radius = 1, length = 2): Vector3[] {
  const front: Vector3 = [0, 0, length / 2];
  const back: Vector3 = [0, 0, -length / 2];
  const ring: Vector3[] = [
    [radius, 0, 0],
    [0, radius * 0.45, 0],
    [-radius, 0, 0],
    [0, -radius * 0.45, 0],
  ];
  return ring.flatMap((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return [...triangle(front, point, next), ...triangle(back, next, point)];
  });
}

function station(): Vector3[] {
  const top: Vector3 = [0, 1, 0];
  const bottom: Vector3 = [0, -1, 0];
  const ring: Vector3[] = [
    [1, 0, 0],
    [0.7, 0, 0.7],
    [0, 0, 1],
    [-0.7, 0, 0.7],
    [-1, 0, 0],
    [-0.7, 0, -0.7],
    [0, 0, -1],
    [0.7, 0, -0.7],
  ];
  return ring.flatMap((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return [...triangle(top, point, next), ...triangle(bottom, next, point)];
  });
}

function ringPlatform(): Vector3[] {
  const vertices: Vector3[] = [];
  const segments = 12;
  for (let index = 0; index < segments; index += 1) {
    const a = (index / segments) * Math.PI * 2;
    const b = ((index + 1) / segments) * Math.PI * 2;
    const outerA: Vector3 = [Math.cos(a), 0, Math.sin(a)];
    const outerB: Vector3 = [Math.cos(b), 0, Math.sin(b)];
    const innerA: Vector3 = [Math.cos(a) * 0.58, 0, Math.sin(a) * 0.58];
    const innerB: Vector3 = [Math.cos(b) * 0.58, 0, Math.sin(b) * 0.58];
    const raisedA: Vector3 = [outerA[0], 0.18, outerA[2]];
    const raisedB: Vector3 = [outerB[0], 0.18, outerB[2]];
    vertices.push(
      ...triangle(innerA, outerA, outerB),
      ...triangle(innerA, outerB, innerB),
      ...triangle(outerA, raisedA, raisedB),
      ...triangle(outerA, raisedB, outerB),
    );
  }
  return [...vertices, ...box(0.24, 0.7, 2.5), ...box(2.5, 0.7, 0.24)];
}

const MODELS: Record<string, ShipModel> = {
  vehicle: { scale: 0.65, triangles: wedge(0.8, 0.4, 1.2) },
  starfighter: {
    scale: 0.9,
    triangles: [
      ...diamond(0.18, 2.2),
      ...box(1.8, 0.08, 0.46, -0.1),
      ...box(0.16, 0.35, 0.5, -0.7),
    ],
  },
  transport: { scale: 1.2, triangles: [...wedge(1.25, 0.55, 1.8), ...box(1.8, 0.12, 0.55, -0.25)] },
  freighter: {
    scale: 1.45,
    triangles: [
      ...box(0.85, 0.55, 1.8, 0, -0.34),
      ...box(0.48, 0.42, 1.35, 0.1, 0.48),
      ...box(0.3, 0.3, 1.45, -0.15, 0.12, 0.35),
    ],
  },
  gunboat: {
    scale: 1.65,
    triangles: [
      ...wedge(1.45, 0.65, 2),
      ...box(0.3, 0.45, 1.45, -0.18, -0.64),
      ...box(0.3, 0.45, 1.45, -0.18, 0.64),
    ],
  },
  corvette: { scale: 2.1, triangles: [...diamond(0.42, 2.6), ...box(0.65, 0.35, 0.75, -0.65)] },
  frigate: { scale: 2.55, triangles: [...wedge(0.85, 0.5, 2.8), ...box(0.34, 0.38, 1.4, -0.55)] },
  cruiser: { scale: 3.1, triangles: [...wedge(1.4, 0.48, 2.8), ...box(0.34, 0.42, 0.65, -0.72)] },
  battleship: {
    scale: 3.8,
    triangles: [
      ...wedge(1.8, 0.58, 3.2),
      ...box(0.55, 0.52, 0.8, -0.85),
      ...box(0.22, 0.6, 0.28, -0.9),
    ],
  },
  battlestation: { scale: 4.8, triangles: station() },
  platform: { scale: 5.4, triangles: ringPlatform() },
};

const FALLBACK = { scale: 1.2, triangles: diamond(0.5, 1.8) };

const assignments = assignmentData as ShipModelAssignments;
const catalog = catalogData as ShipModelCatalog;
const importedModels = new Map<string, ShipModel>();
const modelIdByAlias = new Map<string, string>();
const modelIdByExactName = new Map<string, string>();
const partialAliases: Array<{ alias: string; modelId: string }> = [];
let importedModelLoad: Promise<number> | null = null;

export function normalizeShipIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

for (const model of catalog.models) {
  for (const value of [model.displayName, ...model.aliases]) {
    const alias = normalizeShipIdentity(value);
    const existing = modelIdByAlias.get(alias);
    if (existing && existing !== model.id) {
      throw new Error(
        `Ship-model alias "${value}" is assigned to both ${existing} and ${model.id}.`,
      );
    }
    modelIdByAlias.set(alias, model.id);
    if (
      !partialAliases.some(
        (candidate) => candidate.alias === alias && candidate.modelId === model.id,
      )
    ) {
      partialAliases.push({ alias, modelId: model.id });
    }
  }
}
const catalogModelIds = new Set(catalog.models.map((model) => model.id));
for (const [shipName, modelId] of Object.entries(assignments.exactNames)) {
  if (!catalogModelIds.has(modelId)) {
    throw new Error(`Named ship "${shipName}" references unknown model ${modelId}.`);
  }
  modelIdByExactName.set(normalizeShipIdentity(shipName), modelId);
}
for (const [category, modelId] of Object.entries(assignments.categoryFallbacks)) {
  if (!catalogModelIds.has(modelId)) {
    throw new Error(`Ship category "${category}" references unknown model ${modelId}.`);
  }
}

function containsNormalizedPhrase(value: string, phrase: string): boolean {
  return value === phrase || ` ${value} `.includes(` ${phrase} `);
}

function partialModelFor(value: string): { modelId: string; alias: string } | null {
  if (!value) return null;
  const matches = partialAliases
    .filter((candidate) => containsNormalizedPhrase(value, candidate.alias))
    .sort((left, right) => right.alias.length - left.alias.length);
  const best = matches[0];
  if (!best) return null;
  const ambiguous = matches.some(
    (candidate) =>
      candidate.alias.length === best.alias.length && candidate.modelId !== best.modelId,
  );
  return ambiguous ? null : best;
}

export function resolveConfiguredShipModel(
  category?: unknown,
  shipClass?: unknown,
  shipName?: unknown,
): ShipModelResolution | null {
  const normalizedName = normalizeShipIdentity(shipName);
  const normalizedClass = normalizeShipIdentity(shipClass);
  const normalizedCategory = normalizeShipIdentity(category);

  const explicitNameModel = modelIdByExactName.get(normalizedName);
  if (explicitNameModel) {
    return { modelId: explicitNameModel, match: "explicit-name", matchedValue: normalizedName };
  }

  const exactClassModel = modelIdByAlias.get(normalizedClass);
  if (exactClassModel) {
    return { modelId: exactClassModel, match: "exact-class", matchedValue: normalizedClass };
  }
  const exactNameModel = modelIdByAlias.get(normalizedName);
  if (exactNameModel) {
    return { modelId: exactNameModel, match: "exact-name", matchedValue: normalizedName };
  }

  const partialClassModel = partialModelFor(normalizedClass);
  if (partialClassModel) {
    return {
      modelId: partialClassModel.modelId,
      match: "partial-class",
      matchedValue: partialClassModel.alias,
    };
  }
  const partialNameModel = partialModelFor(normalizedName);
  if (partialNameModel) {
    return {
      modelId: partialNameModel.modelId,
      match: "partial-name",
      matchedValue: partialNameModel.alias,
    };
  }

  const categoryModel = assignments.categoryFallbacks[normalizedCategory];
  return categoryModel
    ? { modelId: categoryModel, match: "category-fallback", matchedValue: normalizedCategory }
    : null;
}

function runtimeAssetUrl(file: string): URL {
  return new URL(`ship-models/${file}`, document.baseURI);
}

export function loadImportedShipModels(): Promise<number> {
  if (importedModelLoad) return importedModelLoad;
  importedModelLoad = (async () => {
    try {
      const manifestResponse = await fetch(runtimeAssetUrl("manifest.json"));
      if (!manifestResponse.ok) return 0;
      const manifest = (await manifestResponse.json()) as ImportedShipManifest;
      if (manifest.version !== 1 || !Array.isArray(manifest.models)) return 0;
      let loaded = 0;
      for (const entry of manifest.models) {
        const response = await fetch(runtimeAssetUrl(entry.file));
        if (!response.ok) continue;
        const positions = new Float32Array(await response.arrayBuffer());
        if (positions.length % 9 !== 0) continue;
        const triangles: Vector3[] = [];
        for (let index = 0; index < positions.length; index += 3) {
          triangles.push([positions[index], positions[index + 1], positions[index + 2]]);
        }
        importedModels.set(entry.id, { id: entry.id, scale: entry.scale, triangles });
        loaded += 1;
      }
      return loaded;
    } catch {
      // Generated preview assets are optional. Procedural class models remain
      // available when the local import step has not been run.
      return 0;
    }
  })();
  return importedModelLoad;
}

export function importedShipModelIdFor(
  category?: unknown,
  shipClass?: unknown,
  shipName?: unknown,
): string | null {
  const resolution = resolveConfiguredShipModel(category, shipClass, shipName);
  if (resolution && importedModels.has(resolution.modelId)) return resolution.modelId;
  const fallbackId = assignments.categoryFallbacks[normalizeShipIdentity(category)];
  if (fallbackId && importedModels.has(fallbackId)) return fallbackId;
  return null;
}

export function configuredShipModelIdFor(
  shipClass?: unknown,
  shipName?: unknown,
  category?: unknown,
): string | null {
  return resolveConfiguredShipModel(category, shipClass, shipName)?.modelId ?? null;
}

export function shipModelFor(
  category: unknown,
  shipClass?: unknown,
  shipName?: unknown,
): ShipModel {
  const importedId = importedShipModelIdFor(category, shipClass, shipName);
  if (importedId) return importedModels.get(importedId) as ShipModel;
  return MODELS[String(category || "").toLowerCase()] ?? FALLBACK;
}

export function tacticalShipPixelsForScale(
  modelScale: number,
  minimumPixels = 24,
  maximumPixels = 72,
): number {
  return Math.min(maximumPixels, Math.max(minimumPixels, minimumPixels + (modelScale - 1) * 8));
}

export function tacticalShipPixelsForCategory(category: unknown): number {
  return tacticalShipPixelsForScale(shipModelFor(category).scale);
}
