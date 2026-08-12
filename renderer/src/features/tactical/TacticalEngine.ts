import {
  OrbitCamera,
  SceneInterpolator,
  buildScene,
  lookAt,
  multiply,
  perspective,
  project,
  sensorRangeFor,
  scenesHaveMotion,
  type ScenePoint,
  type TacticalScene,
} from "../../domain/scene";
import type { Color3, SystemSnapshot, Vector3 } from "../../types/telemetry";

const VERTEX_SOURCE = `
  attribute vec3 a_position;
  attribute vec3 a_color;
  attribute float a_size;
  uniform mat4 u_viewProjection;
  uniform float u_pixelRatio;
  varying vec3 v_color;
  void main() {
    gl_Position = u_viewProjection * vec4(a_position, 1.0);
    gl_PointSize = a_size * u_pixelRatio;
    v_color = a_color;
  }
`;

const FRAGMENT_SOURCE = `
  precision mediump float;
  uniform bool u_points;
  uniform float u_alpha;
  varying vec3 v_color;
  void main() {
    float alpha = u_alpha;
    vec3 color = v_color;
    if (u_points) {
      float radius = distance(gl_PointCoord, vec2(0.5));
      if (radius > 0.5) discard;
      alpha *= smoothstep(0.5, 0.12, radius);
      color = mix(v_color, vec3(1.0), smoothstep(0.3, 0.0, radius));
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

const ACTIVE_FRAME_INTERVAL_MS = 1000 / 30;
const MINIMUM_ORIGIN_GRID_EXTENT = 3_000;
const MINIMUM_ORIGIN_GRID_STEP = 500;

export interface TacticalTooltip {
  name: string;
  distance: number;
  memberCount?: number;
  x: number;
  y: number;
}

export interface ClusterLabel {
  id: string;
  count: number;
  x: number;
  y: number;
}

export interface TacticalEngineCallbacks {
  onSelect(id: string | null): void;
  onTooltip(tooltip: TacticalTooltip | null): void;
  onClusterLabels(labels: ClusterLabel[]): void;
}

interface DragState { x: number; y: number; moved: boolean }

function requireBuffer(gl: WebGLRenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error("Unable to allocate a WebGL buffer.");
  return buffer;
}

export class TacticalEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext;
  private readonly callbacks: TacticalEngineCallbacks;
  private readonly camera = new OrbitCamera();
  private readonly interpolator = new SceneInterpolator();
  private readonly pointBuffer: WebGLBuffer;
  private readonly radarSurfaceBuffer: WebGLBuffer;
  private readonly radarWireBuffer: WebGLBuffer;
  private readonly originGridBuffer: WebGLBuffer;
  private readonly program: WebGLProgram;
  private readonly resizeObserver: ResizeObserver;
  private readonly locations: {
    position: number;
    color: number;
    size: number;
    matrix: WebGLUniformLocation | null;
    pixelRatio: WebGLUniformLocation | null;
    points: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
  };
  private scene: TacticalScene = buildScene(null);
  private viewProjection = new Float32Array(16);
  private pointCount = 0;
  private radarSurfaceCount = 0;
  private radarWireCount = 0;
  private originGridCount = 0;
  private radarRange = 0;
  private radarBubbleEnabled = true;
  private originGridEnabled = false;
  private originOffset: Vector3 = [0, 0, 0];
  private originGridExtent = MINIMUM_ORIGIN_GRID_EXTENT;
  private originGridStep = MINIMUM_ORIGIN_GRID_STEP;
  private firstSnapshot = true;
  private lastMotionSnapshotAt: number | null = null;
  private previousFrame = performance.now();
  private animationFrame: number | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private drag: DragState | null = null;
  private disposed = false;
  private clusterLabelSignature = "";

  constructor(canvas: HTMLCanvasElement, callbacks: TacticalEngineCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) throw new Error("This renderer requires WebGL support.");
    this.gl = gl;
    this.program = this.createProgram();
    this.locations = {
      position: gl.getAttribLocation(this.program, "a_position"),
      color: gl.getAttribLocation(this.program, "a_color"),
      size: gl.getAttribLocation(this.program, "a_size"),
      matrix: gl.getUniformLocation(this.program, "u_viewProjection"),
      pixelRatio: gl.getUniformLocation(this.program, "u_pixelRatio"),
      points: gl.getUniformLocation(this.program, "u_points"),
      alpha: gl.getUniformLocation(this.program, "u_alpha"),
    };
    this.pointBuffer = requireBuffer(gl);
    this.radarSurfaceBuffer = requireBuffer(gl);
    this.radarWireBuffer = requireBuffer(gl);
    this.originGridBuffer = requireBuffer(gl);
    this.rebuildBuffers();
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(canvas);
    this.requestRender();
  }

  setSnapshot(snapshot: SystemSnapshot): void {
    const nextScene = buildScene(snapshot);
    const nextOriginOffset: Vector3 = [
      -Number(snapshot.observer?.x || 0),
      -Number(snapshot.observer?.y || 0),
      -Number(snapshot.observer?.z || 0),
    ];
    const largestWorldCoordinate = nextScene.points.reduce(
      (largest, point) => Math.max(largest, ...point.worldPosition.map(Math.abs)),
      0,
    );
    const desiredGridExtent = Math.max(MINIMUM_ORIGIN_GRID_EXTENT, largestWorldCoordinate * 1.1);
    const nextGridStep = this.niceOriginGridStep(desiredGridExtent);
    const nextGridExtent = Math.ceil(desiredGridExtent / nextGridStep) * nextGridStep;
    if (nextOriginOffset.some((value, index) => value !== this.originOffset[index])
        || nextGridExtent !== this.originGridExtent || nextGridStep !== this.originGridStep) {
      this.originOffset = nextOriginOffset;
      this.originGridExtent = nextGridExtent;
      this.originGridStep = nextGridStep;
      this.rebuildOriginGridBuffer();
    }
    const radarRange = sensorRangeFor(snapshot.observer);
    const radarRangeBecameAvailable = this.radarRange <= 0 && radarRange > 0;
    if (radarRange !== this.radarRange) {
      this.radarRange = radarRange;
      this.rebuildRadarBuffers();
    }
    const now = performance.now();
    if (this.firstSnapshot) {
      this.interpolator.setTarget(nextScene, now, 0);
      this.scene = nextScene;
      this.camera.fit(this.fitRadius(), true);
      this.firstSnapshot = false;
      this.lastMotionSnapshotAt = now;
    } else {
      const moving = scenesHaveMotion(this.interpolator.target, nextScene);
      let duration = 450;
      if (moving) {
        const observedInterval = this.lastMotionSnapshotAt === null ? 900 : now - this.lastMotionSnapshotAt;
        duration = Math.min(6000, Math.max(450, observedInterval * 0.88));
        this.lastMotionSnapshotAt = now;
      }
      this.interpolator.setTarget(nextScene, now, duration);
      this.scene = this.interpolator.sample(now);
    }
    if (radarRangeBecameAvailable && !this.firstSnapshot) this.camera.fit(this.fitRadius());
    this.requestRender();
  }

  fitSystem(): void {
    this.camera.fit(this.fitRadius());
    this.requestRender();
  }

  setRadarBubbleEnabled(enabled: boolean): void {
    this.radarBubbleEnabled = enabled;
    this.requestRender();
  }

  setOriginGridEnabled(enabled: boolean): void {
    this.originGridEnabled = enabled;
    this.camera.fit(this.fitRadius());
    this.requestRender();
  }

  resetOrientation(): void {
    this.camera.resetOrientation();
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    if (this.frameTimer !== null) clearTimeout(this.frameTimer);
    this.resizeObserver.disconnect();
    this.unbindEvents();
    this.gl.deleteBuffer(this.pointBuffer);
    this.gl.deleteBuffer(this.radarSurfaceBuffer);
    this.gl.deleteBuffer(this.radarWireBuffer);
    this.gl.deleteBuffer(this.originGridBuffer);
    this.gl.deleteProgram(this.program);
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate a WebGL shader.");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) || "WebGL shader compilation failed.");
    }
    return shader;
  }

  private createProgram(): WebGLProgram {
    const program = this.gl.createProgram();
    if (!program) throw new Error("Unable to allocate a WebGL program.");
    const vertex = this.createShader(this.gl.VERTEX_SHADER, VERTEX_SOURCE);
    const fragment = this.createShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);
    this.gl.deleteShader(vertex);
    this.gl.deleteShader(fragment);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program) || "WebGL program linking failed.");
    }
    return program;
  }

  private interleavedVertex(position: Vector3, color: Color3, size = 1): number[] {
    return [...position, ...color, size];
  }

  private upload(buffer: WebGLBuffer, values: number[], usage: number = this.gl.STATIC_DRAW): void {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(values), usage);
  }

  private rebuildPointBuffer(): void {
    const points = this.scene.points.flatMap((point) => this.interleavedVertex(point.position3d, point.color, point.pointSize));
    this.pointCount = this.scene.points.length;
    this.upload(this.pointBuffer, points, this.gl.DYNAMIC_DRAW);
  }

  private spherePoint(radius: number, latitude: number, longitude: number): Vector3 {
    const horizontal = Math.cos(latitude) * radius;
    return [horizontal * Math.cos(longitude), Math.sin(latitude) * radius, horizontal * Math.sin(longitude)];
  }

  private niceOriginGridStep(extent: number): number {
    const roughStep = Math.max(MINIMUM_ORIGIN_GRID_STEP, extent / 8);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalized = roughStep / magnitude;
    const niceMultiplier = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
    return Math.max(MINIMUM_ORIGIN_GRID_STEP, niceMultiplier * magnitude);
  }

  private rebuildRadarBuffers(): void {
    const surface: number[] = [];
    const wire: number[] = [];
    if (this.radarRange <= 0) {
      this.radarSurfaceCount = 0;
      this.radarWireCount = 0;
      this.upload(this.radarSurfaceBuffer, surface);
      this.upload(this.radarWireBuffer, wire);
      return;
    }

    const surfaceColor: Color3 = [0.035, 0.28, 0.62];
    const wireColor: Color3 = [0.12, 0.62, 1];
    const longitudeSegments = 36;
    const latitudeSegments = 18;
    for (let latitudeIndex = 0; latitudeIndex < latitudeSegments; latitudeIndex += 1) {
      const latitudeA = -Math.PI / 2 + (latitudeIndex / latitudeSegments) * Math.PI;
      const latitudeB = -Math.PI / 2 + ((latitudeIndex + 1) / latitudeSegments) * Math.PI;
      for (let longitudeIndex = 0; longitudeIndex < longitudeSegments; longitudeIndex += 1) {
        const longitudeA = (longitudeIndex / longitudeSegments) * Math.PI * 2;
        const longitudeB = ((longitudeIndex + 1) / longitudeSegments) * Math.PI * 2;
        const a = this.spherePoint(this.radarRange, latitudeA, longitudeA);
        const b = this.spherePoint(this.radarRange, latitudeB, longitudeA);
        const c = this.spherePoint(this.radarRange, latitudeB, longitudeB);
        const d = this.spherePoint(this.radarRange, latitudeA, longitudeB);
        surface.push(
          ...this.interleavedVertex(a, surfaceColor),
          ...this.interleavedVertex(b, surfaceColor),
          ...this.interleavedVertex(c, surfaceColor),
          ...this.interleavedVertex(a, surfaceColor),
          ...this.interleavedVertex(c, surfaceColor),
          ...this.interleavedVertex(d, surfaceColor),
        );
      }
    }

    const ringSegments = 96;
    const appendRing = (pointAt: (angle: number) => Vector3): void => {
      for (let segment = 0; segment < ringSegments; segment += 1) {
        const start = (segment / ringSegments) * Math.PI * 2;
        const end = ((segment + 1) / ringSegments) * Math.PI * 2;
        wire.push(...this.interleavedVertex(pointAt(start), wireColor));
        wire.push(...this.interleavedVertex(pointAt(end), wireColor));
      }
    };
    for (const degrees of [-60, -30, 0, 30, 60]) {
      const latitude = degrees * Math.PI / 180;
      appendRing((longitude) => this.spherePoint(this.radarRange, latitude, longitude));
    }
    for (let meridian = 0; meridian < 8; meridian += 1) {
      const rotation = (meridian / 8) * Math.PI;
      appendRing((angle) => {
        const x = Math.cos(angle) * this.radarRange;
        const y = Math.sin(angle) * this.radarRange;
        return [x * Math.cos(rotation), y, x * Math.sin(rotation)];
      });
    }

    this.radarSurfaceCount = surface.length / 7;
    this.radarWireCount = wire.length / 7;
    this.upload(this.radarSurfaceBuffer, surface);
    this.upload(this.radarWireBuffer, wire);
  }

  private rebuildOriginGridBuffer(): void {
    const grid: number[] = [];
    const [originX, originY, originZ] = this.originOffset;
    const planeXY: Color3 = [0.07, 0.2, 0.3];
    const planeXZ: Color3 = [0.045, 0.24, 0.27];
    const planeYZ: Color3 = [0.13, 0.1, 0.26];
    const appendLine = (start: Vector3, end: Vector3, color: Color3): void => {
      grid.push(...this.interleavedVertex(start, color), ...this.interleavedVertex(end, color));
    };

    const extent = this.originGridExtent;
    for (let coordinate = -extent; coordinate <= extent; coordinate += this.originGridStep) {
      appendLine(
        [originX - extent, originY + coordinate, originZ],
        [originX + extent, originY + coordinate, originZ],
        planeXY,
      );
      appendLine(
        [originX + coordinate, originY - extent, originZ],
        [originX + coordinate, originY + extent, originZ],
        planeXY,
      );
      appendLine(
        [originX - extent, originY, originZ + coordinate],
        [originX + extent, originY, originZ + coordinate],
        planeXZ,
      );
      appendLine(
        [originX + coordinate, originY, originZ - extent],
        [originX + coordinate, originY, originZ + extent],
        planeXZ,
      );
      appendLine(
        [originX, originY - extent, originZ + coordinate],
        [originX, originY + extent, originZ + coordinate],
        planeYZ,
      );
      appendLine(
        [originX, originY + coordinate, originZ - extent],
        [originX, originY + coordinate, originZ + extent],
        planeYZ,
      );
    }

    appendLine([originX - extent, originY, originZ], [originX + extent, originY, originZ], [0.78, 0.18, 0.25]);
    appendLine([originX, originY - extent, originZ], [originX, originY + extent, originZ], [0.25, 0.78, 0.42]);
    appendLine([originX, originY, originZ - extent], [originX, originY, originZ + extent], [0.16, 0.48, 1]);

    this.originGridCount = grid.length / 7;
    this.upload(this.originGridBuffer, grid);
  }

  private rebuildBuffers(): void {
    this.rebuildPointBuffer();
    this.rebuildRadarBuffers();
    this.rebuildOriginGridBuffer();
  }

  private fitRadius(): number {
    const [offsetX, offsetY, offsetZ] = this.originOffset.map(Math.abs);
    const extent = this.originGridExtent;
    const originGridRadius = this.originGridEnabled ? Math.max(
      Math.hypot(offsetX + extent, offsetY + extent, offsetZ),
      Math.hypot(offsetX + extent, offsetY, offsetZ + extent),
      Math.hypot(offsetX, offsetY + extent, offsetZ + extent),
    ) : 0;
    const contentRadius = Math.max(
      this.interpolator.target.radius,
      this.radarBubbleEnabled ? this.radarRange : 0,
      originGridRadius,
    );
    return contentRadius * (this.originGridEnabled ? 1.1 : 1.22);
  }

  private bindAttributes(buffer: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 7 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.locations.color);
    gl.vertexAttribPointer(this.locations.color, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(this.locations.size);
    gl.vertexAttribPointer(this.locations.size, 1, gl.FLOAT, false, stride, 6 * 4);
  }

  private resize(): number {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return ratio;
  }

  private drawBuffer(buffer: WebGLBuffer, count: number, mode: number, points: boolean, alpha: number): void {
    this.bindAttributes(buffer);
    this.gl.uniform1i(this.locations.points, points ? 1 : 0);
    this.gl.uniform1f(this.locations.alpha, alpha);
    this.gl.drawArrays(mode, 0, count);
  }

  private requestRender = (): void => {
    if (this.disposed || document.hidden) return;
    if (this.frameTimer !== null) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.animationFrame === null) this.animationFrame = requestAnimationFrame(this.render);
  };

  private scheduleActiveFrame(): void {
    if (this.disposed || document.hidden || this.frameTimer !== null || this.animationFrame !== null) return;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      if (!this.disposed && !document.hidden) {
        this.animationFrame = requestAnimationFrame(this.render);
      }
    }, ACTIVE_FRAME_INTERVAL_MS);
  }

  private render = (now: number): void => {
    this.animationFrame = null;
    if (this.disposed) return;
    const gl = this.gl;
    const delta = (now - this.previousFrame) / 1000;
    this.previousFrame = now;
    this.camera.update(delta);
    this.scene = this.interpolator.sample(now);
    this.rebuildPointBuffer();
    const pixelRatio = this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.008, 0.016, 0.031, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const aspect = this.canvas.width / this.canvas.height;
    const near = Math.max(0.05, this.camera.distance * 0.001);
    const far = Math.max(this.camera.distance * 20, this.scene.radius * 20, this.radarRange * 4, 500);
    this.viewProjection = multiply(perspective(Math.PI / 3, aspect, near, far), lookAt(this.camera.eye()));
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locations.matrix, false, this.viewProjection);
    gl.uniform1f(this.locations.pixelRatio, pixelRatio);
    if (this.originGridEnabled) {
      this.drawBuffer(this.originGridBuffer, this.originGridCount, gl.LINES, false, 0.55);
    }
    if (this.radarBubbleEnabled && this.radarRange > 0) {
      gl.depthMask(false);
      this.drawBuffer(this.radarSurfaceBuffer, this.radarSurfaceCount, gl.TRIANGLES, false, 0.035);
      this.drawBuffer(this.radarWireBuffer, this.radarWireCount, gl.LINES, false, 0.58);
      gl.depthMask(true);
    }
    this.drawBuffer(this.pointBuffer, this.pointCount, gl.POINTS, true, 1);
    this.publishClusterLabels();
    if (this.interpolator.isAnimating(now) || this.camera.isMoving()) {
      this.scheduleActiveFrame();
    }
  };

  private publishClusterLabels(): void {
    const rect = this.canvas.getBoundingClientRect();
    const labels: ClusterLabel[] = [];
    for (const point of this.scene.points) {
      if (point.kind !== "cluster" || !point.memberCount) continue;
      const screen = project(point.position3d, this.viewProjection, rect.width, rect.height);
      if (!screen) continue;
      labels.push({ id: point.id, count: point.memberCount, x: screen.x, y: screen.y });
    }
    const signature = labels.map((label) => `${label.id}:${label.x.toFixed(1)}:${label.y.toFixed(1)}:${label.count}`).join("|");
    if (signature === this.clusterLabelSignature) return;
    this.clusterLabelSignature = signature;
    this.callbacks.onClusterLabels(labels);
  }

  private pointAt(clientX: number, clientY: number, threshold: number): ScenePoint | null {
    const rect = this.canvas.getBoundingClientRect();
    let closest: ScenePoint | null = null;
    let closestDistance = threshold;
    for (const point of this.scene.points) {
      const screen = project(point.position3d, this.viewProjection, rect.width, rect.height);
      if (!screen) continue;
      const distance = Math.hypot(screen.x - (clientX - rect.left), screen.y - (clientY - rect.top));
      if (distance < closestDistance) {
        closest = point;
        closestDistance = distance;
      }
    }
    return closest;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.drag = { x: event.clientX, y: event.clientY, moved: false };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.dataset.dragging = "true";
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.drag) {
      const deltaX = event.clientX - this.drag.x;
      const deltaY = event.clientY - this.drag.y;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 1) this.drag.moved = true;
      this.camera.orbit(deltaX, deltaY);
      this.requestRender();
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.callbacks.onTooltip(null);
      return;
    }
    const point = this.pointAt(event.clientX, event.clientY, 18);
    this.callbacks.onTooltip(point ? {
      name: point.name,
      distance: Math.hypot(...point.position3d),
      memberCount: point.memberCount,
      x: event.clientX + 14,
      y: event.clientY + 14,
    } : null);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const moved = this.drag?.moved;
    this.drag = null;
    delete this.canvas.dataset.dragging;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (!moved) this.callbacks.onSelect(this.pointAt(event.clientX, event.clientY, 14)?.id ?? null);
  };

  private onPointerCancel = (): void => {
    this.drag = null;
    delete this.canvas.dataset.dragging;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.camera.zoom(event.deltaY);
    this.requestRender();
  };

  private onContextMenu = (event: Event): void => event.preventDefault();

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === "f") this.fitSystem();
    if (key === "r") this.resetOrientation();
    if (event.key === "ArrowLeft" || key === "a") this.camera.orbit(18, 0);
    if (event.key === "ArrowRight" || key === "d") this.camera.orbit(-18, 0);
    if (event.key === "ArrowUp" || key === "w") this.camera.orbit(0, 18);
    if (event.key === "ArrowDown" || key === "s") this.camera.orbit(0, -18);
    if (key === "q") this.camera.zoom(-120);
    if (key === "e") this.camera.zoom(120);
    this.requestRender();
  };

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
      if (this.frameTimer !== null) clearTimeout(this.frameTimer);
      this.animationFrame = null;
      this.frameTimer = null;
      return;
    }
    this.previousFrame = performance.now();
    this.requestRender();
  };

  private bindEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}
