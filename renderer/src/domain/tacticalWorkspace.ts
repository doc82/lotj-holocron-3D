import type { FleetScope } from "../features/fleet/FleetRoster";
import type {
  FleetMember,
  FleetStatus,
  Observer,
  ShipDisposition,
  SpeedReading,
  SystemSnapshot,
  TelemetryEntity,
} from "../types/telemetry";
import type { ScenePoint } from "./scene";

function formatCoordinate(value: unknown): string {
  const numeric = Number(value);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Number.isFinite(numeric) ? numeric : 0,
  );
}

export const dispositionKey = (name: string) => name.trim().toLowerCase();

export function aggregateReading(
  readings: Array<SpeedReading | undefined>,
): SpeedReading | undefined {
  const known = readings.filter(
    (reading) =>
      Number.isFinite(reading?.current) &&
      Number.isFinite(reading?.maximum) &&
      Number(reading?.maximum) > 0,
  );
  if (known.length === 0) return undefined;
  return {
    current: known.reduce((sum, reading) => sum + Number(reading?.current), 0),
    maximum: known.reduce((sum, reading) => sum + Number(reading?.maximum), 0),
  };
}

export function speedLabel(speed: ScenePoint["speed"]): string {
  if (typeof speed === "object" && speed) {
    return `${formatCoordinate(speed.current)} / ${formatCoordinate(speed.maximum)}`;
  }
  return speed === undefined ? "—" : formatCoordinate(speed);
}

export function isDisabledShip(point: TelemetryEntity): boolean {
  return String(point.condition || "").trim().toLowerCase() === "disabled";
}

export function detailRows(point: ScenePoint): Array<[string, string]> {
  const worldCoordinates = point.worldPosition.map(formatCoordinate).join(" / ");
  const rows: Array<[string, string]> = [];
  if (point.id === "player-ship") {
    rows.push(["WORLD XYZ", worldCoordinates], ["CAMERA FOCUS", "LOCKED"]);
  } else {
    rows.push(["SYSTEM XYZ", worldCoordinates]);
  }
  if (point.distance !== undefined) rows.push(["PROXIMITY", formatCoordinate(point.distance)]);
  if (point.speed !== undefined && typeof point.speed !== "object") {
    rows.push(["VELOCITY", speedLabel(point.speed)]);
  }
  if (point.heading && typeof point.heading === "object") {
    rows.push([
      "HEADING",
      [point.heading.x, point.heading.y, point.heading.z].map(formatCoordinate).join(" / "),
    ]);
  }
  if (point.position) rows.push(["FORMATION", point.position]);
  if (point.condition) rows.push(["CONDITION", String(point.condition)]);
  if (point.energy !== undefined && typeof point.energy !== "object") {
    rows.push(["ENERGY", formatCoordinate(point.energy)]);
  }
  if (point.target) rows.push(["TARGET", String(point.target)]);
  if (point.lifeforms) rows.push(["LIFEFORMS", String(point.lifeforms)]);
  if (point.lifeformScan && typeof point.lifeformScan === "object") {
    const scan = point.lifeformScan as {
      available?: boolean;
      requiredSensors?: number;
      value?: string;
    };
    rows.push([
      "LIFEFORMS",
      scan.available === false
        ? `UNKNOWN // NEED ${formatCoordinate(scan.requiredSensors)} SENSORS`
        : String(scan.value || "DETECTED"),
    ]);
  }
  return rows;
}

export function pointsIncludingClusters(points: ScenePoint[]): ScenePoint[] {
  return points.flatMap((point) => (point.members ? [point, ...point.members] : [point]));
}

export function buildTacticalSnapshot(
  snapshot: SystemSnapshot | null,
  viewpointMemberId: string | null,
): SystemSnapshot | null {
  if (!snapshot || !viewpointMemberId) return snapshot;
  const member = snapshot.metadata?.fleet?.members.find(
    (candidate) => candidate.id === viewpointMemberId,
  );
  if (!member) return snapshot;
  const view = snapshot.metadata?.tacticalViews?.[viewpointMemberId];
  return {
    ...snapshot,
    observedAt: view?.observedAt ?? snapshot.observedAt,
    observer: view?.observer ?? {
      ...member,
      id: member.id,
      kind: "ship",
      x: 0,
      y: 0,
      z: 0,
    },
    entities: view?.entities ?? [],
    metadata: {
      ...snapshot.metadata,
      system: view?.system || member.system || member.location || "Remote sector",
      activeTacticalViewMemberId: viewpointMemberId,
    },
  };
}

export function classifyTacticalSnapshot(
  tacticalSnapshot: SystemSnapshot | null,
  rootSnapshot: SystemSnapshot | null,
  dispositions: Record<string, ShipDisposition>,
): SystemSnapshot | null {
  if (!tacticalSnapshot || !rootSnapshot) return null;
  const formationNames = new Set(
    (rootSnapshot.metadata?.fleet?.members ?? []).map((member) => dispositionKey(member.name)),
  );
  const reportedTarget = String(
    rootSnapshot.metadata?.combatTarget || rootSnapshot.observer?.target || "",
  ).trim();
  const activeTargetKeys = new Set(
    Object.values(rootSnapshot.metadata?.combatTargets || {})
      .map((target) => String(target?.targetName || "").trim())
      .filter((target) => target !== "" && target.toLowerCase() !== "none")
      .map(dispositionKey),
  );
  if (reportedTarget !== "" && reportedTarget.toLowerCase() !== "none") {
    activeTargetKeys.add(dispositionKey(reportedTarget));
  }
  return {
    ...tacticalSnapshot,
    observer: tacticalSnapshot.observer
      ? { ...tacticalSnapshot.observer, formationMember: true }
      : tacticalSnapshot.observer,
    entities: tacticalSnapshot.entities?.map((entity) => {
      const key = dispositionKey(entity.name || entity.id);
      return {
        ...entity,
        formationMember: entity.kind === "ship" && formationNames.has(key),
        combatTarget: entity.kind === "ship" && activeTargetKeys.has(key),
        disposition:
          entity.kind === "ship"
            ? entity.disposition === "enemy"
              ? "enemy"
              : dispositions[key] || entity.disposition || "neutral"
            : entity.disposition,
      };
    }),
  };
}

export interface DossierRequest {
  id: string;
  name: string;
  seed: TelemetryEntity;
}

export function resolveDossierShip({
  request,
  localName,
  localObserver,
  fleetMembers,
  scenePoints,
}: {
  request: DossierRequest | null;
  localName: string;
  localObserver?: Observer;
  fleetMembers?: FleetMember[];
  scenePoints: ScenePoint[];
}): TelemetryEntity | null {
  if (!request) return null;
  const wantedName = dispositionKey(request.name);
  if (request.id === "player-ship" || dispositionKey(localName) === wantedName) {
    return { ...request.seed, ...localObserver, id: "player-ship", kind: "ship" };
  }
  const member = fleetMembers?.find(
    (candidate) => candidate.id === request.id || dispositionKey(candidate.name) === wantedName,
  );
  const point = scenePoints.find(
    (candidate) => candidate.id === request.id || dispositionKey(candidate.name) === wantedName,
  );
  return {
    ...request.seed,
    ...(member as TelemetryEntity | undefined),
    ...point,
    id: point?.id || member?.id || request.id,
    name: point?.name || member?.name || request.name,
    kind: "ship",
  };
}

export function fleetMembersForScope(
  fleet: FleetStatus | undefined,
  scope: FleetScope,
  selectedMembers: FleetMember[],
): FleetMember[] {
  if (!fleet?.active || scope === "local") return [];
  if (scope === "selected") return selectedMembers;
  if (scope === "wings") return fleet.members.filter((member) => !member.leader);
  return fleet.members;
}
