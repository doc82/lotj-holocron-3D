import assignmentManifest from "./planetTextureAssignments.json" with { type: "json" };

const TERRAIN_NAMES = [
  "desert",
  "exotic",
  "gas-giant",
  "ice",
  "oceanic",
  "terran",
  "urban",
  "volcanic",
] as const;

export type PlanetTerrain = (typeof TERRAIN_NAMES)[number];
export type PlanetTextureKey = (typeof assignmentManifest.assignments)[number]["textureKey"];

export interface PlanetTextureAssignment {
  planet: string;
  textureKey: PlanetTextureKey;
  terrain: PlanetTerrain;
}

export interface PlanetVisual {
  textureKey?: PlanetTextureKey;
  terrain: PlanetTerrain;
  textureUrl?: string;
  normalUrl?: string;
  palette: readonly [string, string, string];
  exact: boolean;
}

const TEXTURE_ROOT = "./planet-textures";

export const PLANET_TEXTURE_ASSIGNMENTS =
  assignmentManifest.assignments as readonly PlanetTextureAssignment[];

const PALETTES: Record<PlanetTerrain, readonly [string, string, string]> = {
  desert: ["#9b6536", "#d9b06f", "#3e2519"],
  exotic: ["#244936", "#8c9c55", "#172a31"],
  "gas-giant": ["#8e604a", "#d9bb91", "#372838"],
  ice: ["#668b9d", "#d9eff4", "#1b3447"],
  oceanic: ["#0e4770", "#50a8be", "#10284f"],
  terran: ["#1f563e", "#65956c", "#183c62"],
  urban: ["#343c53", "#d5aa61", "#090c14"],
  volcanic: ["#201719", "#f06127", "#641614"],
};

const FALLBACK_TERRAINS = ["terran", "desert", "oceanic", "ice", "volcanic", "exotic"] as const;

export function normalizePlanetName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ASSIGNMENTS_BY_NAME = new Map(
  PLANET_TEXTURE_ASSIGNMENTS.map((assignment) => [
    normalizePlanetName(assignment.planet),
    assignment,
  ]),
);

for (const [alias, canonicalName] of Object.entries(assignmentManifest.aliases)) {
  const assignment = ASSIGNMENTS_BY_NAME.get(normalizePlanetName(canonicalName));
  if (assignment) ASSIGNMENTS_BY_NAME.set(normalizePlanetName(alias), assignment);
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return Math.abs(result >>> 0);
}

export function planetVisual(name: string): PlanetVisual {
  const normalized = normalizePlanetName(name);
  const assignment = ASSIGNMENTS_BY_NAME.get(normalized);
  const terrain =
    assignment?.terrain || FALLBACK_TERRAINS[hash(normalized) % FALLBACK_TERRAINS.length];

  return {
    textureKey: assignment?.textureKey,
    terrain,
    textureUrl: assignment ? `${TEXTURE_ROOT}/${assignment.textureKey}.webp` : undefined,
    normalUrl: assignment ? `${TEXTURE_ROOT}/${assignment.textureKey}-normal.webp` : undefined,
    palette: PALETTES[terrain],
    exact: Boolean(assignment),
  };
}
