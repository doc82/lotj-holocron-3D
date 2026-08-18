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
  samples?: MotionSample[];
}

export type MotionTrackMap = Map<string, MotionTrack>;

export const MOTION_TRACK_SAMPLE_LIMIT = 6;
export const MOTION_TRACK_RESET_SECONDS = 30;
export const HYPERSPACE_REPLOT_THRESHOLD_UNITS = 50;

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
    const existingSamples = current?.samples?.length
      ? current.samples
      : current?.previous
        ? [current.previous, current.current]
        : current
          ? [current.current]
          : [];
    const samples =
      current && observation.observedAt - current.current.observedAt <= MOTION_TRACK_RESET_SECONDS
        ? [...existingSamples, sample].slice(-MOTION_TRACK_SAMPLE_LIMIT)
        : [sample];
    next.set(observation.id, {
      id: observation.id,
      name: observation.entity.name || observation.id,
      previous: samples.length > 1 ? samples[samples.length - 2] : undefined,
      current: sample,
      samples,
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
  if (!track) return null;
  const samples = track.samples?.length
    ? track.samples
    : track.previous
      ? [track.previous, track.current]
      : [];
  if (samples.length < 2) return null;

  // Least-squares velocity uses every recent authoritative fix. Additional
  // radar hits therefore smooth small coordinate/timing errors instead of
  // replacing the heading with only the newest two-point measurement.
  const originTime = samples[0].observedAt;
  const times = samples.map((sample) => sample.observedAt - originTime);
  const meanTime = times.reduce((sum, value) => sum + value, 0) / times.length;
  const denominator = times.reduce((sum, value) => sum + (value - meanTime) ** 2, 0);
  if (!(denominator > 0)) return null;
  return [0, 1, 2].map((axis) => {
    const meanPosition =
      samples.reduce((sum, sample) => sum + sample.position[axis], 0) / samples.length;
    return (
      samples.reduce(
        (sum, sample, index) =>
          sum + (times[index] - meanTime) * (sample.position[axis] - meanPosition),
        0,
      ) / denominator
    );
  }) as Vector3;
}

export function hyperspaceReplotRequired(
  previous: Vector3,
  next: Vector3,
  threshold = HYPERSPACE_REPLOT_THRESHOLD_UNITS,
): boolean {
  return Math.hypot(...next.map((value, index) => value - previous[index])) > threshold;
}

function projectRaw(track: MotionTrack, seconds: number, velocity: Vector3): Vector3 {
  return track.current.position.map(
    (value, index) => value + velocity[index] * Math.max(0, seconds),
  ) as Vector3;
}

/**
 * The single provisional travel-time estimator used by live interception.
 *
 * Nothing persisted by Holocron feeds back into this function. The constants
 * are only a baseline while we collect current-LOTJ observations; they must
 * not be treated as a description of the game's present server code. Keeping
 * the estimate isolated here lets us replace the baseline from measured jump
 * logs without changing the interception solver.
 */
export const HYPERSPACE_TRAVEL_TIME_MODEL = "provisional-v1";

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
 * Solves the distance/time feedback loop for a moving target: age the radar
 * fix, project the target by the estimated jump duration, recompute that
 * duration for the new distance, and stop once the whole-second estimate is
 * stable. The loop depends only on calculateHyperspaceTravelTime above.
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
  const currentObserver = projectRaw(observer, observerAge, observerVelocity);

  // This is a fixed-point problem rather than a one-pass calculation:
  //
  //   assumed travel time -> predicted target position -> jump distance
  //   -> recalculated travel time
  //
  // Start with a small seed estimate, then feed each result back into the next
  // target projection. Ten iterations is a defensive cap;
  // ordinary solutions stabilize in only a few passes, while the cap prevents
  // malformed or oscillating telemetry from keeping the renderer busy.
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

    // The travel-time model is quantized to discrete ticks. Once recalculating
    // from the projected destination produces the same tick, another pass
    // would project the same position and distance, so the solution is stable.
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
