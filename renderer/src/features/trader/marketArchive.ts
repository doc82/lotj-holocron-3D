import type { GalaxyCatalog, LogisticsMarket, LogisticsState } from "../../types/telemetry";

export interface MarketArchive {
  version: 1;
  logistics: LogisticsState;
  catalog: GalaxyCatalog | null;
}
export const emptyMarketArchive: MarketArchive = { version: 1, logistics: {}, catalog: null };
export function marketObservations(logistics?: LogisticsState): LogisticsMarket[] {
  return [
    ...Object.values(logistics?.markets ?? {}),
    ...(logistics?.market ? [logistics.market] : []),
  ].filter(
    (market) =>
      typeof market.planet === "string" &&
      market.planet.trim() &&
      Number.isFinite(market.observedAt) &&
      market.observedAt! > 0 &&
      market.resources &&
      Object.keys(market.resources).length > 0 &&
      Object.values(market.resources).every((price) => Number.isFinite(price) && price >= 0),
  );
}
export function mergeMarketArchive(
  previous: MarketArchive,
  incoming?: LogisticsState,
  catalog?: GalaxyCatalog | null,
): MarketArchive {
  const markets = { ...previous.logistics.markets };
  for (const market of marketObservations(incoming)) {
    const id = market.planet!.trim().toLowerCase();
    if ((markets[id]?.observedAt ?? 0) <= market.observedAt!) markets[id] = market;
  }
  const old = previous.logistics;
  return {
    version: 1,
    catalog: catalog ?? previous.catalog,
    logistics: {
      markets,
      planets: incoming?.planets ?? old.planets,
      clans: incoming?.clans ?? old.clans,
      clansObservedAt: incoming?.clansObservedAt ?? old.clansObservedAt,
      hyperlanes:
        (incoming?.hyperlanesObservedAt ?? 0) >= (old.hyperlanesObservedAt ?? 0)
          ? (incoming?.hyperlanes ?? old.hyperlanes)
          : old.hyperlanes,
      hyperlanesObservedAt: Math.max(
        incoming?.hyperlanesObservedAt ?? 0,
        old.hyperlanesObservedAt ?? 0,
      ),
    },
  };
}
export function observationId(market: LogisticsMarket): string {
  return JSON.stringify([
    market.planet!.trim().toLowerCase(),
    market.observedAt,
    market.taxRate,
    Object.entries(market.resources!).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
function openArchive(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("holocron3d.market-history", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("state");
      const observations = db.createObjectStore("observations", { keyPath: "id" });
      observations.createIndex("planet", "planetKey");
      observations.createIndex("observedAt", "observedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Market database is blocked by another app window."));
  });
}
export async function loadMarketArchive(): Promise<MarketArchive> {
  const db = await openArchive();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("state").objectStore("state").get("latest");
      request.onsuccess = () =>
        resolve(request.result?.version === 1 ? request.result : emptyMarketArchive);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function saveMarketArchive(
  archive: MarketArchive,
  observations: LogisticsMarket[],
): Promise<void> {
  const db = await openArchive();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(["state", "observations"], "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      transaction.objectStore("state").put(archive, "latest");
      for (const market of observations)
        transaction.objectStore("observations").put({
          ...market,
          id: observationId(market),
          planetKey: market.planet!.trim().toLowerCase(),
        });
    });
  } finally {
    db.close();
  }
}
