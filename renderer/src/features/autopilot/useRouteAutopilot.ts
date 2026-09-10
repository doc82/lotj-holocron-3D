import {
  navigationWaypoint,
  navigationNode,
  validateNavigationPath,
} from "../../domain/navigationTopology";
import { useCallback, useEffect, useRef, useState } from "react";
import { cargoMission } from "../../domain/cargoAutopilot";
import {
  cargoRouteIdentity,
  cargoSystemCoordinates,
  type CargoRoute,
} from "../../domain/cargoRoutes";
import {
  initialCargoExecutionState,
  type CargoExecutionState,
} from "../../domain/cargoRouteExecution";
import { prepareMission, restoreMission, type RouteCheckpoint } from "../../domain/routeAutopilot";
import type { GalaxyCatalog, LogisticsState, SystemSnapshot } from "../../types/telemetry";
import type { TraderConfigState } from "../trader/traderConfig";
import { RouteRunner } from "./RouteRunner";
import { MudletRouteTransport } from "./MudletRouteTransport";

const KEY = "holocron3d.navigation.checkpoint.v1";

export function useRouteAutopilot(
  connected: boolean,
  snapshot: SystemSnapshot | null,
  config: TraderConfigState,
  catalog?: GalaxyCatalog | null,
  logistics?: LogisticsState,
) {
  const [checkpoint, setCheckpoint] = useState<RouteCheckpoint>();
  const [route, setRoute] = useState<CargoRoute | null>(null);
  const [error, setError] = useState<string>();
  const runner = useRef<RouteRunner | undefined>(undefined);
  useEffect(() => {
    const off = window.holocron?.onSnapshot((snapshot) => {
      const accounts = snapshot.metadata?.routeAccounts;
      if (accounts && accounts.runId === runner.current?.state.runId)
        void runner.current.track({
          revision: accounts.revision,
          revenue: accounts.revenue,
          cargo: accounts.cargo,
          fuel: accounts.fuel,
          tax: accounts.tax,
        });
    });
    const timer = setInterval(() => {
      if (runner.current?.state.status === "running") void runner.current.track();
    }, 1000);
    return () => {
      off?.();
      clearInterval(timer);
    };
  }, []);
  const install = useCallback((state: RouteCheckpoint, route: CargoRoute) => {
    const api = window.holocron;
    if (!api) throw new Error("Mudlet connection is unavailable.");
    const transport = new MudletRouteTransport(api);
    runner.current = new RouteRunner(
      state,
      transport,
      {
        save: async (checkpoint) => {
          window.localStorage.setItem(KEY, JSON.stringify({ checkpoint, route }));
        },
      },
      (state) => {
        setCheckpoint(state);
        if (state.status === "completed") void transport.stop(state.runId).catch(() => {});
      },
    );
    setCheckpoint(state);
    setRoute(route);
    setError(undefined);
  }, []);
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
      if (stored?.checkpoint) install(restoreMission(stored.checkpoint), stored.route);
    } catch {
      setError("The saved navigation checkpoint could not be restored. Prepare a new route.");
    }
    return () => {
      void runner.current?.pause("Trader controller closed.");
    };
  }, [install]);
  useEffect(() => {
    if (!connected && runner.current?.state.status === "running")
      void runner.current.pause("Disconnected. Reconnect and reconcile before resuming.");
  }, [connected]);

  const armRoute = useCallback(
    (route: CargoRoute, shipId?: string) => {
      try {
        if (runner.current && !["completed", "aborted"].includes(runner.current.state.status))
          throw new Error("Stop the current run before preparing another route.");
        const ship = config.ships.find((entry) => entry.id === (shipId ?? config.selectedShipId));
        if (!ship) throw new Error("Select a ship in My ships first.");
        if (route.quantity > ship.capacity)
          throw new Error("Route quantity exceeds the selected ship's capacity.");
        const markets = { ...logistics?.markets, ...snapshot?.metadata?.logistics?.markets };
        const mission = cargoMission(route, cargoRouteIdentity(route), ship, (name) => {
          const pad = config.pads.find(
            (pad) => pad.planet.toLowerCase() === name.toLowerCase(),
          )?.pad;
          const waypoint = navigationWaypoint(name);
          if (waypoint)
            return {
              name,
              system: waypoint.system,
              galaxy: waypoint.galacticCoordinates,
              position: waypoint.refuelCoordinates,
              arrival: {
                kind: "station",
                station: waypoint.refuelStation,
                landingTarget: waypoint.landingTarget,
                approachTarget: waypoint.approachTarget,
                pad: waypoint.landingPad ?? pad,
              },
            };
          const market = Object.values(markets).find(
            (market) => market.planet?.toLowerCase() === name.toLowerCase(),
          );
          const system =
            market?.system ??
            logistics?.planets?.find((planet) => planet.name.toLowerCase() === name.toLowerCase())
              ?.system ??
            navigationNode(name)?.system;
          const node = navigationNode(name);
          const galaxy =
            cargoSystemCoordinates(catalog, system) ??
            (node ? { x: node.x, y: node.y } : undefined);
          if (!system || !galaxy) return undefined;
          return { name, system, galaxy, arrival: { kind: "planet", pad } };
        });
        validateNavigationPath(
          mission.stops.map((stop) => stop.destination.name),
          mission.routingMode === "manual",
        );
        const prepared = prepareMission(mission, crypto.randomUUID());
        if (!window.holocron) throw new Error("Mudlet connection is unavailable.");
        window.localStorage.setItem(KEY, JSON.stringify({ checkpoint: prepared, route }));
        install(prepared, route);
        return true;
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not prepare route.");
        return false;
      }
    },
    [config, catalog, logistics, snapshot, install],
  );
  const resumeRoute = useCallback(
    (repeatUntilStopped?: boolean) => {
      if (!connected) {
        setError("Connect to Mudlet before starting.");
        return;
      }
      setError(undefined);
      void runner.current?.resume(repeatUntilStopped).catch((error) => {
        setError(error instanceof Error ? error.message : "Could not resume route.");
      });
    },
    [connected],
  );
  const pauseRoute = useCallback(() => {
    void runner.current?.pause();
  }, []);
  const abortRoute = useCallback(() => {
    const current = runner.current;
    if (current) {
      void current.abort();
      void window.holocron
        ?.sendIntent("route_stop", { runId: current.state.runId, cancel: true })
        .catch(() => {});
    }
  }, []);
  const clearRoute = useCallback(async () => {
    const current = runner.current;
    if (!current || !["completed", "aborted"].includes(current.state.status)) return;
    await current.settled();
    if (runner.current !== current) return;
    try {
      window.localStorage.removeItem(KEY);
      runner.current = undefined;
      setCheckpoint(undefined);
      setRoute(null);
      setError(undefined);
    } catch {
      setError("Could not clear the saved checkpoint. Try again.");
    }
  }, []);
  const execution: CargoExecutionState = checkpoint
    ? {
        route,
        shipName: checkpoint.mission.ship.name,
        repeatUntilStopped: checkpoint.mission.repeatUntilStopped === true,
        circuit: checkpoint.lap + 1,
        runningMs: checkpoint.runningMs ?? 0,
        accounts: checkpoint.accounts,
        flightPhase:
          snapshot?.metadata?.routeNavigation?.runId === checkpoint.runId
            ? snapshot.metadata.routeNavigation.phase
            : undefined,
        stops: checkpoint.mission.stops.map((stop) => ({
          planet: stop.destination.name,
          purpose: "transit",
          legIndex: 0,
        })),
        stopIndex: checkpoint.stop,
        phase: checkpoint.status === "running" ? "in_transit" : checkpoint.status,
        error: error ?? checkpoint.reason,
        pendingAction:
          snapshot?.metadata?.routeNavigation?.runId === checkpoint.runId
            ? snapshot.metadata.routeNavigation.label
            : undefined,
      }
    : { ...initialCargoExecutionState, error };
  return {
    execution,
    armRoute,
    resumeRoute,
    pauseRoute,
    abortRoute,
    clearRoute,
    autopilotError: error,
  };
}
