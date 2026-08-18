import type { SystemSnapshot, TelemetryEntity, Vector3 } from "../types/telemetry";

export interface MotionSample {
  position: Vector3;
  observedAt: number;
}

export interface MotionTrack {
  id: string;
  name: string;
  previous?: MotionSample;
  current: MotionSample;
}

export type MotionTrackMap = Map<string, MotionTrack>;

export interface HyperspaceInterceptSolution {
  targetPosition: Vector3;
  observerPosition: Vector3;
  targetVelocity: Vector3;
  observerVelocity: Vector3;
  travelTime: number;
  distance: number;
  radarAge: number;
}

const positionOf = (entity: Pick<TelemetryEntity, "x" | "y" | "z">): Vector3 => [
  Number(entity.x) || 0,
  Number(entity.y) || 0,
  Number(entity.z) || 0,
];

const timestampSeconds = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 10_000_000_000 ? numeric / 1_000 : numeric;
};

function sourceTimestamp(snapshot: SystemSnapshot, source: "radar" | "ship_gmcp"): number {
  const sources = snapshot.metadata?.sources as Record<string, unknown> | undefined;
  return (
    timestampSeconds(sources?.[source]) ||
    timestampSeconds(snapshot.observedAt) ||
    Date.now() / 1_000
  );
}

function samePosition(left: Vector3, right: Vector3): boolean {
  return left.every((value, index) => value === right[index]);
}

/**
 * Retains the two newest authoritative fixes for each radar contact and the
 * observer. Repeated renderer publications from the same Mudlet capture do not
 * create false zero-duration samples.
 */
export function observeMotionTracks(
  tracks: MotionTrackMap,
  snapshot: SystemSnapshot | null,
): MotionTrackMap {
  if (!snapshot) return tracks;
  const observations: Array<{
    entity: TelemetryEntity;
    id: string;
    observedAt: number;
  }> = [];
  if (snapshot.observer) {
    observations.push({
      entity: snapshot.observer,
      id: "player-ship",
      observedAt: sourceTimestamp(snapshot, "ship_gmcp"),
    });
  }
  const radarObservedAt = sourceTimestamp(snapshot, "radar");
  for (const entity of snapshot.entities ?? []) {
    if (![entity.x, entity.y, entity.z].every((value) => Number.isFinite(Number(value)))) continue;
    observations.push({ entity, id: entity.id, observedAt: radarObservedAt });
  }

  let changed = false;
  const next = new Map(tracks);
  for (const observation of observations) {
    const current = next.get(observation.id);
    const position = positionOf(observation.entity);
    if (current && observation.observedAt <= current.current.observedAt) continue;
    const sample = { position, observedAt: observation.observedAt };
    next.set(observation.id, {
      id: observation.id,
      name: observation.entity.name || observation.id,
      previous: current?.current,
      current: sample,
    });
    changed =
      changed ||
      !current ||
      current.current.observedAt !== sample.observedAt ||
      !samePosition(current.current.position, sample.position);
  }
  return changed ? next : tracks;
}

export function velocityForTrack(track?: MotionTrack): Vector3 | null {
  if (!track?.previous) return null;
  const elapsed = track.current.observedAt - track.previous.observedAt;
  if (!(elapsed > 0)) return null;
  return track.current.position.map(
    (value, index) => (value - track.previous!.position[index]) / elapsed,
  ) as Vector3;
}

function projectRaw(track: MotionTrack, seconds: number, velocity: Vector3): Vector3 {
  return track.current.position.map(
    (value, index) => value + velocity[index] * Math.max(0, seconds),
  ) as Vector3;
}

export function projectMotionTrack(
  track: MotionTrack,
  seconds: number,
  velocity = velocityForTrack(track),
): Vector3 | null {
  if (!velocity) return null;
  return projectRaw(track, seconds, velocity).map(Math.ceil) as Vector3;
}

/** LOTJ local-jump time model used by the Rq8.Y flight computer. */
export function calculateHyperspaceTravelTime(
  distance: number,
  hyperspeed: number,
  navigator = false,
): number | null {
  const effectiveHyperspeed = Number(hyperspeed) * (navigator ? 1.3 : 1);
  if (!(effectiveHyperspeed > 0) || !Number.isFinite(distance)) return null;
  const rawTime = 6 + Math.max(0, distance) / (200 * effectiveHyperspeed);
  return Math.ceil(rawTime / 2) * 2 + 7;
}

/**
 * Iteratively solves the same distance/time feedback loop as Rq8.Y: age the
 * radar fix, project the target by the estimated jump duration, recompute LOTJ
 * jump time, and stop once the whole-second tick stabilizes.
 */
export function calculateHyperspaceIntercept({
  target,
  observer,
  hyperspeed,
  navigator = false,
  now = Date.now() / 1_000,
}: {
  target?: MotionTrack;
  observer?: MotionTrack;
  hyperspeed: number;
  navigator?: boolean;
  now?: number;
}): HyperspaceInterceptSolution | null {
  if (!target || !observer) return null;
  const targetVelocity = velocityForTrack(target);
  const observerVelocity = velocityForTrack(observer);
  if (!targetVelocity || !observerVelocity) return null;

  const radarAge = Math.max(0, now - target.current.observedAt);
  const observerAge = Math.max(0, now - observer.current.observedAt);
  const currentTarget = projectRaw(target, radarAge, targetVelocity);
  const currentObserver = projectRaw(observer, observerAge, observerVelocity);

  let travelTime = 8;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const targetPosition = projectRaw(target, radarAge + travelTime, targetVelocity);
    const distance = Math.hypot(
      targetPosition[0] - currentObserver[0],
      targetPosition[1] - currentObserver[1],
      targetPosition[2] - currentObserver[2],
    );
    const nextTravelTime = calculateHyperspaceTravelTime(distance, hyperspeed, navigator);
    if (nextTravelTime === null) return null;
    if (nextTravelTime === travelTime) {
      const observerPosition = projectRaw(observer, observerAge + travelTime, observerVelocity).map(
        Math.ceil,
      ) as Vector3;
      return {
        targetPosition: targetPosition.map(Math.ceil) as Vector3,
        observerPosition,
        targetVelocity,
        observerVelocity,
        travelTime,
        distance,
        radarAge,
      };
    }
    travelTime = nextTravelTime;
  }
  return null;
}
