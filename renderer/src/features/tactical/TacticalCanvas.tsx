import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { formatCoordinate } from "../../domain/scene";
import { RangeMeter } from "../telemetry/RangeMeter";
import type { CombatEvent, SystemSnapshot, Vector3 } from "../../types/telemetry";
import { TacticalEngine, type ClusterLabel, type CourseLabel, type PlayerShipLabel, type TacticalCameraMode, type TacticalFidelity, type TacticalTooltip } from "./TacticalEngine";
import styles from "./TacticalCanvas.module.css";

export interface TacticalCanvasHandle {
  fitSystem(): void;
  sectorView(): void;
  resetOrientation(): void;
  setCameraMode(mode: TacticalCameraMode, targetId?: string): void;
  beginMovementPlanning(vector: Vector3, interactive: boolean, origins?: Vector3[]): void;
  finishMovementPlanning(): void;
  setMovementActive(active: boolean, vector?: Vector3, interactive?: boolean): void;
  freezeMovement(): void;
}

interface TacticalCanvasProps {
  snapshot: SystemSnapshot | null;
  radarBubbleEnabled: boolean;
  originGridEnabled: boolean;
  combatEvents?: CombatEvent[];
  onSelect(id: string | null): void;
  onMovementVector(vector: Vector3): void;
  onMovementCommit(): void;
  onMovementCancel(): void;
  onCameraModeChange(mode: TacticalCameraMode): void;
}

export const TacticalCanvas = forwardRef<TacticalCanvasHandle, TacticalCanvasProps>(
  function TacticalCanvas({ snapshot, radarBubbleEnabled, originGridEnabled, combatEvents, onSelect, onMovementVector, onMovementCommit, onMovementCancel, onCameraModeChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [tooltip, setTooltip] = useState<TacticalTooltip | null>(null);
    const [clusterLabels, setClusterLabels] = useState<ClusterLabel[]>([]);
    const [courseLabel, setCourseLabel] = useState<CourseLabel | null>(null);
    const [playerShipLabel, setPlayerShipLabel] = useState<PlayerShipLabel | null>(null);
    const [fidelity, setFidelity] = useState<TacticalFidelity>("strategic");

    useEffect(() => {
      if (!canvasRef.current) return;
      const engine = new TacticalEngine(canvasRef.current, {
        onSelect,
        onTooltip: setTooltip,
        onClusterLabels: setClusterLabels,
        onCourseLabel: setCourseLabel,
        onPlayerShipLabel: setPlayerShipLabel,
        onFidelityChange: setFidelity,
        onCameraModeChange,
        onMovementVector,
        onMovementCommit,
        onMovementCancel,
      });
      engineRef.current = engine;
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    }, [onCameraModeChange, onMovementCancel, onMovementCommit, onMovementVector, onSelect]);

    useEffect(() => {
      if (snapshot) engineRef.current?.setSnapshot(snapshot);
    }, [snapshot]);

    useEffect(() => {
      engineRef.current?.setRadarBubbleEnabled(radarBubbleEnabled);
    }, [radarBubbleEnabled]);

    useEffect(() => {
      engineRef.current?.setOriginGridEnabled(originGridEnabled);
    }, [originGridEnabled]);

    useEffect(() => {
      for (const event of combatEvents ?? []) engineRef.current?.pushCombatEvent(event);
    }, [combatEvents]);

    useImperativeHandle(ref, () => ({
      fitSystem: () => engineRef.current?.fitSystem(),
      sectorView: () => engineRef.current?.sectorView(),
      resetOrientation: () => engineRef.current?.resetOrientation(),
      setCameraMode: (mode, targetId) => engineRef.current?.setCameraMode(mode, targetId),
      beginMovementPlanning: (vector, interactive, origins) =>
        engineRef.current?.beginMovementPlanning(vector, interactive, origins),
      finishMovementPlanning: () => engineRef.current?.finishMovementPlanning(),
      setMovementActive: (active, vector, interactive) => engineRef.current?.setMovementActive(active, vector, interactive),
      freezeMovement: () => engineRef.current?.freezeMovement(),
    }), []);

    return (
      <>
        <canvas ref={canvasRef} className={styles.space} aria-label="3D system map" />
        {snapshot && playerShipLabel && (
          <div className={styles.playerShipLabel}
            style={{ left: playerShipLabel.x, top: playerShipLabel.y }} aria-hidden="true">
            YOUR SHIP <span>// {snapshot.observer?.name || "PLAYER SHIP"}</span>
          </div>
        )}
        {fidelity === "strategic" && <div className={styles.fidelity}>STRATEGIC CONTACTS</div>}
        {clusterLabels.map((label) => (
          <button
            key={label.id}
            type="button"
            className={styles.clusterCount}
            style={{ left: label.x, top: label.y }}
            aria-label={`Open group of ${label.count} contacts`}
            onPointerEnter={(event) => setTooltip({
              name: `${label.count} contacts`,
              memberCount: label.count,
              groupSummary: label.summary,
              distance: label.distance,
              worldPosition: label.worldPosition,
              x: Math.min(event.clientX + 14, window.innerWidth - 210),
              y: Math.min(event.clientY + 14, window.innerHeight - 150),
            })}
            onPointerLeave={() => setTooltip(null)}
            onClick={() => onSelect(label.id)}
          >
            {label.count}
          </button>
        ))}
        {courseLabel && (
          <div
            className={styles.courseLabel}
            style={{ left: courseLabel.x, top: courseLabel.y }}
            aria-label={`Course target ${courseLabel.worldPosition.map(formatCoordinate).join(", ")}`}
          >
            <span>X {formatCoordinate(courseLabel.worldPosition[0])}</span>
            <span>Y {formatCoordinate(courseLabel.worldPosition[1])}</span>
            <span>Z {formatCoordinate(courseLabel.worldPosition[2])}</span>
          </div>
        )}
        {tooltip && (
          <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
            <strong>{tooltip.groupSummary || tooltip.name}</strong>
            {tooltip.shipCategory && <span>CLASS {tooltip.shipCategory.toUpperCase()}</span>}
            <span>DIST {formatCoordinate(tooltip.distance)} u</span>
            <span>XYZ {tooltip.worldPosition.map(formatCoordinate).join(" / ")}</span>
            {!tooltip.memberCount && <>
              <RangeMeter label="SHIELD" reading={tooltip.shields} tone="shield" />
              <RangeMeter label="HULL" reading={tooltip.hull} />
            </>}
          </div>
        )}
      </>
    );
  },
);
