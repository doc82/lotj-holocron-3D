import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { dispositionKey } from "../../domain/tacticalWorkspace";
import { fleetMemberSelectionKey } from "../../domain/fleet";
import {
  reconcileDismissedTargetNames,
  type TacticalTargetShortcut,
} from "../../domain/tacticalTargets";
import type { FleetMember } from "../../types/telemetry";
import type { FleetScope } from "../fleet/FleetRoster";
import type { TacticalCanvasHandle } from "./TacticalCanvas";

interface TacticalInteractionOptions {
  connected: boolean;
  localName: string;
  reportedTargets: TacticalTargetShortcut[];
  tacticalRef: RefObject<TacticalCanvasHandle | null>;
  setAlert(message: string): void;
  targetDrawerOpen: boolean;
  setTargetDrawerOpen(open: boolean | ((current: boolean) => boolean)): void;
  selectFleetScope(scope: FleetScope): void;
  selectFleetMember(member: FleetMember): void;
  selectViewpoint(memberId: string | null): void;
  closeFleetDrawer(): void;
  closeDossier(): void;
  setSelectedId(id: string | null): void;
  clearClusterSelection(): void;
}

export function useTacticalInteractionController({
  connected,
  localName,
  reportedTargets,
  tacticalRef,
  setAlert,
  targetDrawerOpen,
  setTargetDrawerOpen,
  selectFleetScope,
  selectFleetMember,
  selectViewpoint,
  closeFleetDrawer,
  closeDossier,
  setSelectedId,
  clearClusterSelection,
}: TacticalInteractionOptions) {
  const [dismissedTargetNames, setDismissedTargetNames] = useState<Set<string>>(() => new Set());
  const dismissedTargetAbsenceRef = useRef(new Map<string, number>());
  const viewpointRequestTokenRef = useRef(0);
  const targets = useMemo(
    () =>
      reportedTargets.filter(
        (target) => !dismissedTargetNames.has(dispositionKey(target.targetName)),
      ),
    [dismissedTargetNames, reportedTargets],
  );

  useEffect(() => {
    if (targets.length > 1 && connected) return;
    setTargetDrawerOpen(false);
  }, [connected, targets.length]);

  useEffect(() => {
    setDismissedTargetNames((current) => {
      const reconciled = reconcileDismissedTargetNames(
        current,
        dismissedTargetAbsenceRef.current,
        reportedTargets.map((target) => target.targetName),
      );
      dismissedTargetAbsenceRef.current = reconciled.absentSnapshots;
      return reconciled.dismissedNames.size === current.size ? current : reconciled.dismissedNames;
    });
  }, [reportedTargets]);

  useEffect(() => {
    if (!connected) viewpointRequestTokenRef.current += 1;
  }, [connected]);

  const selectCommandScope = useCallback(
    (scope: FleetScope) => {
      selectFleetScope(scope);
      setTargetDrawerOpen(false);
    },
    [selectFleetScope],
  );

  const viewFleetMember = useCallback(
    async (member: FleetMember) => {
      if (member.name.trim().toLowerCase() === localName.trim().toLowerCase()) {
        viewpointRequestTokenRef.current += 1;
        selectFleetScope("local");
        selectViewpoint(null);
        closeFleetDrawer();
        setSelectedId(null);
        tacticalRef.current?.setCameraMode("player");
        return;
      }
      const requestToken = viewpointRequestTokenRef.current + 1;
      viewpointRequestTokenRef.current = requestToken;
      const memberKey = fleetMemberSelectionKey(member);
      selectFleetMember(member);
      selectViewpoint(memberKey);
      setSelectedId(null);
      clearClusterSelection();
      tacticalRef.current?.setCameraMode("player");
      setAlert(`REQUESTING TACTICAL VIEW // ${member.name.toUpperCase()}`);
      const result = await window.holocron?.sendIntent("request_tactical_view", {
        memberKey,
        memberId: member.id,
        memberName: member.name,
        memberSlot: member.slot,
      });
      if (viewpointRequestTokenRef.current !== requestToken) return;
      if (result?.accepted === false) {
        selectViewpoint(null);
        setAlert(`TACTICAL VIEW REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
        return;
      }
      setAlert(`TACTICAL VIEW REQUESTED // ${member.name.toUpperCase()}`);
    },
    [
      clearClusterSelection,
      closeFleetDrawer,
      localName,
      selectFleetMember,
      selectFleetScope,
      selectViewpoint,
      setAlert,
      setSelectedId,
      tacticalRef,
    ],
  );

  const focusTarget = useCallback(
    (target: TacticalTargetShortcut) => {
      if (!target.ship?.id) return;
      clearClusterSelection();
      setSelectedId(target.ship.id);
      closeFleetDrawer();
      setTargetDrawerOpen(false);
    },
    [clearClusterSelection, closeFleetDrawer, setSelectedId],
  );

  const clearTarget = useCallback(
    async (target: TacticalTargetShortcut) => {
      const targetKeys = [...new Set(target.owners.map((owner) => owner.key).filter(Boolean))];
      if (targetKeys.length === 0) {
        setAlert("TARGET CLEAR REJECTED // TARGET OWNERSHIP IS UNKNOWN");
        return;
      }
      setAlert(`CLEARING TARGET // ${target.targetName.toUpperCase()}`);
      const result = await window.holocron?.sendIntent("clear_combat_target", { targetKeys });
      if (result?.accepted === false) {
        setAlert(`TARGET CLEAR REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
        return;
      }
      const targetName = dispositionKey(target.targetName);
      dismissedTargetAbsenceRef.current.delete(targetName);
      setDismissedTargetNames((current) => new Set(current).add(targetName));
      setTargetDrawerOpen(false);
      setAlert(`TARGET CLEARED // ${target.targetName.toUpperCase()}`);
    },
    [setAlert],
  );

  const restoreTarget = useCallback((name: string) => {
    dismissedTargetAbsenceRef.current.delete(dispositionKey(name));
    setDismissedTargetNames((current) => {
      const key = dispositionKey(name);
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const toggleTargetDrawer = useCallback(() => {
    closeFleetDrawer();
    closeDossier();
    setTargetDrawerOpen((open) => !open);
  }, [closeDossier, closeFleetDrawer]);

  return {
    targets,
    targetDrawerOpen,
    selectCommandScope,
    viewFleetMember,
    focusTarget,
    clearTarget,
    restoreTarget,
    toggleTargetDrawer,
  } as const;
}
