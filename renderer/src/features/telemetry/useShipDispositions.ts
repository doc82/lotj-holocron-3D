import { useCallback, useEffect, useRef, useState } from "react";

import { dispositionKey } from "../../domain/tacticalWorkspace";
import type { ScenePoint } from "../../domain/scene";
import type { ShipDisposition, SystemSnapshot } from "../../types/telemetry";

const STORAGE_KEY = "holocron3d.ship-dispositions.v1";

function loadDispositions(): Record<string, ShipDisposition> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function useShipDispositions(connected: boolean, snapshot: SystemSnapshot | null) {
  const [dispositions, setDispositions] =
    useState<Record<string, ShipDisposition>>(loadDispositions);
  const syncedRef = useRef(new Map<string, ShipDisposition>());

  const persist = useCallback((name: string, disposition: ShipDisposition) => {
    const key = dispositionKey(name);
    setDispositions((current) => {
      const next = { ...current, [key]: disposition };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    syncedRef.current.set(key, disposition);
  }, []);

  const setDisposition = useCallback(
    (point: ScenePoint, disposition: ShipDisposition) => {
      persist(point.name, disposition);
      void window.holocron?.sendIntent("set_ship_disposition", {
        name: point.name,
        disposition,
      });
    },
    [persist],
  );

  const markEnemy = useCallback((name: string) => persist(name, "enemy"), [persist]);

  useEffect(() => {
    const hostileNames = (snapshot?.entities ?? [])
      .filter((entity) => entity.kind === "ship" && entity.disposition === "enemy")
      .map((entity) => entity.name || entity.id);
    if (hostileNames.length === 0) return;
    setDispositions((current) => {
      let changed = false;
      const next = { ...current };
      for (const name of hostileNames) {
        const key = dispositionKey(name);
        if (next[key] !== "enemy") changed = true;
        next[key] = "enemy";
        syncedRef.current.set(key, "enemy");
      }
      if (!changed) return current;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [snapshot]);

  useEffect(() => {
    if (!connected) {
      syncedRef.current.clear();
      return;
    }
    for (const entity of snapshot?.entities ?? []) {
      if (entity.kind !== "ship") continue;
      const name = entity.name || entity.id;
      const key = dispositionKey(name);
      if (entity.disposition === "enemy") {
        syncedRef.current.set(key, "enemy");
        continue;
      }
      const disposition = dispositions[key];
      if (!disposition || syncedRef.current.get(key) === disposition) continue;
      syncedRef.current.set(key, disposition);
      void window.holocron?.sendIntent("set_ship_disposition", { name, disposition });
    }
  }, [connected, dispositions, snapshot]);

  return { dispositions, setDisposition, markEnemy } as const;
}
