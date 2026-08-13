import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { formatCoordinate } from "../../domain/scene";
import type { SystemSnapshot, Vector3 } from "../../types/telemetry";
import { TacticalEngine, type ClusterLabel, type CourseLabel, type TacticalFidelity, type TacticalTooltip } from "./TacticalEngine";
import styles from "./TacticalCanvas.module.css";

function HealthBar({ label, reading }: { label: string; reading?: { current?: number; maximum?: number } }) {
  const known = Number.isFinite(reading?.current) && Number.isFinite(reading?.maximum) && Number(reading?.maximum) > 0;
  const percent = known ? Math.max(0, Math.min(100, Number(reading?.current) / Number(reading?.maximum) * 100)) : 0;
  return (
    <div className={styles.health} title={known
      ? `${label}: ${formatCoordinate(reading?.current)} / ${formatCoordinate(reading?.maximum)}`
      : `${label}: Unknown`}>
      <span>{label}</span>
      <div className={`${styles.healthTrack} ${known ? "" : styles.unknown}`}>
        {known ? <i style={{ width: `${percent}%` }} /> : <b>UNKNOWN // ?</b>}
      </div>
    </div>
  );
}

export interface TacticalCanvasHandle {
  fitSystem(): void;
  sectorView(): void;
  resetOrientation(): void;
  setMovementActive(active: boolean, vector?: Vector3, interactive?: boolean): void;
  freezeMovement(): void;
}

interface TacticalCanvasProps {
  snapshot: SystemSnapshot | null;
  radarBubbleEnabled: boolean;
  originGridEnabled: boolean;
  onSelect(id: string | null): void;
  onMovementVector(vector: Vector3): void;
  onMovementCommit(): void;
  onMovementCancel(): void;
}

export const TacticalCanvas = forwardRef<TacticalCanvasHandle, TacticalCanvasProps>(
  function TacticalCanvas({ snapshot, radarBubbleEnabled, originGridEnabled, onSelect, onMovementVector, onMovementCommit, onMovementCancel }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [tooltip, setTooltip] = useState<TacticalTooltip | null>(null);
    const [clusterLabels, setClusterLabels] = useState<ClusterLabel[]>([]);
    const [courseLabel, setCourseLabel] = useState<CourseLabel | null>(null);
    const [fidelity, setFidelity] = useState<TacticalFidelity>("strategic");

    useEffect(() => {
      if (!canvasRef.current) return;
      const engine = new TacticalEngine(canvasRef.current, {
        onSelect,
        onTooltip: setTooltip,
        onClusterLabels: setClusterLabels,
        onCourseLabel: setCourseLabel,
        onFidelityChange: setFidelity,
        onMovementVector,
        onMovementCommit,
        onMovementCancel,
      });
      engineRef.current = engine;
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    }, [onMovementCancel, onMovementCommit, onMovementVector, onSelect]);

    useEffect(() => {
      if (snapshot) engineRef.current?.setSnapshot(snapshot);
    }, [snapshot]);

    useEffect(() => {
      engineRef.current?.setRadarBubbleEnabled(radarBubbleEnabled);
    }, [radarBubbleEnabled]);

    useEffect(() => {
      engineRef.current?.setOriginGridEnabled(originGridEnabled);
    }, [originGridEnabled]);

    useImperativeHandle(ref, () => ({
      fitSystem: () => engineRef.current?.fitSystem(),
      sectorView: () => engineRef.current?.sectorView(),
      resetOrientation: () => engineRef.current?.resetOrientation(),
      setMovementActive: (active, vector, interactive) => engineRef.current?.setMovementActive(active, vector, interactive),
      freezeMovement: () => engineRef.current?.freezeMovement(),
    }), []);

    return (
      <>
        <canvas ref={canvasRef} className={styles.space} aria-label="3D system map" />
        {snapshot && (
          <div className={styles.playerShipLabel} aria-hidden="true">
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
              <HealthBar label="SHIELD" reading={tooltip.shields} />
              <HealthBar label="HULL" reading={tooltip.hull} />
            </>}
          </div>
        )}
      </>
    );
  },
);
