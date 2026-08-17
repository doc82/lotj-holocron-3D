import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildScene, findScenePoint } from "../domain/scene";
import { resolveFormationOrigins } from "../domain/coursePlot";
import { canCommandFormation, fleetMemberForSelectionKey } from "../domain/fleet";
import {
  aggregateReading,
  buildTacticalSnapshot,
  classifyTacticalSnapshot,
  fleetMembersForScope,
  pointsIncludingClusters,
  tacticalViewForMember,
} from "../domain/tacticalWorkspace";
import {
  buildTacticalTargetShortcuts,
  type TacticalTargetShortcut,
} from "../domain/tacticalTargets";
import { NavigationDrawer } from "../features/commands/NavigationDrawer";
import { useNavigationController } from "../features/commands/useNavigationController";
import { useShipCommandController } from "../features/commands/useShipCommandController";
import { UplinkNotice } from "../features/connection/UplinkNotice";
import type { FleetScope } from "../features/fleet/FleetRoster";
import { CommandScopeRail } from "../features/fleet/CommandScopeRail";
import { useFleetSelection } from "../features/fleet/useFleetSelection";
import { commandToastTone, useCommandFeedback } from "../features/feedback/useCommandFeedback";
import { HyperspacePlanner } from "../features/hyperspace/HyperspacePlanner";
import { HyperspaceTransit } from "../features/hyperspace/HyperspaceTransit";
import { NavigationComputer } from "../features/hyperspace/NavigationComputer";
import { useHyperspaceController } from "../features/hyperspace/useHyperspaceController";
import { usePollingController } from "../features/polling/usePollingController";
import { StartupSequence } from "../features/startup/StartupSequence";
import { TacticalCanvas, type TacticalCanvasHandle } from "../features/tactical/TacticalCanvas";
import type { TacticalCameraMode } from "../features/tactical/TacticalEngine";
import { TargetShortcutRail } from "../features/tactical/TargetShortcutRail";
import { useTacticalInteractionController } from "../features/tactical/useTacticalInteractionController";
import type { RangeReading } from "../features/telemetry/RangeMeter";
import { ShipDossierPanel } from "../features/telemetry/ShipDossierPanel";
import { useTelemetry } from "../features/telemetry/useTelemetry";
import { useShipDispositions } from "../features/telemetry/useShipDispositions";
import { useShipDossierController } from "../features/telemetry/useShipDossierController";
import styles from "./App.module.css";
import { CommandActionPanel } from "./CommandActionPanel";
import { PollingPausedOverlay, TacticalHeader } from "./TacticalChrome";
import {
  CommandIssuerPanel,
  ContactClusterPanel,
  FleetScopeDrawer,
  SelectedTargetPanel,
} from "./WorkspacePanels";
import type { Vector3 } from "../types/telemetry";

export function App() {
  const telemetry = useTelemetry();
  const pollingPaused = telemetry.snapshot?.metadata?.polling?.paused === true;
  const [starting, setStarting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetDrawerOpen, setTargetDrawerOpen] = useState(false);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const [radarBubbleEnabled, setRadarBubbleEnabled] = useState(true);
  const [originGridEnabled, setOriginGridEnabled] = useState(false);
  const [cameraMode, setCameraMode] = useState<TacticalCameraMode>("player");
  const [commandLocked, setCommandLocked] = useState(false);
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const fleetOrder = telemetry.snapshot?.metadata?.fleetOrder;
  const {
    alert: commandAlert,
    toasts: commandToasts,
    setAlert: setCommandAlert,
  } = useCommandFeedback(fleetOrder);
  const {
    dispositions,
    setDisposition: setShipDisposition,
    markEnemy: markShipEnemy,
  } = useShipDispositions(telemetry.connected, telemetry.snapshot);
  const fleet = telemetry.snapshot?.metadata?.fleet;
  const fleetSelection = useFleetSelection(fleet);
  const {
    scope: fleetScope,
    drawerOpen: scopeDrawerOpen,
    selectedMemberKeys: selectedFleetMemberKeys,
    selectedMembers: selectedFleetMembers,
    selectedMember: selectedFleetMember,
    allMembersSelected: allFleetMembersSelected,
    selectedScopeEmpty: selectedFleetScopeEmpty,
    viewpointMemberKey,
  } = fleetSelection;
  const { pausePending: pollingPausePending, changePause: changePollingPause } =
    usePollingController({
      connected: telemetry.connected,
      paused: pollingPaused,
      starting,
      setAlert: setCommandAlert,
    });
  const viewpointMember = fleetMemberForSelectionKey(fleet?.members ?? [], viewpointMemberKey);
  const activeTacticalView = tacticalViewForMember(telemetry.snapshot, viewpointMemberKey);
  const tacticalSnapshot = useMemo(
    () => buildTacticalSnapshot(telemetry.snapshot, viewpointMemberKey),
    [telemetry.snapshot, viewpointMemberKey],
  );
  const classifiedSnapshot = useMemo(
    () => classifyTacticalSnapshot(tacticalSnapshot, telemetry.snapshot, dispositions),
    [dispositions, tacticalSnapshot, telemetry.snapshot],
  );
  const scene = useMemo(() => buildScene(classifiedSnapshot), [classifiedSnapshot]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const finishStartup = useCallback(() => setStarting(false), []);

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
  const activeTacticalViewReady = Boolean(activeTacticalView?.observedAt);
  const activatedViewpointRef = useRef<string | null>(null);
  useEffect(() => {
    if (!viewpointMemberKey) {
      activatedViewpointRef.current = null;
      return;
    }
    if (!activeTacticalViewReady || activatedViewpointRef.current === viewpointMemberKey) return;
    activatedViewpointRef.current = viewpointMemberKey;
    tacticalRef.current?.fitSystem();
    setCommandAlert(
      `TACTICAL VIEW ACTIVE // ${(activeTacticalView?.memberName || viewpointMember?.name || "UNKNOWN").toUpperCase()}`,
    );
  }, [
    activeTacticalView?.memberName,
    activeTacticalViewReady,
    setCommandAlert,
    viewpointMember?.name,
    viewpointMemberKey,
  ]);
  const observerSpeed =
    typeof localObserver?.speed === "object" && localObserver.speed
      ? Number(localObserver.speed.current) || 0
      : Number(localObserver?.speed) || 0;
  const observedMaximumSpeed =
    typeof localObserver?.speed === "object" && localObserver.speed
      ? Number(localObserver.speed.maximum) || 0
      : Number(localObserver?.maximumSpeed) || 0;
  const navigableTarget =
    selected && ["ship", "planet", "celestial", "star"].includes(selected.kind) ? selected : null;
  const selectedShip = selected?.kind === "ship" ? selected : null;
  const clearTransientSelection = useCallback(() => {
    setExpandedClusterId(null);
    setHoveredMemberId(null);
  }, []);
  const closeTargetDrawerForDossier = useCallback(() => setTargetDrawerOpen(false), []);
  const dossier = useShipDossierController({
    connected: telemetry.connected,
    landed,
    commandLocked,
    snapshot: telemetry.snapshot,
    localName,
    localObserver,
    fleetMembers: fleet?.members,
    scenePoints: flattenedScenePoints,
    setAlert: setCommandAlert,
    onOpen: closeTargetDrawerForDossier,
  });
  const shipDossier = dossier.request;
  const dossierShip = dossier.ship;
  const manualScanStatus = dossier.scanStatus;
  const tacticalInteractions = useTacticalInteractionController({
    connected: telemetry.connected,
    localName,
    reportedTargets: reportedTargetShortcuts,
    tacticalRef,
    setAlert: setCommandAlert,
    targetDrawerOpen,
    setTargetDrawerOpen,
    selectFleetScope: fleetSelection.selectScope,
    selectFleetMember: fleetSelection.selectOnlyMember,
    selectViewpoint: fleetSelection.selectViewpoint,
    closeFleetDrawer: fleetSelection.closeDrawer,
    closeDossier: dossier.close,
    setSelectedId,
    clearClusterSelection: clearTransientSelection,
  });
  const targetShortcuts = tacticalInteractions.targets;

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

  const navigation = useNavigationController({
    connected: telemetry.connected,
    landed,
    pollingPaused,
    commandLocked,
    setCommandLocked,
    setAlert: setCommandAlert,
    tacticalRef,
    scene,
    navigableTarget,
    observerSpeed,
    observedMaximumSpeed,
    fleetCommandMode,
    fleetScope,
    selectedFleetMembers,
    viewpointMemberKey,
    movementOriginsForScope,
    clearTransientSelection,
  });
  const navigationMode = navigation.mode;
  const pendingNavigationMode = navigation.commandMode;
  const navigationTarget = navigation.navigationTarget;
  const courseVector = navigation.vector;
  const requestedSpeed = navigation.requestedSpeed;
  const maximumSpeed = navigation.maximumSpeed;
  const navigationStatus = navigation.status;
  const setCourseVector = navigation.setVector;
  const setRequestedSpeed = navigation.setRequestedSpeed;
  const setNavigationStatus = navigation.setStatus;
  const cancelNavigation = navigation.cancel;
  const beginVectorCourse = navigation.beginVector;
  const armTargetCourse = navigation.armTarget;
  const stageNavigation = navigation.stage;
  const submitNavigation = navigation.submit;
  const chooseSpeed = navigation.chooseSpeed;

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
  const restoreTarget = tacticalInteractions.restoreTarget;
  const shipCommands = useShipCommandController({
    connected: telemetry.connected,
    landed,
    commandLocked,
    setCommandLocked,
    setAlert: setCommandAlert,
    setNavigationStatus,
    selectedShip,
    fleet,
    fleetScope,
    selectedFleetMembers,
    viewpointMemberKey,
    autotrackDesired,
    autotrackPending,
    shieldRecharging,
    shieldsFull,
    autoRechargeEnabled,
    restoreTarget,
    markShipEnemy,
  });
  const viewpointGalaxy = viewpointMember?.galaxy;
  const hyperspace = useHyperspaceController({
    connected: telemetry.connected,
    pollingPaused,
    snapshot: telemetry.snapshot,
    galaxyCatalog: telemetry.galaxyCatalog,
    fleet,
    fleetCommandMode,
    fleetScope,
    selectedFleetMembers,
    commandIssuerLabel,
    localName,
    viewpointGalaxy,
    observerWorldPosition: observer.worldPosition,
    movementOriginsForScope,
    setAlert: setCommandAlert,
  });
  const hyperspaceState = hyperspace.state;
  const hyperspacePlanner = hyperspace.planner;
  const activeRoute = hyperspace.activeRoute;
  const escapePlan = hyperspace.escapePlan;
  const hyperspaceEscapePending = hyperspace.escapePending;
  const routeClearance = hyperspace.routeClearance;
  const navigationDestinations = hyperspace.navigationDestinations;
  const currentGalaxyPosition = hyperspace.currentGalaxyPosition;

  const selectCommandScope = tacticalInteractions.selectCommandScope;
  const toggleFleetMember = fleetSelection.toggleMember;
  const selectAllFleetMembers = fleetSelection.selectAll;
  const viewFleetMember = tacticalInteractions.viewFleetMember;
  const focusTargetShortcut = tacticalInteractions.focusTarget;
  const clearTargetShortcut = tacticalInteractions.clearTarget;
  const toggleTargetDrawer = tacticalInteractions.toggleTargetDrawer;

  const openHyperspacePlanner = hyperspace.openPlanner;
  const plotHyperspace = hyperspace.plot;
  const stopHyperspace = hyperspace.stop;
  const dismissHyperspace = hyperspace.dismiss;
  const engageHyperspace = hyperspace.engage;
  const escapeHyperspace = hyperspace.escape;
  const calculateAnyway = hyperspace.calculateAnyway;

  const openShipDossier = dossier.open;
  const changeDossierMode = dossier.changeMode;

  const targetSelectedShip = shipCommands.targetSelectedShip;
  const toggleAutotrack = shipCommands.toggleAutotrack;
  const fireWeapon = shipCommands.fireWeapon;

  const sendFleetOrder = shipCommands.sendFleetOrder;
  const rechargeShields = shipCommands.rechargeShields;
  const toggleAutoRecharge = shipCommands.toggleAutoRecharge;

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
          observerLabel={viewpointMemberKey ? "REMOTE VIEW" : "YOUR SHIP"}
          radarBubbleEnabled={radarBubbleEnabled}
          originGridEnabled={originGridEnabled}
          combatEvents={viewpointMemberKey ? [] : combatEvents}
          jumpEvents={viewpointMemberKey ? [] : telemetry.snapshot?.metadata?.shipJumpEvents}
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
          <PollingPausedOverlay
            pending={pollingPausePending}
            onResume={() => void changePollingPause(false)}
          />
        )}

        <TacticalHeader
          connected={telemetry.connected}
          identity={
            viewpointMemberKey
              ? `REMOTE UPLINK // ${activeTacticalView ? "LIVE" : "AWAITING RADAR"} // ${viewpointMember?.name || viewpointMemberKey}`
              : "HOLOCRON 3D // LIVE TACTICAL"
          }
          systemName={telemetry.snapshot ? scene.system : "Awaiting telemetry"}
          radarBubbleEnabled={radarBubbleEnabled}
          originGridEnabled={originGridEnabled}
          navigationActive={navigationMode !== "idle"}
          cameraMode={cameraMode}
          cameraFocusName={cameraFocusPoint?.name}
          pollingPaused={pollingPaused}
          pollingPausePending={pollingPausePending}
          connectionLabel={telemetry.connectionLabel}
          onToggleRadar={() => setRadarBubbleEnabled((enabled) => !enabled)}
          onToggleGrid={() => setOriginGridEnabled((enabled) => !enabled)}
          onCameraMode={chooseCameraMode}
          onSectorView={() => tacticalRef.current?.sectorView()}
          onPollingPaused={(paused) => void changePollingPause(paused)}
        />

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
          <FleetScopeDrawer
            label={commandIssuerLabel}
            fleet={fleet}
            fleetOrder={telemetry.snapshot?.metadata?.fleetOrder}
            localName={localName}
            scope={fleetScope}
            selectedMemberKeys={selectedFleetMemberKeys}
            viewpointMemberKey={viewpointMemberKey}
            allMembersSelected={allFleetMembersSelected}
            onSelectAll={selectAllFleetMembers}
            onClose={fleetSelection.closeDrawer}
            onToggleMember={toggleFleetMember}
            onViewMember={viewFleetMember}
            onOpenDossier={openShipDossier}
          />
        )}

        {shipDossier && dossierShip && (
          <ShipDossierPanel
            ship={dossierShip}
            mode={shipDossier.mode}
            loading={dossier.loading}
            message={manualScanStatus}
            onModeChange={changeDossierMode}
            onRefresh={dossier.refresh}
            onClose={dossier.close}
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
            onCancel={hyperspace.closePlanner}
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
            {commandAlert && (
              <div
                className={styles.commandAlert}
                data-tone={commandToastTone(commandAlert)}
                role="status"
                aria-live="polite"
              >
                {commandAlert}
              </div>
            )}
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
              <CommandActionPanel
                navigationMode={navigationMode}
                navigationCommandMode={pendingNavigationMode}
                navigationTarget={navigationTarget}
                commandIssuerLabel={commandIssuerLabel}
                fleetCommandMode={fleetCommandMode}
                fleet={fleet}
                fleetOrder={fleetOrder}
                fleetScope={fleetScope}
                selectedFleetMembers={selectedFleetMembers}
                selectedFleetScopeEmpty={selectedFleetScopeEmpty}
                formationCommandsEnabled={formationCommandsEnabled}
                observer={telemetry.snapshot?.observer || observer}
                combatTargetName={combatTargetName}
                combatEvents={combatEvents}
                selectedShip={selectedShip}
                navigableTarget={navigableTarget}
                landed={landed}
                commandLocked={commandLocked}
                observerHasNoWeapons={observerHasNoWeapons}
                autotrackObserved={autotrackObserved}
                autotrackDesired={autotrackDesired}
                autotrackPending={autotrackPending}
                shieldRecharging={shieldRecharging}
                shieldStatusPending={shieldStatusPending}
                shieldsFull={shieldsFull}
                autoRechargeEnabled={autoRechargeEnabled}
                requestedSpeed={requestedSpeed}
                maximumSpeed={maximumSpeed}
                localName={localName}
                manualScanStatus={manualScanStatus}
                onCancelNavigation={cancelNavigation}
                onBeginMove={beginVectorCourse}
                onCourseTarget={armTargetCourse}
                onTarget={() => void targetSelectedShip()}
                onFire={fireWeapon}
                onFleetOrder={(order, payload) => void sendFleetOrder(order, payload)}
                onOpenDossier={openShipDossier}
                onToggleAutotrack={() => void toggleAutotrack()}
                onRechargeShields={() => void rechargeShields()}
                onToggleAutoRecharge={() => void toggleAutoRecharge()}
                onSpeedChange={setRequestedSpeed}
                onSpeedCommit={chooseSpeed}
                onDisposition={setShipDisposition}
              />

              <SelectedTargetPanel
                selection={hasSelectedContact ? displayedSelection : null}
                selectedShip={selectedShip}
                onOpenDossier={openShipDossier}
              />
              <CommandIssuerPanel
                label={commandIssuerLabel}
                type={commandIssuerType}
                fleetScope={fleetScope}
                fleet={fleet}
                members={issuerMembers}
                hull={issuerHull}
                shields={issuerShields}
                energy={issuerEnergy}
                localAutopilot={telemetry.snapshot?.observer?.autopilot}
                landed={landed}
                routeActive={activeRoute !== null}
                selectedScopeEmpty={selectedFleetScopeEmpty}
                onOpenHyperspace={openHyperspacePlanner}
              />
            </footer>
          </div>
        )}

        {expandedCluster?.members && (
          <ContactClusterPanel
            cluster={expandedCluster}
            selectedId={selectedId}
            onHover={setHoveredMemberId}
            onSelect={(id) => {
              setSelectedId(id);
              setHoveredMemberId(null);
              setExpandedClusterId(null);
            }}
            onClose={() => {
              setExpandedClusterId(null);
              setHoveredMemberId(null);
              setSelectedId(null);
            }}
          />
        )}
      </main>
    </>
  );
}
