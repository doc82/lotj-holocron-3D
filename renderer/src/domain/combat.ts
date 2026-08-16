import type { CombatEvent, ShipDestructionEvent, Vector3, WeaponType } from "../types/telemetry";

export interface CombatVisualPoint {
  name: string;
  kind: string;
  position3d: Vector3;
  heading?: { x?: number; y?: number; z?: number };
  members?: CombatVisualPoint[];
}

export interface CombatVisualEffect {
  id: number;
  type: "projectile" | "launch" | "impact";
  weapon: WeaponType;
  targetName: string;
  start: number;
  duration: number;
  from: Vector3;
  to: Vector3;
  outcome?: "hit" | "miss";
}

export interface CombatVisualStyle {
  impactRadius: number;
  pointSize: number;
  opacity: number;
  trailFraction: number;
}

export interface DestructionVisualEffect {
  id: number;
  shipName: string;
  start: number;
  duration: number;
  origin: Vector3;
}

function pointByName(points: CombatVisualPoint[], name?: string): CombatVisualPoint | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  for (const point of points) {
    if (point.name.trim().toLowerCase() === wanted) return point;
    const member = point.members?.find(
      (candidate) => candidate.name.trim().toLowerCase() === wanted,
    );
    if (member) return member;
  }
  return null;
}

const boundedCount = (count: unknown): number => Math.max(1, Math.min(12, Number(count) || 1));

export function combatVisualStyle(
  effect: Pick<CombatVisualEffect, "weapon" | "outcome">,
): CombatVisualStyle {
  if (effect.outcome === "miss")
    return {
      impactRadius: 4,
      pointSize: 4,
      opacity: 0.32,
      trailFraction: 0.045,
    };
  const explosive = ["missile", "torpedo", "rocket", "burst"].includes(effect.weapon);
  return {
    impactRadius: explosive ? 38 : 24,
    pointSize: explosive ? 26 : 18,
    opacity: 1,
    trailFraction: 0.13,
  };
}

export function planCombatEvent(
  event: CombatEvent,
  points: CombatVisualPoint[],
  now: number,
): CombatVisualEffect[] {
  if (event.type === "charged" || event.type === "failure") return [];
  const effects: CombatVisualEffect[] = [];
  const target = pointByName(points, event.targetName);
  const observer = points.find((point) => point.kind === "observer") ?? null;

  if (event.type === "launch") {
    const projectile = ["missile", "torpedo", "rocket", "burst"].includes(event.weapon);
    const namedSource = pointByName(points, event.sourceName);
    const sourceIsObserver = Boolean(
      event.sourceName &&
      observer &&
      event.sourceName.trim().toLowerCase() === observer.name.trim().toLowerCase(),
    );
    const source = namedSource ?? (!event.sourceName || sourceIsObserver ? observer : null);
    if (!source || (!projectile && !target)) return [];
    const sourcePosition: Vector3 = [...source.position3d];
    const headingVector: Vector3 = [
      Number(source.heading?.x) || 0,
      Number(source.heading?.y) || 0,
      Number(source.heading?.z) || 0,
    ];
    if (Math.hypot(...headingVector) < 0.001) headingVector[2] = 1;
    const launchDirectionTarget: Vector3 = target
      ? [...target.position3d]
      : (sourcePosition.map(
          (coordinate, index) => coordinate + headingVector[index] * 100,
        ) as Vector3);
    for (let index = 0; index < boundedCount(event.count); index += 1) {
      effects.push({
        id: event.id * 100 + index,
        type: projectile ? "launch" : "projectile",
        weapon: event.weapon,
        targetName: target?.name || event.targetName || "",
        start: now + index * 85,
        duration: projectile ? 460 : 1_100,
        from: [...sourcePosition],
        to: projectile ? [...launchDirectionTarget] : [...(target?.position3d ?? [0, 0, 0])],
      });
    }
    return effects;
  }

  if (!target) return [];
  const source = pointByName(points, event.sourceName);
  const sourceIsObserver = Boolean(
    event.sourceName &&
    observer &&
    event.sourceName.trim().toLowerCase() === observer.name.trim().toLowerCase(),
  );
  const remoteSource =
    source &&
    !sourceIsObserver &&
    Math.hypot(...source.position3d.map((value, index) => value - target.position3d[index])) > 0.001
      ? source
      : null;
  const inboundDuration = remoteSource ? 420 : 0;
  const confirmedHits = boundedCount(event.count);
  if (remoteSource) {
    for (let index = 0; index < confirmedHits; index += 1) {
      effects.push({
        id: event.id * 1_000 + index * 2,
        type: "projectile",
        weapon: event.weapon,
        targetName: target.name,
        start: now + index * 85,
        duration: inboundDuration,
        from: [...remoteSource.position3d],
        to: [...target.position3d],
        outcome: event.outcome,
      });
    }
  }
  for (let index = 0; index < confirmedHits; index += 1) {
    effects.push({
      id: event.id * 1_000 + index * 2 + 1,
      type: "impact",
      weapon: event.weapon,
      targetName: target.name,
      start: now + inboundDuration + index * 85,
      duration: event.outcome === "miss" ? 340 : 780,
      from: [...(remoteSource?.position3d ?? observer?.position3d ?? [0, 0, 0])],
      to: [...target.position3d],
      outcome: event.outcome,
    });
  }
  return effects;
}

export function planDestructionEvent(
  event: ShipDestructionEvent,
  points: CombatVisualPoint[],
  originOffset: Vector3,
  now: number,
): DestructionVisualEffect | null {
  if (!event.id || event.phase !== "destroyed") return null;
  const coordinates = [event.x, event.y, event.z];
  const hasWorldPosition = coordinates.every((value) => Number.isFinite(Number(value)));
  const point = pointByName(points, event.shipName);
  if (!hasWorldPosition && !point) return null;
  const origin = hasWorldPosition
    ? (coordinates.map((value, index) => Number(value) + originOffset[index]) as Vector3)
    : ([...point!.position3d] as Vector3);
  return {
    id: event.id,
    shipName: event.shipName,
    start: now,
    duration: 2_400,
    origin,
  };
}
