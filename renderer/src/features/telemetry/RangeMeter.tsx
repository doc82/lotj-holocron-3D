import { formatCoordinate } from "../../domain/scene";
import styles from "./RangeMeter.module.css";

export interface RangeReading {
  current?: number;
  maximum?: number;
}

type RangeMeterTone = "hull" | "shield" | "speed" | "energy";

export function RangeMeter({
  label,
  reading,
  tone = "hull",
}: {
  label: string;
  reading?: RangeReading;
  tone?: RangeMeterTone;
}) {
  const known =
    Number.isFinite(reading?.current) &&
    Number.isFinite(reading?.maximum) &&
    Number(reading?.maximum) > 0;
  const percent = known
    ? Math.max(0, Math.min(100, (Number(reading?.current) / Number(reading?.maximum)) * 100))
    : 0;
  const tooltip = known
    ? `${label} // CURRENT ${formatCoordinate(reading?.current)} // MAX ${formatCoordinate(reading?.maximum)}`
    : `${label} // CURRENT UNKNOWN // MAX UNKNOWN`;

  return (
    <div className={styles.meter} data-tooltip={tooltip} aria-label={tooltip}>
      <span>{label}</span>
      <div className={`${styles.track} ${styles[tone]} ${known ? "" : styles.unknown}`}>
        {known ? <i style={{ width: `${percent}%` }} /> : <b>UNKNOWN // ?</b>}
      </div>
    </div>
  );
}
