import {
  OrbitCamera,
  SceneInterpolator,
  buildScene,
  formatCoordinate,
  lookAt,
  multiply,
  perspective,
  project,
  scenesHaveMotion,
} from "./core.js";

const canvas = document.querySelector("#space");
const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
if (!gl) throw new Error("This renderer requires WebGL support.");

const ui = Object.fromEntries([
  "system-name", "connection-light", "connection-label", "observer-name",
  "observer-class", "observer-coordinates", "observer-speed", "polling-status",
  "contact-count", "sequence", "range", "selection",
  "selection-name", "selection-class", "selection-details", "landed-notice",
  "landed-reason", "tooltip", "fit-button",
].map((id) => [id, document.querySelector(`#${id}`)]));

const vertexSource = `
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

const fragmentSource = `
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

function shader(type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(result));
  }
  return result;
}

const program = gl.createProgram();
gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program));
}

const locations = {
  position: gl.getAttribLocation(program, "a_position"),
  color: gl.getAttribLocation(program, "a_color"),
  size: gl.getAttribLocation(program, "a_size"),
  matrix: gl.getUniformLocation(program, "u_viewProjection"),
  pixelRatio: gl.getUniformLocation(program, "u_pixelRatio"),
  points: gl.getUniformLocation(program, "u_points"),
  alpha: gl.getUniformLocation(program, "u_alpha"),
};

const pointBuffer = gl.createBuffer();
const gridBuffer = gl.createBuffer();
let pointCount = 0;
let gridCount = 0;
let scene = buildScene(null);
const interpolator = new SceneInterpolator(scene);
let snapshot = null;
let selectedId = null;
let viewProjection = new Float32Array(16);
let firstSnapshot = true;
let lastMotionSnapshotAt = null;
const camera = new OrbitCamera();

function interleavedVertex(position, color, size = 1) {
  return [...position, ...color, size];
}

function upload(buffer, values, usage = gl.STATIC_DRAW) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), usage);
}

function niceStep(radius) {
  const rough = Math.max(radius, 10) / 8;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
}

function rebuildPointBuffer() {
  const points = [];
  for (const point of scene.points) {
    points.push(...interleavedVertex(point.position3d, point.color, point.pointSize));
  }
  pointCount = scene.points.length;
  upload(pointBuffer, points, gl.DYNAMIC_DRAW);
}

function rebuildGridBuffer() {
  const grid = [];
  const step = niceStep(scene.radius);
  const extent = step * 10;
  for (let index = -10; index <= 10; index += 1) {
    const coordinate = index * step;
    const color = index === 0 ? [0.12, 0.53, 0.62] : [0.035, 0.18, 0.23];
    grid.push(...interleavedVertex([-extent, 0, coordinate], color));
    grid.push(...interleavedVertex([extent, 0, coordinate], color));
    grid.push(...interleavedVertex([coordinate, 0, -extent], color));
    grid.push(...interleavedVertex([coordinate, 0, extent], color));
  }
  gridCount = grid.length / 7;
  upload(gridBuffer, grid);
}

function rebuildBuffers() {
  rebuildPointBuffer();
  rebuildGridBuffer();
}

function bindAttributes(buffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = 7 * Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(locations.color);
  gl.vertexAttribPointer(locations.color, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(locations.size);
  gl.vertexAttribPointer(locations.size, 1, gl.FLOAT, false, stride, 6 * 4);
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return ratio;
}

function drawBuffer(buffer, count, mode, isPoints, alpha) {
  bindAttributes(buffer);
  gl.uniform1i(locations.points, isPoints ? 1 : 0);
  gl.uniform1f(locations.alpha, alpha);
  gl.drawArrays(mode, 0, count);
}

let previousFrame = performance.now();
function render(now) {
  const delta = (now - previousFrame) / 1000;
  previousFrame = now;
  camera.update(delta);
  scene = interpolator.sample(now);
  rebuildPointBuffer();
  const pixelRatio = resize();

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.008, 0.016, 0.031, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

  const aspect = canvas.width / canvas.height;
  const near = Math.max(0.05, camera.distance * 0.001);
  const far = Math.max(camera.distance * 20, scene.radius * 20, 500);
  viewProjection = multiply(
    perspective(Math.PI / 3, aspect, near, far),
    lookAt(camera.eye()),
  );

  gl.useProgram(program);
  gl.uniformMatrix4fv(locations.matrix, false, viewProjection);
  gl.uniform1f(locations.pixelRatio, pixelRatio);
  drawBuffer(gridBuffer, gridCount, gl.LINES, false, 0.45);
  drawBuffer(pointBuffer, pointCount, gl.POINTS, true, 1);

  requestAnimationFrame(render);
}

function setConnection(state, label) {
  ui["connection-label"].textContent = label;
  ui["connection-light"].classList.toggle("live", state === "live");
}

function distanceFromOrigin(point) {
  return Math.hypot(...point.position3d);
}

function detailsFor(point) {
  const worldCoordinates = point.worldPosition.map(formatCoordinate).join(" / ");
  const rows = [["TYPE", point.kind || "unknown"]];
  if (point.id === "player-ship") {
    rows.push(["WORLD XYZ", worldCoordinates]);
    rows.push(["CAMERA FOCUS", "LOCKED"]);
  } else {
    rows.push(["SYSTEM XYZ", worldCoordinates]);
    rows.push(["RELATIVE XYZ", point.position3d.map(formatCoordinate).join(" / ")]);
  }
  if (point.distance !== undefined) rows.push(["PROXIMITY", formatCoordinate(point.distance)]);
  if (point.speed !== undefined) {
    const speed = typeof point.speed === "object" ? point.speed.current : point.speed;
    rows.push(["VELOCITY", formatCoordinate(speed)]);
  }
  if (point.position) rows.push(["FORMATION", point.position]);
  return rows;
}

function select(point) {
  selectedId = point?.id ?? null;
  ui.selection.classList.toggle("hidden", !point);
  if (!point) return;
  ui["selection-name"].textContent = point.name || point.id;
  ui["selection-class"].textContent = point.class || point.kind || "Unknown contact";
  ui["selection-details"].replaceChildren(...detailsFor(point).map(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    row.append(term, detail);
    return row;
  }));
}

function updateSnapshot(message) {
  snapshot = message;
  const nextScene = buildScene(message);
  const now = performance.now();
  if (firstSnapshot) {
    interpolator.setTarget(nextScene, now, 0);
    scene = nextScene;
    camera.fit(scene.radius, true);
    firstSnapshot = false;
    lastMotionSnapshotAt = now;
  } else {
    const moving = scenesHaveMotion(interpolator.target, nextScene);
    let duration = 450;
    if (moving) {
      const observedInterval = lastMotionSnapshotAt === null ? 900 : now - lastMotionSnapshotAt;
      duration = Math.min(6000, Math.max(450, observedInterval * 0.88));
      lastMotionSnapshotAt = now;
    }
    interpolator.setTarget(nextScene, now, duration);
    scene = interpolator.sample(now);
  }
  rebuildGridBuffer();

  ui["system-name"].textContent = scene.system;
  ui["observer-name"].textContent = message.observer?.name || "Player Ship";
  ui["observer-class"].textContent = message.observer?.class || "Observer identity pending";
  ui["observer-coordinates"].textContent = [
    message.observer?.x,
    message.observer?.y,
    message.observer?.z,
  ].map(formatCoordinate).join(" / ");
  const observerSpeed = message.observer?.speed;
  if (typeof observerSpeed === "object" && observerSpeed) {
    ui["observer-speed"].textContent = `${formatCoordinate(observerSpeed.current)} / ${formatCoordinate(observerSpeed.maximum)}`;
  } else if (observerSpeed !== undefined) {
    ui["observer-speed"].textContent = formatCoordinate(observerSpeed);
  } else {
    ui["observer-speed"].textContent = "—";
  }
  const polling = message.metadata?.polling;
  ui["polling-status"].textContent = polling?.enabled
    ? String(polling.command || "ACTIVE").toUpperCase()
    : "OFF";
  ui["contact-count"].textContent = String(Math.max(0, scene.points.length - 1));
  ui.sequence.textContent = String(scene.sequence);
  ui.range.textContent = `${formatCoordinate(scene.radius)} u`;

  if (selectedId) select(scene.points.find((point) => point.id === selectedId) ?? null);
}

function showSpaceState(message) {
  const landed = message.inSpace === false;
  ui["landed-notice"].classList.toggle("hidden", !landed);
  ui["landed-reason"].textContent = message.reason || "Ship is landed";
}

let socket;
let reconnectTimer;
let reconnectDelay = 500;
async function connectElectron() {
  setConnection("connecting", "WAITING FOR MUDLET");
  window.holocron.onSnapshot(updateSnapshot);
  window.holocron.onSpaceState(showSpaceState);
  window.holocron.onConnectionState((state) => {
    setConnection(state?.connected ? "live" : "offline",
      state?.connected ? "MUDLET LINK" : "WAITING FOR MUDLET");
  });

  const initial = await window.holocron.getInitialState();
  if (!initial) {
    setConnection("offline", "IPC REJECTED");
    return;
  }
  if (initial.snapshot) updateSnapshot(initial.snapshot);
  if (initial.spaceState) showSpaceState(initial.spaceState);
  setConnection(initial.connected ? "live" : "offline",
    initial.connected ? "MUDLET LINK" : "WAITING FOR MUDLET");
}

async function connectWebsocket() {
  clearTimeout(reconnectTimer);
  setConnection("connecting", "CONNECTING");
  let websocketUrl = `ws://${location.hostname}:8787`;
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (response.ok) websocketUrl = (await response.json()).websocketUrl || websocketUrl;
  } catch {
    // The derived default keeps the renderer useful behind a basic static server.
  }

  socket = new WebSocket(websocketUrl);
  socket.addEventListener("open", () => {
    reconnectDelay = 500;
    setConnection("live", "BRIDGE LINK");
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "bridge_ready") setConnection("live", "LIVE LINK");
    if (message.type === "system_snapshot") updateSnapshot(message);
    if (message.type === "space_state") showSpaceState(message);
  });
  socket.addEventListener("close", () => {
    setConnection("offline", "RECONNECTING");
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
  });
  socket.addEventListener("error", () => socket.close());
}

function connect() {
  return window.holocron ? connectElectron() : connectWebsocket();
}

let drag = null;
canvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add("dragging");
});
canvas.addEventListener("pointermove", (event) => {
  if (drag) {
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 1) drag.moved = true;
    camera.orbit(deltaX, deltaY);
    drag.x = event.clientX;
    drag.y = event.clientY;
    ui.tooltip.classList.add("hidden");
    return;
  }

  const rect = canvas.getBoundingClientRect();
  let closest = null;
  let closestDistance = 18;
  for (const point of scene.points) {
    const screen = project(point.position3d, viewProjection, rect.width, rect.height);
    if (!screen) continue;
    const distance = Math.hypot(screen.x - (event.clientX - rect.left), screen.y - (event.clientY - rect.top));
    if (distance < closestDistance) {
      closest = point;
      closestDistance = distance;
    }
  }
  ui.tooltip.classList.toggle("hidden", !closest);
  if (closest) {
    ui.tooltip.textContent = `${closest.name} · ${formatCoordinate(distanceFromOrigin(closest))} u`;
    ui.tooltip.style.left = `${event.clientX + 14}px`;
    ui.tooltip.style.top = `${event.clientY + 14}px`;
  }
});
canvas.addEventListener("pointerup", (event) => {
  const wasMoved = drag?.moved;
  drag = null;
  canvas.classList.remove("dragging");
  canvas.releasePointerCapture(event.pointerId);
  if (!wasMoved) {
    const rect = canvas.getBoundingClientRect();
    const point = scene.points.find((candidate) => {
      const screen = project(candidate.position3d, viewProjection, rect.width, rect.height);
      return screen && Math.hypot(
        screen.x - (event.clientX - rect.left),
        screen.y - (event.clientY - rect.top),
      ) < 14;
    });
    select(point || null);
  }
});
canvas.addEventListener("pointercancel", () => {
  drag = null;
  canvas.classList.remove("dragging");
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  camera.zoom(event.deltaY);
}, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

function fitSystem() { camera.fit(interpolator.target.radius); }
ui["fit-button"].addEventListener("click", fitSystem);
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "f") fitSystem();
  if (event.key.toLowerCase() === "r") camera.resetOrientation();
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") camera.orbit(18, 0);
  if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") camera.orbit(-18, 0);
  if (event.key === "ArrowUp" || event.key.toLowerCase() === "w") camera.orbit(0, 18);
  if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") camera.orbit(0, -18);
  if (event.key.toLowerCase() === "q") camera.zoom(-120);
  if (event.key.toLowerCase() === "e") camera.zoom(120);
});

rebuildBuffers();
connect();
requestAnimationFrame(render);
