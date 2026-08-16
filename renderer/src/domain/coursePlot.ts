import type { Vector3 } from "../types/telemetry";

export function formationCenter(positions: Vector3[]): Vector3 {
  if (positions.length === 0) return [0, 0, 0];
  const minimum: Vector3 = [...positions[0]];
  const maximum: Vector3 = [...positions[0]];
  for (const position of positions.slice(1)) position.forEach((value, index) => {
    minimum[index] = Math.min(minimum[index], value);
    maximum[index] = Math.max(maximum[index], value);
  });
  return minimum.map((value, index) => (value + maximum[index]) / 2) as Vector3;
}

export function formationDestination(origins: Vector3[], vector: Vector3): Vector3 {
  return formationCenter(origins).map(
    (value, index) => value + vector[index],
  ) as Vector3;
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
