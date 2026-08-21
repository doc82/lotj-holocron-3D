import type { CSSProperties } from "react";

import { planetVisual } from "../domain/planetVisuals";
import styles from "./PlanetSphere.module.css";

interface PlanetSphereProps {
  name: string;
  className?: string;
  style?: CSSProperties;
  view?: {
    textureX: number;
    textureY: number;
    lightX: number;
    lightY: number;
  };
}

export function PlanetSphere({ name, className = "", style, view }: PlanetSphereProps) {
  const visual = planetVisual(name);
  return (
    <span
      className={`${styles.sphere} ${className}`.trim()}
      style={
        {
          "--planet-a": visual.palette[0],
          "--planet-b": visual.palette[1],
          "--planet-c": visual.palette[2],
          ...(visual.textureUrl ? { "--planet-texture": `url("${visual.textureUrl}")` } : {}),
          ...(visual.normalUrl ? { "--planet-normal": `url("${visual.normalUrl}")` } : {}),
          ...(view
            ? {
                "--planet-view-x": `${view.textureX}%`,
                "--planet-view-y": `${view.textureY}%`,
                "--planet-light-x": `${view.lightX}%`,
                "--planet-light-y": `${view.lightY}%`,
              }
            : {}),
          ...style,
        } as CSSProperties
      }
      data-planet={name}
      data-texture={visual.textureKey || "procedural"}
      data-terrain={visual.terrain}
      aria-hidden="true"
    />
  );
}
