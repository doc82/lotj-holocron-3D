import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { buildScene, findScenePoint, formatCoordinate, type ScenePoint } from "../domain/scene";
import { formationCenter, resolveFormationOrigins } from "../domain/coursePlot";
import { canCommandFormation } from "../domain/fleet";
import { hyperspaceClearance } from "../domain/hyperspace";
import {
  aggregateReading,
  buildTacticalSnapshot,
  classifyTacticalSnapshot,
  detailRows,
  dispositionKey,
  fleetMembersForScope,
  isDisabledShip,
  pointsIncludingClusters,
  resolveDossierShip,
  speedLabel,
} from "../domain/tacticalWorkspace";
import {
  buildTacticalTargetShortcuts,
  type TacticalTargetShortcut,
} from "../domain/tacticalTargets";
import { NavigationDrawer } from "../features/commands/NavigationDrawer";
import { ShipSpeedControl } from "../features/commands/ShipSpeedControl";
import { UplinkNotice } from "../features/connection/UplinkNotice";
import { FleetCommandPanel } from "../features/fleet/FleetCommandPanel";
import { FleetRoster } from "../features/fleet/FleetRoster";
import type { FleetScope } from "../features/fleet/FleetRoster";
import { CommandScopeRail } from "../features/fleet/CommandScopeRail";
import { SquadronCommandPanel } from "../features/fleet/SquadronCommandPanel";
import { HyperspacePlanner, type EscapePlanDraft } from "../features/hyperspace/HyperspacePlanner";
import { HyperspaceTransit } from "../features/hyperspace/HyperspaceTransit";
import { NavigationComputer } from "../features/hyperspace/NavigationComputer";
import { StartupSequence } from "../features/startup/StartupSequence";
import { TacticalCanvas, type TacticalCanvasHandle } from "../features/tactical/TacticalCanvas";
import type { TacticalCameraMode } from "../features/tactical/TacticalEngine";
import { TargetShortcutRail } from "../features/tactical/TargetShortcutRail";
import { RangeMeter, type RangeReading } from "../features/telemetry/RangeMeter";
import { ShipDossierPanel, type ShipDossierMode } from "../features/telemetry/ShipDossierPanel";
import { useTelemetry } from "../features/telemetry/useTelemetry";
import { WeaponsPanel } from "../features/weapons/WeaponsPanel";
import styles from "./App.module.css";
import type {
  FleetMember,
  HyperspaceRoutePayload,
  ShipDisposition,
  SpeedReading,
  SystemSnapshot,
  TelemetryEntity,
  Vector3,
  WeaponType,
} from "../types/telemetry";

const DISPOSITION_STORAGE_KEY = "holocron3d.ship-dispositions.v1";

interface CommandToast {
  id: number;
  message: string;
  tone: "info" | "success" | "warning" | "error";
}

interface HyperspacePlannerRequest {
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

interface ShipDossierRequest {
  id: string;
  name: string;
  mode: ShipDossierMode;
  seed: TelemetryEntity;
}

function commandToastTone(message: string): CommandToast["tone"] {
  if (/REJECT|BLOCK|FAIL|TIMED OUT|LOST|REQUIRES|SELECT A|CANNOT/.test(message)) return "error";
  if (/WAIT|AWAIT|TRANSMITTING|TARGETING|TRACKING/.test(message)) return "warning";
  if (/ACCEPT|COMPLETE|TRANSMITTED|UPDATED|\bON\b|\bOFF\b/.test(message)) return "success";
  return "info";
}

function loadDispositions(): Record<string, ShipDisposition> {
  try {
    return JSON.parse(localStorage.getItem(DISPOSITION_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function ViewIcon({ type }: { type: "radar" | "grid" | "sector" }) {
  if (type === "radar")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="11" />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 16 25 9M5 16h4M23 16h4M16 5v4M16 23v4" />
      </svg>
    );
  if (type === "grid")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M5 24 12 8h8l7 16ZM8 19h16M10 14h12M12 8l-2 16M20 8l2 16" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M10 5H5v5M22 5h5v5M10 27H5v-5M22 27h5v-5" />
      <circle cx="11" cy="17" r="2" />
      <circle cx="17" cy="12" r="1.5" />
      <circle cx="22" cy="19" r="2.5" />
    </svg>
  );
}

function CameraIcon({ type }: { type: TacticalCameraMode }) {
  if (type === "player")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 24 16 6l10 18-10-4Z" />
        <circle cx="16" cy="16" r="12" />
      </svg>
    );
  if (type === "rts")
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="m5 11 11-6 11 6-11 6Zm0 0v11l11 6 11-6V11M16 17v11" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="8" />
      <path d="M16 3v6M16 23v6M3 16h6M23 16h6" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 24 21 8M14 8h7v7M5 24h15M5 24V9" />
    </svg>
  );
}

function PollingControlIcon({ paused }: { paused: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {paused ? (
        <path d="M8 6v20l17-10Z" />
      ) : (
        <>
          <path d="M10 7v18M22 7v18" />
          <circle cx="16" cy="16" r="13" />
        </>
      )}
    </svg>
  );
}

function HyperspaceIcon({ galactic = false }: { galactic?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {galactic ? (
        <>
          <circle cx="16" cy="16" r="3" />
          <circle cx="7" cy="9" r="2" />
          <circle cx="25" cy="7" r="2" />
          <circle cx="24" cy="24" r="2" />
          <path d="M9 10.5 14 14M19 14l4.5-5M19 18l3.5 4.5M5 25C13 19 20 12 27 4" />
        </>
      ) : (
        <>
          <circle cx="16" cy="16" r="10" />
          <path d="M3 16h9M20 16h9M16 3v9M16 20v9M11 21 21 11M12 10l10 10" />
          <circle cx="16" cy="16" r="2" />
        </>
      )}
    </svg>
  );
}

type CommandIconType =
  | "target"
  | "scan"
  | "info"
  | "to"
  | "away"
  | "track"
  | "cancel"
  | "neutral"
  | "friendly"
  | "enemy"
  | "recharge"
  | "autoRecharge";

function CommandIcon({ type }: { type: CommandIconType }) {
  const paths: Record<CommandIconType, ReactNode> = {
    target: (
      <>
        <circle cx="16" cy="16" r="8" />
        <path d="M16 3v7M16 22v7M3 16h7M22 16h7" />
      </>
    ),
    scan: (
      <>
        <path d="M5 23a18 18 0 0 1 18-18M8 26A18 18 0 0 1 26 8" />
        <circle cx="12" cy="20" r="3" />
      </>
    ),
    info: (
      <>
        <circle cx="16" cy="16" r="11" />
        <path d="M16 14v9M16 9v1" />
      </>
    ),
    to: (
      <>
        <path d="M4 16h20M18 9l7 7-7 7" />
        <circle cx="27" cy="16" r="2" />
      </>
    ),
    away: (
      <>
        <path d="M28 16H8M14 9l-7 7 7 7" />
        <circle cx="5" cy="16" r="2" />
      </>
    ),
    track: (
      <>
        <circle cx="16" cy="16" r="9" />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 3v4M16 25v4M3 16h4M25 16h4M21 11l6-6" />
      </>
    ),
    cancel: <path d="M7 7l18 18M25 7 7 25" />,
    neutral: (
      <>
        <circle cx="16" cy="16" r="10" />
        <path d="M11 16h10" />
      </>
    ),
    friendly: (
      <>
        <path d="M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z" />
        <path d="m11 16 3 3 7-7" />
      </>
    ),
    enemy: (
      <>
        <path d="M16 4 27 9v7c0 7-5 10-11 12C10 26 5 23 5 16V9Z" />
        <path d="m11 12 10 10M21 12 11 22" />
      </>
    ),
    recharge: (
      <>
        <path d="M16 3 27 8v8c0 7-5 11-11 13C10 27 5 23 5 16V8Z" />
        <path d="m18 8-7 10h6l-3 8 8-12h-6z" />
      </>
    ),
    autoRecharge: (
      <>
        <path d="M16 4 26 8v8c0 6-4 10-10 12C10 26 6 22 6 16V8Z" />
        <path d="M11 16a5 5 0 0 1 8-4M21 11v4h-4M21 17a5 5 0 0 1-8 4M11 22v-4h4" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      {paths[type]}
    </svg>
  );
}

type NavigationMode = "idle" | "vector" | "target" | "away" | "confirm";

export function App() {
  const telemetry = useTelemetry();
  const pollingPaused = telemetry.snapshot?.metadata?.polling?.paused === true;
  const [starting, setStarting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFleetMemberIds, setSelectedFleetMemberIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [viewpointMemberId, setViewpointMemberId] = useState<string | null>(null);
  const [fleetScope, setFleetScope] = useState<FleetScope>("local");
  const [scopeDrawerOpen, setScopeDrawerOpen] = useState(false);
  const [targetDrawerOpen, setTargetDrawerOpen] = useState(false);
  const [dismissedTargetNames, setDismissedTargetNames] = useState<Set<string>>(() => new Set());
  const [navigationFleetScope, setNavigationFleetScope] = useState<FleetScope | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const [radarBubbleEnabled, setRadarBubbleEnabled] = useState(true);
  const [originGridEnabled, setOriginGridEnabled] = useState(false);
  const [cameraMode, setCameraMode] = useState<TacticalCameraMode>("player");
  const [navigationMode, setNavigationMode] = useState<NavigationMode>("idle");
  const [pendingNavigationMode, setPendingNavigationMode] = useState<
    "relative" | "target" | "away"
  >("relative");
  const [navigationTargetId, setNavigationTargetId] = useState<string | null>(null);
  const [courseVector, setCourseVector] = useState<Vector3>([100, 0, 0]);
  const [requestedSpeed, setRequestedSpeed] = useState(0);
  const [knownMaximumSpeed, setKnownMaximumSpeed] = useState(0);
  const [navigationStatus, setNavigationStatus] = useState("");
  const [commandAlert, setCommandAlertValue] = useState("");
  const [commandToasts, setCommandToasts] = useState<CommandToast[]>([]);
  const [commandLocked, setCommandLocked] = useState(false);
  const [pollingPausePending, setPollingPausePending] = useState(false);
  const [manualScanSource, setManualScanSource] = useState<"status" | "info" | null>(null);
  const [manualScanStatus, setManualScanStatus] = useState("");
  const [shipDossier, setShipDossier] = useState<ShipDossierRequest | null>(null);
  const [spaceProbeAttempt, setSpaceProbeAttempt] = useState(0);
  const [hyperspacePlanner, setHyperspacePlanner] = useState<HyperspacePlannerRequest | null>(null);
  const [navigationRefreshBlocked, setNavigationRefreshBlocked] = useState(false);
  const [activeRoute, setActiveRoute] = useState<HyperspaceRoutePayload | null>(null);
  const [escapePlan, setEscapePlan] = useState<EscapePlanDraft | undefined>();
  const [hyperspaceEscapePending, setHyperspaceEscapePending] = useState(false);
  const [dispositions, setDispositions] =
    useState<Record<string, ShipDisposition>>(loadDispositions);
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const syncedDispositionsRef = useRef(new Map<string, ShipDisposition>());
  const pendingIntentIdsRef = useRef(new Set<string>());
  const manualScanIntentIdsRef = useRef(new Set<string>());
  const autotrackIntentIdsRef = useRef(new Set<string>());
  const hyperspaceEscapeIntentIdsRef = useRef(new Set<string>());
  const navigationRefreshIntentIdsRef = useRef(new Set<string>());
  const targetIntentShipsRef = useRef(new Map<string, { name: string }>());
  const lastObservedSpeedRef = useRef<number | null>(null);
  const lastMaximumSpeedRef = useRef<number | null>(null);
  const lastSpeedIntentRef = useRef<number | null>(null);
  const manualScanStartSequenceRef = useRef(0);
  const manualScanRequestTokenRef = useRef(0);
  const manualScanTargetIdRef = useRef<string | null>(null);
  const navigationLockTokenRef = useRef(0);
  const targetLockTokenRef = useRef(0);
  const spaceProbeSentRef = useRef(false);
  const spaceProbeIntentIdsRef = useRef(new Set<string>());
  const spaceProbeRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escapeTriggeredRef = useRef(false);
  const arrivalRefreshAtRef = useRef<number | null>(null);
  const commandToastIdRef = useRef(0);
  const lastFleetToastKeyRef = useRef("");
  const pushCommandToast = useCallback((message: string, tone = commandToastTone(message)) => {
    if (!message) return;
    const id = ++commandToastIdRef.current;
    setCommandToasts((current) => [...current, { id, message, tone }].slice(-4));
    setTimeout(
      () => setCommandToasts((current) => current.filter((toast) => toast.id !== id)),
      5_000,
    );
  }, []);
  const setCommandAlert = useCallback(
    (message: string) => {
      setCommandAlertValue(message);
      if (message) pushCommandToast(message);
    },
    [pushCommandToast],
  );
  const changePollingPause = useCallback(
    async (paused: boolean) => {
      if (!telemetry.connected || pollingPausePending) return;
      setPollingPausePending(true);
      const result = await window.holocron?.sendIntent("set_polling_paused", { paused });
      setPollingPausePending(false);
      if (result?.accepted === false) {
        setCommandAlert(`POLLING CONTROL REJECTED // ${result.reason || "UNKNOWN"}`);
        return;
      }
      setCommandAlert(paused ? "AUTOMATIC POLLING PAUSED" : "AUTOMATIC POLLING RESUMED");
    },
    [pollingPausePending, setCommandAlert, telemetry.connected],
  );
  const fleet = telemetry.snapshot?.metadata?.fleet;
  const viewpointMember = fleet?.members.find((member) => member.id === viewpointMemberId);
  const activeTacticalView = viewpointMemberId
    ? telemetry.snapshot?.metadata?.tacticalViews?.[viewpointMemberId]
    : undefined;
  const tacticalSnapshot = useMemo(
    () => buildTacticalSnapshot(telemetry.snapshot, viewpointMemberId),
    [telemetry.snapshot, viewpointMemberId],
  );
  const classifiedSnapshot = useMemo(
    () => classifyTacticalSnapshot(tacticalSnapshot, telemetry.snapshot, dispositions),
    [dispositions, tacticalSnapshot, telemetry.snapshot],
  );
  const scene = useMemo(() => buildScene(classifiedSnapshot), [classifiedSnapshot]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const fleetOrder = telemetry.snapshot?.metadata?.fleetOrder;
  const finishStartup = useCallback(() => setStarting(false), []);

  useEffect(() => {
    if (!fleetOrder || !["accepted", "partial", "rejected"].includes(fleetOrder.status || ""))
      return;
    const reason =
      fleetOrder.reason ||
      Object.values(fleetOrder.results || {}).find((result) => result.reason)?.reason;
    const key = [
      fleetOrder.id,
      fleetOrder.order,
      fleetOrder.status,
      fleetOrder.acceptedCount,
      fleetOrder.rejectedCount,
      reason,
    ].join(":");
    if (lastFleetToastKeyRef.current === key) return;
    lastFleetToastKeyRef.current = key;
    const message =
      `${(fleetOrder.order || "ORDER").toUpperCase()} // ${(fleetOrder.status || "TRANSMITTED").toUpperCase()}` +
      ` // ${fleetOrder.acceptedCount || 0} ACCEPTED // ${fleetOrder.rejectedCount || 0} REJECTED` +
      (reason ? ` // ${reason.toUpperCase()}` : "");
    pushCommandToast(message, fleetOrder.status === "accepted" ? "success" : "error");
  }, [fleetOrder, pushCommandToast]);

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
    if (starting || pollingPaused || spaceProbeSentRef.current) return;

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
  }, [pollingPaused, scheduleSpaceProbeRetry, spaceProbeAttempt, starting, telemetry.connected]);

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
    setSelectedId((current) => (current === id ? null : id));
  }, []);
  const observer = scene.points[0];
  const localObserver = telemetry.snapshot?.observer;
  const localName = String(localObserver?.name || observer.name);
  const expandedCluster = findScenePoint(scene, expandedClusterId);
  const selected = findScenePoint(scene, hoveredMemberId) ?? findScenePoint(scene, selectedId);
  const selectedFleetMembers =
    fleet?.members.filter((member) => selectedFleetMemberIds.has(member.id)) ?? [];
  const selectedFleetMember = selectedFleetMembers[0];
  const allFleetMembersSelected = Boolean(
    fleet?.members.length && fleet.members.every((member) => selectedFleetMemberIds.has(member.id)),
  );
  const selectedFleetScopeEmpty = fleetScope === "selected" && selectedFleetMembers.length === 0;
  const flattenedScenePoints = useMemo(() => pointsIncludingClusters(scene.points), [scene.points]);
  const reportedTargetShortcuts = useMemo<TacticalTargetShortcut[]>(
    () =>
      buildTacticalTargetShortcuts({
        combatTargets: telemetry.snapshot?.metadata?.combatTargets,
        localTarget: String(
          telemetry.snapshot?.metadata?.combatTarget || telemetry.snapshot?.observer?.target || "",
        ),
        observerName: localName,
        scenePoints: flattenedScenePoints,
        fleetMembers: fleet?.members,
      }),
    [
      fleet?.members,
      flattenedScenePoints,
      localName,
      telemetry.snapshot?.metadata?.combatTarget,
      telemetry.snapshot?.metadata?.combatTargets,
      telemetry.snapshot?.observer?.target,
    ],
  );
  const targetShortcuts = useMemo(
    () =>
      reportedTargetShortcuts.filter(
        (target) => !dismissedTargetNames.has(dispositionKey(target.targetName)),
      ),
    [dismissedTargetNames, reportedTargetShortcuts],
  );
  const selectedFleetScenePoint = selectedFleetMember
    ? (flattenedScenePoints.find(
        (point) =>
          point.name.trim().toLowerCase() === selectedFleetMember.name.trim().toLowerCase(),
      ) ?? null)
    : null;
  const cameraFocusPoint =
    selected?.kind === "ship" || selected?.kind === "observer" ? selected : selectedFleetScenePoint;
  const displayedSelection = selected ?? observer;
  const hasSelectedContact = selected !== null;
  const reportedInSpace = telemetry.spaceState?.inSpace ?? telemetry.snapshot?.metadata?.inSpace;
  const landed = reportedInSpace === false;
  const spaceTelemetryActive =
    telemetry.connected &&
    reportedInSpace === true &&
    telemetry.snapshot?.metadata?.inSpace === true;
  const fleetCommandMode = fleet?.active === true && fleetScope !== "local";
  const formationCommandsEnabled = fleet ? canCommandFormation(fleet, localName) : false;
  useEffect(() => {
    if (fleet?.active === true) return;
    setFleetScope("local");
    setSelectedFleetMemberIds(new Set());
    setViewpointMemberId(null);
  }, [fleet?.active]);
  useEffect(() => {
    if (!fleet?.active) return;
    const available = new Set(fleet.members.map((member) => member.id));
    setSelectedFleetMemberIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [fleet?.active, fleet?.members]);
  useEffect(() => {
    if (!viewpointMemberId) return;
    if (fleet?.members.some((member) => member.id === viewpointMemberId)) return;
    setViewpointMemberId(null);
  }, [fleet?.members, viewpointMemberId]);
  useEffect(() => {
    if (!activeTacticalView?.observedAt) return;
    tacticalRef.current?.setCameraMode("player");
    tacticalRef.current?.fitSystem();
    setCommandAlert(`TACTICAL VIEW ACTIVE // ${activeTacticalView.memberName.toUpperCase()}`);
  }, [activeTacticalView?.memberName, activeTacticalView?.observedAt, setCommandAlert]);
  useEffect(() => {
    if (targetShortcuts.length > 1 && telemetry.connected) return;
    setTargetDrawerOpen(false);
  }, [targetShortcuts.length, telemetry.connected]);
  useEffect(() => {
    const reported = new Set(
      reportedTargetShortcuts.map((target) => dispositionKey(target.targetName)),
    );
    setDismissedTargetNames((current) => {
      const next = new Set([...current].filter((target) => reported.has(target)));
      return next.size === current.size ? current : next;
    });
  }, [reportedTargetShortcuts]);
  const observerSpeed =
    typeof localObserver?.speed === "object" && localObserver.speed
      ? Number(localObserver.speed.current) || 0
      : Number(localObserver?.speed) || 0;
  const observedMaximumSpeed =
    typeof localObserver?.speed === "object" && localObserver.speed
      ? Number(localObserver.speed.maximum) || 0
      : Number(localObserver?.maximumSpeed) || 0;
  const maximumSpeed = observedMaximumSpeed > 0 ? observedMaximumSpeed : knownMaximumSpeed;
  const navigableTarget =
    selected && ["ship", "planet", "celestial", "star"].includes(selected.kind) ? selected : null;
  const navigationTarget = findScenePoint(scene, navigationTargetId);
  const selectedShip = selected?.kind === "ship" ? selected : null;
  const dossierShip = useMemo(
    () =>
      resolveDossierShip({
        request: shipDossier,
        localName,
        localObserver,
        fleetMembers: fleet?.members,
        scenePoints: flattenedScenePoints,
      }),
    [fleet?.members, flattenedScenePoints, localName, localObserver, shipDossier],
  );

  const issuerMembers = fleetMembersForScope(fleet, fleetScope, selectedFleetMembers);
  const commandIssuerLabel =
    fleetScope === "local" || !fleet?.active
      ? localName
      : fleetScope === "selected"
        ? selectedFleetMembers.length === 1
          ? selectedFleetMembers[0].name
          : selectedFleetMembers.length > 1
            ? `${selectedFleetMembers.length} SELECTED CRAFT`
            : "SELECT CRAFT"
        : fleet.kind === "squadron"
          ? "SQUADRON"
          : fleetScope === "wings"
            ? "WINGS"
            : "FLEET";
  const commandIssuerType =
    fleetScope === "local" || !fleet?.active
      ? "YOUR SHIP"
      : fleet.kind === "squadron"
        ? "SQUADRON COMMAND"
        : fleetScope === "wings"
          ? "BATTLEGROUP WING COMMAND"
          : fleetScope === "selected"
            ? "BATTLEGROUP SELECTED COMMAND"
            : "BATTLEGROUP COMMAND";
  const issuerHull =
    fleetScope === "local" || !fleet?.active
      ? (localObserver?.hull as RangeReading | undefined)
      : aggregateReading(issuerMembers.map((member) => member.hull));
  const issuerShields =
    fleetScope === "local" || !fleet?.active
      ? (localObserver?.shields as RangeReading | undefined)
      : aggregateReading(issuerMembers.map((member) => member.shields));
  const issuerEnergy =
    fleetScope === "local" || !fleet?.active
      ? (localObserver?.energy as RangeReading | undefined)
      : aggregateReading(issuerMembers.map((member) => member.energy));

  const movementOriginsForScope = useCallback(
    (scope: FleetScope | null): Vector3[] => {
      if (!scope || scope === "local" || !fleet) return [[0, 0, 0]];
      const members =
        scope === "selected"
          ? selectedFleetMembers
          : scope === "wings"
            ? fleet.members.filter((member) => !member.leader)
            : fleet.members;
      const origins = resolveFormationOrigins(members, flattenedScenePoints, observer);
      const unique = new Map(origins.map((origin) => [origin.join(":"), origin]));
      return [...unique.values()];
    },
    [fleet, flattenedScenePoints, observer, selectedFleetMembers],
  );

  const chooseCameraMode = useCallback(
    (mode: TacticalCameraMode) => {
      if (navigationMode !== "idle") return;
      if (mode === "selection" && !cameraFocusPoint) return;
      tacticalRef.current?.setCameraMode(mode, cameraFocusPoint?.id);
    },
    [cameraFocusPoint, navigationMode],
  );
  const autotrackObserved = typeof observer.autotrack === "boolean" ? observer.autotrack : null;
  const observerHasNoWeapons = observer.hasWeapons === false;
  const autotrackDesired = telemetry.snapshot?.metadata?.autotrackDesired !== false;
  const autotrackPending = telemetry.snapshot?.metadata?.autotrackPending === true;
  const combatEvent = telemetry.snapshot?.metadata?.combatEvent;
  const combatEvents =
    telemetry.snapshot?.metadata?.combatEvents ?? (combatEvent ? [combatEvent] : []);
  const reportedCombatTarget = String(
    telemetry.snapshot?.metadata?.combatTarget ||
      (typeof observer.target === "string" ? observer.target : ""),
  ).trim();
  const combatTargetName =
    reportedCombatTarget && reportedCombatTarget.toLowerCase() !== "none"
      ? reportedCombatTarget
      : null;
  const shieldReading =
    observer.shields && typeof observer.shields === "object"
      ? (observer.shields as { current?: number; maximum?: number })
      : null;
  const shieldsFull =
    Number.isFinite(shieldReading?.current) &&
    Number.isFinite(shieldReading?.maximum) &&
    Number(shieldReading?.maximum) > 0 &&
    Number(shieldReading?.current) >= Number(shieldReading?.maximum);
  const shieldRecharging = telemetry.snapshot?.metadata?.shieldRecharging === true;
  const shieldStatusPending = telemetry.snapshot?.metadata?.shieldStatusPending === true;
  const autoRechargeEnabled = telemetry.snapshot?.metadata?.autoRechargeEnabled !== false;
  const hyperspaceState = telemetry.snapshot?.metadata?.hyperspace || { phase: "idle" as const };
  const hyperdriveClearance = hyperspaceClearance(telemetry.snapshot);
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
  const navigationDestinations = telemetry.snapshot?.metadata?.navigation?.destinations || [];
  const navigationGalaxy = telemetry.snapshot?.metadata?.navigation?.galaxy;
  const catalogGalaxy = telemetry.galaxyCatalog?.shipSystem;
  const viewpointGalaxy = viewpointMember?.galaxy;
  const currentGalaxyPosition =
    Number.isFinite(Number(viewpointGalaxy?.x)) && Number.isFinite(Number(viewpointGalaxy?.y))
      ? { x: Number(viewpointGalaxy?.x), y: Number(viewpointGalaxy?.y) }
      : Number.isFinite(Number(navigationGalaxy?.x)) && Number.isFinite(Number(navigationGalaxy?.y))
        ? { x: Number(navigationGalaxy?.x), y: Number(navigationGalaxy?.y) }
        : Number.isFinite(Number(catalogGalaxy?.x)) && Number.isFinite(Number(catalogGalaxy?.y))
          ? { x: Number(catalogGalaxy?.x), y: Number(catalogGalaxy?.y) }
          : undefined;
  const galaxyCatalogSize =
    Object.keys(telemetry.galaxyCatalog?.systems || {}).length +
    Object.keys(telemetry.galaxyCatalog?.customSystems || {}).length;

  const selectCommandScope = useCallback(
    (scope: FleetScope) => {
      const sameScope = fleetScope === scope;
      setFleetScope(scope);
      if (scope === "local") {
        setSelectedFleetMemberIds(new Set());
        setViewpointMemberId(null);
      } else if (fleet) {
        const members =
          scope === "wings" ? fleet.members.filter((member) => !member.leader) : fleet.members;
        setSelectedFleetMemberIds(new Set(members.map((member) => member.id)));
      }
      setTargetDrawerOpen(false);
      setScopeDrawerOpen((open) => (sameScope ? !open : true));
    },
    [fleet, fleetScope],
  );

  const toggleFleetMember = useCallback(
    (member: FleetMember) => {
      const next = new Set(selectedFleetMemberIds);
      if (next.has(member.id)) next.delete(member.id);
      else next.add(member.id);
      setSelectedFleetMemberIds(next);
      setFleetScope(
        fleet &&
          fleet.members.length > 0 &&
          fleet.members.every((candidate) => next.has(candidate.id))
          ? "all"
          : "selected",
      );
    },
    [fleet, selectedFleetMemberIds],
  );

  const selectAllFleetMembers = useCallback(() => {
    if (!fleet) return;
    setSelectedFleetMemberIds(new Set(fleet.members.map((member) => member.id)));
    setFleetScope("all");
  }, [fleet]);

  const viewFleetMember = useCallback(
    async (member: FleetMember) => {
      if (member.name.trim().toLowerCase() === localName.trim().toLowerCase()) {
        setViewpointMemberId(null);
        setSelectedId(null);
        tacticalRef.current?.setCameraMode("player");
        return;
      }
      setViewpointMemberId(member.id);
      setSelectedId(null);
      setExpandedClusterId(null);
      setHoveredMemberId(null);
      tacticalRef.current?.setCameraMode("player");
      setCommandAlert(`REQUESTING TACTICAL VIEW // ${member.name.toUpperCase()}`);
      const result = await window.holocron?.sendIntent("request_tactical_view", {
        memberId: member.id,
        memberName: member.name,
      });
      if (result?.accepted === false) {
        setViewpointMemberId(null);
        setCommandAlert(
          `TACTICAL VIEW REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`,
        );
        return;
      }
      setCommandAlert(`TACTICAL VIEW REQUESTED // ${member.name.toUpperCase()}`);
    },
    [localName, setCommandAlert],
  );

  const focusTargetShortcut = useCallback((target: TacticalTargetShortcut) => {
    if (!target.ship?.id) return;
    setExpandedClusterId(null);
    setHoveredMemberId(null);
    setSelectedId(target.ship.id);
    setScopeDrawerOpen(false);
    setTargetDrawerOpen(false);
  }, []);

  const clearTargetShortcut = useCallback(
    async (target: TacticalTargetShortcut) => {
      const targetKeys = [...new Set(target.owners.map((owner) => owner.key).filter(Boolean))];
      if (targetKeys.length === 0) {
        setCommandAlert("TARGET CLEAR REJECTED // TARGET OWNERSHIP IS UNKNOWN");
        return;
      }
      setCommandAlert(`CLEARING TARGET // ${target.targetName.toUpperCase()}`);
      const result = await window.holocron?.sendIntent("clear_combat_target", { targetKeys });
      if (result?.accepted === false) {
        setCommandAlert(
          `TARGET CLEAR REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`,
        );
        return;
      }
      const key = dispositionKey(target.targetName);
      setDismissedTargetNames((current) => new Set(current).add(key));
      setTargetDrawerOpen(false);
      setCommandAlert(`TARGET CLEARED // ${target.targetName.toUpperCase()}`);
    },
    [setCommandAlert],
  );

  const toggleTargetDrawer = useCallback(() => {
    setScopeDrawerOpen(false);
    setShipDossier(null);
    setTargetDrawerOpen((open) => !open);
  }, []);

  const openHyperspacePlanner = useCallback(
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
      const origin = {
        x: (Number(observer.worldPosition[0]) || 0) + relativeOrigin[0],
        y: (Number(observer.worldPosition[1]) || 0) + relativeOrigin[1],
        z: (Number(observer.worldPosition[2]) || 0) + relativeOrigin[2],
      };
      setNavigationRefreshBlocked(false);
      setHyperspacePlanner({ mode, origin, routeScope });
    },
    [
      commandIssuerLabel,
      fleet?.kind,
      fleetCommandMode,
      fleetScope,
      movementOriginsForScope,
      observer.worldPosition,
      selectedFleetMembers,
    ],
  );

  const plotHyperspace = useCallback(
    async (route: HyperspaceRoutePayload, escape?: EscapePlanDraft) => {
      setActiveRoute(route);
      setEscapePlan(escape);
      setHyperspacePlanner(null);
      escapeTriggeredRef.current = false;
      const result = await window.holocron?.sendIntent(
        "plot_hyperspace",
        route as unknown as Record<string, unknown>,
      );
      if (result?.accepted === false) {
        setCommandAlert(`ROUTE REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
      }
    },
    [],
  );

  const stopHyperspace = useCallback(async () => {
    const result = await window.holocron?.sendIntent(
      "stop_hyperspace",
      activeRoute as unknown as Record<string, unknown> | undefined,
    );
    if (result?.accepted === false) {
      setCommandAlert(`ABORT REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    // A battlegroup recipient does not necessarily echo its terminal reset back
    // through the observer's console. Once Mudlet accepts the scoped stop command,
    // the local workflow is complete and must not wait for that remote-only line.
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, [activeRoute]);

  const dismissHyperspace = useCallback(() => {
    setActiveRoute(null);
    setEscapePlan(undefined);
    escapeTriggeredRef.current = false;
  }, []);

  const engageHyperspace = useCallback(async () => {
    if (!routeClearance.allowed) {
      setCommandAlert(
        `HYPERDRIVE BLOCKED // ${String(routeClearance.reason || "FRESH RADAR CLEARANCE REQUIRED").toUpperCase()}`,
      );
      return;
    }
    const result = await window.holocron?.sendIntent(
      "engage_hyperdrive",
      activeRoute as unknown as Record<string, unknown> | undefined,
    );
    if (result?.accepted === false) {
      setCommandAlert(`HYPERDRIVE BLOCKED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    if (remoteBattlegroupRoute) {
      setActiveRoute(null);
      setEscapePlan(undefined);
      setCommandAlert(
        `HYPERSPACE ENGAGED // ${(activeRoute?.recipientLabel || "FORMATION").toUpperCase()}`,
      );
    }
  }, [activeRoute, remoteBattlegroupRoute, routeClearance.allowed, routeClearance.reason]);

  const escapeHyperspace = useCallback(async () => {
    setHyperspaceEscapePending(true);
    const result = await window.holocron?.sendIntent("escape_hyperspace");
    if (result?.id) hyperspaceEscapeIntentIdsRef.current.add(result.id);
    if (result?.accepted === false) {
      setHyperspaceEscapePending(false);
      setCommandAlert(
        `HYPERSPACE CUTOFF REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`,
      );
    }
  }, []);

  const calculateAnyway = useCallback(() => {
    if (!activeRoute) return;
    void plotHyperspace({ ...activeRoute, acknowledgeFuelRisk: true }, escapePlan);
  }, [activeRoute, escapePlan, plotHyperspace]);

  useEffect(() => {
    if (pollingPaused || hyperspaceState.phase !== "calculating") return;
    const timer = setInterval(
      () => void window.holocron?.sendIntent("refresh_navigation", { command: "calc" }),
      5_000,
    );
    return () => clearInterval(timer);
  }, [hyperspaceState.phase, pollingPaused]);

  useEffect(() => {
    if (
      pollingPaused ||
      !activeRoute ||
      hyperspaceState.phase !== "ready" ||
      hyperdriveClearance.known
    )
      return;
    const refreshClearance = () => void window.holocron?.sendIntent("probe_space");
    refreshClearance();
    const timer = setInterval(refreshClearance, 5_000);
    return () => clearInterval(timer);
  }, [activeRoute, hyperdriveClearance.known, hyperspaceState.phase, pollingPaused]);

  useEffect(() => {
    if (pollingPaused || !hyperspacePlanner || navigationRefreshBlocked) return;
    const needsRange = navigationDestinations.length === 0;
    const needsCatalog = hyperspacePlanner.mode === "galactic" && galaxyCatalogSize === 0;
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
    currentGalaxyPosition?.x,
    currentGalaxyPosition?.y,
    galaxyCatalogSize,
    hyperspacePlanner,
    navigationDestinations.length,
    navigationRefreshBlocked,
    pollingPaused,
  ]);

  useEffect(() => {
    if (hyperspaceState.phase !== "hyperspace") setHyperspaceEscapePending(false);
  }, [hyperspaceState.phase]);

  useEffect(() => {
    if (hyperspaceState.phase !== "arrived") {
      arrivalRefreshAtRef.current = null;
      return;
    }
    if (pollingPaused) return;

    // A completed route is no longer actionable. Remove its computer panel as
    // soon as arrival is confirmed, even while destination telemetry refreshes.
    setActiveRoute(null);

    const arrivedAt = Number(hyperspaceState.arrivedAt) || 0;
    const arrivalNavigationReady =
      Number(telemetry.snapshot?.metadata?.navigation?.arrivalRefreshedAt) >= arrivedAt;
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
      void window.holocron?.sendIntent(
        "plot_hyperspace",
        escapeRoute as unknown as Record<string, unknown>,
      );
      return;
    }
  }, [
    currentGalaxyPosition?.x,
    currentGalaxyPosition?.y,
    escapePlan,
    hyperspaceState.arrivedAt,
    hyperspaceState.phase,
    pollingPaused,
    telemetry.snapshot?.metadata?.navigation?.arrivalRefreshedAt,
  ]);

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
    setNavigationFleetScope(null);
    setCommandAlert("");
    setRequestedSpeed(
      Math.max(0, Math.min(lastMaximumSpeedRef.current ?? 0, lastObservedSpeedRef.current ?? 0)),
    );
    tacticalRef.current?.finishMovementPlanning();
  }, []);

  const beginVectorCourse = useCallback(() => {
    if (!telemetry.connected || landed || commandLocked) return;
    setExpandedClusterId(null);
    setHoveredMemberId(null);
    setPendingNavigationMode("relative");
    setNavigationFleetScope(fleetCommandMode ? fleetScope : null);
    setNavigationTargetId(null);
    setNavigationMode("vector");
    setNavigationStatus(
      "MOVE CURSOR // SHIFT ELEVATION // MMB ORBIT // WASD PAN // Q/E CAMERA ELEVATION",
    );
    const commandScope = fleetCommandMode ? fleetScope : null;
    tacticalRef.current?.beginMovementPlanning(
      courseVector,
      true,
      movementOriginsForScope(commandScope),
    );
  }, [
    commandLocked,
    courseVector,
    fleetCommandMode,
    fleetScope,
    landed,
    movementOriginsForScope,
    telemetry.connected,
  ]);

  const armTargetCourse = useCallback(
    (mode: "target" | "away") => {
      if (!navigableTarget) return;
      setExpandedClusterId(null);
      setHoveredMemberId(null);
      const commandScope = fleetCommandMode ? fleetScope : null;
      const origins = movementOriginsForScope(commandScope);
      const center = formationCenter(origins);
      const preview =
        mode === "away"
          ? (center.map((value, index) => value - navigableTarget.position3d[index]) as Vector3)
          : (navigableTarget.position3d.map((value, index) => value - center[index]) as Vector3);
      const multiplier = mode === "away" ? -1 : 1;
      setPendingNavigationMode(mode);
      setNavigationFleetScope(fleetCommandMode ? fleetScope : null);
      setNavigationTargetId(navigableTarget.id);
      setNavigationMode(mode);
      setNavigationStatus(mode === "away" ? "CONFIRM REVERSE COURSE" : "CONFIRM INTERCEPT COURSE");
      tacticalRef.current?.beginMovementPlanning(
        Math.hypot(...preview) > 0 ? preview : [100 * multiplier, 0, 0],
        false,
        origins,
      );
    },
    [fleetCommandMode, fleetScope, movementOriginsForScope, navigableTarget],
  );

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
    if (!navigationFleetScope && observerSpeed === 0 && requestedSpeed === 0) {
      setNavigationStatus("DEPARTURE SPEED REQUIRED // SELECT PLAYER SPEED");
      setCommandAlert("SELECT A NON-ZERO DEPARTURE SPEED");
      return;
    }
    const payload: Record<string, unknown> = { mode: pendingNavigationMode };
    if (pendingNavigationMode === "relative")
      payload.vector = { x: courseVector[0], y: courseVector[1], z: courseVector[2] };
    else if (navigationTarget) payload.targetId = navigationTarget.id;
    else {
      setNavigationStatus("ORDER BLOCKED // TARGET CONTACT LOST");
      return;
    }
    if (!navigationFleetScope && observerSpeed === 0) payload.departureSpeed = requestedSpeed;
    setNavigationStatus("TRANSMITTING COURSE...");
    if (navigationFleetScope) {
      payload.scope = navigationFleetScope;
      payload.order = "navigate";
      if (navigationFleetScope === "selected") {
        if (selectedFleetMembers.length === 0) {
          setNavigationStatus("ORDER BLOCKED // SELECT AT LEAST ONE CRAFT");
          return;
        }
        payload.memberIds = selectedFleetMembers.map((member) => member.id);
        payload.memberNames = selectedFleetMembers.map((member) => member.name);
        payload.memberSlots = selectedFleetMembers.flatMap((member) =>
          member.slot === undefined ? [] : [member.slot],
        );
        if (selectedFleetMembers.length === 1) {
          payload.memberId = selectedFleetMembers[0].id;
          payload.memberName = selectedFleetMembers[0].name;
          payload.memberSlot = selectedFleetMembers[0].slot;
        }
      }
      if (viewpointMemberId) payload.viewpointMemberId = viewpointMemberId;
    }
    const result = await window.holocron?.sendIntent(
      navigationFleetScope ? "fleet_order" : "navigate_ship",
      payload,
    );
    if (result?.accepted === false) {
      setNavigationStatus(`ORDER REJECTED // ${result.reason || "UNKNOWN"}`);
      return;
    }
    if (result?.id) {
      pendingIntentIdsRef.current.add(result.id);
      setTimeout(() => pendingIntentIdsRef.current.delete(result.id!), 60_000);
    }
    if (navigationFleetScope) {
      setNavigationStatus("FLEET COURSE TRANSMITTED");
      setCommandAlert("FLEET COURSE TRANSMITTED // MONITOR FORMATION ROSTER");
      setNavigationMode("idle");
      setNavigationFleetScope(null);
      tacticalRef.current?.finishMovementPlanning();
      return;
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
    tacticalRef.current?.finishMovementPlanning();
  }, [
    commandLocked,
    courseVector,
    navigationFleetScope,
    navigationTarget,
    observerSpeed,
    pendingNavigationMode,
    requestedSpeed,
    selectedFleetMembers,
    viewpointMemberId,
  ]);

  const commitSpeed = useCallback(
    async (speed: number) => {
      const nextSpeed = Math.max(0, Math.min(maximumSpeed, Math.round(speed)));
      if (navigationMode !== "idle" && observerSpeed === 0) {
        setRequestedSpeed(nextSpeed);
        setNavigationStatus(
          nextSpeed > 0
            ? `DEPARTURE SPEED ${nextSpeed} // READY WITH COURSE`
            : "DEPARTURE SPEED REQUIRED // SELECT PLAYER SPEED",
        );
        setCommandAlert("");
        return;
      }
      if (
        !telemetry.connected ||
        landed ||
        commandLocked ||
        maximumSpeed <= 0 ||
        nextSpeed === observerSpeed ||
        lastSpeedIntentRef.current === nextSpeed
      )
        return;
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
    },
    [commandLocked, landed, maximumSpeed, navigationMode, observerSpeed, telemetry.connected],
  );

  const chooseSpeed = useCallback(
    (speed: number) => {
      setRequestedSpeed(speed);
      void commitSpeed(speed);
    },
    [commitSpeed],
  );

  const requestShipScan = useCallback(
    async (ship: TelemetryEntity, source: ShipDossierMode) => {
      const shipName = String(ship.name || "").trim();
      if (!shipName || !telemetry.connected || landed || commandLocked || manualScanSource) return;
      const token = manualScanRequestTokenRef.current + 1;
      manualScanRequestTokenRef.current = token;
      manualScanStartSequenceRef.current = telemetry.snapshot?.sequence ?? 0;
      manualScanTargetIdRef.current = ship.id;
      setManualScanSource(source);
      setManualScanStatus(`${source.toUpperCase()} SCAN TRANSMITTING...`);
      const result = await window.holocron?.sendIntent("scan_ship", {
        targetId: ship.id,
        targetName: shipName,
        source,
      });
      if (result?.accepted === false) {
        const message = `${source.toUpperCase()} SCAN REJECTED // ${result.reason || "UNKNOWN"}`;
        setCommandAlert(message);
        manualScanTargetIdRef.current = null;
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
      setManualScanStatus(`${source.toUpperCase()} SCAN REQUESTED // ${shipName.toUpperCase()}`);
      setTimeout(() => {
        if (manualScanRequestTokenRef.current !== token) return;
        manualScanRequestTokenRef.current += 1;
        manualScanTargetIdRef.current = null;
        setManualScanSource(null);
        setManualScanStatus(`${source.toUpperCase()} SCAN TIMED OUT`);
      }, 10_000);
    },
    [commandLocked, landed, manualScanSource, telemetry.connected, telemetry.snapshot?.sequence],
  );

  const openShipDossier = useCallback(
    (ship: TelemetryEntity | FleetMember, mode: ShipDossierMode) => {
      const name = String(ship.name || "").trim();
      if (!name) return;
      const seed = { ...ship, kind: "ship" } as TelemetryEntity;
      setTargetDrawerOpen(false);
      setShipDossier({ id: ship.id, name, mode, seed });
      setManualScanStatus("");
      void requestShipScan(seed, mode);
    },
    [requestShipScan],
  );

  const changeDossierMode = useCallback(
    (mode: ShipDossierMode) => {
      if (!shipDossier || !dossierShip) return;
      setShipDossier((current) => (current ? { ...current, mode } : current));
      setManualScanStatus("");
      void requestShipScan(dossierShip, mode);
    },
    [dossierShip, requestShipScan, shipDossier],
  );

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

  const fireWeapon = useCallback(
    async (weapon: WeaponType | "all") => {
      if (!telemetry.connected || landed) return "weapons controls unavailable";
      const result = await window.holocron?.sendIntent("fire_weapon", { weapon });
      return result?.accepted === false ? result.reason || "fire order rejected" : null;
    },
    [landed, telemetry.connected],
  );

  const sendFleetOrder = useCallback(
    async (order: string, extra: Record<string, unknown> = {}) => {
      if (
        !fleet?.active ||
        fleetScope === "local" ||
        !telemetry.connected ||
        landed ||
        commandLocked
      )
        return;
      const payload: Record<string, unknown> = { order, scope: fleetScope, ...extra };
      if (fleetScope === "selected") {
        if (selectedFleetMembers.length === 0) {
          setCommandAlert("FLEET ORDER REQUIRES AT LEAST ONE SELECTED CRAFT");
          return;
        }
        payload.memberIds = selectedFleetMembers.map((member) => member.id);
        payload.memberNames = selectedFleetMembers.map((member) => member.name);
        payload.memberSlots = selectedFleetMembers.flatMap((member) =>
          member.slot === undefined ? [] : [member.slot],
        );
        if (selectedFleetMembers.length === 1) {
          payload.memberId = selectedFleetMembers[0].id;
          payload.memberName = selectedFleetMembers[0].name;
          payload.memberSlot = selectedFleetMembers[0].slot;
        }
      }
      if (viewpointMemberId) payload.viewpointMemberId = viewpointMemberId;
      if (order === "target") {
        if (!selectedShip) {
          setCommandAlert("FLEET TARGET ORDER REQUIRES A SELECTED SHIP");
          return;
        }
        payload.targetId = selectedShip.id;
      }
      const formationLabel = fleet.kind === "squadron" ? "SQUADRON" : "FLEET";
      setCommandAlert(
        `TRANSMITTING ${order.replaceAll("_", " ").toUpperCase()} // ${formationLabel}`,
      );
      const result = await window.holocron?.sendIntent("fleet_order", payload);
      if (result?.accepted === false) {
        setCommandAlert(
          `${formationLabel} ORDER REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`,
        );
        return;
      }
      if (result?.id) {
        pendingIntentIdsRef.current.add(result.id);
        setTimeout(() => pendingIntentIdsRef.current.delete(result.id!), 15_000);
      }
      setCommandAlert(
        `${order.replaceAll("_", " ").toUpperCase()} TRANSMITTED // ${formationLabel}`,
      );
    },
    [
      commandLocked,
      fleet,
      fleetScope,
      landed,
      selectedFleetMembers,
      selectedShip,
      telemetry.connected,
      viewpointMemberId,
    ],
  );

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
    if (
      lastObservedSpeedRef.current === observerSpeed &&
      lastMaximumSpeedRef.current === maximumSpeed
    )
      return;
    lastObservedSpeedRef.current = observerSpeed;
    lastMaximumSpeedRef.current = maximumSpeed;
    lastSpeedIntentRef.current = null;
    setRequestedSpeed(Math.max(0, Math.min(maximumSpeed, observerSpeed)));
  }, [knownMaximumSpeed, maximumSpeed, observedMaximumSpeed, observerSpeed]);

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (ack.id && navigationRefreshIntentIdsRef.current.has(ack.id)) {
          if (ack.status === "accepted") return;
          navigationRefreshIntentIdsRef.current.delete(ack.id);
          const reason = String(ack.reason || "");
          if (ack.status === "rejected" && reason.toLowerCase().includes("navigation computer")) {
            setNavigationRefreshBlocked(true);
            setCommandAlert(`NAVIGATION DATA UNAVAILABLE // ${reason.toUpperCase()}`);
          }
          return;
        }
        if (ack.id && spaceProbeIntentIdsRef.current.has(ack.id)) {
          if (ack.status === "accepted") return;
          spaceProbeIntentIdsRef.current.delete(ack.id);
          const reason = String(ack.reason || "").toLowerCase();
          if (
            ack.status === "rejected" &&
            (reason.includes("target lock") ||
              reason.includes("another ship command") ||
              reason.includes("manual telemetry capture"))
          ) {
            scheduleSpaceProbeRetry();
          }
          return;
        }
        if (ack.id && hyperspaceEscapeIntentIdsRef.current.has(ack.id)) {
          hyperspaceEscapeIntentIdsRef.current.delete(ack.id);
          if (ack.status === "rejected") {
            setHyperspaceEscapePending(false);
            setCommandAlert(
              `HYPERSPACE CUTOFF REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`,
            );
          }
          return;
        }
        if (!ack.id || !pendingIntentIdsRef.current.has(ack.id)) return;
        const autotrackIntent = autotrackIntentIdsRef.current.has(ack.id);
        if (autotrackIntent && ack.status !== "accepted") {
          pendingIntentIdsRef.current.delete(ack.id);
          autotrackIntentIdsRef.current.delete(ack.id);
          setCommandAlert(
            ack.status === "completed"
              ? String(ack.reason || "AUTOTRACK UPDATED").toUpperCase()
              : `AUTOTRACK REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`,
          );
          return;
        }
        const targetedShip = targetIntentShipsRef.current.get(ack.id);
        if (ack.status === "accepted" && targetedShip) {
          setCommandAlert(`TRACKING ${targetedShip.name.toUpperCase()} // HOLDING COMMAND OUTPUT`);
          return;
        }
        if (ack.status === "completed") {
          pendingIntentIdsRef.current.delete(ack.id);
          const completedTarget = targetIntentShipsRef.current.get(ack.id);
          targetIntentShipsRef.current.delete(ack.id);
          if (completedTarget) {
            targetLockTokenRef.current += 1;
            const key = dispositionKey(completedTarget.name);
            setDismissedTargetNames((current) => {
              if (!current.has(key)) return current;
              const next = new Set(current);
              next.delete(key);
              return next;
            });
            setDispositions((current) => {
              const next = { ...current, [key]: "enemy" as ShipDisposition };
              localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(next));
              return next;
            });
            syncedDispositionsRef.current.set(key, "enemy");
          }
          navigationLockTokenRef.current += 1;
          setCommandLocked(false);
          const completion = String(ack.reason || "COMMAND COMPLETE").toUpperCase();
          setNavigationStatus(completion);
          if (completedTarget)
            setCommandAlert(`${completion} // ${completedTarget.name.toUpperCase()}`);
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
          manualScanTargetIdRef.current = null;
          setManualScanSource(null);
          setManualScanStatus(String(ack.reason || "SHIP SCAN REJECTED").toUpperCase());
        }
        const message = String(ack.reason || "COMMAND REJECTED").toUpperCase();
        lastSpeedIntentRef.current = null;
        setRequestedSpeed(
          Math.max(
            0,
            Math.min(lastMaximumSpeedRef.current ?? 0, lastObservedSpeedRef.current ?? 0),
          ),
        );
        setCommandAlert(message);
        setNavigationStatus(message);
        setCommandLocked(false);
        setTimeout(() => setCommandAlert(""), 5_000);
      }),
    [scheduleSpaceProbeRetry],
  );

  useEffect(() => {
    if (!manualScanSource || !telemetry.snapshot) return;
    if (
      (telemetry.snapshot.sequence ?? 0) <= manualScanStartSequenceRef.current ||
      telemetry.snapshot.metadata?.lastSource !== manualScanSource
    )
      return;
    manualScanRequestTokenRef.current += 1;
    manualScanTargetIdRef.current = null;
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
      if (pollingPaused) return;
      if (event.key.toLowerCase() === "m" && navigationMode === "idle") beginVectorCourse();
      else if (event.key === "Escape" && navigationMode !== "idle") cancelNavigation();
      else if (event.key === "Enter" && ["confirm", "target", "away"].includes(navigationMode))
        void submitNavigation();
      else if (event.key === "Enter" && navigationMode === "vector") stageNavigation();
    };
    window.addEventListener("keydown", handleNavigationKey);
    return () => window.removeEventListener("keydown", handleNavigationKey);
  }, [
    beginVectorCourse,
    cancelNavigation,
    navigationMode,
    pollingPaused,
    stageNavigation,
    submitNavigation,
  ]);
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

  if (!spaceTelemetryActive)
    return (
      <>
        {starting && <StartupSequence onComplete={finishStartup} />}
        <main className={`${styles.experience} ${starting ? styles.startupActive : ""}`}>
          <div className={styles.scanlines} aria-hidden="true" />
          <UplinkNotice
            paused={telemetry.connected && landed}
            reason={telemetry.spaceState?.reason}
          />
        </main>
      </>
    );

  return (
    <>
      {starting && <StartupSequence onComplete={finishStartup} />}
      {!starting && ["hyperspace", "reentry"].includes(hyperspaceState.phase || "") && (
        <HyperspaceTransit
          reentry={hyperspaceState.phase === "reentry"}
          escapePending={hyperspaceEscapePending}
          onEscape={() => void escapeHyperspace()}
        />
      )}
      <main className={`${styles.experience} ${starting ? styles.startupActive : ""}`}>
        <TacticalCanvas
          ref={tacticalRef}
          snapshot={classifiedSnapshot}
          observerLabel={viewpointMemberId ? "REMOTE VIEW" : "YOUR SHIP"}
          radarBubbleEnabled={radarBubbleEnabled}
          originGridEnabled={originGridEnabled}
          combatEvents={viewpointMemberId ? [] : combatEvents}
          jumpEvents={viewpointMemberId ? [] : telemetry.snapshot?.metadata?.shipJumpEvents}
          destructionEvents={telemetry.snapshot?.metadata?.shipDestructionEvents}
          selectedId={selectedId}
          onSelect={selectContact}
          onMovementVector={setCourseVector}
          onMovementCommit={stageNavigation}
          onMovementCancel={cancelNavigation}
          onCameraModeChange={setCameraMode}
        />
        <div className={styles.scanlines} aria-hidden="true" />

        {pollingPaused && (
          <section className={styles.pollingPausedOverlay} role="status" aria-live="assertive">
            <div className={styles.pollingPausedIndicator}>
              <span className={styles.pauseGlyph} aria-hidden="true">
                II
              </span>
              <p>AUTOMATIC COMMAND OUTPUT SUSPENDED</p>
              <h2>POLLING PAUSED</h2>
              <span>TACTICAL TELEMETRY MAY BE STALE // MUDLET COMMAND WINDOW IS CLEAR</span>
              <button
                type="button"
                disabled={pollingPausePending}
                onClick={() => void changePollingPause(false)}
              >
                <PollingControlIcon paused />
                {pollingPausePending ? "RESUMING..." : "RESUME POLLING"}
              </button>
            </div>
          </section>
        )}

        <header className={`${styles.topbar} ${styles.panel}`}>
          <div className={styles.systemIdentity}>
            <p className={styles.eyebrow}>
              {viewpointMemberId
                ? `REMOTE UPLINK // ${activeTacticalView ? "LIVE" : "AWAITING RADAR"} // ${viewpointMember?.name || viewpointMemberId}`
                : "HOLOCRON 3D // LIVE TACTICAL"}
            </p>
            <h1 id="system-name">{telemetry.snapshot ? scene.system : "Awaiting telemetry"}</h1>
          </div>
          {telemetry.connected && (
            <div className={styles.controlStack}>
              <nav className={styles.viewControls} aria-label="Tactical view controls">
                <button
                  type="button"
                  className={`${styles.iconButton} ${radarBubbleEnabled ? styles.activeViewControl : ""}`}
                  aria-label={`${radarBubbleEnabled ? "Hide" : "Show"} radar bubble`}
                  aria-pressed={radarBubbleEnabled}
                  data-tooltip={`${radarBubbleEnabled ? "HIDE" : "SHOW"} RADAR BUBBLE`}
                  onClick={() => setRadarBubbleEnabled((enabled) => !enabled)}
                >
                  <ViewIcon type="radar" />
                </button>
                <button
                  type="button"
                  className={`${styles.iconButton} ${originGridEnabled ? styles.activeViewControl : ""}`}
                  aria-label={`${originGridEnabled ? "Hide" : "Show"} origin grid`}
                  aria-pressed={originGridEnabled}
                  data-tooltip={`${originGridEnabled ? "HIDE" : "SHOW"} ORIGIN GRID`}
                  onClick={() => setOriginGridEnabled((enabled) => !enabled)}
                >
                  <ViewIcon type="grid" />
                </button>
              </nav>
              <nav
                className={`${styles.viewControls} ${styles.cameraControls}`}
                aria-label="Camera controls"
              >
                <button
                  type="button"
                  disabled={navigationMode !== "idle"}
                  className={`${styles.iconButton} ${cameraMode === "player" ? styles.activeViewControl : ""}`}
                  aria-label="Follow player ship"
                  aria-pressed={cameraMode === "player"}
                  data-tooltip="CAMERA // FOLLOW YOUR SHIP"
                  onClick={() => chooseCameraMode("player")}
                >
                  <CameraIcon type="player" />
                </button>
                <button
                  type="button"
                  disabled={navigationMode !== "idle"}
                  className={`${styles.iconButton} ${cameraMode === "rts" ? styles.activeViewControl : ""}`}
                  aria-label="Enable free RTS camera"
                  aria-pressed={cameraMode === "rts"}
                  data-tooltip="RTS CAMERA // WASD PAN // Q/E ELEVATION"
                  onClick={() => chooseCameraMode("rts")}
                >
                  <CameraIcon type="rts" />
                </button>
                <button
                  type="button"
                  disabled={navigationMode !== "idle" || !cameraFocusPoint}
                  className={`${styles.iconButton} ${cameraMode === "selection" ? styles.activeViewControl : ""}`}
                  aria-label="Focus camera on selected ship"
                  aria-pressed={cameraMode === "selection"}
                  data-tooltip={
                    cameraFocusPoint
                      ? `CAMERA // FOLLOW ${cameraFocusPoint.name.toUpperCase()}`
                      : "SELECT A SHIP TO FOCUS"
                  }
                  onClick={() => chooseCameraMode("selection")}
                >
                  <CameraIcon type="selection" />
                </button>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="Open strategic sector view"
                  data-tooltip="STRATEGIC SECTOR VIEW"
                  onClick={() => tacticalRef.current?.sectorView()}
                >
                  <ViewIcon type="sector" />
                </button>
              </nav>
            </div>
          )}
          <div className={styles.connectionControls}>
            <button
              type="button"
              className={`${styles.pollingControl} ${pollingPaused ? styles.pollingControlPaused : ""}`}
              disabled={pollingPausePending}
              aria-label={pollingPaused ? "Resume automatic polling" : "Pause automatic polling"}
              aria-pressed={pollingPaused}
              onClick={() => void changePollingPause(!pollingPaused)}
            >
              <PollingControlIcon paused={pollingPaused} />
              <span>{pollingPaused ? "RESUME" : "PAUSE"}</span>
            </button>
            <div className={styles.connection}>
              <span className={`${styles.light} ${telemetry.connected ? styles.live : ""}`} />
              <span>{telemetry.connectionLabel}</span>
            </div>
          </div>
        </header>

        {telemetry.connected && (
          <CommandScopeRail
            fleet={fleet}
            localName={localName}
            scope={fleetScope}
            drawerOpen={scopeDrawerOpen}
            onSelect={selectCommandScope}
          />
        )}

        {telemetry.connected && (
          <TargetShortcutRail
            targets={targetShortcuts}
            drawerOpen={targetDrawerOpen}
            onToggle={toggleTargetDrawer}
            onFocus={focusTargetShortcut}
            onClear={clearTargetShortcut}
            onOpenDossier={openShipDossier}
          />
        )}

        {telemetry.connected && scopeDrawerOpen && (
          <aside
            className={`${styles.scopeDrawer} ${styles.panel}`}
            aria-label="Active command recipient roster"
          >
            <header>
              <div>
                <p className={styles.eyebrow}>COMMAND RECIPIENT</p>
                <h2>{commandIssuerLabel.toUpperCase()}</h2>
              </div>
              <div className={styles.scopeDrawerHeaderActions}>
                {fleet?.kind === "battlegroup" &&
                  fleetScope !== "local" &&
                  !allFleetMembersSelected && (
                    <button
                      type="button"
                      className={styles.selectAllScope}
                      aria-label="Select all fleet craft"
                      title="Select all craft"
                      onClick={selectAllFleetMembers}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="13" height="13" rx="1" />
                        <path d="m7 9 3 3 8-8M8 20h12V8" />
                      </svg>
                    </button>
                  )}
                <button
                  type="button"
                  className={styles.closeScopeDrawer}
                  aria-label="Close command recipient roster"
                  onClick={() => setScopeDrawerOpen(false)}
                >
                  ×
                </button>
              </div>
            </header>
            <FleetRoster
              fleet={fleet}
              fleetOrder={telemetry.snapshot?.metadata?.fleetOrder}
              localName={localName}
              scope={fleetScope}
              selectedMemberIds={selectedFleetMemberIds}
              viewpointMemberId={viewpointMemberId}
              onToggleMember={toggleFleetMember}
              onViewMember={viewFleetMember}
              onOpenDossier={openShipDossier}
            />
          </aside>
        )}

        {shipDossier && dossierShip && (
          <ShipDossierPanel
            ship={dossierShip}
            mode={shipDossier.mode}
            loading={
              manualScanSource === shipDossier.mode &&
              manualScanTargetIdRef.current === dossierShip.id
            }
            message={manualScanStatus}
            onModeChange={changeDossierMode}
            onRefresh={() => void requestShipScan(dossierShip, shipDossier.mode)}
            onClose={() => setShipDossier(null)}
          />
        )}

        {hyperspacePlanner && (
          <HyperspacePlanner
            mode={hyperspacePlanner.mode}
            recipientLabel={hyperspacePlanner.routeScope.recipientLabel || "YOUR SHIP"}
            escapeAllowed={
              hyperspacePlanner.routeScope.formationKind !== "battlegroup" ||
              !["wings", "selected"].includes(hyperspacePlanner.routeScope.scope || "local")
            }
            catalog={telemetry.galaxyCatalog}
            currentSystem={scene.system}
            currentGalaxy={currentGalaxyPosition}
            observer={hyperspacePlanner.origin}
            destinations={navigationDestinations}
            onCancel={() => setHyperspacePlanner(null)}
            onPlot={(route, escape) => {
              const scopedRoute = { ...route, ...hyperspacePlanner.routeScope };
              const scopedEscape = escape
                ? {
                    ...escape,
                    route: { ...escape.route, ...hyperspacePlanner.routeScope },
                  }
                : undefined;
              void plotHyperspace(scopedRoute, scopedEscape);
            }}
          />
        )}

        {activeRoute && !hyperspacePlanner && (
          <NavigationComputer
            route={activeRoute}
            state={hyperspaceState}
            escape={escapePlan}
            clearance={routeClearance}
            onStop={() => void stopHyperspace()}
            onDismiss={dismissHyperspace}
            onEngage={() => void engageHyperspace()}
            onCalculateAnyway={calculateAnyway}
          />
        )}

        {telemetry.connected && navigationMode !== "idle" && (
          <NavigationDrawer
            mode={navigationMode}
            kind={pendingNavigationMode}
            targetName={navigationTarget?.name}
            targetDistance={
              navigationTarget ? Math.hypot(...navigationTarget.position3d) : undefined
            }
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
          <div className={styles.commandDeckFrame}>
            {commandToasts.length > 0 && (
              <div className={styles.commandToasts} role="log" aria-live="polite">
                {commandToasts.map((toast) => (
                  <div key={toast.id} className={styles.commandToast} data-tone={toast.tone}>
                    {toast.message}
                  </div>
                ))}
              </div>
            )}
            <footer className={`${styles.commandDeck} ${styles.panel}`}>
              <section className={styles.commandBank} aria-label="Context-sensitive actions">
                {navigationMode !== "idle" ? (
                  <>
                    <p className={styles.eyebrow}>COMMAND // NAVIGATION</p>
                    <div className={styles.actionPending} role="status">
                      <span className={styles.pendingSignal} aria-hidden="true" />
                      <strong>WAITING FOR CONFIRMATION</strong>
                      <small>
                        {pendingNavigationMode === "relative"
                          ? "COURSE VECTOR"
                          : `${pendingNavigationMode === "away" ? "COURSE AWAY" : "COURSE TO"} // ${(navigationTarget?.name || "TARGET LOST").toUpperCase()}`}
                      </small>
                      <button type="button" onClick={cancelNavigation}>
                        <CommandIcon type="cancel" />
                        <span>CANCEL COMMAND</span>
                      </button>
                    </div>
                  </>
                ) : fleetCommandMode && fleet ? (
                  fleet.kind === "squadron" ? (
                    <SquadronCommandPanel
                      fleet={fleet}
                      observer={telemetry.snapshot?.observer || observer}
                      targetName={combatTargetName || undefined}
                      events={combatEvents}
                      canTarget={selectedShip !== null}
                      disabled={landed || commandLocked || !formationCommandsEnabled}
                      weaponsDisabled={landed}
                      onTarget={() => void targetSelectedShip()}
                      onFire={fireWeapon}
                      onOrder={(order, payload) => void sendFleetOrder(order, payload)}
                    />
                  ) : (
                    <FleetCommandPanel
                      fleet={fleet}
                      fleetOrder={fleetOrder}
                      localAutopilot={telemetry.snapshot?.observer?.autopilot}
                      scope={fleetScope}
                      selectedMembers={selectedFleetMembers}
                      targetName={navigableTarget?.name}
                      canTarget={selectedShip !== null}
                      disabled={landed || commandLocked || selectedFleetScopeEmpty}
                      onBeginMove={beginVectorCourse}
                      onCourseTarget={armTargetCourse}
                      onOrder={(order, payload) => void sendFleetOrder(order, payload)}
                    />
                  )
                ) : (
                  <>
                    <p className={styles.eyebrow}>ACTIONS // {commandIssuerLabel.toUpperCase()}</p>
                    <div className={styles.orderActions}>
                      {navigableTarget ? (
                        <>
                          {selectedShip && (
                            <>
                              <button
                                type="button"
                                className={`${styles.iconButton} ${styles.aggressiveOrder}`}
                                disabled={landed || commandLocked || observerHasNoWeapons}
                                aria-label="Target selected ship"
                                data-tooltip={
                                  observerHasNoWeapons
                                    ? "This ship has no weapons"
                                    : "TARGET // AGGRESSIVE ACT"
                                }
                                onClick={() => void targetSelectedShip()}
                              >
                                <CommandIcon type="target" />
                              </button>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label="Show selected ship status card"
                                data-tooltip="STATUS CARD"
                                onClick={() => openShipDossier(selectedShip, "status")}
                              >
                                <CommandIcon type="scan" />
                              </button>
                              <button
                                type="button"
                                className={styles.iconButton}
                                aria-label="Show selected ship information card"
                                data-tooltip="INFO CARD"
                                onClick={() => openShipDossier(selectedShip, "info")}
                              >
                                <CommandIcon type="info" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className={styles.iconButton}
                            disabled={landed || commandLocked}
                            aria-label="Course toward selected contact"
                            data-tooltip="TO"
                            onClick={() => armTargetCourse("target")}
                          >
                            <CommandIcon type="to" />
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            disabled={landed || commandLocked}
                            aria-label="Course away from selected contact"
                            data-tooltip="AWAY"
                            onClick={() => armTargetCourse("away")}
                          >
                            <CommandIcon type="away" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={landed || commandLocked}
                          className={styles.iconButton}
                          aria-label="Set relative course"
                          data-tooltip="MOVE / M"
                          onClick={beginVectorCourse}
                        >
                          <MoveIcon />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${styles.iconButton} ${autotrackObserved === true ? styles.activeOrder : ""}`}
                        disabled={landed || autotrackPending}
                        aria-label={`${autotrackDesired ? "Disable" : "Enable"} autotrack`}
                        aria-pressed={autotrackObserved === true}
                        data-tooltip={`AUTOTRACK ${autotrackPending ? "AWAITING CONFIRMATION" : autotrackDesired ? "ON" : "OFF"}`}
                        onClick={() => void toggleAutotrack()}
                      >
                        <CommandIcon type="track" />
                      </button>
                      <button
                        type="button"
                        className={styles.iconButton}
                        disabled={
                          landed ||
                          commandLocked ||
                          shieldRecharging ||
                          shieldStatusPending ||
                          shieldsFull
                        }
                        aria-label="Recharge shields to full"
                        data-tooltip={
                          shieldsFull
                            ? "SHIELDS AT PEAK POWER"
                            : shieldRecharging
                              ? "SHIELD RECHARGE RUNNING"
                              : "RECHARGE SHIELDS TO FULL"
                        }
                        onClick={() => void rechargeShields()}
                      >
                        <CommandIcon type="recharge" />
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconButton} ${autoRechargeEnabled ? styles.activeOrder : ""}`}
                        disabled={landed}
                        aria-label={`${autoRechargeEnabled ? "Disable" : "Enable"} automatic shield recharge`}
                        aria-pressed={autoRechargeEnabled}
                        data-tooltip={`AUTO RECHARGE ${autoRechargeEnabled ? "ON" : "OFF"}`}
                        onClick={() => void toggleAutoRecharge()}
                      >
                        <CommandIcon type="autoRecharge" />
                      </button>
                    </div>
                    {selectedShip && (
                      <div className={styles.aggressiveWarning}>
                        TARGET // WEAPON LOCK IS AN AGGRESSIVE ACT
                      </div>
                    )}
                    <ShipSpeedControl
                      id="ship-speed"
                      label={`PLAYER SPEED // ${localName.toUpperCase()}`}
                      value={requestedSpeed}
                      maximum={maximumSpeed}
                      disabled={landed || commandLocked}
                      onChange={setRequestedSpeed}
                      onCommit={chooseSpeed}
                    />
                    {combatTargetName ? (
                      <WeaponsPanel
                        observer={telemetry.snapshot?.observer || observer}
                        targetName={combatTargetName}
                        events={combatEvents}
                        disabled={landed}
                        onFire={fireWeapon}
                      />
                    ) : selectedShip ? (
                      <>
                        <div className={styles.dispositions} aria-label="Ship disposition">
                          {(["neutral", "ally", "enemy"] as ShipDisposition[]).map(
                            (disposition) => (
                              <button
                                key={disposition}
                                type="button"
                                className={styles.iconButton}
                                aria-pressed={
                                  (selectedShip.disposition || "neutral") === disposition
                                }
                                aria-label={`Mark ship ${disposition === "ally" ? "friendly" : disposition}`}
                                data-tooltip={
                                  disposition === "ally" ? "FRIENDLY" : disposition.toUpperCase()
                                }
                                onClick={() => setShipDisposition(selectedShip, disposition)}
                              >
                                <CommandIcon
                                  type={disposition === "ally" ? "friendly" : disposition}
                                />
                              </button>
                            ),
                          )}
                        </div>
                        {manualScanStatus && (
                          <div className={styles.manualScanStatus} role="status">
                            {manualScanStatus}
                          </div>
                        )}
                      </>
                    ) : navigableTarget ? (
                      <div className={styles.commandStandby}>
                        SELECT TO OR AWAY // {navigableTarget.name.toUpperCase()}
                      </div>
                    ) : null}
                  </>
                )}
              </section>

              <section
                className={styles.selectedVessel}
                aria-label="Selected target telemetry"
                data-disabled={hasSelectedContact && isDisabledShip(displayedSelection)}
              >
                {hasSelectedContact ? (
                  <>
                    <p className={styles.eyebrow}>SELECTED TARGET</p>
                    <div className={styles.vesselHeading}>
                      <div>
                        <h2>{displayedSelection.name}</h2>
                        <p className={styles.muted}>
                          {displayedSelection.class || displayedSelection.kind || "Unknown contact"}
                        </p>
                      </div>
                      <div className={styles.vesselTags}>
                        {isDisabledShip(displayedSelection) && (
                          <span className={styles.disabledTag}>DISABLED</span>
                        )}
                        <span>
                          {displayedSelection.shipCategory?.toUpperCase() || "UNCLASSIFIED"}
                        </span>
                        {selectedShip && (
                          <span className={styles.dossierLaunchers}>
                            <button
                              type="button"
                              aria-label={`Show status card for ${selectedShip.name}`}
                              onClick={() => openShipDossier(selectedShip, "status")}
                            >
                              S
                            </button>
                            <button
                              type="button"
                              aria-label={`Show info card for ${selectedShip.name}`}
                              onClick={() => openShipDossier(selectedShip, "info")}
                            >
                              I
                            </button>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.vesselRanges}>
                      <RangeMeter
                        label="HULL"
                        reading={displayedSelection.hull as RangeReading | undefined}
                      />
                      <RangeMeter
                        label="SHIELD"
                        reading={displayedSelection.shields as RangeReading | undefined}
                        tone="shield"
                      />
                      <RangeMeter
                        label="SPEED"
                        reading={
                          typeof displayedSelection.speed === "object"
                            ? (displayedSelection.speed as RangeReading)
                            : undefined
                        }
                        tone="speed"
                      />
                      <RangeMeter
                        label="ENERGY"
                        reading={displayedSelection.energy as RangeReading | undefined}
                        tone="energy"
                      />
                    </div>
                    <dl className={`${styles.readouts} ${styles.compactReadouts}`}>
                      {detailRows(displayedSelection)
                        .slice(0, 8)
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </>
                ) : (
                  <div className={styles.emptyTarget}>
                    <span aria-hidden="true">◇</span>
                    <strong>NO TARGET SELECTED</strong>
                    <small>SELECT A CONTACT, CELESTIAL BODY, OR NAVIGATION OBJECT</small>
                  </div>
                )}
              </section>

              <section className={styles.issuerBank} aria-label="Active command recipient">
                <p className={styles.eyebrow}>ISSUING TO</p>
                <div className={styles.issuerHeading}>
                  <div>
                    <h2>{commandIssuerLabel}</h2>
                    <p>{commandIssuerType}</p>
                  </div>
                  <span>
                    {fleetScope === "local" || !fleet?.active
                      ? "LOCAL"
                      : `${issuerMembers.length} CRAFT`}
                  </span>
                </div>
                <div className={styles.issuerRanges}>
                  <RangeMeter label="HULL" reading={issuerHull} />
                  <RangeMeter label="SHIELD" reading={issuerShields} tone="shield" />
                  <RangeMeter label="ENERGY" reading={issuerEnergy} tone="energy" />
                </div>
                <div className={styles.issuerStatus}>
                  <span>STATUS // ACTIVE</span>
                  <span>
                    AUTOPILOT //{" "}
                    {fleetScope === "local"
                      ? telemetry.snapshot?.observer?.autopilot === undefined
                        ? "UNKNOWN"
                        : telemetry.snapshot.observer.autopilot
                          ? "ON"
                          : "OFF"
                      : issuerMembers.some((member) => member.autopilot)
                        ? "PARTIAL / ON"
                        : "OFF"}
                  </span>
                </div>
                <div className={styles.hyperspaceActions}>
                  <p>HYPERSPACE</p>
                  <div>
                    <button
                      type="button"
                      disabled={landed || activeRoute !== null || selectedFleetScopeEmpty}
                      onClick={() => openHyperspacePlanner("local")}
                    >
                      <HyperspaceIcon />
                      <span>LOCAL JUMP</span>
                    </button>
                    <button
                      type="button"
                      disabled={landed || activeRoute !== null || selectedFleetScopeEmpty}
                      onClick={() => openHyperspacePlanner("galactic")}
                    >
                      <HyperspaceIcon galactic />
                      <span>PLOT HYPERSPACE</span>
                    </button>
                  </div>
                  <small>ROUTE APPLIES TO // {commandIssuerLabel.toUpperCase()}</small>
                </div>
              </section>
            </footer>
          </div>
        )}

        {expandedCluster?.members && (
          <section
            className={`${styles.clusterPanel} ${styles.panel}`}
            aria-label="Grouped contacts"
          >
            <header>
              <div>
                <p className={styles.eyebrow}>COLOCATED CONTACTS</p>
                <h2>
                  {expandedCluster.memberCount} CONTACTS AT{" "}
                  {expandedCluster.worldPosition.map(formatCoordinate).join(" / ")}
                </h2>
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
                  onClick={() => {
                    setSelectedId(member.id);
                    setHoveredMemberId(null);
                    setExpandedClusterId(null);
                  }}
                >
                  <strong>{member.name}</strong>
                  <span>
                    {member.class || (member.kind === "ship" ? "Unknown ship class" : member.kind)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
