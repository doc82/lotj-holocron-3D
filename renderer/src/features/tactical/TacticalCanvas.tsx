import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { formatCoordinate } from "../../domain/scene";
import type { SystemSnapshot } from "../../types/telemetry";
import { TacticalEngine, type TacticalTooltip } from "./TacticalEngine";
import styles from "./TacticalCanvas.module.css";

export interface TacticalCanvasHandle {
  fitSystem(): void;
  resetOrientation(): void;
}

interface TacticalCanvasProps {
  snapshot: SystemSnapshot | null;
  onSelect(id: string | null): void;
}

export const TacticalCanvas = forwardRef<TacticalCanvasHandle, TacticalCanvasProps>(
  function TacticalCanvas({ snapshot, onSelect }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [tooltip, setTooltip] = useState<TacticalTooltip | null>(null);

    useEffect(() => {
      if (!canvasRef.current) return;
      const engine = new TacticalEngine(canvasRef.current, { onSelect, onTooltip: setTooltip });
      engineRef.current = engine;
      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    }, [onSelect]);

    useEffect(() => {
      if (snapshot) engineRef.current?.setSnapshot(snapshot);
    }, [snapshot]);

    useImperativeHandle(ref, () => ({
      fitSystem: () => engineRef.current?.fitSystem(),
      resetOrientation: () => engineRef.current?.resetOrientation(),
    }), []);

    return (
      <>
        <canvas ref={canvasRef} className={styles.space} aria-label="3D system map" />
        {tooltip && (
          <div className={styles.tooltip} style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.name} · {formatCoordinate(tooltip.distance)} u
          </div>
        )}
      </>
    );
  },
);
