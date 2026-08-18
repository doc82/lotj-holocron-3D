export const HYPERSPACE_HISTORY_STORAGE_KEY = "holocron3d.hyperspace-history.v1";
export const HYPERSPACE_HISTORY_VERSION = 1;
export const MAX_HYPERSPACE_HISTORY_ENTRIES = 200;

export type HyperspaceHistorySource = "observed" | "manual";

export interface HyperspaceHistoryEntry {
  id: string;
  completedAt: number;
  mode: "local" | "galactic";
  distance: number;
  hyperspeed: number;
  navigatorApplied: boolean;
  calculationSeconds?: number;
  flightSeconds: number;
  source: HyperspaceHistorySource;
}

export type HyperspaceHistoryDraft = Omit<HyperspaceHistoryEntry, "id">;
export type HyperspaceHistorySortKey =
  | "completedAt"
  | "distance"
  | "hyperspeed"
  | "navigatorApplied"
  | "normalizedLoad"
  | "calculationSeconds"
  | "flightSeconds"
  | "totalSeconds";

interface StoredHyperspaceHistory {
  version: number;
  entries: HyperspaceHistoryEntry[];
}

const finite = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function effectiveHyperspeed(
  entry: Pick<HyperspaceHistoryEntry, "hyperspeed" | "navigatorApplied">,
): number {
  return entry.hyperspeed * (entry.navigatorApplied ? 1.3 : 1);
}

export function normalizedHyperspaceLoad(
  entry: Pick<HyperspaceHistoryEntry, "distance" | "hyperspeed" | "navigatorApplied">,
): number {
  const rating = effectiveHyperspeed(entry);
  return rating > 0 ? entry.distance / rating : Number.POSITIVE_INFINITY;
}

export function sanitizeHyperspaceHistoryEntry(value: unknown): HyperspaceHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HyperspaceHistoryEntry>;
  const completedAt = finite(candidate.completedAt);
  const distance = finite(candidate.distance);
  const hyperspeed = finite(candidate.hyperspeed);
  const calculationSeconds =
    candidate.calculationSeconds === undefined ? undefined : finite(candidate.calculationSeconds);
  const flightSeconds = finite(candidate.flightSeconds);
  if (
    !candidate.id ||
    completedAt === null ||
    completedAt <= 0 ||
    distance === null ||
    distance < 0 ||
    hyperspeed === null ||
    hyperspeed <= 0 ||
    flightSeconds === null ||
    flightSeconds <= 0 ||
    calculationSeconds === null ||
    (calculationSeconds !== undefined && calculationSeconds < 0)
  )
    return null;
  return {
    id: String(candidate.id),
    completedAt,
    mode: candidate.mode === "galactic" ? "galactic" : "local",
    distance,
    hyperspeed,
    navigatorApplied: candidate.navigatorApplied === true,
    calculationSeconds,
    flightSeconds,
    source: candidate.source === "manual" ? "manual" : "observed",
  };
}

export function parseHyperspaceHistory(raw: string | null): HyperspaceHistoryEntry[] {
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as Partial<StoredHyperspaceHistory>;
    if (stored.version !== HYPERSPACE_HISTORY_VERSION || !Array.isArray(stored.entries)) return [];
    return stored.entries
      .flatMap((entry) => {
        const sanitized = sanitizeHyperspaceHistoryEntry(entry);
        return sanitized ? [sanitized] : [];
      })
      .slice(0, MAX_HYPERSPACE_HISTORY_ENTRIES);
  } catch {
    return [];
  }
}

export function serializeHyperspaceHistory(entries: HyperspaceHistoryEntry[]): string {
  return JSON.stringify({
    version: HYPERSPACE_HISTORY_VERSION,
    entries: entries.slice(0, MAX_HYPERSPACE_HISTORY_ENTRIES),
  } satisfies StoredHyperspaceHistory);
}

function sortValue(entry: HyperspaceHistoryEntry, key: HyperspaceHistorySortKey): number {
  if (key === "normalizedLoad") return normalizedHyperspaceLoad(entry);
  if (key === "totalSeconds") return (entry.calculationSeconds ?? 0) + entry.flightSeconds;
  if (key === "navigatorApplied") return entry.navigatorApplied ? 1 : 0;
  if (key === "calculationSeconds") return entry.calculationSeconds ?? -1;
  return entry[key];
}

export function sortHyperspaceHistory(
  entries: HyperspaceHistoryEntry[],
  key: HyperspaceHistorySortKey,
  direction: "asc" | "desc",
): HyperspaceHistoryEntry[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...entries].sort(
    (left, right) =>
      (sortValue(left, key) - sortValue(right, key)) * multiplier ||
      left.id.localeCompare(right.id),
  );
}
