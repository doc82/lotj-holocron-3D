import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import { dispositionKey } from "../../domain/tacticalWorkspace";
import type { TacticalTargetShortcut } from "../../domain/tacticalTargets";
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
  selectViewpoint,
  closeFleetDrawer,
  closeDossier,
  setSelectedId,
  clearClusterSelection,
}: TacticalInteractionOptions) {
  const [dismissedTargetNames, setDismissedTargetNames] = useState<Set<string>>(() => new Set());
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
    const reported = new Set(reportedTargets.map((target) => dispositionKey(target.targetName)));
    setDismissedTargetNames((current) => {
      const next = new Set([...current].filter((target) => reported.has(target)));
      return next.size === current.size ? current : next;
    });
  }, [reportedTargets]);

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
        selectViewpoint(null);
        setSelectedId(null);
        tacticalRef.current?.setCameraMode("player");
        return;
      }
      selectViewpoint(member.id);
      setSelectedId(null);
      clearClusterSelection();
      tacticalRef.current?.setCameraMode("player");
      setAlert(`REQUESTING TACTICAL VIEW // ${member.name.toUpperCase()}`);
      const result = await window.holocron?.sendIntent("request_tactical_view", {
        memberId: member.id,
        memberName: member.name,
      });
      if (result?.accepted === false) {
        selectViewpoint(null);
        setAlert(`TACTICAL VIEW REJECTED // ${String(result.reason || "UNKNOWN").toUpperCase()}`);
        return;
      }
      setAlert(`TACTICAL VIEW REQUESTED // ${member.name.toUpperCase()}`);
    },
    [clearClusterSelection, localName, selectViewpoint, setAlert, setSelectedId, tacticalRef],
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
      setDismissedTargetNames((current) => new Set(current).add(dispositionKey(target.targetName)));
      setTargetDrawerOpen(false);
      setAlert(`TARGET CLEARED // ${target.targetName.toUpperCase()}`);
    },
    [setAlert],
  );

  const restoreTarget = useCallback((name: string) => {
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
