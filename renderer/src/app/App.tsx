import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildScene, findScenePoint, formatCoordinate, sensorRangeFor, type ScenePoint } from "../domain/scene";
import { NavigationDrawer } from "../features/commands/NavigationDrawer";
import { ShipSpeedControl } from "../features/commands/ShipSpeedControl";
import { UplinkNotice } from "../features/connection/UplinkNotice";
import { StartupSequence } from "../features/startup/StartupSequence";
import { TacticalCanvas, type TacticalCanvasHandle } from "../features/tactical/TacticalCanvas";
import { useTelemetry } from "../features/telemetry/useTelemetry";
import styles from "./App.module.css";
import type { ShipDisposition, Vector3 } from "../types/telemetry";

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
  const rows: Array<[string, string]> = [["TYPE", point.kind || "unknown"]];
  if (point.shipCategory) rows.push(["SHIP CLASS", String(point.shipCategory).toUpperCase()]);
  if (point.id === "player-ship") {
    rows.push(["WORLD XYZ", worldCoordinates], ["CAMERA FOCUS", "LOCKED"]);
  } else {
    rows.push(
      ["SYSTEM XYZ", worldCoordinates],
      ["RELATIVE XYZ", point.position3d.map(formatCoordinate).join(" / ")],
    );
  }
  if (point.distance !== undefined) rows.push(["PROXIMITY", formatCoordinate(point.distance)]);
  if (point.speed !== undefined) rows.push(["VELOCITY", speedLabel(point.speed)]);
  if (point.heading && typeof point.heading === "object") {
    rows.push(["HEADING", [point.heading.x, point.heading.y, point.heading.z].map(formatCoordinate).join(" / ")]);
  }
  if (point.position) rows.push(["FORMATION", point.position]);
  if (point.condition) rows.push(["CONDITION", String(point.condition)]);
  for (const [label, key] of [["HULL", "hull"], ["SHIELDS", "shields"], ["ENERGY", "energy"]] as const) {
    const reading = point[key];
    if (typeof reading === "object" && reading) {
      const value = reading as { current?: number; maximum?: number };
      rows.push([label, `${formatCoordinate(value.current)} / ${formatCoordinate(value.maximum)}`]);
    }
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

type CommandIconType = "target" | "scan" | "info" | "to" | "away" | "track"
  | "cancel" | "neutral" | "friendly" | "enemy";

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
  const [dispositions, setDispositions] = useState<Record<string, ShipDisposition>>(loadDispositions);
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const syncedDispositionsRef = useRef(new Map<string, ShipDisposition>());
  const pendingIntentIdsRef = useRef(new Set<string>());
  const manualScanIntentIdsRef = useRef(new Set<string>());
  const autotrackIntentIdsRef = useRef(new Set<string>());
  const targetIntentShipsRef = useRef(new Map<string, { name: string }>());
  const lastObservedSpeedRef = useRef<number | null>(null);
  const lastMaximumSpeedRef = useRef<number | null>(null);
  const lastSpeedIntentRef = useRef<number | null>(null);
  const manualScanStartSequenceRef = useRef(0);
  const manualScanRequestTokenRef = useRef(0);
  const navigationLockTokenRef = useRef(0);
  const targetLockTokenRef = useRef(0);
  const spaceProbeSentRef = useRef(false);
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

  useEffect(() => {
    if (!telemetry.connected) {
      spaceProbeSentRef.current = false;
      return;
    }
    if (starting || spaceProbeSentRef.current) return;

    spaceProbeSentRef.current = true;
    void window.holocron?.sendIntent("probe_space");
  }, [starting, telemetry.connected]);

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
  }), []);

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
      <main className={`${styles.experience} ${starting ? styles.startupActive : ""}`}>
        <TacticalCanvas
          ref={tacticalRef}
          snapshot={classifiedSnapshot}
          radarBubbleEnabled={radarBubbleEnabled}
          originGridEnabled={originGridEnabled}
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
              <p className={styles.eyebrow}>{selected ? "SELECTED CONTACT" : "PLAYER SHIP"}</p>
              <div className={styles.vesselHeading}>
                <div><h2>{displayedSelection.name}</h2><p className={styles.muted}>{displayedSelection.class || displayedSelection.kind || "Unknown contact"}</p></div>
                <span>{selected ? displayedSelection.shipCategory?.toUpperCase() || "UNCLASSIFIED" : "YOUR SHIP"}</span>
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
