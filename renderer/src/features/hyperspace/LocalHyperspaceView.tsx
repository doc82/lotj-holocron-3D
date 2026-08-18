import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  calculateHyperspaceIntercept,
  type MotionTrack,
  type MotionTrackMap,
} from "../../domain/hyperspacePrediction";
import { clampSectorCoordinate, hyperspaceDestinationMarkerSize } from "../../domain/hyperspace";
import { buildScene, findScenePoint, formatCoordinate } from "../../domain/scene";
import type { SystemSnapshot, TelemetryEntity, Vector3 } from "../../types/telemetry";
import { TacticalCanvas, type TacticalCanvasHandle } from "../tactical/TacticalCanvas";
import type { TacticalCameraMode } from "../tactical/TacticalEngine";
import styles from "./LocalHyperspaceView.module.css";

interface LocalHyperspaceViewProps {
  snapshot: SystemSnapshot | null;
  recipientLabel: string;
  observer: { x?: number; y?: number; z?: number };
  destination: Vector3;
  hyperspeed?: number;
  motionTracks: MotionTrackMap;
  planetTargetName?: string;
  onDestinationChange(destination: Vector3): void;
}

const vectorFrom = (entity: { x?: number; y?: number; z?: number }): Vector3 => [
  Math.round(Number(entity.x) || 0),
  Math.round(Number(entity.y) || 0),
  Math.round(Number(entity.z) || 0),
];

function trackForObserver(
  motionTracks: MotionTrackMap,
  recipientLabel: string,
  origin: Vector3,
): MotionTrack {
  const wanted = recipientLabel.trim().toLowerCase();
  const named = [...motionTracks.values()].find(
    (track) => track.name.trim().toLowerCase() === wanted,
  );
  if (named) return named;
  const player = motionTracks.get("player-ship");
  if (
    player &&
    player.current.position.every((coordinate, index) => Math.abs(coordinate - origin[index]) < 1)
  )
    return player;
  return {
    id: "planner-observer",
    name: recipientLabel,
    previous: { position: [...origin], observedAt: Date.now() / 1_000 - 1 },
    current: { position: [...origin], observedAt: Date.now() / 1_000 },
  };
}

function plannerSnapshot(
  snapshot: SystemSnapshot | null,
  recipientLabel: string,
  origin: Vector3,
  predictions: TelemetryEntity[],
): SystemSnapshot {
  const originalObserver = snapshot?.observer;
  const observerName = String(originalObserver?.name || "")
    .trim()
    .toLowerCase();
  const recipientName = recipientLabel.trim().toLowerCase();
  const observerMoved = originalObserver
    ? vectorFrom(originalObserver).some((coordinate, index) => coordinate !== origin[index])
    : false;
  const localObserverContact: TelemetryEntity[] =
    originalObserver && observerMoved && observerName !== recipientName
      ? [
          {
            ...originalObserver,
            id: "local-player-contact",
            kind: "ship",
            name: originalObserver.name || "Your ship",
            formationMember: true,
          },
        ]
      : [];
  const entities = (snapshot?.entities ?? []).filter(
    (entity) => entity.name?.trim().toLowerCase() !== recipientName,
  );
  return {
    ...snapshot,
    observer: {
      ...originalObserver,
      id: "player-ship",
      name: recipientLabel,
      x: origin[0],
      y: origin[1],
      z: origin[2],
    },
    entities: [...localObserverContact, ...entities, ...predictions],
  };
}

export function LocalHyperspaceView({
  snapshot,
  recipientLabel,
  observer,
  destination,
  hyperspeed,
  motionTracks,
  planetTargetName,
  onDestinationChange,
}: LocalHyperspaceViewProps) {
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<TacticalCameraMode>("rts");
  const [pointMode, setPointMode] = useState<"idle" | "plotting" | "fixed">("idle");
  const [predictionEnabled, setPredictionEnabled] = useState(false);
  const [navigatorEnabled, setNavigatorEnabled] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1_000);
  const origin = useMemo(() => vectorFrom(observer), [observer.x, observer.y, observer.z]);
  const baseSnapshot = useMemo(
    () => plannerSnapshot(snapshot, recipientLabel, origin, []),
    [origin, recipientLabel, snapshot],
  );
  const baseScene = useMemo(() => buildScene(baseSnapshot), [baseSnapshot]);
  const selected = findScenePoint(baseScene, selectedId);
  const selectedTrack = selected ? motionTracks.get(selected.id) : undefined;
  const observerTrack = useMemo(
    () => trackForObserver(motionTracks, recipientLabel, origin),
    [motionTracks, origin, recipientLabel],
  );
  const solution = useMemo(
    () =>
      predictionEnabled && selected?.kind === "ship"
        ? calculateHyperspaceIntercept({
            target: selectedTrack,
            observer: observerTrack,
            hyperspeed: Number(hyperspeed) || 0,
            navigator: navigatorEnabled,
            now,
          })
        : null,
    [
      hyperspeed,
      navigatorEnabled,
      now,
      observerTrack,
      predictionEnabled,
      selected?.kind,
      selectedTrack,
    ],
  );
  const predictions = useMemo<TelemetryEntity[]>(() => {
    if (!predictionEnabled || !selected || !solution) return [];
    return [
      {
        id: "prediction:target",
        name: `Predicted ${selected.name}`,
        kind: "prediction",
        x: solution.targetPosition[0],
        y: solution.targetPosition[1],
        z: solution.targetPosition[2],
        renderColor: [1, 0.2, 0.48],
        renderPointSize: 18,
      },
      {
        id: "prediction:observer",
        name: `Predicted ${recipientLabel}`,
        kind: "prediction",
        x: solution.observerPosition[0],
        y: solution.observerPosition[1],
        z: solution.observerPosition[2],
        renderColor: [0.08, 0.9, 1],
        renderPointSize: 15,
      },
    ];
  }, [predictionEnabled, recipientLabel, selected, solution]);
  const destinationMarker = useMemo<TelemetryEntity>(() => {
    const distance = Math.hypot(...destination.map((value, index) => value - origin[index]));
    return {
      id: "route:destination",
      name: "Hyperspace target location",
      kind: "prediction",
      x: clampSectorCoordinate(destination[0]),
      y: clampSectorCoordinate(destination[1]),
      z: clampSectorCoordinate(destination[2]),
      renderColor: [1, 0.72, 0.08],
      renderPointSize: hyperspaceDestinationMarkerSize(distance),
      renderScaleWithZoom: true,
    };
  }, [destination, origin]);
  const renderedSnapshot = useMemo(
    () => plannerSnapshot(snapshot, recipientLabel, origin, [destinationMarker, ...predictions]),
    [destinationMarker, origin, predictions, recipientLabel, snapshot],
  );
  const renderedScene = useMemo(() => buildScene(renderedSnapshot), [renderedSnapshot]);
  const expandedCluster = findScenePoint(renderedScene, expandedClusterId);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      tacticalRef.current?.setCameraMode("rts");
      tacticalRef.current?.sectorView();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!predictionEnabled || !selectedId) return;
    const timer = window.setInterval(() => setNow(Date.now() / 1_000), 1_000);
    return () => window.clearInterval(timer);
  }, [predictionEnabled, selectedId]);

  useEffect(() => {
    if (!selected) return;
    onDestinationChange(solution?.targetPosition ?? selected.worldPosition);
  }, [onDestinationChange, selected, solution]);

  useEffect(() => {
    if (!planetTargetName) return;
    setSelectedId(null);
    setExpandedClusterId(null);
    setPredictionEnabled(false);
    setPointMode("idle");
    tacticalRef.current?.finishMovementPlanning();
  }, [planetTargetName]);

  const beginPointPlot = useCallback(() => {
    setSelectedId(null);
    setExpandedClusterId(null);
    setPredictionEnabled(false);
    setPointMode("plotting");
    tacticalRef.current?.beginMovementPlanning(
      destination.map((coordinate, index) => coordinate - origin[index]) as Vector3,
      true,
      [[0, 0, 0]],
    );
  }, [destination, origin]);

  const cancelPointPlot = useCallback(() => {
    setPointMode("idle");
    tacticalRef.current?.finishMovementPlanning();
  }, []);

  useEffect(() => {
    if (pointMode === "idle") return;
    tacticalRef.current?.setMovementActive(
      true,
      destination.map((coordinate, index) => coordinate - origin[index]) as Vector3,
      pointMode === "plotting",
    );
  }, [destination, origin, pointMode]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "m") {
        event.preventDefault();
        event.stopImmediatePropagation();
        beginPointPlot();
      } else if (key === "escape" && pointMode === "plotting") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelPointPlot();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [beginPointPlot, cancelPointPlot, pointMode]);

  const selectPoint = useCallback(
    (id: string | null) => {
      const point = findScenePoint(renderedScene, id);
      if (!point || point.id === "player-ship" || point.kind === "prediction") {
        setSelectedId(null);
        setExpandedClusterId(null);
        return;
      }
      tacticalRef.current?.finishMovementPlanning();
      setPointMode("idle");
      if (point.kind === "cluster") {
        setExpandedClusterId(point.id);
        setSelectedId(null);
        return;
      }
      setExpandedClusterId(null);
      setSelectedId(point.id);
      onDestinationChange(point.worldPosition);
    },
    [onDestinationChange, renderedScene],
  );

  const chooseCamera = (mode: TacticalCameraMode, targetId?: string) => {
    tacticalRef.current?.setCameraMode(mode, targetId);
    setCameraMode(mode);
  };

  const focusDestination = () => {
    tacticalRef.current?.focusPoint("route:destination");
    setCameraMode("selection");
  };

  const predictionUnavailable =
    predictionEnabled && selected?.kind === "ship" && !solution
      ? Number(hyperspeed) > 0
        ? "ACQUIRING SECOND RADAR FIX"
        : "HYPERSPEED UNKNOWN // INFO REQUIRED"
      : null;

  return (
    <div
      className={styles.view}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
    >
      <TacticalCanvas
        ref={tacticalRef}
        snapshot={renderedSnapshot}
        observerLabel="ROUTE ORIGIN"
        radarBubbleEnabled
        originGridEnabled
        selectedId={selectedId}
        onSelect={selectPoint}
        onMovementVector={(vector) => {
          if (pointMode !== "plotting") return;
          setSelectedId(null);
          onDestinationChange(
            vector.map((coordinate, index) =>
              clampSectorCoordinate(coordinate + origin[index]),
            ) as Vector3,
          );
        }}
        onMovementCommit={() => {
          if (pointMode !== "plotting") return;
          setPointMode("fixed");
          tacticalRef.current?.freezeMovement();
        }}
        onMovementCancel={cancelPointPlot}
        onCameraModeChange={setCameraMode}
      />

      <div className={styles.cameraControls} aria-label="Local hyperspace camera controls">
        <span>CAMERA</span>
        <button
          type="button"
          aria-pressed={cameraMode === "rts"}
          onClick={() => chooseCamera("rts")}
        >
          RTS
        </button>
        <button
          type="button"
          aria-pressed={cameraMode === "player"}
          onClick={() => chooseCamera("player")}
        >
          ORIGIN
        </button>
        <button
          type="button"
          disabled={!selected}
          aria-pressed={cameraMode === "selection"}
          onClick={() => selected && chooseCamera("selection", selected.id)}
        >
          FOLLOW TARGET
        </button>
        <button type="button" onClick={() => tacticalRef.current?.sectorView()}>
          FIT RADAR
        </button>
        <button type="button" onClick={focusDestination}>
          ZOOM TARGET
        </button>
        <button type="button" aria-pressed={pointMode === "plotting"} onClick={beginPointPlot}>
          PLOT POINT [M]
        </button>
      </div>

      <aside className={styles.predictionPanel} aria-label="Contact prediction controls">
        <label>
          <input
            type="checkbox"
            checked={predictionEnabled}
            onChange={(event) => {
              setPredictionEnabled(event.target.checked);
              setNow(Date.now() / 1_000);
            }}
          />
          <span>PREDICT MOVING TARGET</span>
        </label>
        {predictionEnabled && (
          <label className={styles.navigator}>
            <input
              type="checkbox"
              checked={navigatorEnabled}
              onChange={(event) => setNavigatorEnabled(event.target.checked)}
            />
            <span>NAVIGATOR +30%</span>
          </label>
        )}
        <div className={styles.legend}>
          <span data-color="destination">PLOTTED LOCATION</span>
          <span data-color="target">TARGET ARRIVAL</span>
          <span data-color="observer">ISSUER ARRIVAL</span>
        </div>
        {solution && selected ? (
          <div className={styles.solution}>
            <strong>{selected.name.toUpperCase()}</strong>
            <span>JUMP TICK {solution.travelTime}s</span>
            <span>RADAR AGE {solution.radarAge.toFixed(1)}s</span>
            <span>DIST {formatCoordinate(solution.distance)} u</span>
          </div>
        ) : (
          <small>{predictionUnavailable || "SELECT A RADAR CONTACT"}</small>
        )}
      </aside>

      {selected && (
        <aside className={styles.selection} aria-label="Selected local hyperspace target">
          <small>JUMP TARGET</small>
          <strong>{selected.name.toUpperCase()}</strong>
          <span>{selected.kind.toUpperCase()}</span>
          <p>{destination.map(formatCoordinate).join(" / ")}</p>
          <button type="button" onClick={() => chooseCamera("selection", selected.id)}>
            FIX CAMERA
          </button>
          <button type="button" onClick={focusDestination}>
            ZOOM TARGET LOCATION
          </button>
        </aside>
      )}

      {!selected && pointMode !== "idle" && (
        <aside className={styles.selection} aria-label="Selected local hyperspace map point">
          <small>{pointMode === "plotting" ? "POSITIONING MAP POINT" : "MAP POINT LOCKED"}</small>
          <strong>FREE-SPACE COORDINATES</strong>
          <p>{destination.map(formatCoordinate).join(" / ")}</p>
          <button type="button" onClick={beginPointPlot}>
            {pointMode === "plotting" ? "MOVE POINTER + CLICK TO LOCK" : "ADJUST POINT"}
          </button>
          <button type="button" onClick={focusDestination}>
            ZOOM TARGET LOCATION
          </button>
        </aside>
      )}

      {expandedCluster?.members && (
        <aside className={styles.cluster} aria-label="Radar contact group">
          <header>
            <div>
              <small>CONTACT GROUP</small>
              <strong>{expandedCluster.memberSummary}</strong>
            </div>
            <button
              type="button"
              onClick={() => setExpandedClusterId(null)}
              aria-label="Close group"
            >
              ×
            </button>
          </header>
          <div>
            {expandedCluster.members
              .filter((member) => member.id !== "player-ship")
              .map((member) => (
                <button key={member.id} type="button" onClick={() => selectPoint(member.id)}>
                  <strong>{member.name}</strong>
                  <span>{member.kind}</span>
                  <small>{member.worldPosition.map(formatCoordinate).join(" / ")}</small>
                </button>
              ))}
          </div>
        </aside>
      )}

      <div className={styles.instructions}>
        CLICK CONTACT TO SET XYZ // PLOT POINT [M], MOVE + CLICK // HOLD SHIFT FOR Y // MMB ORBIT
      </div>
    </div>
  );
}
