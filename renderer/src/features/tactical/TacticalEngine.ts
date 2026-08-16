import {
  OrbitCamera,
  SceneInterpolator,
  DEFAULT_PIXELS_PER_DISTANCE_UNIT,
  buildScene,
  lookAt,
  multiply,
  orthographic,
  pointerToXZVector,
  project,
  sensorRangeFor,
  scenesHaveMotion,
  type ScenePoint,
  type TacticalScene,
} from "../../domain/scene";
import type { Color3, CombatEvent, ShipJumpEvent, SystemSnapshot, Vector3, WeaponType } from "../../types/telemetry";
import { shipModelFor } from "../../domain/shipModels";
import {
  elevationFromPointer,
  elevationFromWheel,
  formationCenter,
  formationDestination,
} from "../../domain/coursePlot";

const VERTEX_SOURCE = `
  attribute vec3 a_position;
  attribute vec3 a_color;
  attribute float a_size;
  attribute float a_shape;
  attribute vec3 a_heading;
  uniform mat4 u_viewProjection;
  uniform float u_pixelRatio;
  uniform float u_markerScale;
  varying vec3 v_color;
  varying float v_shape;
  varying vec2 v_forward;
  varying float v_hasHeading;
  void main() {
    gl_Position = u_viewProjection * vec4(a_position, 1.0);
    vec4 headingPosition = u_viewProjection * vec4(a_position + a_heading, 1.0);
    vec2 headingDelta = headingPosition.xy / headingPosition.w - gl_Position.xy / gl_Position.w;
    gl_PointSize = max(2.0 * u_pixelRatio, a_size * u_pixelRatio * u_markerScale);
    v_color = a_color;
    v_shape = a_shape;
    v_hasHeading = length(headingDelta) > 0.00001 ? 1.0 : 0.0;
    v_forward = v_hasHeading > 0.5 ? normalize(headingDelta) : vec2(0.0, 1.0);
  }
`;

const FRAGMENT_SOURCE = `
  precision mediump float;
  uniform bool u_points;
  uniform float u_alpha;
  varying vec3 v_color;
  varying float v_shape;
  varying vec2 v_forward;
  varying float v_hasHeading;
  void main() {
    float alpha = u_alpha;
    vec3 color = v_color;
    if (u_points) {
      float radius = distance(gl_PointCoord, vec2(0.5));
      vec2 spritePoint = gl_PointCoord - vec2(0.5);
      vec2 headingRight = vec2(v_forward.y, -v_forward.x);
      vec2 p = vec2(dot(spritePoint, headingRight), dot(spritePoint, v_forward));
      bool outside = radius > 0.5;
      if (v_shape > 0.5 && v_shape < 1.5) outside = radius > 0.43;
      if (v_shape > 1.5 && v_shape < 2.5) outside = p.y > 0.4 || p.y < -0.42 || abs(p.x) > (0.42 - p.y) * 0.62;
      if (v_shape > 2.5 && v_shape < 3.5) outside = max(abs(p.x), abs(p.y)) > 0.42;
      if (v_shape > 3.5 && v_shape < 4.5) outside = abs(p.x) > 0.46 || abs(p.y) > 0.28;
      if (v_shape > 4.5 && v_shape < 5.5) outside = abs(p.x) + abs(p.y) > 0.58;
      if (v_shape > 5.5 && v_shape < 6.5) outside = p.y < -0.42 || p.y > 0.42 || abs(p.x) > mix(0.44, 0.24, clamp((p.y + 0.42) / 0.84, 0.0, 1.0));
      if (v_shape > 6.5 && v_shape < 7.5) outside = max(abs(p.x) * 0.86 + abs(p.y) * 0.5, abs(p.y)) > 0.43;
      if (v_shape > 7.5 && v_shape < 8.5) outside = max(abs(p.x), abs(p.y)) > 0.43 || abs(p.x) + abs(p.y) > 0.68;
      if (v_shape > 8.5 && v_shape < 9.5) outside = max(abs(p.x), abs(p.y)) > 0.45 || abs(abs(p.x) - abs(p.y)) > 0.13;
      if (v_shape > 9.5 && v_shape < 10.5) outside = max(abs(p.x), abs(p.y)) > 0.46 || (abs(p.x) > 0.12 && abs(p.y) > 0.12);
      if (v_shape > 10.5) outside = radius > 0.48 || radius < 0.24;
      if (outside) discard;
      alpha *= smoothstep(0.5, 0.08, radius);
      color = mix(v_color, vec3(1.0), smoothstep(0.3, 0.0, radius));
      color = mix(color, vec3(1.0), smoothstep(0.12, 0.42, p.y) * 0.72 * v_hasHeading);
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

const ACTIVE_FRAME_INTERVAL_MS = 1000 / 30;
const HEIGHT_GUIDE_FADE_MS = 240;
const MINIMUM_ORIGIN_GRID_EXTENT = 3_000;
const MINIMUM_ORIGIN_GRID_STEP = 500;
const STRATEGIC_DOT_PPU = 0.95;
const MODEL_DETAIL_PPU = 2.25;

export type TacticalFidelity = "strategic" | "transition" | "model";
export type TacticalCameraMode = "player" | "rts" | "selection";

export interface TacticalTooltip {
  name: string;
  shipCategory?: string;
  distance: number;
  memberCount?: number;
  groupSummary?: string;
  worldPosition: Vector3;
  hull?: { current?: number; maximum?: number };
  shields?: { current?: number; maximum?: number };
  x: number;
  y: number;
}

export interface ClusterLabel {
  id: string;
  count: number;
  summary: string;
  distance: number;
  worldPosition: Vector3;
  x: number;
  y: number;
}

export interface CourseLabel {
  worldPosition: Vector3;
  x: number;
  y: number;
}

export interface PlayerShipLabel {
  x: number;
  y: number;
}

export interface TacticalEngineCallbacks {
  onSelect(id: string | null): void;
  onTooltip(tooltip: TacticalTooltip | null): void;
  onClusterLabels(labels: ClusterLabel[]): void;
  onCourseLabel(label: CourseLabel | null): void;
  onPlayerShipLabel(label: PlayerShipLabel | null): void;
  onFidelityChange(mode: TacticalFidelity): void;
  onCameraModeChange(mode: TacticalCameraMode): void;
  onMovementVector(vector: Vector3): void;
  onMovementCommit(): void;
  onMovementCancel(): void;
}

interface DragState { x: number; y: number; moved: boolean; button: number }
interface ElevationDragState { pointerY: number; elevation: number }
interface SavedCameraState {
  mode: TacticalCameraMode;
  targetId: string | null;
  focus: Vector3;
  freeFocusWorld: Vector3;
  yaw: number;
  pitch: number;
  distance: number;
  targetYaw: number;
  targetPitch: number;
  targetDistance: number;
}
interface CombatEffect {
  id: number;
  type: "projectile" | "launch" | "impact";
  weapon: WeaponType;
  targetName: string;
  start: number;
  duration: number;
  from: Vector3;
  to: Vector3;
  outcome?: "hit" | "miss";
}
interface JumpEffect {
  id: number;
  start: number;
  duration: number;
  origin: Vector3;
  direction: Vector3;
}

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
  private readonly landmarkBuffer: WebGLBuffer;
  private readonly shipMeshBuffer: WebGLBuffer;
  private readonly courseBuffer: WebGLBuffer;
  private readonly heightGuideBuffer: WebGLBuffer;
  private readonly radarSurfaceBuffer: WebGLBuffer;
  private readonly radarWireBuffer: WebGLBuffer;
  private readonly originGridBuffer: WebGLBuffer;
  private readonly combatLineBuffer: WebGLBuffer;
  private readonly combatPointBuffer: WebGLBuffer;
  private readonly selectionBuffer: WebGLBuffer;
  private readonly program: WebGLProgram;
  private readonly resizeObserver: ResizeObserver;
  private readonly locations: {
    position: number;
    color: number;
    size: number;
    shape: number;
    heading: number;
    matrix: WebGLUniformLocation | null;
    pixelRatio: WebGLUniformLocation | null;
    markerScale: WebGLUniformLocation | null;
    points: WebGLUniformLocation | null;
    alpha: WebGLUniformLocation | null;
  };
  private scene: TacticalScene = buildScene(null);
  private viewProjection = new Float32Array(16);
  private pointCount = 0;
  private landmarkCount = 0;
  private shipMeshCount = 0;
  private courseCount = 0;
  private heightGuideCount = 0;
  private radarSurfaceCount = 0;
  private radarWireCount = 0;
  private originGridCount = 0;
  private combatLineCount = 0;
  private combatPointCount = 0;
  private selectionCount = 0;
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
  private courseLabelSignature = "";
  private playerShipLabelSignature = "";
  private markerScale = 1;
  private markerReferencePixelsPerUnit = 1;
  private fidelity: TacticalFidelity = "strategic";
  private movementActive = false;
  private movementInteractive = false;
  private movementVector: Vector3 = [100, 0, 0];
  private movementOrigins: Vector3[] = [[0, 0, 0]];
  private lastPointerPosition: { x: number; y: number } | null = null;
  private elevationDrag: ElevationDragState | null = null;
  private heightGuideShown = false;
  private heightGuideFadeStartedAt: number | null = null;
  private cameraMode: TacticalCameraMode = "player";
  private cameraTargetId: string | null = null;
  private cameraFocus: Vector3 = [0, 0, 0];
  private freeFocusWorld: Vector3 = [0, 0, 0];
  private savedCameraState: SavedCameraState | null = null;
  private combatEffects: CombatEffect[] = [];
  private lastCombatEventId = 0;
  private jumpEffects: JumpEffect[] = [];
  private lastJumpEventId = 0;
  private disabledEffectsActive = false;
  private selectedId: string | null = null;

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
      shape: gl.getAttribLocation(this.program, "a_shape"),
      heading: gl.getAttribLocation(this.program, "a_heading"),
      matrix: gl.getUniformLocation(this.program, "u_viewProjection"),
      pixelRatio: gl.getUniformLocation(this.program, "u_pixelRatio"),
      markerScale: gl.getUniformLocation(this.program, "u_markerScale"),
      points: gl.getUniformLocation(this.program, "u_points"),
      alpha: gl.getUniformLocation(this.program, "u_alpha"),
    };
    this.pointBuffer = requireBuffer(gl);
    this.landmarkBuffer = requireBuffer(gl);
    this.shipMeshBuffer = requireBuffer(gl);
    this.courseBuffer = requireBuffer(gl);
    this.heightGuideBuffer = requireBuffer(gl);
    this.radarSurfaceBuffer = requireBuffer(gl);
    this.radarWireBuffer = requireBuffer(gl);
    this.originGridBuffer = requireBuffer(gl);
    this.combatLineBuffer = requireBuffer(gl);
    this.combatPointBuffer = requireBuffer(gl);
    this.selectionBuffer = requireBuffer(gl);
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
    const wasFirstSnapshot = this.firstSnapshot;
    if (this.firstSnapshot) {
      this.interpolator.setTarget(nextScene, now, 0);
      this.scene = nextScene;
      this.camera.fit(this.fitRadius(), true);
      this.updateMarkerReference();
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
    if (radarRangeBecameAvailable && !wasFirstSnapshot) {
      this.camera.fit(this.fitRadius());
      this.updateMarkerReference();
    }
    this.requestRender();
  }

  fitSystem(): void {
    this.camera.fit(this.fitRadius());
    this.updateMarkerReference();
    this.requestRender();
  }

  sectorView(): void {
    this.camera.fit(this.fitRadius());
    const strategicDistance = Math.max(1, this.canvas.clientHeight) / (2 * STRATEGIC_DOT_PPU);
    this.camera.targetDistance = Math.max(this.camera.targetDistance, strategicDistance);
    this.updateMarkerReference();
    this.requestRender();
  }

  setRadarBubbleEnabled(enabled: boolean): void {
    this.radarBubbleEnabled = enabled;
    this.requestRender();
  }

  setOriginGridEnabled(enabled: boolean): void {
    this.originGridEnabled = enabled;
    this.requestRender();
  }

  setSelectedId(id: string | null): void {
    this.selectedId = id;
    this.rebuildSelectionBuffer(performance.now());
    this.requestRender();
  }

  resetOrientation(): void {
    this.camera.resetOrientation();
    this.requestRender();
  }

  setCameraMode(mode: TacticalCameraMode, targetId?: string): void {
    if (mode === "selection" && !this.findPointById(targetId)) return;
    if (mode === "rts" && this.cameraMode !== "rts") {
      this.freeFocusWorld = this.cameraFocus.map(
        (value, index) => value - this.originOffset[index],
      ) as Vector3;
    }
    this.cameraMode = mode;
    this.cameraTargetId = mode === "selection" ? targetId || null : null;
    this.callbacks.onCameraModeChange(mode);
    this.requestRender();
  }

  beginMovementPlanning(vector: Vector3, interactive: boolean, origins: Vector3[] = [[0, 0, 0]]): void {
    if (!this.savedCameraState) {
      this.savedCameraState = {
        mode: this.cameraMode,
        targetId: this.cameraTargetId,
        focus: [...this.cameraFocus],
        freeFocusWorld: [...this.freeFocusWorld],
        yaw: this.camera.yaw,
        pitch: this.camera.pitch,
        distance: this.camera.distance,
        targetYaw: this.camera.targetYaw,
        targetPitch: this.camera.targetPitch,
        targetDistance: this.camera.targetDistance,
      };
    }
    this.movementOrigins = this.uniqueOrigins(origins);
    this.movementActive = true;
    this.movementInteractive = interactive;
    this.movementVector = [...vector];
    this.hideHeightGuide();
    const center = this.movementCenter();
    this.cameraMode = "rts";
    this.cameraTargetId = null;
    this.freeFocusWorld = center.map((value, index) => value - this.originOffset[index]) as Vector3;
    this.callbacks.onCameraModeChange("rts");
    this.rebuildCourseBuffer();
    this.requestRender();
  }

  finishMovementPlanning(): void {
    this.movementActive = false;
    this.movementInteractive = false;
    this.hideHeightGuide();
    this.callbacks.onCourseLabel(null);
    const saved = this.savedCameraState;
    this.savedCameraState = null;
    if (saved) {
      this.cameraMode = saved.mode;
      this.cameraTargetId = saved.targetId;
      this.cameraFocus = [...saved.focus];
      this.freeFocusWorld = [...saved.freeFocusWorld];
      this.camera.yaw = saved.yaw;
      this.camera.pitch = saved.pitch;
      this.camera.distance = saved.distance;
      this.camera.targetYaw = saved.targetYaw;
      this.camera.targetPitch = saved.targetPitch;
      this.camera.targetDistance = saved.targetDistance;
      this.callbacks.onCameraModeChange(saved.mode);
    }
    this.rebuildCourseBuffer();
    this.requestRender();
  }

  setMovementActive(active: boolean, vector: Vector3 = this.movementVector, interactive = true): void {
    this.movementActive = active;
    this.movementInteractive = active && interactive;
    this.movementVector = [...vector];
    if (!this.movementInteractive) this.hideHeightGuide();
    this.rebuildCourseBuffer();
    this.requestRender();
  }

  freezeMovement(): void {
    this.movementInteractive = false;
    this.endElevationAdjustment();
  }

  pushCombatEvent(event: CombatEvent): void {
    if (!event.id || event.id <= this.lastCombatEventId
        || event.type === "charged" || event.type === "failure") return;
    this.lastCombatEventId = event.id;
    const target = this.findPointByName(event.targetName);
    const now = performance.now();
    if (event.type === "launch") {
      const projectile = ["missile", "torpedo", "rocket", "burst"].includes(event.weapon);
      const observer = this.scene.points.find((point) => point.kind === "observer") ?? null;
      const namedSource = this.findPointByName(event.sourceName);
      const sourceIsObserver = event.sourceName && observer
        && event.sourceName.trim().toLowerCase() === observer.name.trim().toLowerCase();
      const source = namedSource ?? (!event.sourceName || sourceIsObserver ? observer : null);
      if (!source) return;
      if (!projectile && !target) return;
      const sourcePosition: Vector3 = [...(source?.position3d ?? [0, 0, 0])];
      const heading = source?.heading;
      const headingVector: Vector3 = [
        Number(heading?.x) || 0,
        Number(heading?.y) || 0,
        Number(heading?.z) || 0,
      ];
      if (Math.hypot(...headingVector) < 0.001) headingVector[2] = 1;
      const launchDirectionTarget: Vector3 = target
        ? [...target.position3d]
        : sourcePosition.map((coordinate, index) => coordinate + headingVector[index] * 100) as Vector3;
      this.combatEffects.push({
        id: event.id,
        type: projectile ? "launch" : "projectile",
        weapon: event.weapon,
        targetName: target?.name || event.targetName || "",
        start: now,
        duration: projectile ? 460 : 1_100,
        from: sourcePosition,
        to: projectile ? launchDirectionTarget
          : [...(target?.position3d ?? [0, 0, 0])],
      });
    } else if (event.type === "impact") {
      if (!target) return;
      const confirmedHits = Math.max(1, Math.min(12, Number(event.count) || 1));
      for (let index = 0; index < confirmedHits; index += 1) {
        this.combatEffects.push({
          id: event.id * 100 + index,
          type: "impact",
          weapon: event.weapon,
          targetName: target.name,
          start: now + index * 85,
          duration: 780,
          from: [0, 0, 0],
          to: [...target.position3d],
          outcome: event.outcome,
        });
      }
    }
    this.requestRender();
  }

  pushJumpEvent(event: ShipJumpEvent): void {
    if (!event.id || event.id <= this.lastJumpEventId || event.phase !== "departure") return;
    this.lastJumpEventId = event.id;
    const ship = this.findPointByName(event.shipName);
    if (!ship) return;
    const rawDirection: Vector3 = [
      Number(ship.heading?.x) || 0,
      Number(ship.heading?.y) || 0,
      Number(ship.heading?.z) || 0,
    ];
    const length = Math.hypot(...rawDirection);
    const direction = length > 0.001
      ? rawDirection.map((value) => value / length) as Vector3
      : [0, 0, 1] as Vector3;
    this.jumpEffects.push({
      id: event.id,
      start: performance.now(),
      duration: 1_350,
      origin: [...ship.position3d],
      direction,
    });
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    if (this.frameTimer !== null) clearTimeout(this.frameTimer);
    this.resizeObserver.disconnect();
    this.unbindEvents();
    this.gl.deleteBuffer(this.pointBuffer);
    this.gl.deleteBuffer(this.landmarkBuffer);
    this.gl.deleteBuffer(this.shipMeshBuffer);
    this.gl.deleteBuffer(this.courseBuffer);
    this.gl.deleteBuffer(this.heightGuideBuffer);
    this.gl.deleteBuffer(this.radarSurfaceBuffer);
    this.gl.deleteBuffer(this.radarWireBuffer);
    this.gl.deleteBuffer(this.originGridBuffer);
    this.gl.deleteBuffer(this.combatLineBuffer);
    this.gl.deleteBuffer(this.combatPointBuffer);
    this.gl.deleteBuffer(this.selectionBuffer);
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

  private interleavedVertex(
    position: Vector3,
    color: Color3,
    size = 1,
    shape = 0,
    heading: Vector3 = [0, 0, 0],
  ): number[] {
    return [...position, ...color, size, shape, ...heading];
  }

  private upload(buffer: WebGLBuffer, values: number[], usage: number = this.gl.STATIC_DRAW): void {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(values), usage);
  }

  private headingFor(point: ScenePoint): Vector3 {
      const heading = point.heading;
    return heading && typeof heading === "object"
        ? [Number(heading.x) || 0, Number(heading.y) || 0, Number(heading.z) || 0]
        : [0, 0, 0];
  }

  private rebuildPointBuffers(): void {
    const tacticalPoints = this.scene.points.filter((point) => point.kind !== "projectile");
    const strategic = tacticalPoints.flatMap((point) => {
      const size = point.kind === "cluster" ? Math.min(18, point.pointSize)
        : point.kind === "observer" ? 8 : 5;
      return this.interleavedVertex(
        point.position3d, point.color, size, 0, this.headingFor(point),
      );
    });
    const landmarks = this.scene.points
      .filter((point) => !["ship", "observer", "projectile"].includes(point.kind))
      .flatMap((point) => this.interleavedVertex(
        point.position3d, point.color, point.pointSize, 0, this.headingFor(point),
      ));
    this.pointCount = tacticalPoints.length;
    this.landmarkCount = landmarks.length / 11;
    this.upload(this.pointBuffer, strategic, this.gl.DYNAMIC_DRAW);
    this.upload(this.landmarkBuffer, landmarks, this.gl.DYNAMIC_DRAW);
  }

  private rebuildShipMeshBuffer(): void {
    const vertices: number[] = [];
    const light: Vector3 = [0.35, 0.72, 0.6];
    for (const point of this.scene.points) {
      if (!["ship", "observer"].includes(point.kind)) continue;
      const model = shipModelFor(point.shipCategory);
      const heading = this.headingFor(point);
      const magnitude = Math.hypot(...heading);
      const forward: Vector3 = magnitude > 0.0001
        ? heading.map((value) => value / magnitude) as Vector3
        : [0, 0, 1];
      const referenceUp: Vector3 = Math.abs(forward[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const right: Vector3 = [
        referenceUp[1] * forward[2] - referenceUp[2] * forward[1],
        referenceUp[2] * forward[0] - referenceUp[0] * forward[2],
        referenceUp[0] * forward[1] - referenceUp[1] * forward[0],
      ];
      const rightLength = Math.max(0.0001, Math.hypot(...right));
      right.forEach((value, index) => { right[index] = value / rightLength; });
      const up: Vector3 = [
        forward[1] * right[2] - forward[2] * right[1],
        forward[2] * right[0] - forward[0] * right[2],
        forward[0] * right[1] - forward[1] * right[0],
      ];
      const world = (local: Vector3): Vector3 => [
        point.position3d[0] + model.scale * (right[0] * local[0] + up[0] * local[1] + forward[0] * local[2]),
        point.position3d[1] + model.scale * (right[1] * local[0] + up[1] * local[1] + forward[1] * local[2]),
        point.position3d[2] + model.scale * (right[2] * local[0] + up[2] * local[1] + forward[2] * local[2]),
      ];
      for (let index = 0; index < model.triangles.length; index += 3) {
        const a = world(model.triangles[index]);
        const b = world(model.triangles[index + 1]);
        const c = world(model.triangles[index + 2]);
        const ab: Vector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac: Vector3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const normal: Vector3 = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const normalLength = Math.max(0.0001, Math.hypot(...normal));
        const diffuse = Math.abs((normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]) / normalLength);
        const brightness = 0.36 + diffuse * 0.64;
        const color = point.color.map((channel) => Math.min(1, channel * 0.35 + brightness * 0.62)) as Color3;
        vertices.push(
          ...this.interleavedVertex(a, color),
          ...this.interleavedVertex(b, color),
          ...this.interleavedVertex(c, color),
        );
      }
    }
    this.shipMeshCount = vertices.length / 11;
    this.upload(this.shipMeshBuffer, vertices, this.gl.DYNAMIC_DRAW);
  }

  private rebuildCourseBuffer(): void {
    const vertices: number[] = [];
    if (this.movementActive) {
      const color: Color3 = [0.2, 0.72, 1];
      const pushLine = (from: Vector3, to: Vector3, lineColor: Color3 = color): void => {
        vertices.push(...this.interleavedVertex(from, lineColor), ...this.interleavedVertex(to, lineColor));
      };
      const destination = formationDestination(this.movementOrigins, this.movementVector);
      for (const origin of this.movementOrigins) {
        const offset = destination.map((value, index) => value - origin[index]) as Vector3;
        const exactLength = Math.hypot(...offset);
        if (exactLength < 0.0001) continue;
        const length = Math.max(1, exactLength);
        const direction = offset.map((value) => value / exactLength) as Vector3;
        const reference: Vector3 = Math.abs(direction[1]) > 0.85 ? [1, 0, 0] : [0, 1, 0];
        const side: Vector3 = [
          direction[1] * reference[2] - direction[2] * reference[1],
          direction[2] * reference[0] - direction[0] * reference[2],
          direction[0] * reference[1] - direction[1] * reference[0],
        ];
        const sideLength = Math.max(0.0001, Math.hypot(...side));
        side.forEach((value, index) => { side[index] = value / sideLength; });
        const headLength = Math.min(length * 0.24, Math.max(12, this.camera.distance * 0.055));
        const headWidth = headLength * 0.5;
        const base = destination.map((value, index) => value - direction[index] * headLength) as Vector3;
        const left = base.map((value, index) => value + side[index] * headWidth) as Vector3;
        const right = base.map((value, index) => value - side[index] * headWidth) as Vector3;
        pushLine(origin, destination);
        pushLine(destination, left);
        pushLine(destination, right);
      }
    }
    this.courseCount = vertices.length / 11;
    this.upload(this.courseBuffer, vertices, this.gl.DYNAMIC_DRAW);
  }

  private rebuildHeightGuideBuffer(): void {
    const vertices: number[] = [];
    if (this.movementActive && this.heightGuideShown) {
      const origin = this.movementCenter();
      const endpoint: Vector3 = origin.map(
        (value, index) => value + this.movementVector[index],
      ) as Vector3;
      const guideColor: Color3 = [0.32, 0.88, 1];
      const markerColor: Color3 = [0.62, 0.94, 1];
      const margin = Math.max(12, this.camera.distance * 0.08);
      const lowerY = Math.min(origin[1], endpoint[1], this.cameraFocus[1] - this.camera.distance) - margin;
      const upperY = Math.max(origin[1], endpoint[1], this.cameraFocus[1] + this.camera.distance) + margin;
      const guideStart: Vector3 = [endpoint[0], lowerY, endpoint[2]];
      const guideEnd: Vector3 = [endpoint[0], upperY, endpoint[2]];
      vertices.push(
        ...this.interleavedVertex(guideStart, guideColor),
        ...this.interleavedVertex(guideEnd, guideColor),
      );

      // Camera-right stays horizontal on screen, keeping the current-Y marker
      // easy to read even while the tactical camera is orbited.
      const markerHalfWidth = Math.max(7, this.camera.distance * 0.035);
      const cameraRight: Vector3 = [Math.cos(this.camera.yaw), 0, -Math.sin(this.camera.yaw)];
      const markerLeft = endpoint.map(
        (value, index) => value - cameraRight[index] * markerHalfWidth,
      ) as Vector3;
      const markerRight = endpoint.map(
        (value, index) => value + cameraRight[index] * markerHalfWidth,
      ) as Vector3;
      vertices.push(
        ...this.interleavedVertex(markerLeft, markerColor),
        ...this.interleavedVertex(markerRight, markerColor),
      );

      // Retain the existing ground ring as the base of the relocated guide.
      const ground: Vector3 = [endpoint[0], origin[1], endpoint[2]];
      const ringSize = Math.max(6, markerHalfWidth * 0.55);
      for (let index = 0; index < 20; index += 1) {
        const a = index / 20 * Math.PI * 2;
        const b = (index + 1) / 20 * Math.PI * 2;
        vertices.push(
          ...this.interleavedVertex(
            [ground[0] + Math.cos(a) * ringSize, ground[1], ground[2] + Math.sin(a) * ringSize],
            guideColor,
          ),
          ...this.interleavedVertex(
            [ground[0] + Math.cos(b) * ringSize, ground[1], ground[2] + Math.sin(b) * ringSize],
            guideColor,
          ),
        );
      }
    }
    this.heightGuideCount = vertices.length / 11;
    this.upload(this.heightGuideBuffer, vertices, this.gl.DYNAMIC_DRAW);
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

    this.radarSurfaceCount = surface.length / 11;
    this.radarWireCount = wire.length / 11;
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

    this.originGridCount = grid.length / 11;
    this.upload(this.originGridBuffer, grid);
  }

  private findPointByName(name?: string): ScenePoint | null {
    if (!name) return null;
    const wanted = name.trim().toLowerCase();
    for (const point of this.scene.points) {
      if ((point.name || "").trim().toLowerCase() === wanted) return point;
      const member = point.members?.find((candidate) =>
        (candidate.name || "").trim().toLowerCase() === wanted);
      if (member) return member;
    }
    return null;
  }

  private findPointById(id?: string): ScenePoint | null {
    if (!id) return null;
    for (const point of this.scene.points) {
      if (point.id === id) return point;
      const member = point.members?.find((candidate) => candidate.id === id);
      if (member) return member;
    }
    return null;
  }

  private uniqueOrigins(origins: Vector3[]): Vector3[] {
    const unique = new Map<string, Vector3>();
    for (const origin of origins.length > 0 ? origins : [[0, 0, 0] as Vector3]) {
      const safe = origin.map((value) => Number.isFinite(value) ? value : 0) as Vector3;
      unique.set(safe.join(":"), safe);
    }
    return [...unique.values()];
  }

  private movementCenter(): Vector3 {
    return formationCenter(this.movementOrigins);
  }

  private cameraTarget(): Vector3 {
    if (this.cameraMode === "selection") {
      const selected = this.findPointById(this.cameraTargetId || undefined);
      if (selected) return [...selected.position3d];
      this.cameraMode = "player";
      this.cameraTargetId = null;
      this.callbacks.onCameraModeChange("player");
    }
    if (this.cameraMode === "rts") {
      return this.freeFocusWorld.map((value, index) => value + this.originOffset[index]) as Vector3;
    }
    return [0, 0, 0];
  }

  private weaponColor(weapon: WeaponType): Color3 {
    if (weapon === "ion") return [0.3, 0.72, 1];
    if (weapon === "missile") return [1, 0.62, 0.12];
    if (weapon === "torpedo") return [0.72, 0.3, 1];
    if (weapon === "rocket") return [1, 0.14, 0.06];
    if (weapon === "burst") return [1, 0.25, 0.74];
    if (weapon === "turbolaser") return [0.3, 1, 0.42];
    return [1, 0.18, 0.2];
  }

  private projectileWeapon(point: ScenePoint): WeaponType {
    const identity = `${point.class || ""} ${point.name || ""}`.toLowerCase();
    if (identity.includes("torpedo")) return "torpedo";
    if (identity.includes("rocket")) return "rocket";
    if (identity.includes("pulse") || identity.includes("burst")) return "burst";
    return "missile";
  }

  private disabledShips(): ScenePoint[] {
    const points = this.scene.points.flatMap((point) => point.members ?? [point]);
    return points.filter((point) => ["ship", "observer"].includes(point.kind)
      && String(point.condition || "").trim().toLowerCase() === "disabled");
  }

  private appendDisabledShipEffects(now: number, lines: number[], points: number[]): void {
    const disabledShips = this.disabledShips();
    this.disabledEffectsActive = disabledShips.length > 0;
    const hash = (value: string): number => {
      let result = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
      }
      return (result >>> 0) / 4294967295;
    };

    for (const ship of disabledShips) {
      const modelScale = shipModelFor(ship.shipCategory).scale;
      const shipSeed = hash(ship.id || ship.name);
      const fireSites = modelScale >= 3 ? 3 : modelScale >= 1.5 ? 2 : 1;
      for (let site = 0; site < fireSites; site += 1) {
        const siteSeed = hash(`${ship.id}:${site}`);
        const siteAngle = siteSeed * Math.PI * 2;
        const siteRadius = modelScale * (0.18 + (site % 2) * 0.16);
        const origin: Vector3 = [
          ship.position3d[0] + Math.cos(siteAngle) * siteRadius,
          ship.position3d[1] + modelScale * (0.08 + siteSeed * 0.12),
          ship.position3d[2] + Math.sin(siteAngle) * siteRadius,
        ];
        const pulse = 0.72 + Math.sin(now * 0.014 + siteSeed * 19) * 0.28;
        points.push(...this.interleavedVertex(origin, [0.28, 0.035, 0.005], 30 * pulse));
        points.push(...this.interleavedVertex(origin, [1, 0.2, 0.015], 13 * pulse));
        points.push(...this.interleavedVertex(
          [origin[0], origin[1] + modelScale * 0.14, origin[2]],
          [1, 0.72, 0.08], 7 * pulse,
        ));

        for (let ember = 0; ember < 7; ember += 1) {
          const emberSeed = hash(`${ship.id}:${site}:${ember}`);
          const speed = 0.42 + emberSeed * 0.55;
          const progress = (now / 1000 * speed + emberSeed * 7.31 + shipSeed) % 1;
          const angle = emberSeed * Math.PI * 8 + progress * 1.4;
          const spread = modelScale * (0.08 + progress * 0.42);
          const rise = modelScale * (0.18 + progress * 1.35);
          const emberPoint: Vector3 = [
            origin[0] + Math.cos(angle) * spread,
            origin[1] + rise,
            origin[2] + Math.sin(angle) * spread,
          ];
          const tail: Vector3 = [
            emberPoint[0] - Math.cos(angle) * modelScale * 0.05,
            emberPoint[1] - modelScale * (0.12 + progress * 0.12),
            emberPoint[2] - Math.sin(angle) * modelScale * 0.05,
          ];
          const emberColor: Color3 = progress < 0.32
            ? [1, 0.86, 0.2]
            : progress < 0.72 ? [1, 0.28, 0.025] : [0.72, 0.055, 0.008];
          lines.push(...this.interleavedVertex(tail, emberColor),
            ...this.interleavedVertex(emberPoint, emberColor));
          points.push(...this.interleavedVertex(emberPoint, emberColor,
            Math.max(2, 8 * (1 - progress))));
        }
      }

      // Intermittent white-blue arcs make the effect read as a systems failure,
      // rather than an ordinary weapon impact that happens to linger.
      const arcPhase = (now / 520 + shipSeed * 13) % 1;
      if (arcPhase < 0.32) {
        const arcColor: Color3 = [0.55, 0.86, 1];
        const arcRadius = modelScale * 0.62;
        const start: Vector3 = [
          ship.position3d[0] - arcRadius,
          ship.position3d[1] + modelScale * 0.2,
          ship.position3d[2],
        ];
        const middle: Vector3 = [
          ship.position3d[0] + modelScale * (arcPhase - 0.16),
          ship.position3d[1] + modelScale * (0.42 + arcPhase),
          ship.position3d[2] + modelScale * 0.22,
        ];
        const end: Vector3 = [
          ship.position3d[0] + arcRadius,
          ship.position3d[1] + modelScale * 0.12,
          ship.position3d[2] - modelScale * 0.08,
        ];
        lines.push(
          ...this.interleavedVertex(start, arcColor), ...this.interleavedVertex(middle, arcColor),
          ...this.interleavedVertex(middle, arcColor), ...this.interleavedVertex(end, arcColor),
        );
      }
    }
  }

  private rebuildSelectionBuffer(now: number): void {
    const vertices: number[] = [];
    const selected = this.findPointById(this.selectedId || undefined);
    if (selected && ["ship", "observer"].includes(selected.kind)) {
      const center = selected.position3d;
      const modelScale = shipModelFor(selected.shipCategory).scale;
      const radius = Math.max(modelScale * 1.85, this.camera.distance * 0.018);
      const segments = 72;
      const appendRing = (ringRadius: number, color: Color3, rotation = 0,
          fromSegment = 0, toSegment = segments): void => {
        for (let segment = fromSegment; segment < toSegment; segment += 1) {
          const start = rotation + segment / segments * Math.PI * 2;
          const end = rotation + (segment + 1) / segments * Math.PI * 2;
          vertices.push(
            ...this.interleavedVertex([
              center[0] + Math.cos(start) * ringRadius,
              center[1],
              center[2] + Math.sin(start) * ringRadius,
            ], color),
            ...this.interleavedVertex([
              center[0] + Math.cos(end) * ringRadius,
              center[1],
              center[2] + Math.sin(end) * ringRadius,
            ], color),
          );
        }
      };

      // A doubled outer border stays crisp at strategic zoom. Successively
      // dimmer inner rings create an additive glow that falls toward the hull.
      appendRing(radius, [1, 0.67, 0.13]);
      appendRing(radius * 0.975, [0.82, 0.39, 0.045]);
      appendRing(radius * 0.86, [0.42, 0.17, 0.018]);
      appendRing(radius * 0.72, [0.23, 0.075, 0.008]);

      // Two opposed bright sweeps orbit the otherwise solid selection border.
      const rotation = now / 1150 * Math.PI * 2;
      const sweepLength = 10;
      appendRing(radius * 1.035, [1, 0.9, 0.42], rotation, 0, sweepLength);
      appendRing(radius * 1.035, [1, 0.9, 0.42], rotation + Math.PI, 0, sweepLength);

      const bracketColor: Color3 = [1, 0.62, 0.1];
      const bracketInner = radius * 1.08;
      const bracketOuter = radius * 1.24;
      for (let quarter = 0; quarter < 4; quarter += 1) {
        const angle = rotation * 0.18 + quarter * Math.PI / 2;
        vertices.push(
          ...this.interleavedVertex([
            center[0] + Math.cos(angle) * bracketInner, center[1],
            center[2] + Math.sin(angle) * bracketInner,
          ], bracketColor),
          ...this.interleavedVertex([
            center[0] + Math.cos(angle) * bracketOuter, center[1],
            center[2] + Math.sin(angle) * bracketOuter,
          ], bracketColor),
        );
      }
    }
    this.selectionCount = vertices.length / 11;
    this.upload(this.selectionBuffer, vertices, this.gl.DYNAMIC_DRAW);
  }

  private rebuildCombatBuffers(now: number): void {
    const lines: number[] = [];
    const points: number[] = [];
    const lerp = (from: Vector3, to: Vector3, amount: number): Vector3 => [
      from[0] + (to[0] - from[0]) * amount,
      from[1] + (to[1] - from[1]) * amount,
      from[2] + (to[2] - from[2]) * amount,
    ];
    this.combatEffects = this.combatEffects.filter((effect) => now - effect.start < effect.duration);
    for (const effect of this.combatEffects) {
      if (now < effect.start) continue;
      const progress = Math.max(0, Math.min(1, (now - effect.start) / effect.duration));
      const color = effect.outcome === "miss" ? [0.52, 0.72, 0.82] as Color3 : this.weaponColor(effect.weapon);
      const liveTarget = this.findPointByName(effect.targetName);
      const targetPosition = liveTarget?.position3d ?? effect.to;
      const missOffset = effect.outcome === "miss"
        ? Math.max(8, Math.hypot(...targetPosition) * 0.045)
        : 0;
      const endpoint: Vector3 = [
        targetPosition[0] + missOffset,
        targetPosition[1] + missOffset * 0.35,
        targetPosition[2],
      ];
      if (effect.type === "launch") {
        const delta: Vector3 = endpoint.map((value, index) => value - effect.from[index]) as Vector3;
        const targetDistance = Math.hypot(...delta);
        const direction: Vector3 = targetDistance > 0.001
          ? delta.map((value) => value / targetDistance) as Vector3
          : [0, 0, 1];
        const reference: Vector3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const rightRaw: Vector3 = [
          direction[1] * reference[2] - direction[2] * reference[1],
          direction[2] * reference[0] - direction[0] * reference[2],
          direction[0] * reference[1] - direction[1] * reference[0],
        ];
        const rightLength = Math.hypot(...rightRaw) || 1;
        const right = rightRaw.map((value) => value / rightLength) as Vector3;
        const up: Vector3 = [
          right[1] * direction[2] - right[2] * direction[1],
          right[2] * direction[0] - right[0] * direction[2],
          right[0] * direction[1] - right[1] * direction[0],
        ];
        const burstLength = Math.max(14, Math.min(60, targetDistance * 0.08));
        const eased = 1 - (1 - progress) ** 3;
        const headDistance = burstLength * eased;
        const tailProgress = Math.max(0, (progress - 0.24) / 0.76);
        const tailDistance = burstLength * tailProgress * tailProgress;
        const tail = effect.from.map((value, index) =>
          value + direction[index] * tailDistance) as Vector3;
        const head = effect.from.map((value, index) =>
          value + direction[index] * headDistance) as Vector3;
        const spread = Math.sin(progress * Math.PI) * Math.min(7, burstLength * 0.16);
        const rays = 5;
        for (let index = 0; index < rays; index += 1) {
          const angle = index / rays * Math.PI * 2;
          const rayScale = index === 0 ? 0 : 0.55 + (index % 2) * 0.35;
          const rayHead: Vector3 = head.map((value, axis) => value
            + right[axis] * Math.cos(angle) * spread * rayScale
            + up[axis] * Math.sin(angle) * spread * rayScale) as Vector3;
          lines.push(...this.interleavedVertex(tail, color),
            ...this.interleavedVertex(rayHead, color));
        }
        const glow = color.map((channel) => channel * 0.3) as Color3;
        points.push(...this.interleavedVertex(head, glow, 26));
        points.push(...this.interleavedVertex(head, color, 11));
      } else if (effect.type === "projectile") {
        const eased = 1 - (1 - progress) ** 2;
        const head = lerp(effect.from, endpoint, Math.min(0.96, eased));
        const tail = lerp(effect.from, endpoint, Math.max(0, eased - 0.13));
        const strategicProjectile = ["missile", "torpedo", "rocket", "burst"].includes(effect.weapon);
        const coreSize = effect.weapon === "torpedo" ? 14
          : effect.weapon === "missile" ? 13
            : effect.weapon === "rocket" ? 11 : effect.weapon === "burst" ? 10 : 8;
        const glowColor = color.map((channel) => channel * 0.28) as Color3;
        lines.push(...this.interleavedVertex(tail, color), ...this.interleavedVertex(head, color));
        if (strategicProjectile) {
          points.push(...this.interleavedVertex(head, glowColor, coreSize * 2.35));
        }
        points.push(...this.interleavedVertex(head, color, coreSize));
      } else {
        const explosive = ["missile", "torpedo", "rocket", "burst"].includes(effect.weapon);
        const radius = Math.sin(progress * Math.PI)
          * (effect.outcome === "hit" ? explosive ? 38 : 24 : 14);
        const segments = 16;
        for (let index = 0; index < segments; index += 1) {
          const a = index / segments * Math.PI * 2;
          const b = (index + 1) / segments * Math.PI * 2;
          const start: Vector3 = [endpoint[0] + Math.cos(a) * radius, endpoint[1] + Math.sin(a) * radius, endpoint[2]];
          const end: Vector3 = [endpoint[0] + Math.cos(b) * radius, endpoint[1] + Math.sin(b) * radius, endpoint[2]];
          lines.push(...this.interleavedVertex(start, color), ...this.interleavedVertex(end, color));
        }
        points.push(...this.interleavedVertex(endpoint, color,
          effect.outcome === "hit" ? explosive ? 26 : 18 : 8));
      }
    }
    this.jumpEffects = this.jumpEffects.filter((effect) => now - effect.start < effect.duration);
    for (const effect of this.jumpEffects) {
      const progress = Math.max(0, Math.min(1, (now - effect.start) / effect.duration));
      const eased = 1 - (1 - progress) ** 3;
      const length = 35 + eased * 220;
      const tail = effect.origin.map((value, axis) =>
        value + effect.direction[axis] * length * Math.max(0, progress - 0.3)) as Vector3;
      const head = effect.origin.map((value, axis) =>
        value + effect.direction[axis] * length) as Vector3;
      const color: Color3 = [0.54, 0.76, 1];
      for (let ray = -3; ray <= 3; ray += 1) {
        const spread = Math.sin(progress * Math.PI) * ray * 1.8;
        const rayHead: Vector3 = [head[0] + spread, head[1] + Math.abs(ray) * 0.45, head[2]];
        lines.push(...this.interleavedVertex(tail, color), ...this.interleavedVertex(rayHead, color));
      }
      const glow: Color3 = [0.18, 0.3, 0.48];
      points.push(...this.interleavedVertex(head, glow, 42 * (1 - progress * 0.55)));
      points.push(...this.interleavedVertex(head, color, 16 * (1 - progress * 0.45)));
    }
    for (const point of this.scene.points) {
      if (point.kind !== "projectile") continue;
      const weapon = this.projectileWeapon(point);
      const color = this.weaponColor(weapon);
      const distance = Math.hypot(...point.position3d);
      const trailLength = Math.max(5, Math.min(55, distance * 0.045));
      const direction: Vector3 = distance > 0.0001
        ? point.position3d.map((value) => value / distance) as Vector3
        : [0, 0, 1];
      const tail: Vector3 = [
        point.position3d[0] - direction[0] * trailLength,
        point.position3d[1] - direction[1] * trailLength,
        point.position3d[2] - direction[2] * trailLength,
      ];
      const glow = color.map((channel) => channel * 0.28) as Color3;
      lines.push(...this.interleavedVertex(tail, color),
        ...this.interleavedVertex(point.position3d, color));
      points.push(...this.interleavedVertex(point.position3d, glow, 30));
      points.push(...this.interleavedVertex(point.position3d, color, 13));
    }
    this.appendDisabledShipEffects(now, lines, points);
    this.combatLineCount = lines.length / 11;
    this.combatPointCount = points.length / 11;
    this.upload(this.combatLineBuffer, lines, this.gl.DYNAMIC_DRAW);
    this.upload(this.combatPointBuffer, points, this.gl.DYNAMIC_DRAW);
  }

  private rebuildBuffers(): void {
    this.rebuildPointBuffers();
    this.rebuildShipMeshBuffer();
    this.rebuildCourseBuffer();
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

  private updateMarkerReference(): void {
    const fitPixelsPerUnit = Math.max(1, this.canvas.clientHeight) / (2 * this.camera.targetDistance);
    this.markerReferencePixelsPerUnit = Math.max(
      0.01,
      Math.min(DEFAULT_PIXELS_PER_DISTANCE_UNIT, fitPixelsPerUnit),
    );
  }

  private bindAttributes(buffer: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 11 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.locations.color);
    gl.vertexAttribPointer(this.locations.color, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(this.locations.size);
    gl.vertexAttribPointer(this.locations.size, 1, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(this.locations.shape);
    gl.vertexAttribPointer(this.locations.shape, 1, gl.FLOAT, false, stride, 7 * 4);
    gl.enableVertexAttribArray(this.locations.heading);
    gl.vertexAttribPointer(this.locations.heading, 3, gl.FLOAT, false, stride, 8 * 4);
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
    const cameraTarget = this.cameraTarget();
    const focusBlend = 1 - Math.exp(-9 * Math.min(0.1, Math.max(0, delta)));
    this.cameraFocus = this.cameraFocus.map(
      (value, index) => value + (cameraTarget[index] - value) * focusBlend,
    ) as Vector3;
    this.rebuildPointBuffers();
    this.rebuildShipMeshBuffer();
    this.rebuildCombatBuffers(now);
    this.rebuildSelectionBuffer(now);
    let heightGuideAlpha = 0;
    if (this.heightGuideShown) {
      const fadeProgress = this.heightGuideFadeStartedAt === null
        ? 0
        : Math.max(0, Math.min(1, (now - this.heightGuideFadeStartedAt) / HEIGHT_GUIDE_FADE_MS));
      if (fadeProgress >= 1) {
        this.hideHeightGuide();
      } else {
        heightGuideAlpha = 0.9 * (1 - fadeProgress);
        this.rebuildHeightGuideBuffer();
      }
    }
    const pixelRatio = this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.008, 0.016, 0.031, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const aspect = this.canvas.width / this.canvas.height;
    const movementReach = this.movementActive
      ? Math.max(
        ...this.movementOrigins.map((origin) => Math.hypot(...origin)),
        Math.hypot(...formationDestination(this.movementOrigins, this.movementVector)),
      )
      : 0;
    const contentRadius = Math.max(
      this.scene.radius + Math.hypot(...this.cameraFocus),
      this.radarRange,
      this.originGridEnabled ? this.originGridExtent * 2 : 0,
      movementReach,
      10,
    );
    const eyeDistance = Math.max(contentRadius * 2.5, this.camera.distance * 2.5);
    const near = 0.05;
    const far = eyeDistance + contentRadius * 2.5;
    const halfHeight = this.camera.distance;
    const halfWidth = halfHeight * aspect;
    const pixelsPerUnit = Math.max(1, this.canvas.clientHeight) / (2 * halfHeight);
    const modelBlend = Math.max(0, Math.min(1,
      (pixelsPerUnit - STRATEGIC_DOT_PPU) / (MODEL_DETAIL_PPU - STRATEGIC_DOT_PPU),
    ));
    const nextFidelity: TacticalFidelity = modelBlend <= 0.05
      ? "strategic"
      : modelBlend >= 0.95 ? "model" : "transition";
    if (nextFidelity !== this.fidelity) {
      this.fidelity = nextFidelity;
      this.callbacks.onFidelityChange(nextFidelity);
    }
    this.markerScale = Math.min(12, Math.max(1, pixelsPerUnit / this.markerReferencePixelsPerUnit));
    const eyeOffset = this.camera.eye(eyeDistance);
    const cameraEye = this.cameraFocus.map((value, index) => value + eyeOffset[index]) as Vector3;
    this.viewProjection = multiply(
      orthographic(-halfWidth, halfWidth, -halfHeight, halfHeight, near, far),
      lookAt(cameraEye, this.cameraFocus),
    );
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locations.matrix, false, this.viewProjection);
    gl.uniform1f(this.locations.pixelRatio, pixelRatio);
    gl.uniform1f(this.locations.markerScale, this.markerScale);
    if (this.originGridEnabled) {
      this.drawBuffer(this.originGridBuffer, this.originGridCount, gl.LINES, false, 0.55);
    }
    if (this.radarBubbleEnabled && this.radarRange > 0) {
      gl.depthMask(false);
      this.drawBuffer(this.radarSurfaceBuffer, this.radarSurfaceCount, gl.TRIANGLES, false, 0.035);
      this.drawBuffer(this.radarWireBuffer, this.radarWireCount, gl.LINES, false, 0.58);
      gl.depthMask(true);
    }
    if (modelBlend > 0) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.drawBuffer(this.shipMeshBuffer, this.shipMeshCount, gl.TRIANGLES, false, modelBlend);
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform1f(this.locations.markerScale, 1);
    if (modelBlend < 1) {
      this.drawBuffer(this.pointBuffer, this.pointCount, gl.POINTS, true, Math.max(0.12, 1 - modelBlend));
    }
    if (modelBlend > 0) {
      gl.uniform1f(this.locations.markerScale, this.markerScale);
      this.drawBuffer(this.landmarkBuffer, this.landmarkCount, gl.POINTS, true, modelBlend);
    }
    if (this.movementActive) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      this.drawBuffer(this.courseBuffer, this.courseCount, gl.LINES, false, 0.95);
      if (heightGuideAlpha > 0) {
        this.drawBuffer(this.heightGuideBuffer, this.heightGuideCount, gl.LINES, false, heightGuideAlpha);
      }
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
    }
    if (this.combatLineCount > 0 || this.combatPointCount > 0) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.uniform1f(this.locations.markerScale, 1);
      this.drawBuffer(this.combatLineBuffer, this.combatLineCount, gl.LINES, false, 0.98);
      this.drawBuffer(this.combatPointBuffer, this.combatPointCount, gl.POINTS, true, 1);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
    }
    if (this.selectionCount > 0) {
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.uniform1f(this.locations.markerScale, 1);
      this.drawBuffer(this.selectionBuffer, this.selectionCount, gl.LINES, false, 0.96);
      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);
    }
    this.publishClusterLabels();
    this.publishCourseLabel();
    this.publishPlayerShipLabel();
    const focusMoving = this.cameraFocus.some((value, index) => Math.abs(cameraTarget[index] - value) > 0.05);
    if (this.interpolator.isAnimating(now) || this.camera.isMoving() || focusMoving
        || this.combatEffects.length > 0 || this.jumpEffects.length > 0
        || this.disabledEffectsActive
        || this.selectionCount > 0
        || this.heightGuideFadeStartedAt !== null) {
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
      labels.push({
        id: point.id,
        count: point.memberCount,
        summary: point.memberSummary || `${point.memberCount} CONTACTS`,
        distance: Math.hypot(...point.position3d),
        worldPosition: point.worldPosition,
        x: screen.x,
        y: screen.y,
      });
    }
    const signature = labels.map((label) => [
      label.id, label.x.toFixed(1), label.y.toFixed(1), label.count, label.summary,
      label.distance.toFixed(1), ...label.worldPosition,
    ].join(":" )).join("|");
    if (signature === this.clusterLabelSignature) return;
    this.clusterLabelSignature = signature;
    this.callbacks.onClusterLabels(labels);
  }

  private publishCourseLabel(): void {
    const rect = this.canvas.getBoundingClientRect();
    const endpoint = this.movementCenter().map(
      (value, index) => value + this.movementVector[index],
    ) as Vector3;
    const screen = this.movementActive
      ? project(endpoint, this.viewProjection, rect.width, rect.height)
      : null;
    const label: CourseLabel | null = screen ? {
      worldPosition: endpoint.map((value, index) => value - this.originOffset[index]) as Vector3,
      x: screen.x,
      y: screen.y,
    } : null;
    const signature = label
      ? `${label.x.toFixed(1)}:${label.y.toFixed(1)}:${label.worldPosition.join(":")}`
      : "hidden";
    if (signature === this.courseLabelSignature) return;
    this.courseLabelSignature = signature;
    this.callbacks.onCourseLabel(label);
  }

  private publishPlayerShipLabel(): void {
    const rect = this.canvas.getBoundingClientRect();
    const screen = project([0, 0, 0], this.viewProjection, rect.width, rect.height);
    const label = screen ? { x: screen.x, y: screen.y } : null;
    const signature = label ? `${label.x.toFixed(1)}:${label.y.toFixed(1)}` : "hidden";
    if (signature === this.playerShipLabelSignature) return;
    this.playerShipLabelSignature = signature;
    this.callbacks.onPlayerShipLabel(label);
  }

  private pointAt(clientX: number, clientY: number, threshold: number): ScenePoint | null {
    const rect = this.canvas.getBoundingClientRect();
    let closest: ScenePoint | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const point of this.scene.points) {
      const screen = project(point.position3d, this.viewProjection, rect.width, rect.height);
      if (!screen) continue;
      const distance = Math.hypot(screen.x - (clientX - rect.left), screen.y - (clientY - rect.top));
      const markerRadius = point.pointSize * this.markerScale / 2 + 5;
      const inside = distance < Math.max(threshold, markerRadius);
      const winsTie = closest && Math.abs(distance - closestDistance) < 0.5
        && point.kind === "cluster" && closest.kind !== "cluster";
      if (inside && (distance < closestDistance || winsTie)) {
        closest = point;
        closestDistance = distance;
      }
    }
    return closest;
  }

  private beginElevationAdjustment(pointerY?: number): void {
    if (!this.movementInteractive) return;
    const rect = this.canvas.getBoundingClientRect();
    const anchorY = pointerY ?? this.lastPointerPosition?.y ?? rect.top + rect.height / 2;
    if (!this.elevationDrag) {
      this.elevationDrag = { pointerY: anchorY, elevation: this.movementVector[1] };
    }
    this.heightGuideShown = true;
    this.heightGuideFadeStartedAt = null;
    this.rebuildHeightGuideBuffer();
    this.requestRender();
  }

  private endElevationAdjustment(): void {
    this.elevationDrag = null;
    if (!this.heightGuideShown || this.heightGuideFadeStartedAt !== null) return;
    this.heightGuideFadeStartedAt = performance.now();
    this.requestRender();
  }

  private hideHeightGuide(): void {
    this.elevationDrag = null;
    this.heightGuideShown = false;
    this.heightGuideFadeStartedAt = null;
    this.rebuildHeightGuideBuffer();
  }

  private publishMovementVector(): void {
    this.movementVector = this.movementVector.map((value) => Math.round(value)) as Vector3;
    if (Math.hypot(...this.movementVector) < 1) this.movementVector = [1, 0, 0];
    this.rebuildCourseBuffer();
    this.rebuildHeightGuideBuffer();
    this.callbacks.onMovementVector([...this.movementVector]);
    this.callbacks.onTooltip(null);
    this.requestRender();
  }

  private onPointerDown = (event: PointerEvent): void => {
    // Course plotting keeps normal pointer movement, but middle-drag temporarily
    // hands the pointer to the camera without cancelling the pending vector.
    if (this.movementInteractive && event.button !== 1) return;
    this.drag = { x: event.clientX, y: event.clientY, moved: false, button: event.button };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.dataset.dragging = "true";
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.lastPointerPosition = { x: event.clientX, y: event.clientY };
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
    if (this.movementInteractive) {
      const rect = this.canvas.getBoundingClientRect();
      const unitsPerPixel = this.camera.distance * 2 / Math.max(1, rect.height);
      const deltaX = event.clientX - (rect.left + rect.width / 2);
      const deltaY = event.clientY - (rect.top + rect.height / 2);
      const origin = this.movementCenter();
      if (event.shiftKey) {
        this.beginElevationAdjustment(event.clientY);
        const anchor = this.elevationDrag;
        if (anchor) {
          const elevation = elevationFromPointer(
            anchor.elevation, anchor.pointerY, event.clientY, unitsPerPixel,
          );
          this.movementVector = [this.movementVector[0], elevation, this.movementVector[2]];
        }
      } else {
        this.endElevationAdjustment();
        const planarVector = pointerToXZVector(
          deltaX, deltaY, unitsPerPixel, this.camera.yaw, this.camera.pitch,
        );
        const targetX = this.cameraFocus[0] + planarVector[0];
        const targetZ = this.cameraFocus[2] + planarVector[2];
        this.movementVector = [targetX - origin[0], this.movementVector[1], targetZ - origin[2]];
      }
      this.publishMovementVector();
      return;
    }
    const point = this.pointAt(event.clientX, event.clientY, 18);
    this.callbacks.onTooltip(point ? {
      name: point.name,
      shipCategory: point.shipCategory,
      distance: Math.hypot(...point.position3d),
      memberCount: point.memberCount,
      groupSummary: point.memberSummary,
      worldPosition: point.worldPosition,
      hull: point.hull as TacticalTooltip["hull"],
      shields: point.shields as TacticalTooltip["shields"],
      x: Math.min(event.clientX + 14, window.innerWidth - 210),
      y: Math.min(event.clientY + 14, window.innerHeight - 150),
    } : null);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.drag && event.button === this.drag.button) {
      const { moved, button } = this.drag;
      this.drag = null;
      delete this.canvas.dataset.dragging;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      if (!this.movementInteractive && button === 0 && !moved) {
        this.callbacks.onSelect(this.pointAt(event.clientX, event.clientY, 14)?.id ?? null);
      }
      return;
    }
    if (this.movementInteractive) {
      if (event.button === 0) this.callbacks.onMovementCommit();
      return;
    }
  };

  private onPointerCancel = (): void => {
    this.drag = null;
    delete this.canvas.dataset.dragging;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.movementInteractive && event.shiftKey) {
      const rect = this.canvas.getBoundingClientRect();
      const unitsPerPixel = this.camera.distance * 2 / Math.max(1, rect.height);
      this.beginElevationAdjustment();
      const elevation = elevationFromWheel(this.movementVector[1], event.deltaY, unitsPerPixel);
      this.movementVector = [this.movementVector[0], elevation, this.movementVector[2]];
      this.publishMovementVector();
      if (this.elevationDrag) {
        this.elevationDrag.elevation = this.movementVector[1];
        this.elevationDrag.pointerY = this.lastPointerPosition?.y ?? this.elevationDrag.pointerY;
      }
      return;
    }
    this.camera.zoom(event.deltaY);
    this.requestRender();
  };

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
    if (this.movementActive) this.callbacks.onMovementCancel();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
        || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === "shift" && this.movementInteractive) {
      this.beginElevationAdjustment();
      event.preventDefault();
      return;
    }
    if (key === "f") this.sectorView();
    if (key === "r") this.resetOrientation();
    if (this.cameraMode === "rts" && ["w", "a", "s", "d", "q", "e"].includes(key)) {
      const step = Math.max(10, this.camera.distance * 0.14);
      if (key === "q" || key === "e") {
        this.freeFocusWorld[1] += key === "e" ? step : -step;
      } else {
        const pointer = pointerToXZVector(
          key === "a" ? -1 : key === "d" ? 1 : 0,
          key === "w" ? -1 : key === "s" ? 1 : 0,
          1, this.camera.yaw, this.camera.pitch,
        );
        const length = Math.max(0.0001, Math.hypot(pointer[0], pointer[2]));
        this.freeFocusWorld[0] += pointer[0] / length * step;
        this.freeFocusWorld[2] += pointer[2] / length * step;
      }
      event.preventDefault();
    } else {
      if (event.key === "ArrowLeft" || key === "a") this.camera.orbit(18, 0);
      if (event.key === "ArrowRight" || key === "d") this.camera.orbit(-18, 0);
      if (event.key === "ArrowUp" || key === "w") this.camera.orbit(0, 18);
      if (event.key === "ArrowDown" || key === "s") this.camera.orbit(0, -18);
      if (key === "q") this.camera.zoom(-120);
      if (key === "e") this.camera.zoom(120);
    }
    this.requestRender();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === "shift") this.endElevationAdjustment();
  };

  private onWindowBlur = (): void => {
    this.endElevationAdjustment();
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
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
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
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }
}
