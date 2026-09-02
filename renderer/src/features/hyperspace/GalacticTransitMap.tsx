import { useEffect, useMemo, useState } from "react";

import type { GalaxyCatalog } from "../../types/telemetry";
import styles from "./GalacticTransitMap.module.css";

interface GalaxyPoint {
  x: number;
  y: number;
}

interface Props {
  catalog: GalaxyCatalog | null;
  current?: GalaxyPoint;
  destination: GalaxyPoint;
  destinationName?: string;
}

interface MapSystem extends GalaxyPoint {
  name: string;
  custom: boolean;
}

const MAP_MIN = 7;
const MAP_SPAN = 86;

function finitePoint(point?: { x?: unknown; y?: unknown }): GalaxyPoint | undefined {
  const x = Number(point?.x);
  const y = Number(point?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function normalizeSystems(catalog: GalaxyCatalog | null): MapSystem[] {
  const systems = new Map<string, MapSystem>();
  for (const [name, raw] of Object.entries(catalog?.systems || {})) {
    const point = finitePoint(raw);
    if (point) systems.set(name, { name, ...point, custom: false });
  }
  for (const [name, raw] of Object.entries(catalog?.customSystems || {})) {
    const point = finitePoint(raw);
    if (point) systems.set(name, { name, ...point, custom: true });
  }
  return [...systems.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function sameName(left: string, right?: string) {
  return right ? left.trim().toLowerCase() === right.trim().toLowerCase() : false;
}

export function GalacticTransitMap({ catalog, current, destination, destinationName }: Props) {
  const livePosition = finitePoint(current);
  const [origin, setOrigin] = useState<GalaxyPoint | undefined>(livePosition);

  useEffect(() => {
    if (!origin && livePosition) setOrigin(livePosition);
  }, [livePosition, origin]);

  const systems = useMemo(() => normalizeSystems(catalog), [catalog]);
  const bounds = useMemo(() => {
    const points = [
      ...systems,
      destination,
      ...(origin ? [origin] : []),
      ...(livePosition ? [livePosition] : []),
    ];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xPadding = Math.max((maxX - minX) * 0.04, 10);
    const yPadding = Math.max((maxY - minY) * 0.04, 10);
    return {
      minX: minX - xPadding,
      maxX: maxX + xPadding,
      minY: minY - yPadding,
      maxY: maxY + yPadding,
    };
  }, [destination, livePosition, origin, systems]);

  const project = (point: GalaxyPoint) => ({
    left: MAP_MIN + ((point.x - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * MAP_SPAN,
    top: MAP_MIN + ((bounds.maxY - point.y) / (bounds.maxY - bounds.minY || 1)) * MAP_SPAN,
  });
  const destinationPosition = project(destination);
  const originPosition = origin ? project(origin) : undefined;
  const shipPosition = livePosition ? project(livePosition) : originPosition;
  const currentSystemName = catalog?.shipSystem?.name;

  return (
    <section className={styles.overlay} aria-label="Galactic hyperspace progress">
      <div className={styles.header}>
        <span>GALACTIC TRANSIT PLOT</span>
        <strong>{destinationName || "CUSTOM VECTOR"}</strong>
      </div>
      <div className={styles.map}>
        <div className={styles.galaxyGlow} aria-hidden="true" />
        <div className={styles.grid} aria-hidden="true" />
        {originPosition && (
          <svg
            className={styles.route}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              className={styles.remainingRoute}
              x1={shipPosition?.left ?? originPosition.left}
              y1={shipPosition?.top ?? originPosition.top}
              x2={destinationPosition.left}
              y2={destinationPosition.top}
              vectorEffect="non-scaling-stroke"
            />
            {shipPosition && (
              <line
                className={styles.completedRoute}
                x1={originPosition.left}
                y1={originPosition.top}
                x2={shipPosition.left}
                y2={shipPosition.top}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
        {systems.map((system) => {
          const position = project(system);
          const destinationSystem = sameName(system.name, destinationName);
          const currentSystem = sameName(system.name, currentSystemName);
          return (
            <div
              className={`${styles.system} ${system.custom ? styles.customSystem : ""} ${destinationSystem ? styles.destinationSystem : ""} ${currentSystem ? styles.currentSystem : ""}`}
              key={system.name}
              style={{ left: `${position.left}%`, top: `${position.top}%` }}
              title={`${system.name} // ${system.x} / ${system.y}`}
            >
              <i aria-hidden="true" />
              <span>{system.name}</span>
            </div>
          );
        })}
        <div
          className={styles.destination}
          style={{ left: `${destinationPosition.left}%`, top: `${destinationPosition.top}%` }}
          aria-label={`Destination ${destinationName || "custom vector"}`}
        >
          <i aria-hidden="true" />
          <span>{destinationName || "CUSTOM VECTOR"}</span>
        </div>
        {shipPosition && (
          <div
            className={styles.ship}
            style={{ left: `${shipPosition.left}%`, top: `${shipPosition.top}%` }}
            aria-label={`Ship position ${livePosition?.x ?? origin?.x} / ${livePosition?.y ?? origin?.y}`}
          >
            <i aria-hidden="true" />
            <span>YOUR SHIP</span>
          </div>
        )}
        {!shipPosition && <div className={styles.awaiting}>AWAITING GMCP.SHIP.SYSTEM</div>}
      </div>
      <div className={styles.footer} aria-live="polite">
        <span>LIVE GMCP // SHIP.SYSTEM</span>
        <strong>
          {livePosition
            ? `${Math.round(livePosition.x)} / ${Math.round(livePosition.y)}`
            : "POSITION UNAVAILABLE"}
        </strong>
      </div>
    </section>
  );
}
