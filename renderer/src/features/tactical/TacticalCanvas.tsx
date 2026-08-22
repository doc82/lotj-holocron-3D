import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { PlanetSphere } from "../../components/PlanetSphere";
import { formatCoordinate } from "../../domain/scene";
import { RangeMeter } from "../telemetry/RangeMeter";
import type {
  CombatEvent,
  ShipDestructionEvent,
  ShipJumpEvent,
  SystemSnapshot,
  Vector3,
} from "../../types/telemetry";
import { useLatestRef } from "../../hooks/useLatestRef";
import {
  TacticalEngine,
  type ClusterLabel,
  type CourseLabel,
  type PlayerShipLabel,
  type PlanetSprite,
  type TacticalCameraMode,
  type TacticalFidelity,
  type TacticalTooltip,
} from "./TacticalEngine";
import styles from "./TacticalCanvas.module.css";

export interface TacticalCanvasHandle {
  fitSystem(): void;
  sectorView(): void;
  resetOrientation(): void;
  setCameraMode(mode: TacticalCameraMode, targetId?: string): void;
  focusPoint(targetId: string): void;
  beginMovementPlanning(vector: Vector3, interactive: boolean, origins?: Vector3[]): void;
  finishMovementPlanning(): void;
  setMovementActive(active: boolean, vector?: Vector3, interactive?: boolean): void;
  freezeMovement(): void;
}

interface TacticalCanvasProps {
  snapshot: SystemSnapshot | null;
  observerLabel?: string;
  radarBubbleEnabled: boolean;
  originGridEnabled: boolean;
  keyboardEnabled?: boolean;
  combatEvents?: CombatEvent[];
  jumpEvents?: ShipJumpEvent[];
  destructionEvents?: ShipDestructionEvent[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  onMovementVector(vector: Vector3): void;
  onMovementCommit(): void;
  onMovementCancel(): void;
  onCameraModeChange(mode: TacticalCameraMode): void;
}

export const TacticalCanvas = forwardRef<TacticalCanvasHandle, TacticalCanvasProps>(
  function TacticalCanvas(
    {
      snapshot,
      observerLabel = "YOUR SHIP",
      radarBubbleEnabled,
      originGridEnabled,
      keyboardEnabled = true,
      combatEvents,
      jumpEvents,
      destructionEvents,
      selectedId,
      onSelect,
      onMovementVector,
      onMovementCommit,
      onMovementCancel,
      onCameraModeChange,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<TacticalEngine | null>(null);
    const [tooltip, setTooltip] = useState<TacticalTooltip | null>(null);
    const [clusterLabels, setClusterLabels] = useState<ClusterLabel[]>([]);
    const [courseLabel, setCourseLabel] = useState<CourseLabel | null>(null);
    const [playerShipLabel, setPlayerShipLabel] = useState<PlayerShipLabel | null>(null);
    const [planetSprites, setPlanetSprites] = useState<PlanetSprite[]>([]);
    const [fidelity, setFidelity] = useState<TacticalFidelity>("strategic");
    const callbacksRef = useLatestRef({
      onSelect,
      onMovementVector,
      onMovementCommit,
      onMovementCancel,
      onCameraModeChange,
    });

    useEffect(() => {
      if (!canvasRef.current) return;
      const engine = new TacticalEngine(canvasRef.current, {
        onSelect: (id) => callbacksRef.current.onSelect(id),
        onTooltip: setTooltip,
        onClusterLabels: setClusterLabels,
        onCourseLabel: setCourseLabel,
        onPlayerShipLabel: setPlayerShipLabel,
        onPlanetSprites: setPlanetSprites,
        onFidelityChange: setFidelity,
        onCameraModeChange: (mode) => callbacksRef.current.onCameraModeChange(mode),
        onMovementVector: (vector) => callbacksRef.current.onMovementVector(vector),
        onMovementCommit: () => callbacksRef.current.onMovementCommit(),
        onMovementCancel: () => callbacksRef.current.onMovementCancel(),
      });
      engineRef.current = engine;
      return () => {
        engine.dispose();
        if (engineRef.current === engine) engineRef.current = null;
      };
    }, []);

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
      engineRef.current?.setKeyboardEnabled(keyboardEnabled);
    }, [keyboardEnabled]);

    useEffect(() => {
      engineRef.current?.setSelectedId(selectedId);
    }, [selectedId]);

    useEffect(() => {
      for (const event of combatEvents ?? []) engineRef.current?.pushCombatEvent(event);
    }, [combatEvents]);

    useEffect(() => {
      for (const event of jumpEvents ?? []) engineRef.current?.pushJumpEvent(event);
    }, [jumpEvents]);

    useEffect(() => {
      for (const event of destructionEvents ?? []) engineRef.current?.pushDestructionEvent(event);
    }, [destructionEvents]);

    useImperativeHandle(
      ref,
      () => ({
        fitSystem: () => engineRef.current?.fitSystem(),
        sectorView: () => engineRef.current?.sectorView(),
        resetOrientation: () => engineRef.current?.resetOrientation(),
        setCameraMode: (mode, targetId) => engineRef.current?.setCameraMode(mode, targetId),
        focusPoint: (targetId) => engineRef.current?.focusPoint(targetId),
        beginMovementPlanning: (vector, interactive, origins) =>
          engineRef.current?.beginMovementPlanning(vector, interactive, origins),
        finishMovementPlanning: () => engineRef.current?.finishMovementPlanning(),
        setMovementActive: (active, vector, interactive) =>
          engineRef.current?.setMovementActive(active, vector, interactive),
        freezeMovement: () => engineRef.current?.freezeMovement(),
      }),
      [],
    );

    return (
      <>
        <canvas ref={canvasRef} className={styles.space} aria-label="3D system map" />
        {planetSprites.map((planet) => (
          <PlanetSphere
            key={planet.id}
            name={planet.name}
            className={`${styles.planetSprite} ${planet.orbitingShipCount > 0 ? styles.orbitedPlanetSprite : ""} ${selectedId === planet.id ? styles.selectedPlanetSprite : ""}`}
            view={{
              textureX: planet.textureX,
              textureY: planet.textureY,
              lightX: planet.lightX,
              lightY: planet.lightY,
            }}
            style={{
              left: planet.x,
              top: planet.y,
              width: planet.size,
              height: planet.size,
              zIndex: Math.max(2, Math.round(20 - planet.depth * 8)),
            }}
          />
        ))}
        {snapshot && playerShipLabel && (
          <div
            className={styles.playerShipLabel}
            style={{ left: playerShipLabel.x, top: playerShipLabel.y }}
            aria-hidden="true"
          >
            {observerLabel} <span>// {snapshot.observer?.name || "PLAYER SHIP"}</span>
          </div>
        )}
        {fidelity === "strategic" && <div className={styles.fidelity}>STRATEGIC CONTACTS</div>}
        {clusterLabels.map((label) => (
          <button
            key={label.id}
            type="button"
            className={`${styles.clusterCount} ${label.orbitingPlanet ? styles.orbitCount : ""}`}
            style={{ left: label.x, top: label.y }}
            aria-label={
              label.orbitingPlanet
                ? `Open ${label.count} ships in orbit`
                : `Open group of ${label.count} contacts`
            }
            onPointerEnter={(event) =>
              setTooltip({
                name: label.orbitingPlanet
                  ? `${label.count} ships in orbit`
                  : `${label.count} contacts`,
                memberCount: label.count,
                groupSummary: label.summary,
                distance: label.distance,
                worldPosition: label.worldPosition,
                x: Math.min(event.clientX + 14, window.innerWidth - 210),
                y: Math.min(event.clientY + 14, window.innerHeight - 150),
              })
            }
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
            {!tooltip.memberCount && (
              <>
                <RangeMeter label="SHIELD" reading={tooltip.shields} tone="shield" />
                <RangeMeter label="HULL" reading={tooltip.hull} />
              </>
            )}
          </div>
        )}
      </>
    );
  },
);
