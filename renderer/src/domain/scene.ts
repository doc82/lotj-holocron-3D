import type { Color3, SystemSnapshot, TelemetryEntity, Vector3 } from "../types/telemetry";

const TAU = Math.PI * 2;
export const BASE_SENSOR_RANGE = 500;
export const SENSOR_RANGE_PER_ARRAY = 10;
export const DEFAULT_PIXELS_PER_DISTANCE_UNIT = 10;

export interface ScenePoint extends TelemetryEntity {
  name: string;
  kind: string;
  position3d: Vector3;
  worldPosition: Vector3;
  color: Color3;
  pointSize: number;
  members?: ScenePoint[];
  memberCount?: number;
  memberSummary?: string;
  markerShape: number;
  shipSize?: number;
}

export interface TacticalScene {
  points: ScenePoint[];
  radius: number;
  system: string;
  sequence: number;
  observedAt?: number;
  contactCount: number;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function projectileVisual(entity: Pick<TelemetryEntity, "name" | "class">): { color: Color3; shape: number; pixels: number } {
  const identity = `${entity.class || ""} ${entity.name || ""}`.toLowerCase();
  if (identity.includes("torpedo")) return { color: [0.72, 0.3, 1], shape: 11, pixels: 15 };
  if (identity.includes("rocket")) return { color: [1, 0.14, 0.06], shape: 2, pixels: 12 };
  return { color: [1, 0.52, 0.08], shape: 6, pixels: 14 };
}

export function colorFor(entity: Pick<TelemetryEntity, "id" | "kind" | "position" | "name" | "class">): Color3 {
  if (entity.id === "player-ship") return [0.5, 0.96, 1];
  if (entity.kind === "projectile") return projectileVisual(entity).color;
  if (["celestial", "planet", "star"].includes(entity.kind ?? "")) return [0.66, 0.5, 1];
  if (entity.kind === "ship") {
    const disposition = (entity as TelemetryEntity).disposition;
    if (disposition === "enemy") return [1, 0.16, 0.2];
    if (disposition === "ally") return [0.16, 0.58, 1];
    return [1, 0.76, 0.12];
  }
  if (entity.position === "Ctr") return [0.29, 0.91, 1];
  if (entity.position === "Mid") return [0.25, 0.72, 1];
  if (entity.position === "Out") return [0.22, 0.55, 0.88];
  return [0.36, 0.82, 0.96];
}

export function summarizeContacts(members: Array<Pick<ScenePoint, "kind">>): string {
  const counts = { ships: 0, planets: 0, stars: 0, contacts: 0 };
  for (const member of members) {
    if (member.kind === "ship") counts.ships += 1;
    else if (member.kind === "star") counts.stars += 1;
    else if (["planet", "celestial"].includes(member.kind)) counts.planets += 1;
    else counts.contacts += 1;
  }
  const label = (count: number, singular: string): string => `${count} ${singular}${count === 1 ? "" : "S"}`;
  return [
    counts.ships ? label(counts.ships, "SHIP") : "",
    counts.planets ? label(counts.planets, "PLANET") : "",
    counts.stars ? label(counts.stars, "STAR") : "",
    counts.contacts ? label(counts.contacts, "CONTACT") : "",
  ].filter(Boolean).join(", ");
}

const SHIP_CLASSES: Record<string, { hangarSize: number; markerPixels: number; shape: number }> = {
  vehicle: { hangarSize: 1, markerPixels: 1, shape: 1 },
  starfighter: { hangarSize: 2, markerPixels: 1, shape: 2 },
  transport: { hangarSize: 5, markerPixels: 3, shape: 3 },
  freighter: { hangarSize: 15, markerPixels: 4, shape: 4 },
  gunboat: { hangarSize: 20, markerPixels: 5, shape: 5 },
  corvette: { hangarSize: 30, markerPixels: 6, shape: 6 },
  frigate: { hangarSize: 35, markerPixels: 7, shape: 7 },
  cruiser: { hangarSize: 50, markerPixels: 8, shape: 8 },
  battleship: { hangarSize: 65, markerPixels: 9, shape: 9 },
  battlestation: { hangarSize: 100, markerPixels: 10, shape: 10 },
  platform: { hangarSize: 200, markerPixels: 11, shape: 11 },
};

function shipVisual(category: unknown): { size?: number; shape: number; pixels: number } {
  const normalized = String(category || "").toLowerCase();
  const shipClass = SHIP_CLASSES[normalized];
  if (!shipClass) return { shape: 0, pixels: 5 };
  return { size: shipClass.hangarSize, shape: shipClass.shape, pixels: shipClass.markerPixels };
}

export function buildScene(snapshot: SystemSnapshot | null): TacticalScene {
  const observer = snapshot?.observer ?? { id: "player-ship" };
  const origin: Vector3 = [finite(observer.x), finite(observer.y), finite(observer.z)];
  const observerVisual = shipVisual(observer.shipCategory);
  const observerPoint: ScenePoint = {
    ...observer,
    id: "player-ship",
    name: observer.name || "Player Ship",
    kind: "observer",
    position3d: [0, 0, 0],
    worldPosition: [...origin],
    color: colorFor({ id: "player-ship" }),
    pointSize: observerVisual.pixels,
    markerShape: observerVisual.shape,
    shipSize: observerVisual.size,
  };

  const contacts: ScenePoint[] = [];
  for (const entity of snapshot?.entities ?? []) {
    if (![entity?.x, entity?.y, entity?.z].every((value) => Number.isFinite(Number(value)))) continue;
    const position3d: Vector3 = [
      finite(entity.x) - origin[0],
      finite(entity.y) - origin[1],
      finite(entity.z) - origin[2],
    ];
    const visual = shipVisual(entity.shipCategory);
    const projectile = entity.kind === "projectile" ? projectileVisual(entity) : null;
    contacts.push({
      ...entity,
      name: entity.name || entity.id,
      kind: entity.kind || "unknown",
      position3d,
      worldPosition: [finite(entity.x), finite(entity.y), finite(entity.z)],
      color: colorFor(entity),
      pointSize: ["celestial", "planet", "star"].includes(entity.kind || "")
        ? 13 : projectile?.pixels ?? visual.pixels,
      markerShape: entity.kind === "ship" ? visual.shape : projectile?.shape ?? 0,
      shipSize: visual.size,
    });
  }

  const colocatedContacts = new Map<string, ScenePoint[]>();
  for (const contact of contacts) {
    const key = contact.worldPosition.join(":");
    const members = colocatedContacts.get(key) ?? [];
    members.push(contact);
    colocatedContacts.set(key, members);
  }

  const clusters = new Map<string, ScenePoint>();
  for (const [coordinateKey, unsortedMembers] of colocatedContacts) {
    if (unsortedMembers.length === 1 || !unsortedMembers.some((member) => member.kind === "ship")) continue;
    const members = [...unsortedMembers].sort((left, right) => left.name.localeCompare(
      right.name,
      undefined,
      { numeric: true, sensitivity: "base" },
    ));
    const representative = unsortedMembers[0];
    clusters.set(coordinateKey, {
      id: `cluster:${coordinateKey}`,
      name: `${members.length} contacts`,
      kind: "cluster",
      x: representative.x,
      y: representative.y,
      z: representative.z,
      position3d: [...representative.position3d],
      worldPosition: [...representative.worldPosition],
      color: [0.18, 0.72, 1],
      pointSize: Math.min(34, 13 + Math.sqrt(members.length) * 4.5),
      members,
      memberCount: members.length,
      memberSummary: summarizeContacts(members),
      markerShape: 0,
    });
  }

  const renderedContacts: ScenePoint[] = [];
  const emittedClusters = new Set<string>();
  for (const contact of contacts) {
    const coordinateKey = contact.worldPosition.join(":");
    const cluster = clusters.get(coordinateKey);
    if (!cluster) {
      renderedContacts.push(contact);
    } else if (!emittedClusters.has(coordinateKey)) {
      renderedContacts.push(cluster);
      emittedClusters.add(coordinateKey);
    }
  }

  const points = [observerPoint, ...renderedContacts];

  const radius = points.reduce((largest, point) => Math.max(largest, Math.hypot(...point.position3d)), 0);
  return {
    points,
    radius: Math.max(radius, 10),
    system: snapshot?.metadata?.system || "Unknown system",
    sequence: snapshot?.sequence ?? 0,
    observedAt: snapshot?.observedAt,
    contactCount: contacts.length,
  };
}

export function findScenePoint(scene: TacticalScene, id: string | null): ScenePoint | null {
  if (!id) return null;
  for (const point of scene.points) {
    if (point.id === id) return point;
    const member = point.members?.find((candidate) => candidate.id === id);
    if (member) return member;
  }
  return null;
}

function lerpVector(from: Vector3, to: Vector3, amount: number): Vector3 {
  return from.map((value, index) => value + (to[index] - value) * amount) as Vector3;
}

export function scenesHaveMotion(previous: TacticalScene | null, next: TacticalScene): boolean {
  if (!previous || previous.points.length !== next.points.length) return true;
  const previousById = new Map(previous.points.map((point) => [point.id, point]));
  return next.points.some((point) => {
    const old = previousById.get(point.id);
    return !old || point.position3d.some((value, index) => Math.abs(value - old.position3d[index]) > 0.0001);
  });
}

export class SceneInterpolator {
  target: TacticalScene;
  private starts: Map<string, ScenePoint>;
  private startedAt = 0;
  private duration = 0;
  private startRadius: number;

  constructor(initialScene = buildScene(null)) {
    this.target = initialScene;
    this.starts = new Map(initialScene.points.map((point) => [point.id, point]));
    this.startRadius = initialScene.radius;
  }

  setTarget(nextScene: TacticalScene, now: number, duration = 900): void {
    const current = this.sample(now);
    this.starts = new Map(current.points.map((point) => [point.id, point]));
    this.startRadius = current.radius;
    this.target = nextScene;
    this.startedAt = now;
    this.duration = Math.max(0, duration);
  }

  sample(now: number): TacticalScene {
    const linear = this.duration === 0 ? 1 : clamp((now - this.startedAt) / this.duration, 0, 1);
    const amount = linear * linear * (3 - 2 * linear);
    return {
      ...this.target,
      radius: this.startRadius + (this.target.radius - this.startRadius) * amount,
      points: this.target.points.map((point) => {
        const start = this.starts.get(point.id);
        return start ? {
          ...point,
          position3d: lerpVector(start.position3d, point.position3d, amount),
          worldPosition: lerpVector(start.worldPosition, point.worldPosition, amount),
        } : point;
      }),
    };
  }

  isAnimating(now: number): boolean {
    return this.duration > 0 && now < this.startedAt + this.duration;
  }
}

export function sensorRangeFor(observer: SystemSnapshot["observer"]): number {
  const sensorArray = Number(observer?.sensorArray);
  if (Number.isFinite(sensorArray)) {
    return BASE_SENSOR_RANGE + Math.max(0, sensorArray) * SENSOR_RANGE_PER_ARRAY;
  }

  const reportedRange = Number(observer?.radarRange);
  return Number.isFinite(reportedRange) && reportedRange >= BASE_SENSOR_RANGE
    ? reportedRange
    : BASE_SENSOR_RANGE;
}

export function pointerToXZVector(
  deltaX: number,
  deltaY: number,
  unitsPerPixel: number,
  yaw: number,
  pitch: number,
): Vector3 {
  const right: Vector3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const screenDown: Vector3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const pitchProjection = Math.sin(pitch);
  const safePitchProjection = Math.abs(pitchProjection) < 0.08
    ? (pitchProjection < 0 ? -0.08 : 0.08)
    : pitchProjection;
  const horizontalUnits = deltaX * unitsPerPixel;
  const depthUnits = deltaY * unitsPerPixel / safePitchProjection;
  return [
    right[0] * horizontalUnits + screenDown[0] * depthUnits,
    0,
    right[2] * horizontalUnits + screenDown[2] * depthUnits,
  ];
}

export class OrbitCamera {
  yaw = -0.72;
  pitch = 0.48;
  distance = 100;
  targetYaw = this.yaw;
  targetPitch = this.pitch;
  targetDistance = this.distance;
  minimumDistance = 4;
  maximumDistance = 1e9;

  orbit(deltaX: number, deltaY: number): void {
    this.targetYaw = (this.targetYaw - deltaX * 0.006) % TAU;
    this.targetPitch = clamp(this.targetPitch - deltaY * 0.006, -1.45, 1.45);
  }

  zoom(delta: number): void {
    this.targetDistance = clamp(this.targetDistance * Math.exp(delta * 0.0035), this.minimumDistance, this.maximumDistance);
  }

  fit(radius: number, immediate = false): void {
    const safeRadius = Math.max(10, finite(radius, 10));
    this.minimumDistance = Math.max(1, safeRadius * 0.0025);
    this.maximumDistance = Math.max(2_000, safeRadius * 50);
    this.targetDistance = clamp(safeRadius * 1.12, this.minimumDistance, this.maximumDistance);
    if (immediate) this.distance = this.targetDistance;
  }

  setPixelScale(viewportHeight: number, pixelsPerUnit: number, immediate = false): void {
    const safePixelsPerUnit = Math.max(0.01, finite(pixelsPerUnit, 1));
    this.targetDistance = clamp(
      Math.max(1, finite(viewportHeight, 1)) / (2 * safePixelsPerUnit),
      this.minimumDistance,
      this.maximumDistance,
    );
    if (immediate) this.distance = this.targetDistance;
  }

  resetOrientation(): void {
    this.targetYaw = -0.72;
    this.targetPitch = 0.48;
  }

  update(deltaSeconds: number): void {
    const blend = 1 - Math.exp(-10 * clamp(deltaSeconds, 0, 0.1));
    this.yaw += (this.targetYaw - this.yaw) * blend;
    this.pitch += (this.targetPitch - this.pitch) * blend;
    this.distance += (this.targetDistance - this.distance) * blend;
  }

  isMoving(): boolean {
    const distanceTolerance = Math.max(0.001, this.distance * 0.0001);
    return Math.abs(this.targetYaw - this.yaw) > 0.0001
      || Math.abs(this.targetPitch - this.pitch) > 0.0001
      || Math.abs(this.targetDistance - this.distance) > distanceTolerance;
  }

  eye(distance = this.distance): Vector3 {
    const horizontal = Math.cos(this.pitch) * distance;
    return [Math.sin(this.yaw) * horizontal, Math.sin(this.pitch) * distance, Math.cos(this.yaw) * horizontal];
  }
}

export function perspective(fieldOfView: number, aspect: number, near: number, far: number): Float32Array<ArrayBuffer> {
  const f = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0]);
}

export function orthographic(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Float32Array<ArrayBuffer> {
  return new Float32Array([
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, -2 / (far - near), 0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    -(far + near) / (far - near),
    1,
  ]);
}

function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length) as Vector3;
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2], left[0] * right[1] - left[1] * right[0]];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function lookAt(eye: Vector3, target: Vector3 = [0, 0, 0], up: Vector3 = [0, 1, 0]): Float32Array<ArrayBuffer> {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  let x = normalize(cross(up, z));
  if (Math.hypot(...x) < 0.001) x = [1, 0, 0];
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

export function multiply(
  left: Float32Array<ArrayBuffer>,
  right: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) value += left[index * 4 + row] * right[column * 4 + index];
      output[column * 4 + row] = value;
    }
  }
  return output;
}

export interface ScreenPoint { x: number; y: number; depth: number }

export function project(
  position: Vector3,
  matrix: Float32Array<ArrayBuffer>,
  width: number,
  height: number,
): ScreenPoint | null {
  const [x, y, z] = position;
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (clipW <= 0 || clipZ < -clipW || clipZ > clipW) return null;
  return { x: (clipX / clipW * 0.5 + 0.5) * width, y: (1 - (clipY / clipW * 0.5 + 0.5)) * height, depth: clipZ / clipW };
}

export function formatCoordinate(value: unknown): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(finite(value));
}
