import { useCallback, useEffect, useReducer, useRef, type RefObject } from "react";

import { formationCenter } from "../../domain/coursePlot";
import { findScenePoint, type ScenePoint, type TacticalScene } from "../../domain/scene";
import type { FleetMember, Vector3 } from "../../types/telemetry";
import type { FleetScope } from "../fleet/FleetRoster";
import type { TacticalCanvasHandle } from "../tactical/TacticalCanvas";
import { initialNavigationState, navigationReducer } from "./navigationReducer";

interface NavigationControllerOptions {
  connected: boolean;
  landed: boolean;
  pollingPaused: boolean;
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
  viewpointMemberId: string | null;
  movementOriginsForScope(scope: FleetScope | null): Vector3[];
  clearTransientSelection(): void;
}

export function useNavigationController({
  connected,
  landed,
  pollingPaused,
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
  viewpointMemberId,
  movementOriginsForScope,
  clearTransientSelection,
}: NavigationControllerOptions) {
  const [state, dispatch] = useReducer(navigationReducer, initialNavigationState);
  const intentIdsRef = useRef(new Set<string>());
  const lastObservedSpeedRef = useRef<number | null>(null);
  const lastMaximumSpeedRef = useRef<number | null>(null);
  const lastSpeedIntentRef = useRef<number | null>(null);
  const lockTokenRef = useRef(0);
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
    if (!state.fleetScope && observerSpeed === 0 && state.requestedSpeed === 0) {
      dispatch({ type: "set-status", status: "DEPARTURE SPEED REQUIRED // SELECT PLAYER SPEED" });
      setAlert("SELECT A NON-ZERO DEPARTURE SPEED");
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
    if (!state.fleetScope && observerSpeed === 0) payload.departureSpeed = state.requestedSpeed;
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
      if (viewpointMemberId) payload.viewpointMemberId = viewpointMemberId;
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
      setTimeout(() => intentIdsRef.current.delete(result.id!), 60_000);
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
    setTimeout(() => {
      if (lockTokenRef.current !== lockToken) return;
      lockTokenRef.current += 1;
      setCommandLocked(false);
      setAlert("MANEUVER CONFIRMATION TIMED OUT // CONTROLS RELEASED");
      setTimeout(() => setAlert(""), 5_000);
    }, 50_000);
    dispatch({ type: "finish", status: "MANEUVER IN PROGRESS" });
    tacticalRef.current?.finishMovementPlanning();
  }, [
    commandLocked,
    navigationTarget,
    observerSpeed,
    selectedFleetMembers,
    setAlert,
    setCommandLocked,
    state.commandMode,
    state.fleetScope,
    state.requestedSpeed,
    state.vector,
    tacticalRef,
    viewpointMemberId,
  ]);

  const commitSpeed = useCallback(
    async (speed: number) => {
      const nextSpeed = Math.max(0, Math.min(maximumSpeed, Math.round(speed)));
      if (state.mode !== "idle" && observerSpeed === 0) {
        dispatch({
          type: "set-speed",
          speed: nextSpeed,
          status:
            nextSpeed > 0
              ? `DEPARTURE SPEED ${nextSpeed} // READY WITH COURSE`
              : "DEPARTURE SPEED REQUIRED // SELECT PLAYER SPEED",
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
        setTimeout(() => intentIdsRef.current.delete(result.id!), 12_000);
      }
      setCommandLocked(true);
      setTimeout(() => setCommandLocked(false), 1_500);
    },
    [
      commandLocked,
      connected,
      landed,
      maximumSpeed,
      observerSpeed,
      setAlert,
      setCommandLocked,
      state.mode,
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

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (!ack.id || !intentIdsRef.current.has(ack.id) || ack.status === "accepted") return;
        intentIdsRef.current.delete(ack.id);
        lockTokenRef.current += 1;
        setCommandLocked(false);
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
          setAlert(message);
        }
      }),
    [setAlert, setCommandLocked],
  );

  useEffect(() => {
    if (!landed && connected) return;
    lockTokenRef.current += 1;
    setCommandLocked(false);
    cancel();
  }, [cancel, connected, landed, setCommandLocked]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (pollingPaused) return;
      if (event.key.toLowerCase() === "m" && state.mode === "idle") beginVector();
      else if (event.key === "Escape" && state.mode !== "idle") cancel();
      else if (event.key === "Enter" && ["confirm", "target", "away"].includes(state.mode))
        void submit();
      else if (event.key === "Enter" && state.mode === "vector") stage();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [beginVector, cancel, pollingPaused, stage, state.mode, submit]);

  return {
    ...state,
    maximumSpeed,
    navigationTarget,
    setVector: (vector: Vector3) => dispatch({ type: "set-vector", vector }),
    setStatus: (status: string) => dispatch({ type: "set-status", status }),
    setRequestedSpeed: (speed: number) => dispatch({ type: "set-speed", speed }),
    cancel,
    beginVector,
    armTarget,
    stage,
    submit,
    chooseSpeed,
  } as const;
}
