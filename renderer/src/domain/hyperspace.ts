import type { SystemSnapshot } from "../types/telemetry";

export const MIN_HYPERSPACE_CLEARANCE = 500;
export const HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS = 15;
export const SECTOR_COORDINATE_LIMIT = 50_000;

export type SectorPoint = readonly [number, number, number];

export function clampSectorCoordinate(value: number): number {
  const finiteValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.max(
    -SECTOR_COORDINATE_LIMIT,
    Math.min(SECTOR_COORDINATE_LIMIT, Math.round(finiteValue)),
  );
}

function randomUnit(random: () => number): number {
  const value = Number(random());
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
}

export function sectorDistance(left: SectorPoint, right: SectorPoint): number {
  return Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
}

export function randomSectorDestinationBeyond(
  origin: SectorPoint,
  requestedMinimumDistance: number,
  random: () => number = Math.random,
): [number, number, number] {
  const center = origin.map(clampSectorCoordinate) as [number, number, number];
  const minimumDistance = Math.max(
    MIN_HYPERSPACE_CLEARANCE,
    Number.isFinite(requestedMinimumDistance) ? Math.round(requestedMinimumDistance) : 0,
  );
  const radialSpan = Math.max(MIN_HYPERSPACE_CLEARANCE, minimumDistance);

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const azimuth = randomUnit(random) * Math.PI * 2;
    const vertical = randomUnit(random) * 2 - 1;
    const horizontal = Math.sqrt(Math.max(0, 1 - vertical * vertical));
    const distance = minimumDistance + 2 + randomUnit(random) * radialSpan;
    const candidate: [number, number, number] = [
      Math.round(center[0] + Math.cos(azimuth) * horizontal * distance),
      Math.round(center[1] + vertical * distance),
      Math.round(center[2] + Math.sin(azimuth) * horizontal * distance),
    ];
    if (
      candidate.every((coordinate) => Math.abs(coordinate) <= SECTOR_COORDINATE_LIMIT) &&
      sectorDistance(center, candidate) > minimumDistance
    ) {
      return candidate;
    }
  }

  const corners = [-SECTOR_COORDINATE_LIMIT, SECTOR_COORDINATE_LIMIT].flatMap((x) =>
    [-SECTOR_COORDINATE_LIMIT, SECTOR_COORDINATE_LIMIT].flatMap((y) =>
      [-SECTOR_COORDINATE_LIMIT, SECTOR_COORDINATE_LIMIT].map(
        (z) => [x, y, z] as [number, number, number],
      ),
    ),
  );
  const fallback = corners.reduce((furthest, candidate) =>
    sectorDistance(center, candidate) > sectorDistance(center, furthest) ? candidate : furthest,
  );
  const maximumDistance = sectorDistance(center, fallback);
  const distance = Math.min(maximumDistance, minimumDistance + 2 + randomUnit(random) * radialSpan);
  return fallback.map((coordinate, index) =>
    clampSectorCoordinate(
      center[index] + ((coordinate - center[index]) / maximumDistance) * distance,
    ),
  ) as [number, number, number];
}

export function hyperspaceDestinationMarkerSize(distance: number): number {
  const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
  return Math.round(Math.min(56, 26 + Math.sqrt(safeDistance / 1_000) * 3));
}

export interface HyperspaceClearance {
  known: boolean;
  allowed: boolean;
  nearestDistance?: number;
  nearestName?: string;
  reason?: string;
}

export interface ReachabilityReading {
  system: string;
  distanceParsecs: number;
  reachable: boolean;
}

export interface GalaxyCoordinate {
  x: number;
  y: number;
}

export function galacticDistance(left: GalaxyCoordinate, right: GalaxyCoordinate): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function hyperspaceClearance(
  snapshot: SystemSnapshot | null,
  nowSeconds = Date.now() / 1000,
  exemptShipNames: Iterable<string> = [],
): HyperspaceClearance {
  const observer = snapshot?.observer;
  const ox = Number(observer?.x);
  const oy = Number(observer?.y);
  const oz = Number(observer?.z);
  const sources = snapshot?.metadata?.sources as Record<string, unknown> | undefined;
  const spatialObservedAt = Math.max(Number(sources?.radar) || 0, Number(sources?.fleetradar) || 0);
  if (
    ![ox, oy, oz].every(Number.isFinite) ||
    spatialObservedAt <= 0 ||
    nowSeconds - spatialObservedAt > HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS
  ) {
    return { known: false, allowed: false, reason: "Fresh radar clearance is required" };
  }

  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestName: string | undefined;
  const exemptNames = new Set(
    [...exemptShipNames].map((name) => String(name).trim().toLowerCase()).filter(Boolean),
  );
  for (const entity of snapshot?.entities || []) {
    if (!["ship", "planet", "celestial", "star"].includes(String(entity.kind || ""))) continue;
    if (entity.id === "player-ship") continue;
    if (
      entity.kind === "ship" &&
      exemptNames.has(
        String(entity.name || "")
          .trim()
          .toLowerCase(),
      )
    )
      continue;
    const x = Number(entity.x);
    const y = Number(entity.y);
    const z = Number(entity.z);
    if (![x, y, z].every(Number.isFinite)) continue;
    const distance = Math.hypot(x - ox, y - oy, z - oz);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestName = entity.name || entity.id;
    }
  }

  if (nearestDistance < MIN_HYPERSPACE_CLEARANCE) {
    return {
      known: true,
      allowed: false,
      nearestDistance,
      nearestName,
      reason: `${nearestName || "Object"} is only ${Math.round(nearestDistance)} units away`,
    };
  }
  return {
    known: true,
    allowed: true,
    nearestDistance: Number.isFinite(nearestDistance) ? nearestDistance : undefined,
    nearestName,
  };
}

export function conservativeJumpRange(destinations: ReachabilityReading[]): number | null {
  const reachable = destinations
    .filter((destination) => destination.reachable && destination.distanceParsecs > 0)
    .map((destination) => destination.distanceParsecs);
  return reachable.length > 0 ? Math.max(...reachable) : null;
}

export function escapeDestinationInRange(
  origin: GalaxyCoordinate,
  destination: GalaxyCoordinate,
  destinations: ReachabilityReading[],
  knownSystemName?: string,
  requireAuthoritativeListing = false,
): { allowed: boolean; distance: number; reason?: string } {
  const distance = galacticDistance(origin, destination);
  const knownReading = knownSystemName
    ? destinations.find((reading) => reading.system === knownSystemName)
    : undefined;
  if (knownReading?.reachable === false) {
    return { allowed: false, distance, reason: `${knownSystemName} is out of range` };
  }
  if (requireAuthoritativeListing && !knownReading) {
    return {
      allowed: false,
      distance,
      reason: "Reachability has not been confirmed by the nav computer",
    };
  }
  const safeRange = conservativeJumpRange(destinations);
  if (safeRange === null) {
    return {
      allowed: false,
      distance,
      reason: "Run CALC to establish the ship's hyperspace range",
    };
  }
  if (distance > safeRange + 0.05) {
    return {
      allowed: false,
      distance,
      reason: `Escape destination is ${distance.toFixed(1)} pc away; confirmed range is ${safeRange.toFixed(1)} pc`,
    };
  }
  return { allowed: true, distance };
}
