import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { formationCenter } from "../../domain/coursePlot";
import { hyperspaceClearance } from "../../domain/hyperspace";
import { useLatestRef } from "../../hooks/useLatestRef";
import type { FleetScope } from "../fleet/FleetRoster";
import type {
  FleetMember,
  FleetStatus,
  GalaxyCatalog,
  HyperspaceRoutePayload,
  SystemSnapshot,
  Vector3,
} from "../../types/telemetry";
import type { EscapePlanDraft } from "./HyperspacePlanner";

export interface HyperspacePlannerRequest {
  mode: "local" | "galactic";
  origin: { x?: number; y?: number; z?: number };
  routeScope: Pick<
    HyperspaceRoutePayload,
    | "scope"
    | "formationKind"
    | "memberId"
    | "memberName"
    | "memberSlot"
    | "memberIds"
    | "memberNames"
    | "memberSlots"
    | "recipientLabel"
  >;
}

interface HyperspaceControllerOptions {
  connected: boolean;
  pollingPaused: boolean;
  snapshot: SystemSnapshot | null;
  galaxyCatalog: GalaxyCatalog | null;
  fleet?: FleetStatus;
  fleetCommandMode: boolean;
  fleetScope: FleetScope;
  selectedFleetMembers: FleetMember[];
  commandIssuerLabel: string;
  localName: string;
  viewpointGalaxy?: { x?: number; y?: number };
  observerWorldPosition: Vector3;
  movementOriginsForScope(scope: FleetScope | null): Vector3[];
  setAlert(message: string): void;
}

export function useHyperspaceController({
  connected,
  pollingPaused,
  snapshot,
  galaxyCatalog,
  fleet,
  fleetCommandMode,
  fleetScope,
  selectedFleetMembers,
  commandIssuerLabel,
  localName,
  viewpointGalaxy,
  observerWorldPosition,
  movementOriginsForScope,
  setAlert,
}: HyperspaceControllerOptions) {
  const [planner, setPlanner] = useState<HyperspacePlannerRequest | null>(null);
  const [navigationRefreshBlocked, setNavigationRefreshBlocked] = useState(false);
  const [activeRoute, setActiveRoute] = useState<HyperspaceRoutePayload | null>(null);
  const [escapePlan, setEscapePlan] = useState<EscapePlanDraft | undefined>();
  const [escapePending, setEscapePending] = useState(false);
  const escapeIntentIdsRef = useRef(new Set<string>());
  const navigationRefreshIntentIdsRef = useRef(new Set<string>());
  const escapeTriggeredRef = useRef(false);
  const arrivalRefreshAtRef = useRef<number | null>(null);

  const state = snapshot?.metadata?.hyperspace || { phase: "idle" as const };
  const hyperdriveClearance = hyperspaceClearance(snapshot);
  const remoteBattlegroupRoute =
    activeRoute?.formationKind === "battlegroup" &&
    (activeRoute.scope === "wings" ||
      (activeRoute.scope === "selected" &&
        (activeRoute.memberNames?.some(
          (name) => name.trim().toLowerCase() !== localName.trim().toLowerCase(),
        ) ??
          activeRoute.memberName?.trim().toLowerCase() !== localName.trim().toLowerCase())));
  const routeClearance = remoteBattlegroupRoute
    ? {
        known: true,
        allowed: true,
        reason: "Recipient clearance is verified by the battlegroup controller",
      }
    : hyperdriveClearance;
  const navigationDestinations = snapshot?.metadata?.navigation?.destinations || [];
  const navigationGalaxy = snapshot?.metadata?.navigation?.galaxy;
  const catalogGalaxy = galaxyCatalog?.shipSystem;
  const currentGalaxyPosition = useMemo(
    () =>
      Number.isFinite(Number(viewpointGalaxy?.x)) && Number.isFinite(Number(viewpointGalaxy?.y))
        ? { x: Number(viewpointGalaxy?.x), y: Number(viewpointGalaxy?.y) }
        : Number.isFinite(Number(navigationGalaxy?.x)) &&
            Number.isFinite(Number(navigationGalaxy?.y))
          ? { x: Number(navigationGalaxy?.x), y: Number(navigationGalaxy?.y) }
          : Number.isFinite(Number(catalogGalaxy?.x)) && Number.isFinite(Number(catalogGalaxy?.y))
            ? { x: Number(catalogGalaxy?.x), y: Number(catalogGalaxy?.y) }
            : undefined,
    [
      catalogGalaxy?.x,
      catalogGalaxy?.y,
      navigationGalaxy?.x,
      navigationGalaxy?.y,
      viewpointGalaxy?.x,
      viewpointGalaxy?.y,
    ],
  );
  const galaxyCatalogSize =
    Object.keys(galaxyCatalog?.systems || {}).length +
    Object.keys(galaxyCatalog?.customSystems || {}).length;

  const openPlanner = useCallback(
    (mode: "local" | "galactic") => {
      const routeScope: HyperspacePlannerRequest["routeScope"] = {
        scope: fleetCommandMode ? fleetScope : "local",
        formationKind: fleetCommandMode ? fleet?.kind : undefined,
        recipientLabel: commandIssuerLabel,
      };
      if (fleetCommandMode && fleetScope === "selected" && selectedFleetMembers.length > 0) {
        routeScope.memberIds = selectedFleetMembers.map((member) => member.id);
        routeScope.memberNames = selectedFleetMembers.map((member) => member.name);
        routeScope.memberSlots = selectedFleetMembers.flatMap((member) =>
          member.slot === undefined ? [] : [member.slot],
        );
        if (selectedFleetMembers.length === 1) {
          routeScope.memberId = selectedFleetMembers[0].id;
          routeScope.memberName = selectedFleetMembers[0].name;
          routeScope.memberSlot = selectedFleetMembers[0].slot;
        }
      }
      const relativeOrigin = formationCenter(
        movementOriginsForScope(fleetCommandMode ? fleetScope : "local"),
      );
      setNavigationRefreshBlocked(false);
      setPlanner({
        mode,
        origin: {
          x: (Number(observerWorldPosition[0]) || 0) + relativeOrigin[0],
          y: (Number(observerWorldPosition[1]) || 0) + relativeOrigin[1],
          z: (Number(observerWorldPosition[2]) || 0) + relativeOrigin[2],
        },
        routeScope,
      });
    },
    [
      commandIssuerLabel,
      fleet?.kind,
      fleetCommandMode,
      fleetScope,
      movementOriginsForScope,
      observerWorldPosition,
      selectedFleetMembers,
    ],
  );

  const plot = useCallback(
    async (route: HyperspaceRoutePayload, escape?: EscapePlanDraft) => {
      setActiveRoute(route);
      setEscapePlan(escape);
      setPlanner(null);
      escapeTriggeredRef.current = false;
      const result = await window.holocron?.sendIntent(
        "plot_hyperspace",
        route as unknown as Record<string, unknown>,
      );
      if (result?.accepted === false) {
        setAlert(`ROUTE REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
      }
    },
    [setAlert],
  );

  const stop = useCallback(async () => {
    const result = await window.holocron?.sendIntent(
      "stop_hyperspace",
      activeRoute as unknown as Record<string, unknown> | undefined,
    );
    if (result?.accepted === false) {
      setAlert(`ABORT REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, [activeRoute, setAlert]);

  const dismiss = useCallback(() => {
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, []);

  const engage = useCallback(async () => {
    if (!routeClearance.allowed) {
      setAlert(
        `HYPERDRIVE BLOCKED // ${String(routeClearance.reason || "FRESH RADAR CLEARANCE REQUIRED").toUpperCase()}`,
      );
      return;
    }
    const result = await window.holocron?.sendIntent(
      "engage_hyperdrive",
      activeRoute as unknown as Record<string, unknown> | undefined,
    );
    if (result?.accepted === false) {
      setAlert(`HYPERDRIVE BLOCKED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    if (remoteBattlegroupRoute) {
      setActiveRoute(null);
      setEscapePlan(undefined);
      setAlert(
        `HYPERSPACE ENGAGED // ${(activeRoute?.recipientLabel || "FORMATION").toUpperCase()}`,
      );
    }
  }, [
    activeRoute,
    remoteBattlegroupRoute,
    routeClearance.allowed,
    routeClearance.reason,
    setAlert,
  ]);

  const escape = useCallback(async () => {
    setEscapePending(true);
    const result = await window.holocron?.sendIntent("escape_hyperspace");
    if (result?.id) escapeIntentIdsRef.current.add(result.id);
    if (result?.accepted === false) {
      setEscapePending(false);
      setAlert(`HYPERSPACE CUTOFF REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
    }
  }, [setAlert]);

  const calculateAnyway = useCallback(() => {
    if (!activeRoute) return;
    void plot({ ...activeRoute, acknowledgeFuelRisk: true }, escapePlan);
  }, [activeRoute, escapePlan, plot]);

  const closePlanner = useCallback(() => setPlanner(null), []);

  useEffect(() => {
    if (pollingPaused || state.phase !== "calculating") return;
    const timer = setInterval(
      () => void window.holocron?.sendIntent("refresh_navigation", { command: "calc" }),
      5_000,
    );
    return () => clearInterval(timer);
  }, [pollingPaused, state.phase]);

  useEffect(() => {
    if (pollingPaused || !activeRoute || state.phase !== "ready" || hyperdriveClearance.known)
      return;
    const refreshClearance = () => void window.holocron?.sendIntent("probe_space");
    refreshClearance();
    const timer = setInterval(refreshClearance, 5_000);
    return () => clearInterval(timer);
  }, [activeRoute, hyperdriveClearance.known, pollingPaused, state.phase]);

  useEffect(() => {
    if (pollingPaused || !planner || navigationRefreshBlocked) return;
    const needsRange = navigationDestinations.length === 0;
    const needsCatalog = planner.mode === "galactic" && galaxyCatalogSize === 0;
    const needsPosition = !currentGalaxyPosition;
    if (!needsRange && !needsCatalog && !needsPosition) return;
    const refreshMissingNavigationData = async () => {
      if (needsCatalog) void window.holocron?.sendIntent("refresh_galaxy_catalog");
      if (!needsPosition && !needsRange) return;
      const result = await window.holocron?.sendIntent("refresh_navigation", {
        command: needsPosition ? "navstat" : "calc",
      });
      if (result?.id) navigationRefreshIntentIdsRef.current.add(result.id);
    };
    void refreshMissingNavigationData();
    const timer = setInterval(refreshMissingNavigationData, 2_500);
    return () => clearInterval(timer);
  }, [
    currentGalaxyPosition,
    galaxyCatalogSize,
    navigationDestinations.length,
    navigationRefreshBlocked,
    planner,
    pollingPaused,
  ]);

  useEffect(() => {
    if (state.phase !== "hyperspace") setEscapePending(false);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "arrived") {
      arrivalRefreshAtRef.current = null;
      return;
    }
    if (pollingPaused) return;
    setActiveRoute(null);
    const arrivedAt = Number(state.arrivedAt) || 0;
    const arrivalNavigationReady =
      Number(snapshot?.metadata?.navigation?.arrivalRefreshedAt) >= arrivedAt;
    if (arrivalRefreshAtRef.current !== arrivedAt) {
      arrivalRefreshAtRef.current = arrivedAt;
      void window.holocron?.sendIntent("refresh_navigation", {
        command: "navstat",
        followupRadar: true,
      });
    }
    if (!escapePlan || escapeTriggeredRef.current || !arrivalNavigationReady) return;
    const actualX = Number(currentGalaxyPosition?.x);
    const actualY = Number(currentGalaxyPosition?.y);
    if (actualX !== escapePlan.triggerGalaxy.x || actualY !== escapePlan.triggerGalaxy.y) return;
    escapeTriggeredRef.current = true;
    const escapeRoute = escapePlan.route;
    setActiveRoute(escapeRoute);
    setEscapePlan(undefined);
    void window.holocron?.sendIntent(
      "plot_hyperspace",
      escapeRoute as unknown as Record<string, unknown>,
    );
  }, [
    currentGalaxyPosition?.x,
    currentGalaxyPosition?.y,
    escapePlan,
    pollingPaused,
    snapshot?.metadata?.navigation?.arrivalRefreshedAt,
    state.arrivedAt,
    state.phase,
  ]);

  useEffect(() => {
    if (connected) return;
    setPlanner(null);
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, [connected]);

  const acknowledgementCallbacksRef = useLatestRef({ setAlert });

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (ack.id && navigationRefreshIntentIdsRef.current.has(ack.id)) {
          if (ack.status === "accepted") return;
          navigationRefreshIntentIdsRef.current.delete(ack.id);
          const reason = String(ack.reason || "");
          if (ack.status === "rejected" && reason.toLowerCase().includes("navigation computer")) {
            setNavigationRefreshBlocked(true);
            acknowledgementCallbacksRef.current.setAlert(
              `NAVIGATION DATA UNAVAILABLE // ${reason.toUpperCase()}`,
            );
          }
          return;
        }
        if (!ack.id || !escapeIntentIdsRef.current.has(ack.id)) return;
        escapeIntentIdsRef.current.delete(ack.id);
        if (ack.status === "rejected") {
          setEscapePending(false);
          acknowledgementCallbacksRef.current.setAlert(
            `HYPERSPACE CUTOFF REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`,
          );
        }
      }),
    [],
  );

  return {
    state,
    planner,
    activeRoute,
    escapePlan,
    escapePending,
    routeClearance,
    navigationDestinations,
    currentGalaxyPosition,
    openPlanner,
    closePlanner,
    plot,
    stop,
    dismiss,
    engage,
    escape,
    calculateAnyway,
  } as const;
}
