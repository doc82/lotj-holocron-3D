import { useCallback, useState } from "react";

import {
  HYPERSPACE_HISTORY_STORAGE_KEY,
  MAX_HYPERSPACE_HISTORY_ENTRIES,
  parseHyperspaceHistory,
  sanitizeHyperspaceHistoryEntry,
  serializeHyperspaceHistory,
  type HyperspaceHistoryDraft,
  type HyperspaceHistoryEntry,
} from "../../domain/hyperspaceHistory";

const makeId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `jump-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function loadHistory(): HyperspaceHistoryEntry[] {
  try {
    return parseHyperspaceHistory(window.localStorage.getItem(HYPERSPACE_HISTORY_STORAGE_KEY));
  } catch {
    return [];
  }
}

function persistHistory(entries: HyperspaceHistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      HYPERSPACE_HISTORY_STORAGE_KEY,
      serializeHyperspaceHistory(entries),
    );
  } catch {
    // Calibration remains available for this session when persistence is unavailable.
  }
}

export function useHyperspaceHistory() {
  const [entries, setEntries] = useState<HyperspaceHistoryEntry[]>(loadHistory);

  const add = useCallback((draft: HyperspaceHistoryDraft) => {
    const entry = sanitizeHyperspaceHistoryEntry({ ...draft, id: makeId() });
    if (!entry) return false;
    setEntries((current) => {
      const next = [entry, ...current].slice(0, MAX_HYPERSPACE_HISTORY_ENTRIES);
      persistHistory(next);
      return next;
    });
    return true;
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((current) => {
      const next = current.filter((entry) => entry.id !== id);
      persistHistory(next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
    try {
      window.localStorage.removeItem(HYPERSPACE_HISTORY_STORAGE_KEY);
    } catch {
      // The in-memory history is still cleared.
    }
  }, []);

  return { entries, add, remove, clear } as const;
}
