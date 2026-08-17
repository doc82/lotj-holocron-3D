import { useCallback, useEffect, useRef } from "react";

import type { ScenePoint } from "../../domain/scene";
import type { FleetMember, FleetStatus, WeaponType } from "../../types/telemetry";
import type { FleetScope } from "../fleet/FleetRoster";

interface ShipCommandControllerOptions {
  connected: boolean;
  landed: boolean;
  commandLocked: boolean;
  setCommandLocked(locked: boolean): void;
  setAlert(message: string): void;
  setNavigationStatus(message: string): void;
  selectedShip: ScenePoint | null;
  fleet?: FleetStatus;
  fleetScope: FleetScope;
  selectedFleetMembers: FleetMember[];
  viewpointMemberId: string | null;
  autotrackDesired: boolean;
  autotrackPending: boolean;
  shieldRecharging: boolean;
  shieldsFull: boolean;
  autoRechargeEnabled: boolean;
  restoreTarget(name: string): void;
  markShipEnemy(name: string): void;
}

export function useShipCommandController({
  connected,
  landed,
  commandLocked,
  setCommandLocked,
  setAlert,
  setNavigationStatus,
  selectedShip,
  fleet,
  fleetScope,
  selectedFleetMembers,
  viewpointMemberId,
  autotrackDesired,
  autotrackPending,
  shieldRecharging,
  shieldsFull,
  autoRechargeEnabled,
  restoreTarget,
  markShipEnemy,
}: ShipCommandControllerOptions) {
  const intentIdsRef = useRef(new Set<string>());
  const autotrackIntentIdsRef = useRef(new Set<string>());
  const targetIntentShipsRef = useRef(new Map<string, { name: string }>());
  const targetLockTokenRef = useRef(0);

  const targetSelectedShip = useCallback(async () => {
    if (!selectedShip || !connected || landed || commandLocked) return;
    setAlert(`TARGETING ${selectedShip.name.toUpperCase()} // AGGRESSIVE ACT`);
    const result = await window.holocron?.sendIntent("target_ship", { targetId: selectedShip.id });
    if (result?.accepted === false) {
      setAlert(`TARGET ORDER REJECTED // ${result.reason || "UNKNOWN"}`);
      return;
    }
    if (!result?.id) return;
    const lockToken = targetLockTokenRef.current + 1;
    targetLockTokenRef.current = lockToken;
    setCommandLocked(true);
    setAlert(`TRACKING ${selectedShip.name.toUpperCase()} // HOLDING COMMAND OUTPUT`);
    intentIdsRef.current.add(result.id);
    targetIntentShipsRef.current.set(result.id, { name: selectedShip.name });
    setTimeout(() => {
      if (targetLockTokenRef.current !== lockToken) return;
      targetLockTokenRef.current += 1;
      intentIdsRef.current.delete(result.id!);
      targetIntentShipsRef.current.delete(result.id!);
      setCommandLocked(false);
      setAlert("TARGET LOCK TIMED OUT // CONTROLS RELEASED");
    }, 50_000);
  }, [commandLocked, connected, landed, selectedShip, setAlert, setCommandLocked]);

  const toggleAutotrack = useCallback(async () => {
    if (!connected || landed || autotrackPending) return;
    const enabled = !autotrackDesired;
    setAlert(`AUTOTRACK ${enabled ? "ON" : "OFF"} // AWAITING SHIP CONFIRMATION`);
    const result = await window.holocron?.sendIntent("set_autotrack", { enabled });
    if (result?.accepted === false) {
      setAlert(`AUTOTRACK REJECTED // ${result.reason || "UNKNOWN"}`);
      return;
    }
    if (!result?.id) return;
    intentIdsRef.current.add(result.id);
    autotrackIntentIdsRef.current.add(result.id);
    setTimeout(() => {
      intentIdsRef.current.delete(result.id!);
      autotrackIntentIdsRef.current.delete(result.id!);
    }, 12_000);
  }, [autotrackDesired, autotrackPending, connected, landed, setAlert]);

  const fireWeapon = useCallback(
    async (weapon: WeaponType | "all") => {
      if (!connected || landed) return "weapons controls unavailable";
      const result = await window.holocron?.sendIntent("fire_weapon", { weapon });
      return result?.accepted === false ? result.reason || "fire order rejected" : null;
    },
    [connected, landed],
  );

  const sendFleetOrder = useCallback(
    async (order: string, extra: Record<string, unknown> = {}) => {
      if (!fleet?.active || fleetScope === "local" || !connected || landed || commandLocked) return;
      const payload: Record<string, unknown> = { order, scope: fleetScope, ...extra };
      if (fleetScope === "selected") {
        if (selectedFleetMembers.length === 0) {
          setAlert("FLEET ORDER REQUIRES AT LEAST ONE SELECTED CRAFT");
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
          setAlert("FLEET TARGET ORDER REQUIRES A SELECTED SHIP");
          return;
        }
        payload.targetId = selectedShip.id;
      }
      const formationLabel = fleet.kind === "squadron" ? "SQUADRON" : "FLEET";
      setAlert(`TRANSMITTING ${order.replaceAll("_", " ").toUpperCase()} // ${formationLabel}`);
      const result = await window.holocron?.sendIntent("fleet_order", payload);
      if (result?.accepted === false) {
        setAlert(
          `${formationLabel} ORDER REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`,
        );
        return;
      }
      if (result?.id) {
        intentIdsRef.current.add(result.id);
        setTimeout(() => intentIdsRef.current.delete(result.id!), 15_000);
      }
      setAlert(`${order.replaceAll("_", " ").toUpperCase()} TRANSMITTED // ${formationLabel}`);
    },
    [
      commandLocked,
      connected,
      fleet,
      fleetScope,
      landed,
      selectedFleetMembers,
      selectedShip,
      setAlert,
      viewpointMemberId,
    ],
  );

  const rechargeShields = useCallback(async () => {
    if (!connected || landed || commandLocked || shieldRecharging || shieldsFull) return;
    const result = await window.holocron?.sendIntent("recharge_shields");
    if (result?.accepted === false) {
      setAlert(`SHIELD RECHARGE REJECTED // ${(result.reason || "UNKNOWN").toUpperCase()}`);
      return;
    }
    if (result?.id) intentIdsRef.current.add(result.id);
  }, [commandLocked, connected, landed, setAlert, shieldRecharging, shieldsFull]);

  const toggleAutoRecharge = useCallback(async () => {
    const enabled = !autoRechargeEnabled;
    const result = await window.holocron?.sendIntent("set_auto_recharge", { enabled });
    if (result?.accepted === false) {
      setAlert(`AUTO RECHARGE REJECTED // ${(result.reason || "UNKNOWN").toUpperCase()}`);
    }
  }, [autoRechargeEnabled, setAlert]);

  useEffect(
    () =>
      window.holocron?.onIntentAck((ack) => {
        if (!ack.id || !intentIdsRef.current.has(ack.id)) return;
        const autotrackIntent = autotrackIntentIdsRef.current.has(ack.id);
        if (autotrackIntent && ack.status !== "accepted") {
          intentIdsRef.current.delete(ack.id);
          autotrackIntentIdsRef.current.delete(ack.id);
          setAlert(
            ack.status === "completed"
              ? String(ack.reason || "AUTOTRACK UPDATED").toUpperCase()
              : `AUTOTRACK REJECTED // ${String(ack.reason || "UNKNOWN").toUpperCase()}`,
          );
          return;
        }
        const targetedShip = targetIntentShipsRef.current.get(ack.id);
        if (ack.status === "accepted" && targetedShip) {
          setAlert(`TRACKING ${targetedShip.name.toUpperCase()} // HOLDING COMMAND OUTPUT`);
          return;
        }
        if (ack.status === "completed") {
          intentIdsRef.current.delete(ack.id);
          const completedTarget = targetIntentShipsRef.current.get(ack.id);
          targetIntentShipsRef.current.delete(ack.id);
          if (completedTarget) {
            targetLockTokenRef.current += 1;
            restoreTarget(completedTarget.name);
            markShipEnemy(completedTarget.name);
          }
          setCommandLocked(false);
          const completion = String(ack.reason || "COMMAND COMPLETE").toUpperCase();
          setNavigationStatus(completion);
          if (completedTarget) setAlert(`${completion} // ${completedTarget.name.toUpperCase()}`);
          return;
        }
        if (ack.status !== "rejected") return;
        intentIdsRef.current.delete(ack.id);
        const rejectedTarget = targetIntentShipsRef.current.get(ack.id);
        targetIntentShipsRef.current.delete(ack.id);
        if (rejectedTarget) targetLockTokenRef.current += 1;
        const message = String(ack.reason || "COMMAND REJECTED").toUpperCase();
        setAlert(message);
        setNavigationStatus(message);
        setCommandLocked(false);
      }),
    [markShipEnemy, restoreTarget, setAlert, setCommandLocked, setNavigationStatus],
  );

  return {
    targetSelectedShip,
    toggleAutotrack,
    fireWeapon,
    sendFleetOrder,
    rechargeShields,
    toggleAutoRecharge,
  } as const;
}
