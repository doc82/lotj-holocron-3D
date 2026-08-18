import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";

import { formationCenter } from "../../domain/coursePlot";
import { findScenePoint, type ScenePoint, type TacticalScene } from "../../domain/scene";
import { useLatestRef } from "../../hooks/useLatestRef";
import { useTimeoutRegistry } from "../../hooks/useTimeoutRegistry";
import type { FleetMember, Vector3 } from "../../types/telemetry";
import type { FleetScope } from "../fleet/FleetRoster";
import type { TacticalCanvasHandle } from "../tactical/TacticalCanvas";
import { initialNavigationState, navigationReducer } from "./navigationReducer";

interface NavigationControllerOptions {
  connected: boolean;
  landed: boolean;
  pollingPaused: boolean;
  keyboardEnabled: boolean;
  commandLocked: boolean;
  setCommandLocked(locked: boolean): void;
  setAlert(message: string): void;
  tacticalRef: RefObject<TacticalCanvasHandle | null>;
  scene: TacticalScene;
  navigableTarget: ScenePoint | null;
  observerSpeed: number;
  observedMaximumSpeed: number;
  fleetCommandMode: boolean;
  fleetScope: FleetScope;
  selectedFleetMembers: FleetMember[];
  viewpointMemberKey: string | null;
  movementOriginsForScope(scope: FleetScope | null): Vector3[];
  clearTransientSelection(): void;
}

export function useNavigationController({
  connected,
  landed,
  pollingPaused,
  keyboardEnabled,
  commandLocked,
  setCommandLocked,
  setAlert,
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
}: NavigationControllerOptions) {
  const [state, dispatch] = useReducer(navigationReducer, initialNavigationState);
  const intentIdsRef = useRef(new Set<string>());
  const lastObservedSpeedRef = useRef<number | null>(null);
  const lastMaximumSpeedRef = useRef<number | null>(null);
  const lastSpeedIntentRef = useRef<number | null>(null);
  const lockTokenRef = useRef(0);
  const scheduleTimeout = useTimeoutRegistry();
  const maximumSpeed = observedMaximumSpeed > 0 ? observedMaximumSpeed : state.knownMaximumSpeed;
  const navigationTarget = findScenePoint(scene, state.targetId);

  const cancel = useCallback(() => {
    dispatch({
      type: "reset",
      speed: Math.max(
        0,
        Math.min(lastMaximumSpeedRef.current ?? 0, lastObservedSpeedRef.current ?? 0),
      ),
    });
    setAlert("");
    tacticalRef.current?.finishMovementPlanning();
  }, [setAlert, tacticalRef]);

  const beginVector = useCallback(() => {
    if (!connected || landed || commandLocked) return;
    clearTransientSelection();
    const commandScope = fleetCommandMode ? fleetScope : null;
    dispatch({ type: "begin-vector", fleetScope: commandScope });
    tacticalRef.current?.beginMovementPlanning(
      state.vector,
      true,
      movementOriginsForScope(commandScope),
    );
  }, [
    clearTransientSelection,
    commandLocked,
    connected,
    fleetCommandMode,
    fleetScope,
    landed,
    movementOriginsForScope,
    state.vector,
    tacticalRef,
  ]);

  const armTarget = useCallback(
    (mode: "target" | "away") => {
      if (!navigableTarget) return;
      clearTransientSelection();
      const commandScope = fleetCommandMode ? fleetScope : null;
      const origins = movementOriginsForScope(commandScope);
      const center = formationCenter(origins);
      const preview =
        mode === "away"
          ? (center.map((value, index) => value - navigableTarget.position3d[index]) as Vector3)
          : (navigableTarget.position3d.map((value, index) => value - center[index]) as Vector3);
      const multiplier = mode === "away" ? -1 : 1;
      dispatch({
        type: "arm-target",
        mode,
        targetId: navigableTarget.id,
        fleetScope: commandScope,
      });
      tacticalRef.current?.beginMovementPlanning(
        Math.hypot(...preview) > 0 ? preview : [100 * multiplier, 0, 0],
        false,
        origins,
      );
    },
    [
      clearTransientSelection,
      fleetCommandMode,
      fleetScope,
      movementOriginsForScope,
      navigableTarget,
      tacticalRef,
    ],
  );

  const stage = useCallback(() => {
    dispatch({ type: "stage" });
    tacticalRef.current?.freezeMovement();
  }, [tacticalRef]);

  const submit = useCallback(async () => {
    if (commandLocked) {
      setAlert("NAVIGATION COMPUTER IS WAITING FOR THE CURRENT MANEUVER");
      return;
    }
    if ((state.fleetScope || observerSpeed === 0) && state.requestedSpeed === 0) {
      dispatch({ type: "set-status", status: "COURSE SPEED REQUIRED // SELECT A NON-ZERO SPEED" });
      setAlert("SELECT A NON-ZERO COURSE SPEED");
      return;
    }
    const payload: Record<string, unknown> = { mode: state.commandMode };
    if (state.commandMode === "relative") {
      payload.vector = { x: state.vector[0], y: state.vector[1], z: state.vector[2] };
    } else if (navigationTarget) payload.targetId = navigationTarget.id;
    else {
      dispatch({ type: "set-status", status: "ORDER BLOCKED // TARGET CONTACT LOST" });
      return;
    }
    if (state.fleetScope || observerSpeed === 0) payload.departureSpeed = state.requestedSpeed;
    dispatch({ type: "set-status", status: "TRANSMITTING COURSE..." });
    if (state.fleetScope) {
      payload.scope = state.fleetScope;
      payload.order = "navigate";
      if (state.fleetScope === "selected") {
        if (selectedFleetMembers.length === 0) {
          dispatch({ type: "set-status", status: "ORDER BLOCKED // SELECT AT LEAST ONE CRAFT" });
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
      if (viewpointMemberKey) payload.viewpointMemberKey = viewpointMemberKey;
    }
    const result = await window.holocron?.sendIntent(
      state.fleetScope ? "fleet_order" : "navigate_ship",
      payload,
    );
    if (result?.accepted === false) {
      dispatch({ type: "set-status", status: `ORDER REJECTED // ${result.reason || "UNKNOWN"}` });
      return;
    }
    if (result?.id) {
      intentIdsRef.current.add(result.id);
      scheduleTimeout(() => intentIdsRef.current.delete(result.id!), 60_000);
    }
    if (state.fleetScope) {
      dispatch({ type: "finish", status: "FLEET COURSE TRANSMITTED" });
      setAlert("FLEET COURSE TRANSMITTED // MONITOR FORMATION ROSTER");
      tacticalRef.current?.finishMovementPlanning();
      return;
    }
    const lockToken = lockTokenRef.current + 1;
    lockTokenRef.current = lockToken;
    setCommandLocked(true);
    scheduleTimeout(() => {
      if (lockTokenRef.current !== lockToken) return;
      lockTokenRef.current += 1;
      setCommandLocked(false);
      setAlert("MANEUVER CONFIRMATION TIMED OUT // CONTROLS RELEASED");
      scheduleTimeout(() => setAlert(""), 5_000);
    }, 50_000);
    dispatch({ type: "finish", status: "MANEUVER IN PROGRESS" });
    tacticalRef.current?.finishMovementPlanning();
  }, [
    commandLocked,
    navigationTarget,
    observerSpeed,
    selectedFleetMembers,
    scheduleTimeout,
    setAlert,
    setCommandLocked,
    state.commandMode,
    state.fleetScope,
    state.requestedSpeed,
    state.vector,
    tacticalRef,
    viewpointMemberKey,
  ]);

  const commitSpeed = useCallback(
    async (speed: number) => {
      const nextSpeed = Math.max(0, Math.min(maximumSpeed, Math.round(speed)));
      if (state.mode !== "idle" && (state.fleetScope || observerSpeed === 0)) {
        dispatch({
          type: "set-speed",
          speed: nextSpeed,
          status:
            nextSpeed > 0
              ? `COURSE SPEED ${nextSpeed} // READY WITH COURSE`
              : "COURSE SPEED REQUIRED // SELECT A NON-ZERO SPEED",
        });
        setAlert("");
        return;
      }
      if (
        !connected ||
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
        setAlert(`SPEED ORDER REJECTED // ${result.reason || "UNKNOWN"}`);
        lastSpeedIntentRef.current = null;
        return;
      }
      if (result?.id) {
        intentIdsRef.current.add(result.id);
        scheduleTimeout(() => intentIdsRef.current.delete(result.id!), 12_000);
      }
      setCommandLocked(true);
      scheduleTimeout(() => setCommandLocked(false), 1_500);
    },
    [
      commandLocked,
      connected,
      landed,
      maximumSpeed,
      observerSpeed,
      scheduleTimeout,
      setAlert,
      setCommandLocked,
      state.mode,
      state.fleetScope,
    ],
  );

  const chooseSpeed = useCallback(
    (speed: number) => {
      dispatch({ type: "set-speed", speed });
      void commitSpeed(speed);
    },
    [commitSpeed],
  );

  useEffect(() => {
    if (
      lastObservedSpeedRef.current === observerSpeed &&
      lastMaximumSpeedRef.current === maximumSpeed
    )
      return;
    lastObservedSpeedRef.current = observerSpeed;
    lastMaximumSpeedRef.current = maximumSpeed;
    lastSpeedIntentRef.current = null;
    dispatch({ type: "observe-speed", speed: observerSpeed, maximum: maximumSpeed });
  }, [maximumSpeed, observerSpeed]);

  const acknowledgementCallbacksRef = useLatestRef({ setAlert, setCommandLocked });

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (!ack.id || !intentIdsRef.current.has(ack.id) || ack.status === "accepted") return;
        intentIdsRef.current.delete(ack.id);
        lockTokenRef.current += 1;
        acknowledgementCallbacksRef.current.setCommandLocked(false);
        lastSpeedIntentRef.current = null;
        const message = String(
          ack.reason || (ack.status === "completed" ? "COMMAND COMPLETE" : "COMMAND REJECTED"),
        ).toUpperCase();
        dispatch({ type: "set-status", status: message });
        if (ack.status === "rejected") {
          dispatch({
            type: "set-speed",
            speed: Math.max(
              0,
              Math.min(lastMaximumSpeedRef.current ?? 0, lastObservedSpeedRef.current ?? 0),
            ),
          });
          acknowledgementCallbacksRef.current.setAlert(message);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!landed && connected) return;
    lockTokenRef.current += 1;
    setCommandLocked(false);
    cancel();
  }, [cancel, connected, landed, setCommandLocked]);

  const keyboardStateRef = useLatestRef({
    keyboardEnabled,
    pollingPaused,
    mode: state.mode,
    beginVector,
    cancel,
    stage,
    submit,
  });

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const current = keyboardStateRef.current;
      if (!current.keyboardEnabled || current.pollingPaused) return;
      if (event.key.toLowerCase() === "m" && current.mode === "idle") current.beginVector();
      else if (event.key === "Escape" && current.mode !== "idle") current.cancel();
      else if (event.key === "Enter" && ["confirm", "target", "away"].includes(current.mode))
        void current.submit();
      else if (event.key === "Enter" && current.mode === "vector") current.stage();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const setVector = useCallback((vector: Vector3) => dispatch({ type: "set-vector", vector }), []);
  const setStatus = useCallback((status: string) => dispatch({ type: "set-status", status }), []);
  const setRequestedSpeed = useCallback(
    (speed: number) => dispatch({ type: "set-speed", speed }),
    [],
  );

  return {
    ...state,
    maximumSpeed,
    navigationTarget,
    setVector,
    setStatus,
    setRequestedSpeed,
    cancel,
    beginVector,
    armTarget,
    stage,
    submit,
    chooseSpeed,
  } as const;
}
