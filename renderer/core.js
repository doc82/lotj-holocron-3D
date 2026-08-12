const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function colorFor(entity) {
  if (entity.id === "player-ship") return [1, 0.86, 0.34];
  if (entity.kind === "celestial" || entity.kind === "planet"
      || entity.kind === "star") return [0.66, 0.5, 1];
  if (entity.position === "Ctr") return [0.29, 0.91, 1];
  if (entity.position === "Mid") return [0.25, 0.72, 1];
  if (entity.position === "Out") return [0.22, 0.55, 0.88];
  return [0.36, 0.82, 0.96];
}

export function buildScene(snapshot) {
  const observer = snapshot?.observer ?? {};
  const origin = [finite(observer.x), finite(observer.y), finite(observer.z)];
  const observerPoint = {
    ...observer,
    id: "player-ship",
    name: observer.name || "Player Ship",
    kind: "observer",
    position3d: [0, 0, 0],
    worldPosition: [...origin],
    color: colorFor({ id: "player-ship" }),
    pointSize: 15,
  };

  const points = [observerPoint];
  for (const entity of snapshot?.entities ?? []) {
    if (![entity?.x, entity?.y, entity?.z].every((value) => Number.isFinite(Number(value)))) {
      continue;
    }
    const position3d = [
      finite(entity.x) - origin[0],
      finite(entity.y) - origin[1],
      finite(entity.z) - origin[2],
    ];
    points.push({
      ...entity,
      position3d,
      worldPosition: [finite(entity.x), finite(entity.y), finite(entity.z)],
      color: colorFor(entity),
      pointSize: entity.kind === "celestial" ? 13 : 10,
    });
  }

  const radius = points.reduce((largest, point) => {
    const [x, y, z] = point.position3d;
    return Math.max(largest, Math.hypot(x, y, z));
  }, 0);

  return {
    points,
    radius: Math.max(radius, 10),
    system: snapshot?.metadata?.system || "Unknown system",
    sequence: snapshot?.sequence ?? 0,
    observedAt: snapshot?.observedAt,
  };
}

function lerpVector(from, to, amount) {
  return to.map((value, index) => from[index] + (value - from[index]) * amount);
}

export function scenesHaveMotion(previous, next) {
  if (!previous || previous.points.length !== next.points.length) return true;
  const previousById = new Map(previous.points.map((point) => [point.id, point]));
  return next.points.some((point) => {
    const old = previousById.get(point.id);
    return !old || point.position3d.some(
      (value, index) => Math.abs(value - old.position3d[index]) > 0.0001,
    );
  });
}

export class SceneInterpolator {
  constructor(initialScene = buildScene(null)) {
    this.target = initialScene;
    this.starts = new Map(initialScene.points.map((point) => [point.id, point]));
    this.startedAt = 0;
    this.duration = 0;
    this.startRadius = initialScene.radius;
  }

  setTarget(nextScene, now, duration = 900) {
    const current = this.sample(now);
    this.starts = new Map(current.points.map((point) => [point.id, point]));
    this.startRadius = current.radius;
    this.target = nextScene;
    this.startedAt = now;
    this.duration = Math.max(0, duration);
  }

  sample(now) {
    const linear = this.duration === 0
      ? 1
      : clamp((now - this.startedAt) / this.duration, 0, 1);
    const amount = linear * linear * (3 - 2 * linear);
    return {
      ...this.target,
      radius: this.startRadius + (this.target.radius - this.startRadius) * amount,
      points: this.target.points.map((point) => {
        const start = this.starts.get(point.id);
        if (!start) return point;
        return {
          ...point,
          position3d: lerpVector(start.position3d, point.position3d, amount),
          worldPosition: lerpVector(start.worldPosition, point.worldPosition, amount),
        };
      }),
    };
  }
}

export class OrbitCamera {
  constructor() {
    this.yaw = -0.72;
    this.pitch = 0.48;
    this.distance = 100;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.targetDistance = this.distance;
    this.minimumDistance = 4;
    this.maximumDistance = 1e9;
  }

  orbit(deltaX, deltaY) {
    this.targetYaw = (this.targetYaw - deltaX * 0.006) % TAU;
    this.targetPitch = clamp(this.targetPitch - deltaY * 0.006, -1.45, 1.45);
  }

  zoom(delta) {
    this.targetDistance = clamp(
      this.targetDistance * Math.exp(delta * 0.0012),
      this.minimumDistance,
      this.maximumDistance,
    );
  }

  fit(radius, immediate = false) {
    const safeRadius = Math.max(10, finite(radius, 10));
    this.minimumDistance = Math.max(2, safeRadius * 0.025);
    this.maximumDistance = Math.max(2_000, safeRadius * 50);
    this.targetDistance = clamp(safeRadius * 2.25, this.minimumDistance, this.maximumDistance);
    if (immediate) this.distance = this.targetDistance;
  }

  resetOrientation() {
    this.targetYaw = -0.72;
    this.targetPitch = 0.48;
  }

  update(deltaSeconds) {
    const blend = 1 - Math.exp(-10 * clamp(deltaSeconds, 0, 0.1));
    this.yaw += (this.targetYaw - this.yaw) * blend;
    this.pitch += (this.targetPitch - this.pitch) * blend;
    this.distance += (this.targetDistance - this.distance) * blend;
  }

  eye() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    return [
      Math.sin(this.yaw) * horizontal,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * horizontal,
    ];
  }
}

export function perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2);
  const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, 2 * far * near * range, 0,
  ]);
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function lookAt(eye, target = [0, 0, 0], up = [0, 1, 0]) {
  const z = normalize([
    eye[0] - target[0],
    eye[1] - target[1],
    eye[2] - target[2],
  ]);
  let x = normalize(cross(up, z));
  if (Math.hypot(...x) < 0.001) x = [1, 0, 0];
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

export function multiply(left, right) {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[index * 4 + row] * right[column * 4 + index];
      }
      output[column * 4 + row] = value;
    }
  }
  return output;
}

export function project(position, matrix, width, height) {
  const [x, y, z] = position;
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (clipW <= 0 || clipZ < -clipW || clipZ > clipW) return null;
  return {
    x: (clipX / clipW * 0.5 + 0.5) * width,
    y: (1 - (clipY / clipW * 0.5 + 0.5)) * height,
    depth: clipZ / clipW,
  };
}

export function formatCoordinate(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(finite(value));
}
