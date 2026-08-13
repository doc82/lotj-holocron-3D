import { formatCoordinate } from "../../domain/scene";
import type { Vector3 } from "../../types/telemetry";
import { ShipSpeedControl } from "./ShipSpeedControl";
import styles from "./NavigationDrawer.module.css";

export type ActiveNavigationMode = "vector" | "target" | "away" | "confirm";
export type NavigationKind = "relative" | "target" | "away";

interface NavigationDrawerProps {
  mode: ActiveNavigationMode;
  kind: NavigationKind;
  targetName?: string;
  targetDistance?: number;
  vector: Vector3;
  status: string;
  observerStopped: boolean;
  speed: number;
  maximumSpeed: number;
  commandLocked: boolean;
  onSpeedChange(speed: number): void;
  onSpeedCommit(speed: number): void;
  onStageVector(): void;
  onConfirm(): void;
  onCancel(): void;
}

function ActionIcon({ type }: { type: "confirm" | "cancel" }) {
  return type === "confirm"
    ? <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m6 16 7 7L27 8" /></svg>
    : <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7l18 18M25 7 7 25" /></svg>;
}

export function NavigationDrawer({
  mode,
  kind,
  targetName,
  targetDistance,
  vector,
  status,
  observerStopped,
  speed,
  maximumSpeed,
  commandLocked,
  onSpeedChange,
  onSpeedCommit,
  onStageVector,
  onConfirm,
  onCancel,
}: NavigationDrawerProps) {
  const title = kind === "relative" ? "PLOT COURSE VECTOR" : kind === "away" ? "COURSE AWAY" : "COURSE TO CONTACT";
  const targetMissing = kind !== "relative" && !targetName;
  const departureSpeedMissing = observerStopped && speed <= 0;
  const needsVectorLock = mode === "vector";
  const confirmDisabled = commandLocked || targetMissing || departureSpeedMissing;

  return (
    <aside className={styles.drawer} aria-label="Navigation command wizard">
      <header>
        <p>NAVIGATION ACTION</p>
        <h2>{title}</h2>
      </header>

      <div className={styles.routeSummary}>
        <span>{kind === "relative" ? "RELATIVE VECTOR" : kind === "away" ? "REVERSE VECTOR" : "INTERCEPT VECTOR"}</span>
        <strong>{kind === "relative"
          ? `Δ ${vector.map(formatCoordinate).join(" / ")}`
          : targetName
            ? `${targetName.toUpperCase()} // ${formatCoordinate(targetDistance)} u`
            : "TARGET CONTACT LOST"}</strong>
        <small>{status}</small>
      </div>

      {observerStopped && (
        <section className={styles.departureStep} aria-label="Departure speed">
          <p>DEPARTURE SPEED REQUIRED</p>
          <span>The speed order will be sent immediately before the course order.</span>
          <ShipSpeedControl
            id="navigation-departure-speed"
            label="DEPARTURE SPEED"
            value={speed}
            maximum={maximumSpeed}
            disabled={commandLocked}
            onChange={onSpeedChange}
            onCommit={onSpeedCommit}
          />
        </section>
      )}

      {needsVectorLock && !observerStopped && (
        <p className={styles.instructions}>Move the pointer to set X/Z. Hold Shift for Y. Middle-drag orbits the camera without leaving this action.</p>
      )}

      {targetMissing && <p className={styles.blocker} role="status">TARGET IS NO LONGER AVAILABLE</p>}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.confirm}
          disabled={needsVectorLock ? commandLocked : confirmDisabled}
          onClick={needsVectorLock ? onStageVector : onConfirm}
        ><ActionIcon type="confirm" /><span>{needsVectorLock ? "LOCK VECTOR" : "CONFIRM COURSE"}</span></button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          <ActionIcon type="cancel" /><span>CANCEL</span>
        </button>
      </div>
    </aside>
  );
}
