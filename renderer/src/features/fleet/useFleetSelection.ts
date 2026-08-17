import { useCallback, useEffect, useMemo, useState } from "react";

import type { FleetMember, FleetStatus } from "../../types/telemetry";
import type { FleetScope } from "./FleetRoster";

export function useFleetSelection(fleet?: FleetStatus) {
  const [scope, setScope] = useState<FleetScope>("local");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set());
  const [viewpointMemberId, setViewpointMemberId] = useState<string | null>(null);

  const selectedMembers = useMemo(
    () => fleet?.members.filter((member) => selectedMemberIds.has(member.id)) ?? [],
    [fleet?.members, selectedMemberIds],
  );
  const allMembersSelected = Boolean(
    fleet?.members.length && fleet.members.every((member) => selectedMemberIds.has(member.id)),
  );

  useEffect(() => {
    if (fleet?.active === true) return;
    setScope("local");
    setSelectedMemberIds(new Set());
    setViewpointMemberId(null);
  }, [fleet?.active]);

  useEffect(() => {
    if (!fleet?.active) return;
    const available = new Set(fleet.members.map((member) => member.id));
    setSelectedMemberIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [fleet?.active, fleet?.members]);

  useEffect(() => {
    if (!viewpointMemberId) return;
    if (fleet?.members.some((member) => member.id === viewpointMemberId)) return;
    setViewpointMemberId(null);
  }, [fleet?.members, viewpointMemberId]);

  const selectScope = useCallback(
    (nextScope: FleetScope) => {
      const sameScope = scope === nextScope;
      setScope(nextScope);
      if (nextScope === "local") {
        setSelectedMemberIds(new Set());
        setViewpointMemberId(null);
      } else if (fleet) {
        const members =
          nextScope === "wings" ? fleet.members.filter((member) => !member.leader) : fleet.members;
        setSelectedMemberIds(new Set(members.map((member) => member.id)));
      }
      setDrawerOpen((open) => (sameScope ? !open : true));
    },
    [fleet, scope],
  );

  const toggleMember = useCallback(
    (member: FleetMember) => {
      const next = new Set(selectedMemberIds);
      if (next.has(member.id)) next.delete(member.id);
      else next.add(member.id);
      setSelectedMemberIds(next);
      setScope(
        fleet &&
          fleet.members.length > 0 &&
          fleet.members.every((candidate) => next.has(candidate.id))
          ? "all"
          : "selected",
      );
    },
    [fleet, selectedMemberIds],
  );

  const selectAll = useCallback(() => {
    if (!fleet) return;
    setSelectedMemberIds(new Set(fleet.members.map((member) => member.id)));
    setScope("all");
  }, [fleet]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return {
    scope,
    drawerOpen,
    selectedMemberIds,
    selectedMembers,
    selectedMember: selectedMembers[0],
    allMembersSelected,
    selectedScopeEmpty: scope === "selected" && selectedMembers.length === 0,
    viewpointMemberId,
    selectScope,
    toggleMember,
    selectAll,
    selectViewpoint: setViewpointMemberId,
    closeDrawer,
  } as const;
}
