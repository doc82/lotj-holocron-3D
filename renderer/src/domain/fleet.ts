import type { FleetMember, FleetStatus } from "../types/telemetry";

function normalizedName(name: string | undefined): string {
  return (name || "").trim().toLowerCase();
}

export function localFormationRole(fleet: FleetStatus, localName: string): FleetStatus["role"] {
  const localMember = fleet.members.find(
    (member) => normalizedName(member.name) === normalizedName(localName),
  );

  if (!localMember) return fleet.role;
  if (fleet.kind === "battlegroup") {
    return localMember.leader || localMember.role === "leader" ? "commander" : "member";
  }
  return localMember.leader || localMember.role === "lead" ? "lead" : "wing";
}

export function canCommandFormation(fleet: FleetStatus, localName: string): boolean {
  const role = localFormationRole(fleet, localName);
  return fleet.kind === "battlegroup" ? role === "commander" : role === "lead";
}

export function fleetMemberSelectionKey(member: Pick<FleetMember, "id" | "name">): string {
  const name = normalizedName(member.name);
  return name ? `name:${name}` : `id:${normalizedName(member.id)}`;
}

export function fleetMemberForSelectionKey(
  members: FleetMember[],
  selectionKey: string | null,
): FleetMember | undefined {
  if (!selectionKey) return undefined;
  return members.find((member) => fleetMemberSelectionKey(member) === selectionKey);
}

export function fleetMembersMatchingSelection(
  members: FleetMember[],
  selectionKeys: ReadonlySet<string>,
): FleetMember[] {
  return members.filter((member) => selectionKeys.has(fleetMemberSelectionKey(member)));
}

export function toggleFleetMemberSelection(
  selectionKeys: ReadonlySet<string>,
  member: Pick<FleetMember, "id" | "name">,
): Set<string> {
  const next = new Set(selectionKeys);
  const key = fleetMemberSelectionKey(member);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
