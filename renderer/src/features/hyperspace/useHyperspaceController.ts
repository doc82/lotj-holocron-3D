import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { absoluteFormationCenter } from "../../domain/coursePlot";
import { clampSectorCoordinate, hyperspaceClearance } from "../../domain/hyperspace";
import {
  calculateHyperspaceIntercept,
  calculateHyperspaceTravelTime,
  HYPERSPACE_TRAVEL_TIME_MODEL,
  hyperspaceReplotRequired,
  observeMotionTracks,
  velocityForTrack,
  type MotionTrack,
  type MotionTrackMap,
} from "../../domain/hyperspacePrediction";
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
  hyperspeed?: number;
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

function selectedRouteMemberNames(route: HyperspaceRoutePayload | null): string[] {
  if (!route || route.scope !== "selected") return [];
  if (route.memberNames?.length) return route.memberNames;
  return route.memberName ? [route.memberName] : [];
}

function selectedRouteIncludesLocalShip(
  route: HyperspaceRoutePayload | null,
  localName: string,
): boolean {
  const wanted = localName.trim().toLowerCase();
  return selectedRouteMemberNames(route).some((name) => name.trim().toLowerCase() === wanted);
}

function routeIncludesLocalShip(route: HyperspaceRoutePayload, localName: string): boolean {
  if (!route.scope || route.scope === "local" || route.scope === "all") return true;
  if (route.scope === "wings") return false;
  return selectedRouteIncludesLocalShip(route, localName);
}

function trackByIdentity(
  tracks: MotionTrackMap,
  id: string | undefined,
  name: string | undefined,
): MotionTrack | undefined {
  const direct = id ? tracks.get(id) : undefined;
  if (direct) return direct;
  const wanted = String(name || "")
    .trim()
    .toLowerCase();
  return wanted
    ? [...tracks.values()].find((track) => track.name.trim().toLowerCase() === wanted)
    : undefined;
}

function stationaryTrack(id: string, name: string, position: Vector3): MotionTrack {
  const observedAt = Date.now() / 1_000;
  const previous = { position: [...position] as Vector3, observedAt: observedAt - 1 };
  const current = { position: [...position] as Vector3, observedAt };
  return { id, name, previous, current, samples: [previous, current] };
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
  const [trackingRecalculationPending, setTrackingRecalculationPending] = useState(false);
  const [motionTracks, setMotionTracks] = useState<MotionTrackMap>(() => new Map());
  const escapeIntentIdsRef = useRef(new Set<string>());
  const engageIntentIdsRef = useRef(new Set<string>());
  const plotIntentIdsRef = useRef(new Set<string>());
  const trackingPlotIntentIdsRef = useRef(new Set<string>());
  const navigationRefreshIntentIdsRef = useRef(new Set<string>());
  const escapeTriggeredRef = useRef(false);
  const arrivalRefreshAtRef = useRef<number | null>(null);
  const announcedReadyKeyRef = useRef<string | null>(null);
  const announcedCalculationWaitRef = useRef(false);
  const trackingReplotPendingRef = useRef(false);
  const trackingRecalculationSawCalculatingRef = useRef(false);

  const state = snapshot?.metadata?.hyperspace || { phase: "idle" as const };
  const battlegroupClearanceExemptions =
    fleet?.active && fleet.kind === "battlegroup" ? fleet.members.map((member) => member.name) : [];
  const hyperdriveClearance = hyperspaceClearance(
    snapshot,
    undefined,
    battlegroupClearanceExemptions,
  );
  const selectedRouteIncludesLocal = selectedRouteIncludesLocalShip(activeRoute, localName);
  const battlegroupControllerRoute =
    activeRoute?.formationKind === "battlegroup" &&
    (activeRoute.scope === "all" ||
      activeRoute.scope === "wings" ||
      (activeRoute.scope === "selected" && !selectedRouteIncludesLocal));
  const remoteBattlegroupRoute =
    activeRoute?.formationKind === "battlegroup" &&
    (activeRoute.scope === "wings" ||
      (activeRoute.scope === "selected" && !selectedRouteIncludesLocal));
  const routeClearance = battlegroupControllerRoute
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

  useEffect(() => {
    setMotionTracks((current) => observeMotionTracks(current, snapshot));
  }, [snapshot]);

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
      const initialOrigin = absoluteFormationCenter(
        observerWorldPosition,
        movementOriginsForScope(fleetCommandMode ? fleetScope : "local"),
      );
      const recipientMembers = !fleetCommandMode
        ? []
        : fleetScope === "selected"
          ? selectedFleetMembers
          : fleetScope === "wings"
            ? (fleet?.members.filter((member) => !member.leader) ?? [])
            : (fleet?.members ?? []);
      const recipientHyperspeeds = recipientMembers
        .map((member) => Number(member.hyperspeed))
        .filter((value) => value > 0);
      const hyperspeed = recipientHyperspeeds.length
        ? Math.min(...recipientHyperspeeds)
        : Number(snapshot?.observer?.hyperspeed) || undefined;
      setNavigationRefreshBlocked(false);
      setPlanner({
        mode,
        hyperspeed,
        origin: {
          x: initialOrigin[0],
          y: initialOrigin[1],
          z: initialOrigin[2],
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
      snapshot?.observer?.hyperspeed,
    ],
  );

  const livePlanner = useMemo(() => {
    if (!planner) return null;
    const origin = absoluteFormationCenter(
      observerWorldPosition,
      movementOriginsForScope(planner.routeScope.scope || "local"),
    );
    return {
      ...planner,
      origin: { x: origin[0], y: origin[1], z: origin[2] },
    };
  }, [movementOriginsForScope, observerWorldPosition, planner]);

  const withTravelEstimate = useCallback(
    (route: HyperspaceRoutePayload): HyperspaceRoutePayload => {
      if (route.mode !== "local") return route;
      const rating = Number(route.tracking?.hyperspeed) || Number(snapshot?.observer?.hyperspeed);
      if (!routeIncludesLocalShip(route, localName) || !(rating > 0)) return route;
      const origin = absoluteFormationCenter(
        observerWorldPosition,
        movementOriginsForScope(route.scope || "local"),
      );
      const distance = Math.hypot(
        Number(route.destination.x) - origin[0],
        Number(route.destination.y) - origin[1],
        Number(route.destination.z) - origin[2],
      );
      const estimatedTravelSeconds = calculateHyperspaceTravelTime(
        distance,
        rating,
        route.tracking?.navigator,
      );
      return {
        ...route,
        predictionModel: HYPERSPACE_TRAVEL_TIME_MODEL,
        estimatedTravelSeconds: estimatedTravelSeconds ?? undefined,
      };
    },
    [localName, movementOriginsForScope, observerWorldPosition, snapshot?.observer?.hyperspeed],
  );

  const trackingUpdate = useMemo(() => {
    const tracking = activeRoute?.tracking;
    if (!activeRoute || activeRoute.mode !== "local" || !tracking) return null;
    const target = trackByIdentity(motionTracks, tracking.targetId, tracking.targetName);
    if (!target || !velocityForTrack(target)) return null;
    const origin = absoluteFormationCenter(
      observerWorldPosition,
      movementOriginsForScope(activeRoute.scope || "local"),
    );
    let observerTrack: MotionTrack | undefined;
    if (!activeRoute.scope || activeRoute.scope === "local") {
      const playerTrack = motionTracks.get("player-ship");
      observerTrack = playerTrack && velocityForTrack(playerTrack) ? playerTrack : undefined;
    } else if (
      activeRoute.scope === "selected" &&
      selectedRouteMemberNames(activeRoute).length === 1
    ) {
      observerTrack = trackByIdentity(
        motionTracks,
        activeRoute.memberId,
        selectedRouteMemberNames(activeRoute)[0],
      );
      if (observerTrack && !velocityForTrack(observerTrack)) observerTrack = undefined;
    }
    observerTrack ??= stationaryTrack("tracked-route-origin", "Tracked route origin", origin);
    const solution = calculateHyperspaceIntercept({
      target,
      observer: observerTrack,
      hyperspeed: tracking.hyperspeed,
      navigator: tracking.navigator,
    });
    return solution ? { solution, targetObservedAt: target.current.observedAt } : null;
  }, [activeRoute, motionTracks, movementOriginsForScope, observerWorldPosition]);

  const plot = useCallback(
    async (route: HyperspaceRoutePayload, escape?: EscapePlanDraft) => {
      const plottedRoute = withTravelEstimate(route);
      setActiveRoute(plottedRoute);
      setEscapePlan(escape);
      setPlanner(null);
      escapeTriggeredRef.current = false;
      const result = await window.holocron?.sendIntent(
        "plot_hyperspace",
        plottedRoute as unknown as Record<string, unknown>,
      );
      if (result?.accepted === false) {
        setAlert(`ROUTE REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
        return;
      }
      if (result?.id) plotIntentIdsRef.current.add(result.id);
    },
    [setAlert, withTravelEstimate],
  );

  const refreshTrackedRoute = useCallback(async (): Promise<boolean> => {
    const tracking = activeRoute?.tracking;
    if (
      !activeRoute ||
      !tracking ||
      state.phase !== "ready" ||
      !trackingUpdate ||
      trackingUpdate.targetObservedAt <= Number(tracking.lastObservedAt || 0)
    )
      return false;
    if (trackingReplotPendingRef.current) return true;

    const previousDestination: Vector3 = [
      activeRoute.destination.x,
      activeRoute.destination.y,
      activeRoute.destination.z,
    ];
    const nextDestination = trackingUpdate.solution.targetPosition.map(
      clampSectorCoordinate,
    ) as Vector3;
    if (!hyperspaceReplotRequired(previousDestination, nextDestination, tracking.thresholdUnits)) {
      setActiveRoute((current) =>
        current === activeRoute
          ? {
              ...current,
              tracking: { ...tracking, lastObservedAt: trackingUpdate.targetObservedAt },
            }
          : current,
      );
      return false;
    }

    const drift = Math.hypot(
      ...nextDestination.map((value, index) => value - previousDestination[index]),
    );
    const revisedRoute = withTravelEstimate({
      ...activeRoute,
      destination: {
        x: nextDestination[0],
        y: nextDestination[1],
        z: nextDestination[2],
      },
      tracking: { ...tracking, lastObservedAt: trackingUpdate.targetObservedAt },
    });
    trackingReplotPendingRef.current = true;
    trackingRecalculationSawCalculatingRef.current = false;
    setTrackingRecalculationPending(true);
    let accepted = false;
    try {
      const result = await window.holocron?.sendIntent(
        "plot_hyperspace",
        revisedRoute as unknown as Record<string, unknown>,
      );
      if (result?.accepted === false) {
        setAlert(`TRACK UPDATE REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
        return true;
      }
      accepted = true;
      setActiveRoute(revisedRoute);
      if (result?.id) {
        plotIntentIdsRef.current.add(result.id);
        trackingPlotIntentIdsRef.current.add(result.id);
      }
      setAlert(
        `TARGET MOVED ${Math.round(drift)} U // RECALCULATING ${tracking.targetName.toUpperCase()}`,
      );
      return true;
    } catch (error) {
      setAlert(`TRACK UPDATE FAILED // ${String(error || "UNKNOWN").toUpperCase()}`);
      return true;
    } finally {
      trackingReplotPendingRef.current = false;
      if (!accepted) setTrackingRecalculationPending(false);
    }
  }, [activeRoute, setAlert, state.phase, trackingUpdate, withTravelEstimate]);

  useEffect(() => {
    void refreshTrackedRoute();
  }, [refreshTrackedRoute]);

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
    trackingPlotIntentIdsRef.current.clear();
    setTrackingRecalculationPending(false);
    trackingRecalculationSawCalculatingRef.current = false;
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, [activeRoute, setAlert]);

  const dismiss = useCallback(() => {
    setActiveRoute(null);
    trackingPlotIntentIdsRef.current.clear();
    setTrackingRecalculationPending(false);
    trackingRecalculationSawCalculatingRef.current = false;
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, []);

  const engage = useCallback(async () => {
    if (trackingRecalculationPending) {
      setAlert("TRACK UPDATE IN PROGRESS // WAITING FOR CURRENT CALCULATION");
      return;
    }
    if (await refreshTrackedRoute()) return;
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
    if (result?.id) engageIntentIdsRef.current.add(result.id);
    if (remoteBattlegroupRoute) {
      setActiveRoute(null);
      setEscapePlan(undefined);
      setAlert(
        `HYPERSPACE ENGAGED // ${(activeRoute?.recipientLabel || "FORMATION").toUpperCase()}`,
      );
    }
  }, [
    activeRoute,
    refreshTrackedRoute,
    remoteBattlegroupRoute,
    routeClearance.allowed,
    routeClearance.reason,
    setAlert,
    trackingRecalculationPending,
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
    const trackingActive = activeRoute?.mode === "local" && Boolean(activeRoute.tracking);
    if (
      pollingPaused ||
      (planner?.mode !== "local" && !trackingActive) ||
      ["engaging", "hyperspace", "reentry", "arrived"].includes(state.phase || "idle")
    )
      return;
    const refreshRadar = () => void window.holocron?.sendIntent("refresh_local_hyperspace_radar");
    refreshRadar();
    const timer = setInterval(refreshRadar, 4_000);
    return () => clearInterval(timer);
  }, [activeRoute?.mode, activeRoute?.tracking, planner?.mode, pollingPaused, state.phase]);

  useEffect(() => {
    if (state.phase !== "hyperspace") setEscapePending(false);
  }, [state.phase]);

  useEffect(() => {
    if (!trackingRecalculationPending) return;
    if (state.phase === "calculating") {
      trackingRecalculationSawCalculatingRef.current = true;
      return;
    }
    if (state.phase === "ready" && trackingRecalculationSawCalculatingRef.current) {
      trackingRecalculationSawCalculatingRef.current = false;
      setTrackingRecalculationPending(false);
    }
  }, [state.phase, trackingRecalculationPending]);

  useEffect(() => {
    if (!state.waitingForCalculation) {
      announcedCalculationWaitRef.current = false;
      return;
    }
    if (announcedCalculationWaitRef.current) return;
    announcedCalculationWaitRef.current = true;
    setAlert("NAVIGATION COMPUTER IS STILL CALCULATING // PLEASE WAIT TO ENGAGE");
  }, [setAlert, state.waitingForCalculation]);

  useEffect(() => {
    if (state.phase === "calculating") announcedReadyKeyRef.current = null;
    if (!activeRoute || state.phase !== "ready" || !state.readyAt) return;
    const readyKey = `${state.readyAt}:${state.calculationEstimated === true ? "estimated" : "confirmed"}`;
    if (announcedReadyKeyRef.current === readyKey) return;
    announcedReadyKeyRef.current = readyKey;
    setAlert(
      `HYPERSPACE CALCULATION READY // ${(activeRoute.recipientLabel || "FORMATION").toUpperCase()} // ${state.calculationEstimated === true ? "ESTIMATED" : "ENGAGE AVAILABLE"}`,
    );
  }, [activeRoute, setAlert, state.calculationEstimated, state.phase, state.readyAt]);

  useEffect(() => {
    if (state.phase !== "arrived") {
      arrivalRefreshAtRef.current = null;
      return;
    }
    // Arrival is authoritative and must always release the navigation panel.
    // Pausing telemetry only suppresses the follow-up navstat request.
    setActiveRoute(null);
    if (pollingPaused) return;
    const arrivedAt = Number(state.arrivedAt) || 0;
    const arrivalNavigationReady =
      Number(snapshot?.metadata?.navigation?.arrivalRefreshedAt) >= arrivedAt;
    if (arrivalRefreshAtRef.current !== arrivedAt) {
      arrivalRefreshAtRef.current = arrivedAt;
      void window.holocron?.sendIntent("refresh_navigation", {
        command: "navstat",
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
    trackingReplotPendingRef.current = false;
    trackingPlotIntentIdsRef.current.clear();
    trackingRecalculationSawCalculatingRef.current = false;
    setTrackingRecalculationPending(false);
    setPlanner(null);
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, [connected]);

  const acknowledgementCallbacksRef = useLatestRef({ setAlert });

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (ack.id && trackingPlotIntentIdsRef.current.has(ack.id)) {
          if (ack.status === "accepted") return;
          trackingPlotIntentIdsRef.current.delete(ack.id);
          trackingRecalculationSawCalculatingRef.current = false;
          setTrackingRecalculationPending(false);
        }
        if (ack.id && plotIntentIdsRef.current.has(ack.id)) {
          if (ack.status === "accepted") return;
          plotIntentIdsRef.current.delete(ack.id);
          if (ack.status === "rejected") {
            acknowledgementCallbacksRef.current.setAlert(
              `ROUTE REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`,
            );
          }
          return;
        }
        if (ack.id && engageIntentIdsRef.current.has(ack.id)) {
          if (ack.status === "accepted") return;
          engageIntentIdsRef.current.delete(ack.id);
          if (ack.status === "rejected") {
            acknowledgementCallbacksRef.current.setAlert(
              `HYPERDRIVE REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`,
            );
          }
          return;
        }
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
    planner: livePlanner,
    activeRoute,
    escapePlan,
    escapePending,
    trackingRecalculationPending,
    routeClearance,
    navigationDestinations,
    currentGalaxyPosition,
    motionTracks,
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
