import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fleetMemberSelectionKey,
  fleetMembersMatchingSelection,
  selectFleetCommandMember,
} from "../../domain/fleet";
import type { FleetMember, FleetStatus } from "../../types/telemetry";
import type { FleetScope } from "./FleetRoster";

export function useFleetSelection(fleet?: FleetStatus) {
  const [scope, setScope] = useState<FleetScope>("local");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedMemberKeys, setSelectedMemberKeys] = useState<Set<string>>(() => new Set());
  const [viewpointMemberKey, setViewpointMemberKey] = useState<string | null>(null);

  const selectedMembers = useMemo(
    () => fleetMembersMatchingSelection(fleet?.members ?? [], selectedMemberKeys),
    [fleet?.members, selectedMemberKeys],
  );
  const allMembersSelected = Boolean(
    fleet?.members.length &&
    fleet.members.every((member) => selectedMemberKeys.has(fleetMemberSelectionKey(member))),
  );

  useEffect(() => {
    if (fleet?.active === true) return;
    setScope("local");
    setSelectedMemberKeys(new Set());
    setViewpointMemberKey(null);
  }, [fleet?.active]);

  useEffect(() => {
    if (!fleet?.active) return;
    const available = new Set(fleet.members.map(fleetMemberSelectionKey));
    setSelectedMemberKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [fleet?.active, fleet?.members]);

  useEffect(() => {
    if (!viewpointMemberKey) return;
    if (fleet?.members.some((member) => fleetMemberSelectionKey(member) === viewpointMemberKey)) {
      return;
    }
    setViewpointMemberKey(null);
  }, [fleet?.members, viewpointMemberKey]);

  const selectScope = useCallback(
    (nextScope: FleetScope) => {
      const sameScope = scope === nextScope;
      setScope(nextScope);
      if (nextScope === "local") {
        setSelectedMemberKeys(new Set());
        setViewpointMemberKey(null);
      } else if (fleet) {
        const members =
          nextScope === "wings" ? fleet.members.filter((member) => !member.leader) : fleet.members;
        setSelectedMemberKeys(new Set(members.map(fleetMemberSelectionKey)));
      }
      setDrawerOpen((open) => (sameScope ? !open : true));
    },
    [fleet, scope],
  );

  const toggleMember = useCallback(
    (member: FleetMember) => {
      const next = selectFleetCommandMember(
        fleet?.members ?? [],
        selectedMemberKeys,
        member,
        scope,
      );
      setSelectedMemberKeys(next.selectionKeys);
      setScope(next.scope);
    },
    [fleet, scope, selectedMemberKeys],
  );

  const selectAll = useCallback(() => {
    if (!fleet) return;
    setSelectedMemberKeys(new Set(fleet.members.map(fleetMemberSelectionKey)));
    setScope("all");
  }, [fleet]);

  const selectOnlyMember = useCallback((member: FleetMember) => {
    setSelectedMemberKeys(new Set([fleetMemberSelectionKey(member)]));
    setScope("selected");
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return {
    scope,
    drawerOpen,
    selectedMemberKeys,
    selectedMembers,
    selectedMember: selectedMembers[0],
    allMembersSelected,
    selectedScopeEmpty: scope === "selected" && selectedMembers.length === 0,
    viewpointMemberKey,
    selectScope,
    toggleMember,
    selectAll,
    selectOnlyMember,
    selectViewpoint: setViewpointMemberKey,
    closeDrawer,
  } as const;
}
