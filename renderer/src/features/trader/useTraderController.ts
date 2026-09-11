import { useCallback, useEffect, useRef, useState } from "react";

import { useRouteAutopilot } from "../autopilot/useRouteAutopilot";
import { cargoRouteTitle, type CargoRoute } from "../../domain/cargoRoutes";
import type {
  GalaxyCatalog,
  LogisticsState,
  LogisticsMarket,
  SystemSnapshot,
} from "../../types/telemetry";
import {
  EMPTY_TRADER_CONFIG,
  readTraderConfig,
  upsertShip,
  removeShip,
  upsertPad,
  savedRouteId,
  type TraderConfigState,
  type TraderPadConfig,
  type TraderShipConfig,
} from "./traderConfig";

const CONFIG_KEY = "holocron3d.trader.config";

export function useTraderController(
  connected: boolean,
  snapshot: SystemSnapshot | null,
  catalog?: GalaxyCatalog | null,
  logistics?: LogisticsState,
) {
  const [config, setConfig] = useState<TraderConfigState>(() => {
    try {
      return readTraderConfig(JSON.parse(window.localStorage.getItem(CONFIG_KEY) ?? "null"));
    } catch {
      return EMPTY_TRADER_CONFIG;
    }
  });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const refreshIntentIds = useRef(new Set<string>());

  const refreshMarkets = useCallback(async () => {
    if (!connected) return;
    setRefreshError(null);
    try {
      const result = await window.holocron?.sendIntent("refresh_logistics");
      if (!result?.accepted)
        setRefreshError(result?.reason ?? "Could not start logistics refresh.");
      else if (result.id) refreshIntentIds.current.add(result.id);
    } catch {
      setRefreshError("Could not start logistics refresh. Check the connection and retry.");
    }
  }, [connected]);

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (!ack.id || !refreshIntentIds.current.has(ack.id) || ack.status === "accepted") return;
        refreshIntentIds.current.delete(ack.id);
        if (ack.status === "rejected") setRefreshError(ack.reason ?? "Logistics refresh failed.");
      }),
    [],
  );

  const { execution, armRoute, pauseRoute, resumeRoute, abortRoute, clearRoute, autopilotError } =
    useRouteAutopilot(connected, snapshot, config, catalog, logistics);

  const [storageError, setStorageError] = useState<string | null>(null);
  const addShip = useCallback(
    (ship: TraderShipConfig) => setConfig((current) => upsertShip(current, ship)),
    [],
  );
  const deleteShip = useCallback(
    (id: string) => setConfig((current) => removeShip(current, id)),
    [],
  );
  const selectShip = useCallback(
    (id: string) =>
      setConfig((current) =>
        current.ships.some((ship) => ship.id === id) ? { ...current, selectedShipId: id } : current,
      ),
    [],
  );
  const addPad = useCallback(
    (pad: TraderPadConfig, previousPlanet?: string) =>
      setConfig((current) => upsertPad(current, pad, previousPlanet)),
    [],
  );
  const deletePad = useCallback(
    (planet: string) =>
      setConfig((current) => ({
        ...current,
        pads: current.pads.filter((pad) => pad.planet !== planet),
      })),
    [],
  );
  const saveRoute = useCallback(
    (route: CargoRoute, name?: string, marketSnapshot?: LogisticsMarket[]) => {
      const id = savedRouteId(route, config.selectedShipId);
      const next = {
        ...config,
        routes: [
          ...config.routes.filter((saved) => saved.id !== id),
          {
            ...route,
            id,
            shipId: config.selectedShipId,
            savedAt: Date.now() / 1000,
            marketSnapshot,
            name: name?.trim() || cargoRouteTitle(route),
          },
        ],
      };
      try {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
        setConfig(next);
        setStorageError(null);
        return true;
      } catch {
        setStorageError(
          "Route could not be saved on this device. Your draft is still open; free storage and try again.",
        );
        return false;
      }
    },
    [config],
  );
  const deleteRoute = useCallback(
    (id: string) =>
      setConfig((current) => ({
        ...current,
        routes: current.routes.filter((route) => route.id !== id),
      })),
    [],
  );
  const renameRoute = useCallback(
    (id: string, name: string) =>
      setConfig((current) => ({
        ...current,
        routes: current.routes.map((route) =>
          route.id === id && name.trim() ? { ...route, name: name.trim() } : route,
        ),
      })),
    [],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      setStorageError(null);
    } catch {
      setStorageError(
        "Changes could not be saved on this device. Keep Trader open and check available storage.",
      );
    }
  }, [config]);

  return {
    refreshMarkets,
    refreshError,
    execution,
    armRoute,
    pauseRoute,
    resumeRoute,
    abortRoute,
    clearRoute,
    config,
    addShip,
    addPad,
    saveRoute,
    storageError: [storageError, autopilotError].filter(Boolean).join(" ") || null,
    deleteShip,
    selectShip,
    deletePad,
    deleteRoute,
    renameRoute,
  } as const;
}
