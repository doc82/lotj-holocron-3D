import type { CombatTargetTrack, FleetMember, TelemetryEntity } from "../types/telemetry";

export interface TacticalTargetShortcut {
  id: string;
  targetName: string;
  ownerLabels: string[];
  owners: CombatTargetTrack[];
  ship?: TelemetryEntity & Partial<FleetMember>;
}

interface TacticalTargetShortcutInput {
  combatTargets?: Record<string, CombatTargetTrack>;
  localTarget?: string;
  observerName?: string;
  scenePoints?: TelemetryEntity[];
  fleetMembers?: FleetMember[];
}

const targetKey = (name: string) => name.trim().toLowerCase();

function ownerLabel(target: CombatTargetTrack): string {
  return (
    target.ownerLabel ||
    (target.scope === "local"
      ? "YOUR SHIP'S TARGET"
      : target.scope === "all"
        ? "FLEET TARGET"
        : target.scope === "wings"
          ? "WING TARGET"
          : target.scope === "squadron"
            ? "SQUADRON TARGET"
            : `${String(target.ownerName || "FORMATION SHIP").toUpperCase()}'S TARGET`)
  );
}

export function buildTacticalTargetShortcuts({
  combatTargets = {},
  localTarget = "",
  observerName = "",
  scenePoints = [],
  fleetMembers = [],
}: TacticalTargetShortcutInput): TacticalTargetShortcut[] {
  const scopedTargets = Object.entries(combatTargets).flatMap(([key, target]) => {
    const targetName = String(target?.targetName || "").trim();
    return targetName === "" || targetName.toLowerCase() === "none"
      ? []
      : [{ ...target, key, targetName } as CombatTargetTrack];
  });
  const fallbackLocalTarget = String(localTarget).trim();
  if (
    fallbackLocalTarget !== "" &&
    fallbackLocalTarget.toLowerCase() !== "none" &&
    !scopedTargets.some((target) => target.scope === "local")
  ) {
    scopedTargets.unshift({
      key: "local",
      scope: "local",
      targetName: fallbackLocalTarget,
      ownerId: "player-ship",
      ownerName: observerName,
      ownerLabel: "YOUR SHIP'S TARGET",
    });
  }

  const grouped = new Map<string, TacticalTargetShortcut>();
  for (const target of scopedTargets) {
    const key = targetKey(target.targetName);
    const label = ownerLabel(target);
    const current = grouped.get(key);
    if (current) {
      if (!current.ownerLabels.includes(label)) current.ownerLabels.push(label);
      current.owners.push(target);
      continue;
    }
    const point = scenePoints.find((candidate) => targetKey(candidate.name || "") === key);
    const member = fleetMembers.find((candidate) => targetKey(candidate.name || "") === key);
    const ship =
      point || member
        ? ({
            ...(member || {}),
            ...(point || {}),
            id: point?.id || member?.id || key,
            name: point?.name || member?.name || target.targetName,
            kind: "ship",
          } as TacticalTargetShortcut["ship"])
        : undefined;
    grouped.set(key, {
      id: key,
      targetName: point?.name || member?.name || target.targetName,
      ownerLabels: [label],
      owners: [target],
      ship,
    });
  }
  return [...grouped.values()];
}
