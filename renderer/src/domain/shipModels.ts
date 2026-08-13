import type { Vector3 } from "../types/telemetry";

export interface ShipModel {
  triangles: Vector3[];
  scale: number;
}

const triangle = (a: Vector3, b: Vector3, c: Vector3): Vector3[] => [a, b, c];

function box(width: number, height: number, length: number, z = 0, xOffset = 0, yOffset = 0): Vector3[] {
  const x = width / 2;
  const y = height / 2;
  const front = z + length / 2;
  const back = z - length / 2;
  const p: Vector3[] = [
    [-x + xOffset, -y + yOffset, back], [x + xOffset, -y + yOffset, back],
    [x + xOffset, y + yOffset, back], [-x + xOffset, y + yOffset, back],
    [-x + xOffset, -y + yOffset, front], [x + xOffset, -y + yOffset, front],
    [x + xOffset, y + yOffset, front], [-x + xOffset, y + yOffset, front],
  ];
  return [
    ...triangle(p[4], p[5], p[6]), ...triangle(p[4], p[6], p[7]),
    ...triangle(p[1], p[0], p[3]), ...triangle(p[1], p[3], p[2]),
    ...triangle(p[0], p[4], p[7]), ...triangle(p[0], p[7], p[3]),
    ...triangle(p[5], p[1], p[2]), ...triangle(p[5], p[2], p[6]),
    ...triangle(p[3], p[7], p[6]), ...triangle(p[3], p[6], p[2]),
    ...triangle(p[0], p[1], p[5]), ...triangle(p[0], p[5], p[4]),
  ];
}

function wedge(width = 1, height = 0.35, length = 2): Vector3[] {
  const x = width / 2;
  const y = height / 2;
  const front: Vector3 = [0, 0, length / 2];
  const back = -length / 2;
  const p: Vector3[] = [[-x, -y, back], [x, -y, back], [x, y, back], [-x, y, back]];
  return [
    ...triangle(p[0], p[1], front), ...triangle(p[1], p[2], front),
    ...triangle(p[2], p[3], front), ...triangle(p[3], p[0], front),
    ...triangle(p[1], p[0], p[3]), ...triangle(p[1], p[3], p[2]),
  ];
}

function diamond(radius = 1, length = 2): Vector3[] {
  const front: Vector3 = [0, 0, length / 2];
  const back: Vector3 = [0, 0, -length / 2];
  const ring: Vector3[] = [[radius, 0, 0], [0, radius * 0.45, 0], [-radius, 0, 0], [0, -radius * 0.45, 0]];
  return ring.flatMap((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return [...triangle(front, point, next), ...triangle(back, next, point)];
  });
}

function station(): Vector3[] {
  const top: Vector3 = [0, 1, 0];
  const bottom: Vector3 = [0, -1, 0];
  const ring: Vector3[] = [[1, 0, 0], [0.7, 0, 0.7], [0, 0, 1], [-0.7, 0, 0.7], [-1, 0, 0], [-0.7, 0, -0.7], [0, 0, -1], [0.7, 0, -0.7]];
  return ring.flatMap((point, index) => {
    const next = ring[(index + 1) % ring.length];
    return [...triangle(top, point, next), ...triangle(bottom, next, point)];
  });
}

function ringPlatform(): Vector3[] {
  const vertices: Vector3[] = [];
  const segments = 12;
  for (let index = 0; index < segments; index += 1) {
    const a = index / segments * Math.PI * 2;
    const b = (index + 1) / segments * Math.PI * 2;
    const outerA: Vector3 = [Math.cos(a), 0, Math.sin(a)];
    const outerB: Vector3 = [Math.cos(b), 0, Math.sin(b)];
    const innerA: Vector3 = [Math.cos(a) * 0.58, 0, Math.sin(a) * 0.58];
    const innerB: Vector3 = [Math.cos(b) * 0.58, 0, Math.sin(b) * 0.58];
    const raisedA: Vector3 = [outerA[0], 0.18, outerA[2]];
    const raisedB: Vector3 = [outerB[0], 0.18, outerB[2]];
    vertices.push(
      ...triangle(innerA, outerA, outerB), ...triangle(innerA, outerB, innerB),
      ...triangle(outerA, raisedA, raisedB), ...triangle(outerA, raisedB, outerB),
    );
  }
  return [...vertices, ...box(0.24, 0.7, 2.5), ...box(2.5, 0.7, 0.24)];
}

const MODELS: Record<string, ShipModel> = {
  vehicle: { scale: 0.65, triangles: wedge(0.8, 0.4, 1.2) },
  starfighter: {
    scale: 0.9,
    triangles: [...diamond(0.18, 2.2), ...box(1.8, 0.08, 0.46, -0.1), ...box(0.16, 0.35, 0.5, -0.7)],
  },
  transport: { scale: 1.2, triangles: [...wedge(1.25, 0.55, 1.8), ...box(1.8, 0.12, 0.55, -0.25)] },
  freighter: { scale: 1.45, triangles: [...box(0.85, 0.55, 1.8, 0, -0.34), ...box(0.48, 0.42, 1.35, 0.1, 0.48), ...box(0.3, 0.3, 1.45, -0.15, 0.12, 0.35)] },
  gunboat: { scale: 1.65, triangles: [...wedge(1.45, 0.65, 2), ...box(0.3, 0.45, 1.45, -0.18, -0.64), ...box(0.3, 0.45, 1.45, -0.18, 0.64)] },
  corvette: { scale: 2.1, triangles: [...diamond(0.42, 2.6), ...box(0.65, 0.35, 0.75, -0.65)] },
  frigate: { scale: 2.55, triangles: [...wedge(0.85, 0.5, 2.8), ...box(0.34, 0.38, 1.4, -0.55)] },
  cruiser: { scale: 3.1, triangles: [...wedge(1.4, 0.48, 2.8), ...box(0.34, 0.42, 0.65, -0.72)] },
  battleship: { scale: 3.8, triangles: [...wedge(1.8, 0.58, 3.2), ...box(0.55, 0.52, 0.8, -0.85), ...box(0.22, 0.6, 0.28, -0.9)] },
  battlestation: { scale: 4.8, triangles: station() },
  platform: { scale: 5.4, triangles: ringPlatform() },
};

const FALLBACK = { scale: 1.2, triangles: diamond(0.5, 1.8) };

export function shipModelFor(category: unknown): ShipModel {
  return MODELS[String(category || "").toLowerCase()] ?? FALLBACK;
}
