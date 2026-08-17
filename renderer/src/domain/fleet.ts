import type { FleetStatus } from "../types/telemetry";

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
