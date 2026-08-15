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
