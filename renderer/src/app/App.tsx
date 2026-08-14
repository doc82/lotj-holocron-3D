import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildScene, findScenePoint, formatCoordinate, sensorRangeFor, type ScenePoint } from "../domain/scene";
import { hyperspaceClearance } from "../domain/hyperspace";
import { NavigationDrawer } from "../features/commands/NavigationDrawer";
import { ShipSpeedControl } from "../features/commands/ShipSpeedControl";
import { UplinkNotice } from "../features/connection/UplinkNotice";
import { HyperspacePlanner, type EscapePlanDraft } from "../features/hyperspace/HyperspacePlanner";
import { HyperspaceTransit } from "../features/hyperspace/HyperspaceTransit";
import { NavigationComputer } from "../features/hyperspace/NavigationComputer";
import { StartupSequence } from "../features/startup/StartupSequence";
import { TacticalCanvas, type TacticalCanvasHandle } from "../features/tactical/TacticalCanvas";
import { RangeMeter, type RangeReading } from "../features/telemetry/RangeMeter";
import { useTelemetry } from "../features/telemetry/useTelemetry";
import { WeaponsPanel } from "../features/weapons/WeaponsPanel";
import styles from "./App.module.css";
import type { HyperspaceRoutePayload, ShipDisposition, Vector3, WeaponType } from "../types/telemetry";

const DISPOSITION_STORAGE_KEY = "holocron3d.ship-dispositions.v1";
const dispositionKey = (name: string) => name.trim().toLowerCase();

function loadDispositions(): Record<string, ShipDisposition> {
  try { return JSON.parse(localStorage.getItem(DISPOSITION_STORAGE_KEY) || "{}"); } catch { return {}; }
}

function speedLabel(speed: ScenePoint["speed"]): string {
  if (typeof speed === "object" && speed) {
    return `${formatCoordinate(speed.current)} / ${formatCoordinate(speed.maximum)}`;
  }
  return speed === undefined ? "—" : formatCoordinate(speed);
}

function detailRows(point: ScenePoint): Array<[string, string]> {
  const worldCoordinates = point.worldPosition.map(formatCoordinate).join(" / ");
  const rows: Array<[string, string]> = [];
  if (point.id === "player-ship") {
    rows.push(["WORLD XYZ", worldCoordinates], ["CAMERA FOCUS", "LOCKED"]);
  } else {
    rows.push(["SYSTEM XYZ", worldCoordinates]);
  }
  if (point.distance !== undefined) rows.push(["PROXIMITY", formatCoordinate(point.distance)]);
  if (point.speed !== undefined && typeof point.speed !== "object") {
    rows.push(["VELOCITY", speedLabel(point.speed)]);
  }
  if (point.heading && typeof point.heading === "object") {
    rows.push(["HEADING", [point.heading.x, point.heading.y, point.heading.z].map(formatCoordinate).join(" / ")]);
  }
  if (point.position) rows.push(["FORMATION", point.position]);
  if (point.condition) rows.push(["CONDITION", String(point.condition)]);
  if (point.energy !== undefined && typeof point.energy !== "object") {
    rows.push(["ENERGY", formatCoordinate(point.energy)]);
  }
  if (point.target) rows.push(["TARGET", String(point.target)]);
  if (point.lifeforms) rows.push(["LIFEFORMS", String(point.lifeforms)]);
  if (point.lifeformScan && typeof point.lifeformScan === "object") {
    const scan = point.lifeformScan as { available?: boolean; requiredSensors?: number; value?: string };
    rows.push(["LIFEFORMS", scan.available === false
      ? `UNKNOWN // NEED ${formatCoordinate(scan.requiredSensors)} SENSORS`
      : String(scan.value || "DETECTED")]);
  }
  return rows;
}

function ViewIcon({ type }: { type: "radar" | "grid" | "sector" }) {
  if (type === "radar") return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" /><circle cx="16" cy="16" r="3" />
      <path d="M16 16 25 9M5 16h4M23 16h4M16 5v4M16 23v4" />
    </svg>
  );
  if (type === "grid") return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 24 12 8h8l7 16ZM8 19h16M10 14h12M12 8l-2 16M20 8l2 16" />
    </svg>
  );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M10 5H5v5M22 5h5v5M10 27H5v-5M22 27h5v-5" />
      <circle cx="11" cy="17" r="2" /><circle cx="17" cy="12" r="1.5" /><circle cx="22" cy="19" r="2.5" />
    </svg>
  );
}

function MoveIcon() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 24 21 8M14 8h7v7M5 24h15M5 24V9" /></svg>;
}

function HyperspaceIcon({ galactic = false }: { galactic?: boolean }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true">
    {galactic ? <><circle cx="16" cy="16" r="3" /><circle cx="7" cy="9" r="2" /><circle cx="25" cy="7" r="2" /><circle cx="24" cy="24" r="2" /><path d="M9 10.5 14 14M19 14l4.5-5M19 18l3.5 4.5M5 25C13 19 20 12 27 4" /></>
      : <><circle cx="16" cy="16" r="10" /><path d="M3 16h9M20 16h9M16 3v9M16 20v9M11 21 21 11M12 10l10 10" /><circle cx="16" cy="16" r="2" /></>}
  </svg>;
}

type CommandIconType = "target" | "scan" | "info" | "to" | "away" | "track"
  | "cancel" | "neutral" | "friendly" | "enemy" | "recharge" | "autoRecharge";

function CommandIcon({ type }: { type: CommandIconType }) {
  const paths: Record<CommandIconType, ReactNode> = {
    target: <><circle cx="16" cy="16" r="8" /><path d="M16 3v7M16 22v7M3 16h7M22 16h7" /></>,
    scan: <><path d="M5 23a18 18 0 0 1 18-18M8 26A18 18 0 0 1 26 8" /><circle cx="12" cy="20" r="3" /></>,
    info: <><circle cx="16" cy="16" r="11" /><path d="M16 14v9M16 9v1" /></>,
    to: <><path d="M4 16h20M18 9l7 7-7 7" /><circle cx="27" cy="16" r="2" /></>,
    away: <><path d="M28 16H8M14 9l-7 7 7 7" /><circle cx="5" cy="16" r="2" /></>,
    track: <><circle cx="16" cy="16" r="9" /><circle cx="16" cy="16" r="3" /><path d="M16 3v4M16 25v4M3 16h4M25 16h4M21 11l6-6" /></>,
    cancel: <path d="M7 7l18 18M25 7 7 25" />,
    neutral: <><circle cx="16" cy="16" r="10" /><path d="M11 16h10" /></>,
    friendly: <><path d="M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z" /><path d="m11 16 3 3 7-7" /></>,
    enemy: <><path d="M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z" /><path d="m11 12 10 10M21 12 11 22" /></>,
    recharge: <><path d="M16 3 27 8v8c0 7-5 11-11 13C10 27 5 23 5 16V8Z" /><path d="m18 8-7 10h6l-3 8 8-12h-6z" /></>,
    autoRecharge: <><path d="M16 4 26 8v8c0 6-4 10-10 12C10 26 6 22 6 16V8Z" /><path d="M11 16a5 5 0 0 1 8-4M21 11v4h-4M21 17a5 5 0 0 1-8 4M11 22v-4h4" /></>,
  };
  return <svg viewBox="0 0 32 32" aria-hidden="true">{paths[type]}</svg>;
}

type NavigationMode = "idle" | "vector" | "target" | "away" | "confirm";

export function App() {
  const telemetry = useTelemetry();
  const [starting, setStarting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const [radarBubbleEnabled, setRadarBubbleEnabled] = useState(true);
  const [originGridEnabled, setOriginGridEnabled] = useState(false);
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("idle");
  const [pendingNavigationMode, setPendingNavigationMode] = useState<"relative" | "target" | "away">("relative");
  const [navigationTargetId, setNavigationTargetId] = useState<string | null>(null);
  const [courseVector, setCourseVector] = useState<Vector3>([100, 0, 0]);
  const [requestedSpeed, setRequestedSpeed] = useState(0);
  const [knownMaximumSpeed, setKnownMaximumSpeed] = useState(0);
  const [navigationStatus, setNavigationStatus] = useState("");
  const [commandAlert, setCommandAlert] = useState("");
  const [commandLocked, setCommandLocked] = useState(false);
  const [manualScanSource, setManualScanSource] = useState<"status" | "info" | null>(null);
  const [manualScanStatus, setManualScanStatus] = useState("");
  const [spaceProbeAttempt, setSpaceProbeAttempt] = useState(0);
  const [hyperspacePlanner, setHyperspacePlanner] = useState<"local" | "galactic" | null>(null);
  const [activeRoute, setActiveRoute] = useState<HyperspaceRoutePayload | null>(null);
  const [escapePlan, setEscapePlan] = useState<EscapePlanDraft | undefined>();
  const [hyperspaceEscapePending, setHyperspaceEscapePending] = useState(false);
  const [dispositions, setDispositions] = useState<Record<string, ShipDisposition>>(loadDispositions);
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const syncedDispositionsRef = useRef(new Map<string, ShipDisposition>());
  const pendingIntentIdsRef = useRef(new Set<string>());
  const manualScanIntentIdsRef = useRef(new Set<string>());
  const autotrackIntentIdsRef = useRef(new Set<string>());
  const hyperspaceEscapeIntentIdsRef = useRef(new Set<string>());
  const targetIntentShipsRef = useRef(new Map<string, { name: string }>());
  const lastObservedSpeedRef = useRef<number | null>(null);
  const lastMaximumSpeedRef = useRef<number | null>(null);
  const lastSpeedIntentRef = useRef<number | null>(null);
  const manualScanStartSequenceRef = useRef(0);
  const manualScanRequestTokenRef = useRef(0);
  const navigationLockTokenRef = useRef(0);
  const targetLockTokenRef = useRef(0);
  const spaceProbeSentRef = useRef(false);
  const spaceProbeIntentIdsRef = useRef(new Set<string>());
  const spaceProbeRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escapeTriggeredRef = useRef(false);
  const arrivalRefreshAtRef = useRef<number | null>(null);
  const classifiedSnapshot = useMemo(() => telemetry.snapshot ? {
    ...telemetry.snapshot,
    entities: telemetry.snapshot.entities?.map((entity) => ({
      ...entity,
      disposition: entity.kind === "ship"
        ? entity.disposition === "enemy"
          ? "enemy"
          : dispositions[dispositionKey(entity.name || entity.id)] || entity.disposition || "neutral"
        : entity.disposition,
    })),
  } : null, [telemetry.snapshot, dispositions]);
  const scene = useMemo(() => buildScene(classifiedSnapshot), [classifiedSnapshot]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const finishStartup = useCallback(() => setStarting(false), []);

  const scheduleSpaceProbeRetry = useCallback(() => {
    if (spaceProbeRetryTimerRef.current) clearTimeout(spaceProbeRetryTimerRef.current);
    spaceProbeRetryTimerRef.current = setTimeout(() => {
      spaceProbeRetryTimerRef.current = null;
      spaceProbeSentRef.current = false;
      setSpaceProbeAttempt((attempt) => attempt + 1);
    }, 1_500);
  }, []);

  useEffect(() => {
    if (!telemetry.connected) {
      spaceProbeSentRef.current = false;
      spaceProbeIntentIdsRef.current.clear();
      if (spaceProbeRetryTimerRef.current) clearTimeout(spaceProbeRetryTimerRef.current);
      spaceProbeRetryTimerRef.current = null;
      return;
    }
    if (starting || spaceProbeSentRef.current) return;

    spaceProbeSentRef.current = true;
    void window.holocron?.sendIntent("probe_space").then((result) => {
      if (result?.accepted === false) {
        scheduleSpaceProbeRetry();
        return;
      }
      if (result?.id) {
        spaceProbeIntentIdsRef.current.add(result.id);
        setTimeout(() => spaceProbeIntentIdsRef.current.delete(result.id!), 60_000);
      }
    });
  }, [scheduleSpaceProbeRetry, spaceProbeAttempt, starting, telemetry.connected]);

  const selectContact = useCallback((id: string | null) => {
    if (!id || id === "player-ship") {
      setExpandedClusterId(null);
      setHoveredMemberId(null);
      setSelectedId(null);
      return;
    }
    const point = findScenePoint(sceneRef.current, id);
    if (point?.kind === "cluster") {
      setExpandedClusterId(point.id);
      setSelectedId(null);
      setHoveredMemberId(null);
      return;
    }
    setExpandedClusterId(null);
    setHoveredMemberId(null);
    setSelectedId((current) => current === id ? null : id);
  }, []);
  const observer = scene.points[0];
  const expandedCluster = findScenePoint(scene, expandedClusterId);
  const selected = findScenePoint(scene, hoveredMemberId) ?? findScenePoint(scene, selectedId);
  const displayedSelection = selected ?? observer;
  const landed = telemetry.spaceState?.inSpace === false;
  const sensorRange = telemetry.snapshot ? sensorRangeFor(telemetry.snapshot.observer) : null;
  const observerSpeed = typeof observer.speed === "object" && observer.speed ? Number(observer.speed.current) || 0 : Number(observer.speed) || 0;
  const observedMaximumSpeed = typeof observer.speed === "object" && observer.speed
    ? Number(observer.speed.maximum) || 0
    : Number(observer.maximumSpeed) || 0;
  const maximumSpeed = observedMaximumSpeed > 0 ? observedMaximumSpeed : knownMaximumSpeed;
  const navigableTarget = selected && ["ship", "planet", "celestial", "star"].includes(selected.kind) ? selected : null;
  const navigationTarget = findScenePoint(scene, navigationTargetId);
  const selectedShip = selected?.kind === "ship" ? selected : null;
  const autotrackObserved = typeof observer.autotrack === "boolean" ? observer.autotrack : null;
  const observerHasNoWeapons = observer.hasWeapons === false;
  const autotrackDesired = telemetry.snapshot?.metadata?.autotrackDesired !== false;
  const autotrackPending = telemetry.snapshot?.metadata?.autotrackPending === true;
  const combatEvent = telemetry.snapshot?.metadata?.combatEvent;
  const combatEvents = telemetry.snapshot?.metadata?.combatEvents
    ?? (combatEvent ? [combatEvent] : []);
  const reportedCombatTarget = String(telemetry.snapshot?.metadata?.combatTarget
    || (typeof observer.target === "string" ? observer.target : "")).trim();
  const combatTargetName = reportedCombatTarget && reportedCombatTarget.toLowerCase() !== "none"
    ? reportedCombatTarget
    : null;
  const shieldReading = observer.shields && typeof observer.shields === "object"
    ? observer.shields as { current?: number; maximum?: number }
    : null;
  const shieldsFull = Number.isFinite(shieldReading?.current)
    && Number.isFinite(shieldReading?.maximum)
    && Number(shieldReading?.maximum) > 0
    && Number(shieldReading?.current) >= Number(shieldReading?.maximum);
  const shieldRecharging = telemetry.snapshot?.metadata?.shieldRecharging === true;
  const shieldStatusPending = telemetry.snapshot?.metadata?.shieldStatusPending === true;
  const autoRechargeEnabled = telemetry.snapshot?.metadata?.autoRechargeEnabled !== false;
  const hyperspaceState = telemetry.snapshot?.metadata?.hyperspace || { phase: "idle" as const };
  const hyperdriveClearance = hyperspaceClearance(telemetry.snapshot);
  const navigationDestinations = telemetry.snapshot?.metadata?.navigation?.destinations || [];
  const navigationGalaxy = telemetry.snapshot?.metadata?.navigation?.galaxy;
  const catalogGalaxy = telemetry.galaxyCatalog?.shipSystem;
  const currentGalaxyPosition = Number.isFinite(Number(navigationGalaxy?.x))
      && Number.isFinite(Number(navigationGalaxy?.y))
    ? { x: Number(navigationGalaxy?.x), y: Number(navigationGalaxy?.y) }
    : Number.isFinite(Number(catalogGalaxy?.x)) && Number.isFinite(Number(catalogGalaxy?.y))
    ? { x: Number(catalogGalaxy?.x), y: Number(catalogGalaxy?.y) }
    : undefined;
  const galaxyCatalogSize = Object.keys(telemetry.galaxyCatalog?.systems || {}).length
    + Object.keys(telemetry.galaxyCatalog?.customSystems || {}).length;

  const plotHyperspace = useCallback(async (route: HyperspaceRoutePayload, escape?: EscapePlanDraft) => {
    setActiveRoute(route);
    setEscapePlan(escape);
    setHyperspacePlanner(null);
    escapeTriggeredRef.current = false;
    const result = await window.holocron?.sendIntent("plot_hyperspace", route as unknown as Record<string, unknown>);
    if (result?.accepted === false) {
      setCommandAlert(`ROUTE REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
    }
  }, []);

  const stopHyperspace = useCallback(async () => {
    const result = await window.holocron?.sendIntent("stop_hyperspace");
    if (result?.accepted === false) setCommandAlert(`ABORT REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
  }, []);

  const dismissHyperspace = useCallback(() => {
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, []);

  const engageHyperspace = useCallback(async () => {
    if (!hyperdriveClearance.allowed) {
      setCommandAlert(`HYPERDRIVE BLOCKED // ${String(hyperdriveClearance.reason || "FRESH RADAR CLEARANCE REQUIRED").toUpperCase()}`);
      return;
    }
    const result = await window.holocron?.sendIntent("engage_hyperdrive");
    if (result?.accepted === false) setCommandAlert(`HYPERDRIVE BLOCKED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
  }, [hyperdriveClearance.allowed, hyperdriveClearance.reason]);

  const escapeHyperspace = useCallback(async () => {
    setHyperspaceEscapePending(true);
    const result = await window.holocron?.sendIntent("escape_hyperspace");
    if (result?.id) hyperspaceEscapeIntentIdsRef.current.add(result.id);
    if (result?.accepted === false) {
      setHyperspaceEscapePending(false);
      setCommandAlert(`HYPERSPACE CUTOFF REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
    }
  }, []);

  const calculateAnyway = useCallback(() => {
    if (!activeRoute) return;
    void plotHyperspace({ ...activeRoute, acknowledgeFuelRisk: true }, escapePlan);
  }, [activeRoute, escapePlan, plotHyperspace]);

  useEffect(() => {
    if (hyperspaceState.phase !== "calculating") return;
    const timer = setInterval(() => void window.holocron?.sendIntent("refresh_navigation", { command: "calc" }), 5_000);
    return () => clearInterval(timer);
  }, [hyperspaceState.phase]);

  useEffect(() => {
    if (!activeRoute || hyperspaceState.phase !== "ready" || hyperdriveClearance.known) return;
    const refreshClearance = () => void window.holocron?.sendIntent("probe_space");
    refreshClearance();
    const timer = setInterval(refreshClearance, 5_000);
    return () => clearInterval(timer);
  }, [activeRoute, hyperdriveClearance.known, hyperspaceState.phase]);

  useEffect(() => {
    if (!hyperspacePlanner) return;
    const needsRange = navigationDestinations.length === 0;
    const needsCatalog = hyperspacePlanner === "galactic" && galaxyCatalogSize === 0;
    const needsPosition = !currentGalaxyPosition;
    if (!needsRange && !needsCatalog && !needsPosition) return;

    const refreshMissingNavigationData = () => {
      if (needsCatalog) void window.holocron?.sendIntent("refresh_galaxy_catalog");
      if (needsPosition) void window.holocron?.sendIntent("refresh_navigation", { command: "navstat" });
      else if (needsRange) void window.holocron?.sendIntent("refresh_navigation", { command: "calc" });
    };
    refreshMissingNavigationData();
    const timer = setInterval(refreshMissingNavigationData, 2_500);
    return () => clearInterval(timer);
  }, [currentGalaxyPosition?.x, currentGalaxyPosition?.y, galaxyCatalogSize, hyperspacePlanner, navigationDestinations.length]);

  useEffect(() => {
    if (hyperspaceState.phase !== "hyperspace") setHyperspaceEscapePending(false);
  }, [hyperspaceState.phase]);

  useEffect(() => {
    if (hyperspaceState.phase !== "arrived") {
      arrivalRefreshAtRef.current = null;
      return;
    }

    // A completed route is no longer actionable. Remove its computer panel as
    // soon as arrival is confirmed, even while destination telemetry refreshes.
    setActiveRoute(null);

    const arrivedAt = Number(hyperspaceState.arrivedAt) || 0;
    const arrivalNavigationReady = Number(telemetry.snapshot?.metadata?.navigation?.arrivalRefreshedAt) >= arrivedAt;
    if (arrivalRefreshAtRef.current !== arrivedAt) {
      arrivalRefreshAtRef.current = arrivedAt;
      void window.holocron?.sendIntent("refresh_navigation", {
        command: "navstat",
        followupRadar: true,
      });
    }

    if (escapePlan && !escapeTriggeredRef.current) {
      if (!arrivalNavigationReady) return;
      const actualX = Number(currentGalaxyPosition?.x);
      const actualY = Number(currentGalaxyPosition?.y);
      if (actualX !== escapePlan.triggerGalaxy.x || actualY !== escapePlan.triggerGalaxy.y) return;
      escapeTriggeredRef.current = true;
      const escapeRoute = escapePlan.route;
      setActiveRoute(escapeRoute);
      setEscapePlan(undefined);
      void window.holocron?.sendIntent("plot_hyperspace", escapeRoute as unknown as Record<string, unknown>);
      return;
    }
  }, [currentGalaxyPosition?.x, currentGalaxyPosition?.y, escapePlan, hyperspaceState.arrivedAt,
    hyperspaceState.phase, telemetry.snapshot?.metadata?.navigation?.arrivalRefreshedAt]);

  useEffect(() => {
    if (telemetry.connected) return;
    setHyperspacePlanner(null);
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, [telemetry.connected]);

  const cancelNavigation = useCallback(() => {
    setNavigationMode("idle");
    setPendingNavigationMode("relative");
    setNavigationTargetId(null);
    setNavigationStatus("");
    setCommandAlert("");
    setRequestedSpeed(Math.max(0, Math.min(
      lastMaximumSpeedRef.current ?? 0,
      lastObservedSpeedRef.current ?? 0,
    )));
    tacticalRef.current?.setMovementActive(false);
  }, []);

  const beginVectorCourse = useCallback(() => {
    if (!telemetry.connected || landed || commandLocked) return;
    setExpandedClusterId(null);
    setHoveredMemberId(null);
    setPendingNavigationMode("relative");
    setNavigationTargetId(null);
    setNavigationMode("vector");
    setNavigationStatus("MOVE CURSOR // SHIFT ELEVATION // MMB ORBIT");
    tacticalRef.current?.setMovementActive(true, courseVector, true);
  }, [commandLocked, courseVector, landed, telemetry.connected]);

  const armTargetCourse = useCallback((mode: "target" | "away") => {
    if (!navigableTarget) return;
    setExpandedClusterId(null);
    setHoveredMemberId(null);
    const multiplier = mode === "away" ? -1 : 1;
    const preview = navigableTarget.position3d.map((value) => value * multiplier) as Vector3;
    setPendingNavigationMode(mode);
    setNavigationTargetId(navigableTarget.id);
    setNavigationMode(mode);
    setNavigationStatus(mode === "away" ? "CONFIRM REVERSE COURSE" : "CONFIRM INTERCEPT COURSE");
    tacticalRef.current?.setMovementActive(true, Math.hypot(...preview) > 0 ? preview : [100 * multiplier, 0, 0], false);
  }, [navigableTarget]);

  const stageNavigation = useCallback(() => {
    setNavigationMode("confirm");
    setNavigationStatus("COURSE READY // CONFIRM ORDER");
    tacticalRef.current?.freezeMovement();
  }, []);

  const submitNavigation = useCallback(async () => {
    if (commandLocked) {
      setCommandAlert("NAVIGATION COMPUTER IS WAITING FOR THE CURRENT MANEUVER");
      return;
    }
    if (observerSpeed === 0 && requestedSpeed === 0) {
      setNavigationStatus("DEPARTURE SPEED REQUIRED // SELECT PLAYER SPEED");
      setCommandAlert("SELECT A NON-ZERO DEPARTURE SPEED");
      return;
    }
    const payload: Record<string, unknown> = { mode: pendingNavigationMode };
    if (pendingNavigationMode === "relative") payload.vector = { x: courseVector[0], y: courseVector[1], z: courseVector[2] };
    else if (navigationTarget) payload.targetId = navigationTarget.id;
    else {
      setNavigationStatus("ORDER BLOCKED // TARGET CONTACT LOST");
      return;
    }
    if (observerSpeed === 0) payload.departureSpeed = requestedSpeed;
    setNavigationStatus("TRANSMITTING COURSE...");
    const result = await window.holocron?.sendIntent("navigate_ship", payload);
    if (result?.accepted === false) {
      setNavigationStatus(`ORDER REJECTED // ${result.reason || "UNKNOWN"}`);
      return;
    }
    if (result?.id) {
      pendingIntentIdsRef.current.add(result.id);
      setTimeout(() => pendingIntentIdsRef.current.delete(result.id!), 60_000);
    }
    const lockToken = navigationLockTokenRef.current + 1;
    navigationLockTokenRef.current = lockToken;
    setCommandLocked(true);
    setTimeout(() => {
      if (navigationLockTokenRef.current !== lockToken) return;
      navigationLockTokenRef.current += 1;
      setCommandLocked(false);
      setCommandAlert("MANEUVER CONFIRMATION TIMED OUT // CONTROLS RELEASED");
      setTimeout(() => setCommandAlert(""), 5_000);
    }, 50_000);
    setNavigationStatus("MANEUVER IN PROGRESS");
    setNavigationMode("idle");
    tacticalRef.current?.setMovementActive(false);
  }, [commandLocked, courseVector, navigationTarget, observerSpeed, pendingNavigationMode, requestedSpeed]);

  const commitSpeed = useCallback(async (speed: number) => {
    const nextSpeed = Math.max(0, Math.min(maximumSpeed, Math.round(speed)));
    if (navigationMode !== "idle" && observerSpeed === 0) {
      setRequestedSpeed(nextSpeed);
      setNavigationStatus(nextSpeed > 0
        ? `DEPARTURE SPEED ${nextSpeed} // READY WITH COURSE`
        : "DEPARTURE SPEED REQUIRED // SELECT PLAYER SPEED");
      setCommandAlert("");
      return;
    }
    if (!telemetry.connected || landed || commandLocked || maximumSpeed <= 0 || nextSpeed === observerSpeed
        || lastSpeedIntentRef.current === nextSpeed) return;
    lastSpeedIntentRef.current = nextSpeed;
    const result = await window.holocron?.sendIntent("set_ship_speed", { speed: nextSpeed });
    if (result?.accepted === false) {
      setCommandAlert(`SPEED ORDER REJECTED // ${result.reason || "UNKNOWN"}`);
      lastSpeedIntentRef.current = null;
      return;
    }
    if (result?.id) {
      pendingIntentIdsRef.current.add(result.id);
      setTimeout(() => pendingIntentIdsRef.current.delete(result.id!), 12_000);
    }
    setCommandLocked(true);
    setTimeout(() => setCommandLocked(false), 1_500);
  }, [commandLocked, landed, maximumSpeed, navigationMode, observerSpeed, telemetry.connected]);

  const chooseSpeed = useCallback((speed: number) => {
    setRequestedSpeed(speed);
    void commitSpeed(speed);
  }, [commitSpeed]);

  const requestShipScan = useCallback(async (source: "status" | "info") => {
    if (!selectedShip || !telemetry.connected || landed || commandLocked || manualScanSource) return;
    const token = manualScanRequestTokenRef.current + 1;
    manualScanRequestTokenRef.current = token;
    manualScanStartSequenceRef.current = telemetry.snapshot?.sequence ?? 0;
    setManualScanSource(source);
    setManualScanStatus(`${source.toUpperCase()} SCAN TRANSMITTING...`);
    const result = await window.holocron?.sendIntent("scan_ship", {
      targetId: selectedShip.id,
      source,
    });
    if (result?.accepted === false) {
      const message = `${source.toUpperCase()} SCAN REJECTED // ${result.reason || "UNKNOWN"}`;
      setCommandAlert(message);
      setManualScanSource(null);
      setManualScanStatus(message);
      return;
    }
    if (result?.id) {
      pendingIntentIdsRef.current.add(result.id);
      manualScanIntentIdsRef.current.add(result.id);
      setTimeout(() => pendingIntentIdsRef.current.delete(result.id!), 12_000);
      setTimeout(() => manualScanIntentIdsRef.current.delete(result.id!), 12_000);
    }
    setManualScanStatus(`${source.toUpperCase()} SCAN REQUESTED // ${selectedShip.name.toUpperCase()}`);
    setTimeout(() => {
      if (manualScanRequestTokenRef.current !== token) return;
      manualScanRequestTokenRef.current += 1;
      setManualScanSource(null);
      setManualScanStatus(`${source.toUpperCase()} SCAN TIMED OUT`);
    }, 10_000);
  }, [commandLocked, landed, manualScanSource, selectedShip, telemetry.connected, telemetry.snapshot?.sequence]);

  const targetSelectedShip = useCallback(async () => {
    if (!selectedShip || !telemetry.connected || landed || commandLocked) return;
    setCommandAlert(`TARGETING ${selectedShip.name.toUpperCase()} // AGGRESSIVE ACT`);
    const result = await window.holocron?.sendIntent("target_ship", { targetId: selectedShip.id });
    if (result?.accepted === false) {
      setCommandAlert(`TARGET ORDER REJECTED // ${result.reason || "UNKNOWN"}`);
      return;
    }
    if (result?.id) {
      const lockToken = targetLockTokenRef.current + 1;
      targetLockTokenRef.current = lockToken;
      setCommandLocked(true);
      setCommandAlert(`TRACKING ${selectedShip.name.toUpperCase()} // HOLDING COMMAND OUTPUT`);
      pendingIntentIdsRef.current.add(result.id);
      targetIntentShipsRef.current.set(result.id, { name: selectedShip.name });
      setTimeout(() => {
        if (targetLockTokenRef.current !== lockToken) return;
        targetLockTokenRef.current += 1;
        pendingIntentIdsRef.current.delete(result.id!);
        targetIntentShipsRef.current.delete(result.id!);
        setCommandLocked(false);
        setCommandAlert("TARGET LOCK TIMED OUT // CONTROLS RELEASED");
      }, 50_000);
    }
  }, [commandLocked, landed, selectedShip, telemetry.connected]);

  const toggleAutotrack = useCallback(async () => {
    if (!telemetry.connected || landed || autotrackPending) return;
    const enabled = !autotrackDesired;
    setCommandAlert(`AUTOTRACK ${enabled ? "ON" : "OFF"} // AWAITING SHIP CONFIRMATION`);
    const result = await window.holocron?.sendIntent("set_autotrack", { enabled });
    if (result?.accepted === false) {
      setCommandAlert(`AUTOTRACK REJECTED // ${result.reason || "UNKNOWN"}`);
      return;
    }
    if (result?.id) {
      pendingIntentIdsRef.current.add(result.id);
      autotrackIntentIdsRef.current.add(result.id);
      setTimeout(() => {
        pendingIntentIdsRef.current.delete(result.id!);
        autotrackIntentIdsRef.current.delete(result.id!);
      }, 12_000);
    }
  }, [autotrackDesired, autotrackPending, landed, telemetry.connected]);

  const fireWeapon = useCallback(async (weapon: WeaponType | "all") => {
    if (!telemetry.connected || landed || commandLocked) return "weapons controls unavailable";
    const result = await window.holocron?.sendIntent("fire_weapon", { weapon });
    return result?.accepted === false ? result.reason || "fire order rejected" : null;
  }, [commandLocked, landed, telemetry.connected]);

  const rechargeShields = useCallback(async () => {
    if (!telemetry.connected || landed || commandLocked || shieldRecharging || shieldsFull) return;
    const result = await window.holocron?.sendIntent("recharge_shields");
    if (result?.accepted === false) {
      setCommandAlert(`SHIELD RECHARGE REJECTED // ${(result.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    if (result?.id) pendingIntentIdsRef.current.add(result.id);
  }, [commandLocked, landed, shieldRecharging, shieldsFull, telemetry.connected]);

  const toggleAutoRecharge = useCallback(async () => {
    const enabled = !autoRechargeEnabled;
    const result = await window.holocron?.sendIntent("set_auto_recharge", { enabled });
    if (result?.accepted === false) {
      setCommandAlert(`AUTO RECHARGE REJECTED // ${(result.reason || "UNKNOWN").toUpperCase()}`);
    }
  }, [autoRechargeEnabled]);

  useEffect(() => {
    if (observedMaximumSpeed > 0 && observedMaximumSpeed !== knownMaximumSpeed) {
      setKnownMaximumSpeed(observedMaximumSpeed);
    }
    if (lastObservedSpeedRef.current === observerSpeed
        && lastMaximumSpeedRef.current === maximumSpeed) return;
    lastObservedSpeedRef.current = observerSpeed;
    lastMaximumSpeedRef.current = maximumSpeed;
    lastSpeedIntentRef.current = null;
    setRequestedSpeed(Math.max(0, Math.min(maximumSpeed, observerSpeed)));
  }, [knownMaximumSpeed, maximumSpeed, observedMaximumSpeed, observerSpeed]);

  useEffect(() => window.holocron?.onIntentAck((ack) => {
    if (ack.id && spaceProbeIntentIdsRef.current.has(ack.id)) {
      if (ack.status === "accepted") return;
      spaceProbeIntentIdsRef.current.delete(ack.id);
      const reason = String(ack.reason || "").toLowerCase();
      if (ack.status === "rejected"
          && (reason.includes("target lock") || reason.includes("another ship command")
            || reason.includes("manual telemetry capture"))) {
        scheduleSpaceProbeRetry();
      }
      return;
    }
    if (ack.id && hyperspaceEscapeIntentIdsRef.current.has(ack.id)) {
      hyperspaceEscapeIntentIdsRef.current.delete(ack.id);
      if (ack.status === "rejected") {
        setHyperspaceEscapePending(false);
        setCommandAlert(`HYPERSPACE CUTOFF REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`);
      }
      return;
    }
    if (!ack.id || !pendingIntentIdsRef.current.has(ack.id)) return;
    const autotrackIntent = autotrackIntentIdsRef.current.has(ack.id);
    if (autotrackIntent && ack.status !== "accepted") {
      pendingIntentIdsRef.current.delete(ack.id);
      autotrackIntentIdsRef.current.delete(ack.id);
      setCommandAlert(ack.status === "completed"
        ? String(ack.reason || "AUTOTRACK UPDATED").toUpperCase()
        : `AUTOTRACK REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    const targetedShip = targetIntentShipsRef.current.get(ack.id);
    if (ack.status === "accepted" && targetedShip) {
      setDispositions((current) => {
        const next = { ...current, [dispositionKey(targetedShip.name)]: "enemy" as ShipDisposition };
        localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
      syncedDispositionsRef.current.set(dispositionKey(targetedShip.name), "enemy");
      setCommandAlert(`TRACKING ${targetedShip.name.toUpperCase()} // HOLDING COMMAND OUTPUT`);
      return;
    }
    if (ack.status === "completed") {
      pendingIntentIdsRef.current.delete(ack.id);
      const completedTarget = targetIntentShipsRef.current.get(ack.id);
      targetIntentShipsRef.current.delete(ack.id);
      if (completedTarget) targetLockTokenRef.current += 1;
      navigationLockTokenRef.current += 1;
      setCommandLocked(false);
      const completion = String(ack.reason || "COMMAND COMPLETE").toUpperCase();
      setNavigationStatus(completion);
      if (completedTarget) setCommandAlert(`${completion} // ${completedTarget.name.toUpperCase()}`);
      return;
    }
    if (ack.status !== "rejected") return;
    pendingIntentIdsRef.current.delete(ack.id);
    const rejectedTarget = targetIntentShipsRef.current.get(ack.id);
    targetIntentShipsRef.current.delete(ack.id);
    if (rejectedTarget) targetLockTokenRef.current += 1;
    navigationLockTokenRef.current += 1;
    const rejectedManualScan = manualScanIntentIdsRef.current.delete(ack.id);
    if (rejectedManualScan) {
      manualScanRequestTokenRef.current += 1;
      setManualScanSource(null);
      setManualScanStatus(String(ack.reason || "SHIP SCAN REJECTED").toUpperCase());
    }
    const message = String(ack.reason || "COMMAND REJECTED").toUpperCase();
    lastSpeedIntentRef.current = null;
    setRequestedSpeed(Math.max(0, Math.min(
      lastMaximumSpeedRef.current ?? 0,
      lastObservedSpeedRef.current ?? 0,
    )));
    setCommandAlert(message);
    setNavigationStatus(message);
    setCommandLocked(false);
    setTimeout(() => setCommandAlert(""), 5_000);
  }), [scheduleSpaceProbeRetry]);

  useEffect(() => {
    if (!manualScanSource || !telemetry.snapshot) return;
    if ((telemetry.snapshot.sequence ?? 0) <= manualScanStartSequenceRef.current
        || telemetry.snapshot.metadata?.lastSource !== manualScanSource) return;
    manualScanRequestTokenRef.current += 1;
    setManualScanSource(null);
    setManualScanStatus(`${manualScanSource.toUpperCase()} TELEMETRY UPDATED`);
  }, [manualScanSource, telemetry.snapshot]);

  useEffect(() => {
    if (!commandAlert) return;
    const timer = setTimeout(() => setCommandAlert(""), 5_000);
    return () => clearTimeout(timer);
  }, [commandAlert]);

  useEffect(() => {
    if (!manualScanStatus || manualScanSource) return;
    const timer = setTimeout(() => setManualScanStatus(""), 5_000);
    return () => clearTimeout(timer);
  }, [manualScanSource, manualScanStatus]);

  useEffect(() => {
    if (landed || !telemetry.connected) {
      navigationLockTokenRef.current += 1;
      setCommandLocked(false);
      cancelNavigation();
    }
  }, [cancelNavigation, landed, telemetry.connected]);

  useEffect(() => {
    const handleNavigationKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "m" && navigationMode === "idle") beginVectorCourse();
      else if (event.key === "Escape" && navigationMode !== "idle") cancelNavigation();
      else if (event.key === "Enter" && ["confirm", "target", "away"].includes(navigationMode)) void submitNavigation();
      else if (event.key === "Enter" && navigationMode === "vector") stageNavigation();
    };
    window.addEventListener("keydown", handleNavigationKey);
    return () => window.removeEventListener("keydown", handleNavigationKey);
  }, [beginVectorCourse, cancelNavigation, navigationMode, stageNavigation, submitNavigation]);
  const setShipDisposition = useCallback((point: ScenePoint, disposition: ShipDisposition) => {
    const name = point.name;
    setDispositions((current) => {
      const next = { ...current, [dispositionKey(name)]: disposition };
      localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    syncedDispositionsRef.current.set(dispositionKey(name), disposition);
    void window.holocron?.sendIntent("set_ship_disposition", { name, disposition });
  }, []);
  useEffect(() => {
    const hostileNames = (telemetry.snapshot?.entities ?? [])
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
        syncedDispositionsRef.current.set(key, "enemy");
      }
      if (!changed) return current;
      localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [telemetry.snapshot]);

  useEffect(() => {
    if (!telemetry.connected) {
      syncedDispositionsRef.current.clear();
      return;
    }
    for (const entity of telemetry.snapshot?.entities ?? []) {
      if (entity.kind !== "ship") continue;
      const name = entity.name || entity.id;
      const key = dispositionKey(name);
      if (entity.disposition === "enemy") {
        syncedDispositionsRef.current.set(key, "enemy");
        continue;
      }
      const disposition = dispositions[key];
      if (!disposition || syncedDispositionsRef.current.get(key) === disposition) continue;
      syncedDispositionsRef.current.set(key, disposition);
      void window.holocron?.sendIntent("set_ship_disposition", { name, disposition });
    }
  }, [dispositions, telemetry.connected, telemetry.snapshot]);

  return (
    <>
      {starting && <StartupSequence onComplete={finishStartup} />}
      {!starting && ["hyperspace", "reentry"].includes(hyperspaceState.phase || "") &&
        <HyperspaceTransit reentry={hyperspaceState.phase === "reentry"}
          escapePending={hyperspaceEscapePending} onEscape={() => void escapeHyperspace()} />}
      <main className={`${styles.experience} ${starting ? styles.startupActive : ""}`}>
        <TacticalCanvas
          ref={tacticalRef}
          snapshot={classifiedSnapshot}
          radarBubbleEnabled={radarBubbleEnabled}
          originGridEnabled={originGridEnabled}
          combatEvents={combatEvents}
          onSelect={selectContact}
          onMovementVector={setCourseVector}
          onMovementCommit={stageNavigation}
          onMovementCancel={cancelNavigation}
        />
        <div className={styles.scanlines} aria-hidden="true" />

        <header className={`${styles.topbar} ${styles.panel}`}>
          <div className={styles.systemIdentity}>
            <p className={styles.eyebrow}>HOLOCRON 3D // LIVE TACTICAL</p>
            <h1 id="system-name">{telemetry.snapshot ? scene.system : "Awaiting telemetry"}</h1>
          </div>
          {telemetry.connected && (
            <nav className={styles.viewControls} aria-label="Tactical view controls">
              <button
                type="button"
                className={`${styles.iconButton} ${radarBubbleEnabled ? styles.activeViewControl : ""}`}
                aria-label={`${radarBubbleEnabled ? "Hide" : "Show"} radar bubble`}
                aria-pressed={radarBubbleEnabled}
                data-tooltip={`${radarBubbleEnabled ? "HIDE" : "SHOW"} RADAR BUBBLE`}
                onClick={() => setRadarBubbleEnabled((enabled) => !enabled)}
              ><ViewIcon type="radar" /></button>
              <button
                type="button"
                className={`${styles.iconButton} ${originGridEnabled ? styles.activeViewControl : ""}`}
                aria-label={`${originGridEnabled ? "Hide" : "Show"} origin grid`}
                aria-pressed={originGridEnabled}
                data-tooltip={`${originGridEnabled ? "HIDE" : "SHOW"} ORIGIN GRID`}
                onClick={() => setOriginGridEnabled((enabled) => !enabled)}
              ><ViewIcon type="grid" /></button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Open strategic sector view"
                data-tooltip="STRATEGIC SECTOR VIEW"
                onClick={() => tacticalRef.current?.sectorView()}
              ><ViewIcon type="sector" /></button>
              <button type="button" className={styles.iconButton} disabled={landed || activeRoute !== null}
                aria-label="Plot a local hyperspace jump" data-tooltip="LOCAL JUMP"
                onClick={() => setHyperspacePlanner("local")}><HyperspaceIcon /></button>
              <button type="button" className={styles.iconButton} disabled={landed || activeRoute !== null}
                aria-label="Plot a galactic hyperspace route" data-tooltip="PLOT HYPERSPACE ROUTE"
                onClick={() => setHyperspacePlanner("galactic")}><HyperspaceIcon galactic /></button>
            </nav>
          )}
          <div className={styles.connection}>
            <span className={`${styles.light} ${telemetry.connected ? styles.live : ""}`} />
            <span>{telemetry.connectionLabel}</span>
          </div>
        </header>

        {landed && (
          <section className={styles.landed} role="status">
            <span>SPACE TELEMETRY PAUSED</span>
            <small>{telemetry.spaceState?.reason || "Ship is landed"}</small>
          </section>
        )}

        {!telemetry.connected && <UplinkNotice />}

        {hyperspacePlanner && <HyperspacePlanner mode={hyperspacePlanner} catalog={telemetry.galaxyCatalog}
          currentSystem={scene.system} currentGalaxy={currentGalaxyPosition} observer={telemetry.snapshot?.observer || {}}
          destinations={navigationDestinations}
          onCancel={() => setHyperspacePlanner(null)} onPlot={(route, escape) => void plotHyperspace(route, escape)} />}

        {activeRoute && !hyperspacePlanner && <NavigationComputer route={activeRoute} state={hyperspaceState}
          escape={escapePlan} clearance={hyperdriveClearance} onStop={() => void stopHyperspace()} onDismiss={dismissHyperspace}
          onEngage={() => void engageHyperspace()} onCalculateAnyway={calculateAnyway} />}

        {telemetry.connected && navigationMode !== "idle" && (
          <NavigationDrawer
            mode={navigationMode}
            kind={pendingNavigationMode}
            targetName={navigationTarget?.name}
            targetDistance={navigationTarget ? Math.hypot(...navigationTarget.position3d) : undefined}
            vector={courseVector}
            status={navigationStatus}
            observerStopped={observerSpeed === 0}
            speed={requestedSpeed}
            maximumSpeed={maximumSpeed}
            commandLocked={commandLocked}
            onSpeedChange={setRequestedSpeed}
            onSpeedCommit={chooseSpeed}
            onStageVector={stageNavigation}
            onConfirm={() => void submitNavigation()}
            onCancel={cancelNavigation}
          />
        )}

        {telemetry.connected && combatTargetName && navigationMode === "idle" && (
          <WeaponsPanel
            observer={telemetry.snapshot?.observer || observer}
            targetName={combatTargetName}
            events={combatEvents}
            disabled={landed || commandLocked}
            onFire={fireWeapon}
          />
        )}

        {telemetry.connected && (
          <footer className={`${styles.commandDeck} ${styles.panel}`}>
            <section className={styles.commandBank} aria-label="Selected contact commands">
              {commandAlert && <div className={styles.commandAlert} role="alert">{commandAlert}</div>}
              {navigationMode !== "idle" ? (
                <>
                  <p className={styles.eyebrow}>COMMAND // NAVIGATION</p>
                  <div className={styles.actionPending} role="status">
                    <span className={styles.pendingSignal} aria-hidden="true" />
                    <strong>WAITING FOR CONFIRMATION</strong>
                    <small>{pendingNavigationMode === "relative"
                      ? "COURSE VECTOR"
                      : `${pendingNavigationMode === "away" ? "COURSE AWAY" : "COURSE TO"} // ${(navigationTarget?.name || "TARGET LOST").toUpperCase()}`}</small>
                    <button type="button" onClick={cancelNavigation}><CommandIcon type="cancel" /><span>CANCEL COMMAND</span></button>
                  </div>
                </>
              ) : (
                <>
                  <p className={styles.eyebrow}>COMMAND // {(navigableTarget?.name || observer.name).toUpperCase()}</p>
                  <div className={styles.orderActions}>
                    {navigableTarget ? <>
                      {selectedShip && <>
                        <button type="button" className={`${styles.iconButton} ${styles.aggressiveOrder}`} disabled={landed || commandLocked || observerHasNoWeapons} aria-label="Target selected ship" data-tooltip={observerHasNoWeapons ? "This ship has no weapons" : "TARGET // AGGRESSIVE ACT"} onClick={() => void targetSelectedShip()}><CommandIcon type="target" /></button>
                        <button type="button" className={styles.iconButton} disabled={landed || commandLocked || manualScanSource !== null} aria-label="Scan selected ship status" data-tooltip="SCAN" onClick={() => void requestShipScan("status")}><CommandIcon type="scan" /></button>
                        <button type="button" className={styles.iconButton} disabled={landed || commandLocked || manualScanSource !== null} aria-label="Inspect selected ship information" data-tooltip="INFO" onClick={() => void requestShipScan("info")}><CommandIcon type="info" /></button>
                      </>}
                      <button type="button" className={styles.iconButton} disabled={landed || commandLocked} aria-label="Course toward selected contact" data-tooltip="TO" onClick={() => armTargetCourse("target")}><CommandIcon type="to" /></button>
                      <button type="button" className={styles.iconButton} disabled={landed || commandLocked} aria-label="Course away from selected contact" data-tooltip="AWAY" onClick={() => armTargetCourse("away")}><CommandIcon type="away" /></button>
                    </> : (
                      <button type="button" disabled={landed || commandLocked} className={styles.iconButton} aria-label="Set relative course" data-tooltip="MOVE / M" onClick={beginVectorCourse}><MoveIcon /></button>
                    )}
                    <button
                      type="button"
                      className={`${styles.iconButton} ${autotrackObserved === true ? styles.activeOrder : ""}`}
                      disabled={landed || autotrackPending}
                      aria-label={`${autotrackDesired ? "Disable" : "Enable"} autotrack`}
                      aria-pressed={autotrackObserved === true}
                      data-tooltip={`AUTOTRACK ${autotrackPending ? "AWAITING CONFIRMATION" : autotrackDesired ? "ON" : "OFF"}`}
                      onClick={() => void toggleAutotrack()}
                    ><CommandIcon type="track" /></button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      disabled={landed || commandLocked || shieldRecharging || shieldStatusPending || shieldsFull}
                      aria-label="Recharge shields to full"
                      data-tooltip={shieldsFull ? "SHIELDS AT PEAK POWER" : shieldRecharging ? "SHIELD RECHARGE RUNNING" : "RECHARGE SHIELDS TO FULL"}
                      onClick={() => void rechargeShields()}
                    ><CommandIcon type="recharge" /></button>
                    <button
                      type="button"
                      className={`${styles.iconButton} ${autoRechargeEnabled ? styles.activeOrder : ""}`}
                      disabled={landed}
                      aria-label={`${autoRechargeEnabled ? "Disable" : "Enable"} automatic shield recharge`}
                      aria-pressed={autoRechargeEnabled}
                      data-tooltip={`AUTO RECHARGE ${autoRechargeEnabled ? "ON" : "OFF"}`}
                      onClick={() => void toggleAutoRecharge()}
                    ><CommandIcon type="autoRecharge" /></button>
                  </div>
                  {selectedShip && <div className={styles.aggressiveWarning}>TARGET // WEAPON LOCK IS AN AGGRESSIVE ACT</div>}
                  <ShipSpeedControl
                    id="ship-speed"
                    label={`PLAYER SPEED // ${observer.name.toUpperCase()}`}
                    value={requestedSpeed}
                    maximum={maximumSpeed}
                    disabled={landed || commandLocked}
                    onChange={setRequestedSpeed}
                    onCommit={chooseSpeed}
                  />
                  {selectedShip ? (
                    <>
                      <div className={styles.dispositions} aria-label="Ship disposition">
                        {(["neutral", "ally", "enemy"] as ShipDisposition[]).map((disposition) => (
                          <button
                            key={disposition}
                            type="button"
                            className={styles.iconButton}
                            aria-pressed={(selectedShip.disposition || "neutral") === disposition}
                            aria-label={`Mark ship ${disposition === "ally" ? "friendly" : disposition}`}
                            data-tooltip={disposition === "ally" ? "FRIENDLY" : disposition.toUpperCase()}
                            onClick={() => setShipDisposition(selectedShip, disposition)}
                          >
                            <CommandIcon type={disposition === "ally" ? "friendly" : disposition} />
                          </button>
                        ))}
                      </div>
                      {manualScanStatus && <div className={styles.manualScanStatus} role="status">{manualScanStatus}</div>}
                    </>
                  ) : navigableTarget ? (
                    <div className={styles.commandStandby}>SELECT TO OR AWAY // {navigableTarget.name.toUpperCase()}</div>
                  ) : <div className={styles.commandStandby}>M // SET COURSE VECTOR</div>}
                </>
              )}
            </section>

            <section className={`${styles.selectedVessel} ${selected ? "" : styles.playerVessel}`} aria-label="Selected vessel telemetry">
              {selected && <p className={styles.eyebrow}>SELECTED CONTACT</p>}
              <div className={styles.vesselHeading}>
                <div><h2>{displayedSelection.name}</h2><p className={styles.muted}>{displayedSelection.class || displayedSelection.kind || "Unknown contact"}</p></div>
                <div className={styles.vesselTags}>
                  <span>{displayedSelection.shipCategory?.toUpperCase() || "UNCLASSIFIED"}</span>
                  {!selected && <span className={styles.ownershipTag}>YOUR SHIP</span>}
                </div>
              </div>
              <div className={styles.vesselRanges}>
                <RangeMeter label="HULL" reading={displayedSelection.hull as RangeReading | undefined} />
                <RangeMeter label="SHIELD" reading={displayedSelection.shields as RangeReading | undefined} tone="shield" />
                <RangeMeter label="SPEED" reading={typeof displayedSelection.speed === "object" ? displayedSelection.speed as RangeReading : undefined} tone="speed" />
                <RangeMeter label="ENERGY" reading={displayedSelection.energy as RangeReading | undefined} tone="energy" />
              </div>
              <dl className={`${styles.readouts} ${styles.compactReadouts}`}>
                {detailRows(displayedSelection).slice(0, 8).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </section>

            <section className={styles.fleetBank} aria-label="Battlegroup or squadron roster">
              <p className={styles.eyebrow}>FORMATION // ROSTER</p>
              <div className={styles.fleetStatus}><span className={styles.light} /><strong>NOT ASSIGNED</strong></div>
              <button
                type="button"
                className={styles.fleetShip}
                aria-label={`Select ${observer.name}`}
                aria-pressed={!selected}
                onClick={() => selectContact(observer.id)}
              >
                <span>LOCAL ELEMENT</span>
                <strong>{observer.name}</strong>
                <small>{speedLabel(observer.speed)} SPD // {sensorRange === null ? "—" : `${formatCoordinate(sensorRange)} u`} SCAN</small>
              </button>
            </section>
          </footer>
        )}

        {expandedCluster?.members && (
          <section className={`${styles.clusterPanel} ${styles.panel}`} aria-label="Grouped contacts">
            <header>
              <div>
                <p className={styles.eyebrow}>COLOCATED CONTACTS</p>
                <h2>{expandedCluster.memberCount} CONTACTS AT {expandedCluster.worldPosition.map(formatCoordinate).join(" / ")}</h2>
              </div>
              <button
                type="button"
                className={`${styles.closeCluster} ${styles.iconButton}`}
                aria-label="Close grouped contacts"
                data-tooltip="CLOSE CONTACT GROUP"
                onClick={() => {
                  setExpandedClusterId(null);
                  setHoveredMemberId(null);
                  setSelectedId(null);
                }}
              >
                ×
              </button>
            </header>
            <div className={styles.memberGrid}>
              {expandedCluster.members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={selectedId === member.id ? styles.selectedMember : undefined}
                  onMouseEnter={() => setHoveredMemberId(member.id)}
                  onMouseLeave={() => setHoveredMemberId(null)}
                  onFocus={() => setHoveredMemberId(member.id)}
                  onBlur={() => setHoveredMemberId(null)}
                  onClick={() => setSelectedId(member.id)}
                >
                  <strong>{member.name}</strong>
                  <span>{member.class || (member.kind === "ship" ? "Unknown ship class" : member.kind)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
