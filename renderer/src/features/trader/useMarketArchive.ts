import { useEffect, useRef, useState } from "react";
import type { GalaxyCatalog, LogisticsState } from "../../types/telemetry";
import {
  emptyMarketArchive,
  loadMarketArchive,
  saveMarketArchive,
  mergeMarketArchive,
  marketObservations,
  observationId,
} from "./marketArchive";

export function useMarketArchive(logistics?: LogisticsState, catalog?: GalaxyCatalog | null) {
  const [archive, setArchive] = useState(emptyMarketArchive);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(emptyMarketArchive);
  const persisted = useRef("");
  const recorded = useRef(new Set<string>());
  const pending = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    loadMarketArchive()
      .then((stored) => {
        if (!active) return;
        current.current = stored;
        persisted.current = JSON.stringify(stored);
        setArchive(stored);
        setLoaded(true);
      })
      .catch(() => {
        if (active)
          setError(
            "Stored markets could not be loaded. Reopen the app to retry; existing data has not been overwritten.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const next = mergeMarketArchive(current.current, logistics, catalog);
    const fingerprint = JSON.stringify(next);
    const observations = marketObservations(logistics).filter(
      (market) => !recorded.current.has(observationId(market)),
    );
    if (fingerprint === persisted.current && observations.length === 0) return;
    current.current = next;
    setArchive(next);
    pending.current = pending.current.then(async () => {
      try {
        await saveMarketArchive(next, observations);
        observations.forEach((market) => recorded.current.add(observationId(market)));
        persisted.current = fingerprint;
        setError(null);
      } catch {
        setError(
          "Market history could not be saved on this device. Current prices remain available in memory; check available storage.",
        );
      }
    });
  }, [loaded, logistics, catalog]);
  return { archive, error, loaded };
}
