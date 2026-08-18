import { useEffect, useState } from "react";
import { HyperspaceField } from "./HyperspaceField";
import styles from "./HyperspaceTransit.module.css";

interface Props {
  reentry: boolean;
  arrived: boolean;
  escapePending: boolean;
  onEscape(): void;
}

export function HyperspaceTransit({ reentry, arrived, escapePending, onEscape }: Props) {
  const [reentryFadeStarted, setReentryFadeStarted] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!arrived) {
      setReentryFadeStarted(false);
      setHidden(false);
      return;
    }
    const frame = requestAnimationFrame(() => setReentryFadeStarted(true));
    const timer = window.setTimeout(() => setHidden(true), 5_000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [arrived]);

  if (hidden) return null;

  return (
    <section
      className={`${styles.transit} ${reentry ? styles.reentry : ""}`}
      style={
        reentry
          ? {
              animation: "none",
              opacity: arrived && reentryFadeStarted ? 0 : 1,
              filter: arrived && reentryFadeStarted ? "brightness(2.2)" : "brightness(1)",
              transition: "opacity 5s ease-out, filter 5s ease-out",
            }
          : undefined
      }
      aria-label={reentry ? "Returning to realspace" : "Hyperspace transit"}
    >
      <HyperspaceField engaged className={styles.field} />
      <div className={styles.vignette} aria-hidden="true" />
      <div className={styles.readout} aria-live="polite">
        <span>{reentry ? "DESTINATION REACHED" : "HYPERSPACE TRANSIT"}</span>
        <strong>{reentry ? "REALSPACE REENTRY" : "NAVIGATION LOCKED"}</strong>
      </div>
      {!reentry && (
        <div className={styles.emergencyHousing} data-tooltip="ESCAPE HYPERSPACE">
          <span>EMERGENCY HYPERDRIVE CUTOFF</span>
          <button
            type="button"
            aria-label="Escape hyperspace"
            title="Escape hyperspace"
            disabled={escapePending}
            onClick={onEscape}
          >
            <i aria-hidden="true" />
          </button>
          <small>{escapePending ? "CUTOFF COMMAND SENT" : "PRESS TO ABORT TRANSIT"}</small>
        </div>
      )}
    </section>
  );
}
