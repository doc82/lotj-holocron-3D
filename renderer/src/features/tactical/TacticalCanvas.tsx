import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { formatCoordinate } from "../../domain/scene";
import type { SystemSnapshot } from "../../types/telemetry";
import { TacticalEngine, type ClusterLabel, type TacticalTooltip } from "./TacticalEngine";
import styles from "./TacticalCanvas.module.css";

export interface TacticalCanvasHandle {
  fitSystem(): void;
  resetOrientation(): void;
}

interface TacticalCanvasProps {
  snapshot: SystemSnapshot | null;
  radarBubbleEnabled: boolean;
  originGridEnabled: boolean;
  onSelect(id: string | null): void;
}

export const TacticalCanvas = forwardRef<TacticalCanvasHandle, TacticalCanvasProps>(
  function TacticalCanvas({ snapshot, radarBubbleEnabled, originGridEnabled, onSelect }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [tooltip, setTooltip] = useState<TacticalTooltip | null>(null);
    const [clusterLabels, setClusterLabels] = useState<ClusterLabel[]>([]);

    useEffect(() => {
      if (!canvasRef.current) return;
      const engine = new TacticalEngine(canvasRef.current, {
        onSelect,
        onTooltip: setTooltip,
        onClusterLabels: setClusterLabels,
      });
      engineRef.current = engine;
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    }, [onSelect]);

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
      resetOrientation: () => engineRef.current?.resetOrientation(),
    }), []);

    return (
      <>
        <canvas ref={canvasRef} className={styles.space} aria-label="3D system map" />
        {clusterLabels.map((label) => (
          <button
            key={label.id}
            type="button"
            className={styles.clusterCount}
            style={{ left: label.x, top: label.y }}
            aria-label={`Open group of ${label.count} ships`}
            onClick={() => onSelect(label.id)}
          >
            {label.count}
          </button>
        ))}
        {tooltip && (
          <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.memberCount ? `${tooltip.memberCount} SHIPS` : tooltip.name} · {formatCoordinate(tooltip.distance)} u
          </div>
        )}
      </>
    );
  },
);
