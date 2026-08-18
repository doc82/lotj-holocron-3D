import type { FleetMember, Vector3 } from "../types/telemetry";

interface FormationScenePoint {
  id: string;
  name: string;
  position3d: Vector3;
}

interface FormationObserver {
  id?: string;
  name: string;
  worldPosition: Vector3;
}

const normalizedIdentity = (value: unknown): string =>
  String(value || "")
    .trim()
    .toLowerCase();

export function resolveFormationOrigins(
  members: FleetMember[],
  scenePoints: FormationScenePoint[],
  observer: FormationObserver,
): Vector3[] {
  const observerId = normalizedIdentity(observer.id);
  const observerName = normalizedIdentity(observer.name);
  return members.flatMap((member) => {
    const memberId = normalizedIdentity(member.id);
    const memberName = normalizedIdentity(member.name);
    if (
      (memberId !== "" && memberId === observerId) ||
      (memberName !== "" && memberName === observerName)
    ) {
      return [[0, 0, 0] as Vector3];
    }
    const point = scenePoints.find(
      (candidate) =>
        (memberId !== "" && normalizedIdentity(candidate.id) === memberId) ||
        (memberName !== "" && normalizedIdentity(candidate.name) === memberName),
    );
    if (point) return [[...point.position3d] as Vector3];

    const worldPosition = [member.x, member.y, member.z].map(Number) as Vector3;
    if (worldPosition.every(Number.isFinite)) {
      return [
        worldPosition.map((value, index) => value - observer.worldPosition[index]) as Vector3,
      ];
    }
    return [];
  });
}

export function formationCenter(positions: Vector3[]): Vector3 {
  if (positions.length === 0) return [0, 0, 0];
  const minimum: Vector3 = [...positions[0]];
  const maximum: Vector3 = [...positions[0]];
  for (const position of positions.slice(1))
    position.forEach((value, index) => {
      minimum[index] = Math.min(minimum[index], value);
      maximum[index] = Math.max(maximum[index], value);
    });
  return minimum.map((value, index) => (value + maximum[index]) / 2) as Vector3;
}

export function absoluteFormationCenter(
  observerWorldPosition: Vector3,
  relativeOrigins: Vector3[],
): Vector3 {
  const relativeCenter = formationCenter(relativeOrigins);
  return observerWorldPosition.map(
    (coordinate, index) => coordinate + relativeCenter[index],
  ) as Vector3;
}

export function formationDestination(origins: Vector3[], vector: Vector3): Vector3 {
  return formationCenter(origins).map((value, index) => value + vector[index]) as Vector3;
}

export function elevationFromPointer(
  initialElevation: number,
  initialPointerY: number,
  pointerY: number,
  unitsPerPixel: number,
): number {
  return initialElevation + (initialPointerY - pointerY) * unitsPerPixel;
}

export function elevationFromWheel(
  elevation: number,
  deltaY: number,
  unitsPerPixel: number,
): number {
  return elevation - deltaY * unitsPerPixel;
}
