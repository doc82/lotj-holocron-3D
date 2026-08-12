import {
  OrbitCamera,
  SceneInterpolator,
  buildScene,
  lookAt,
  multiply,
  perspective,
  project,
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

export interface TacticalTooltip {
  name: string;
  distance: number;
  x: number;
  y: number;
}

export interface TacticalEngineCallbacks {
  onSelect(id: string | null): void;
  onTooltip(tooltip: TacticalTooltip | null): void;
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
  private readonly gridBuffer: WebGLBuffer;
  private readonly program: WebGLProgram;
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
  private gridCount = 0;
  private firstSnapshot = true;
  private lastMotionSnapshotAt: number | null = null;
  private previousFrame = performance.now();
  private animationFrame = 0;
  private drag: DragState | null = null;
  private disposed = false;

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
    this.gridBuffer = requireBuffer(gl);
    this.rebuildBuffers();
    this.bindEvents();
    this.animationFrame = requestAnimationFrame(this.render);
  }

  setSnapshot(snapshot: SystemSnapshot): void {
    const nextScene = buildScene(snapshot);
    const now = performance.now();
    if (this.firstSnapshot) {
      this.interpolator.setTarget(nextScene, now, 0);
      this.scene = nextScene;
      this.camera.fit(this.scene.radius, true);
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
    this.rebuildGridBuffer();
  }

  fitSystem(): void { this.camera.fit(this.interpolator.target.radius); }
  resetOrientation(): void { this.camera.resetOrientation(); }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.unbindEvents();
    this.gl.deleteBuffer(this.pointBuffer);
    this.gl.deleteBuffer(this.gridBuffer);
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

  private niceStep(radius: number): number {
    const rough = Math.max(radius, 10) / 8;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  }

  private rebuildPointBuffer(): void {
    const points = this.scene.points.flatMap((point) => this.interleavedVertex(point.position3d, point.color, point.pointSize));
    this.pointCount = this.scene.points.length;
    this.upload(this.pointBuffer, points, this.gl.DYNAMIC_DRAW);
  }

  private rebuildGridBuffer(): void {
    const grid: number[] = [];
    const step = this.niceStep(this.scene.radius);
    const extent = step * 10;
    for (let index = -10; index <= 10; index += 1) {
      const coordinate = index * step;
      const color: Color3 = index === 0 ? [0.12, 0.53, 0.62] : [0.035, 0.18, 0.23];
      grid.push(...this.interleavedVertex([-extent, 0, coordinate], color));
      grid.push(...this.interleavedVertex([extent, 0, coordinate], color));
      grid.push(...this.interleavedVertex([coordinate, 0, -extent], color));
      grid.push(...this.interleavedVertex([coordinate, 0, extent], color));
    }
    this.gridCount = grid.length / 7;
    this.upload(this.gridBuffer, grid);
  }

  private rebuildBuffers(): void {
    this.rebuildPointBuffer();
    this.rebuildGridBuffer();
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

  private render = (now: number): void => {
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
    const far = Math.max(this.camera.distance * 20, this.scene.radius * 20, 500);
    this.viewProjection = multiply(perspective(Math.PI / 3, aspect, near, far), lookAt(this.camera.eye()));
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locations.matrix, false, this.viewProjection);
    gl.uniform1f(this.locations.pixelRatio, pixelRatio);
    this.drawBuffer(this.gridBuffer, this.gridCount, gl.LINES, false, 0.45);
    this.drawBuffer(this.pointBuffer, this.pointCount, gl.POINTS, true, 1);
    this.animationFrame = requestAnimationFrame(this.render);
  };

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
      this.drag.x = event.clientX;
      this.drag.y = event.clientY;
      this.callbacks.onTooltip(null);
      return;
    }
    const point = this.pointAt(event.clientX, event.clientY, 18);
    this.callbacks.onTooltip(point ? {
      name: point.name,
      distance: Math.hypot(...point.position3d),
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
  };

  private bindEvents(): void {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private unbindEvents(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
  }
}
