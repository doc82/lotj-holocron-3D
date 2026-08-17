import type { SystemSnapshot } from "../types/telemetry";

export const MIN_HYPERSPACE_CLEARANCE = 500;
export const HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS = 15;

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
  for (const entity of snapshot?.entities || []) {
    if (!["ship", "planet", "celestial", "star"].includes(String(entity.kind || ""))) continue;
    if (entity.id === "player-ship") continue;
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
