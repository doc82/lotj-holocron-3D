import type { ReactNode } from "react";

import styles from "./ShipSpeedControl.module.css";

type SpeedPreset = "stop" | "quarter" | "half" | "threeQuarter" | "maximum";

function SpeedIcon({ type }: { type: SpeedPreset }) {
  const paths = {
    stop: <rect x="9" y="9" width="14" height="14" />,
    quarter: <><path d="M5 24A19 19 0 0 1 24 5" /><path d="M7 24h6" /></>,
    half: <><path d="M5 24A19 19 0 0 1 24 5" /><path d="M7 24 16 15" /></>,
    threeQuarter: <><path d="M5 24A19 19 0 0 1 24 5" /><path d="m7 24 14-14" /></>,
    maximum: <><path d="M5 24A19 19 0 0 1 24 5" /><path d="M7 24 24 7M20 7h4v4" /></>,
  } satisfies Record<SpeedPreset, ReactNode>;
  return <svg viewBox="0 0 32 32" aria-hidden="true">{paths[type]}</svg>;
}

interface ShipSpeedControlProps {
  id: string;
  label: string;
  value: number;
  maximum: number;
  disabled?: boolean;
  unavailableLabel?: string;
  onChange(value: number): void;
  onCommit(value: number): void;
}

export function ShipSpeedControl({
  id,
  label,
  value,
  maximum,
  disabled = false,
  unavailableLabel = "AWAITING STATUS / INFO FOR SPEED LIMIT",
  onChange,
  onCommit,
}: ShipSpeedControlProps) {
  const presets = [
    { ratio: 0, icon: "stop", label: "STOP" },
    { ratio: .25, icon: "quarter", label: "25% SPEED" },
    { ratio: .5, icon: "half", label: "50% SPEED" },
    { ratio: .75, icon: "threeQuarter", label: "75% SPEED" },
    { ratio: 1, icon: "maximum", label: "MAX SPEED" },
  ] as const;

  return (
    <div className={styles.speedControl}>
      <label htmlFor={id}><span>{label}</span><strong>{Math.round(value)} / {Math.round(maximum)}</strong></label>
      <input
        id={id}
        type="range"
        min="0"
        max={Math.max(1, maximum)}
        value={value}
        disabled={disabled || maximum <= 0}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={(event) => onCommit(Number(event.currentTarget.value))}
        onKeyUp={(event) => onCommit(Number(event.currentTarget.value))}
      />
      <div className={styles.presets}>
        {presets.map(({ ratio, icon, label: presetLabel }) => (
          <button
            key={ratio}
            type="button"
            className={styles.iconButton}
            aria-label={presetLabel}
            data-tooltip={presetLabel}
            disabled={disabled || maximum <= 0}
            onClick={() => onCommit(Math.round(maximum * ratio))}
          ><SpeedIcon type={icon} /></button>
        ))}
      </div>
      {maximum <= 0 && <small className={styles.speedUnavailable}>{unavailableLabel}</small>}
    </div>
  );
}
