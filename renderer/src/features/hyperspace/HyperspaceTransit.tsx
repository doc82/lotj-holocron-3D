import { useEffect, useState } from "react";
import { HyperspaceField } from "./HyperspaceField";
import styles from "./HyperspaceTransit.module.css";

interface Props {
  reentry: boolean;
  escapePending: boolean;
  onEscape(): void;
}

export function HyperspaceTransit({ reentry, escapePending, onEscape }: Props) {
  const [reentryFadeStarted, setReentryFadeStarted] = useState(false);

  useEffect(() => {
    if (!reentry) {
      setReentryFadeStarted(false);
      return;
    }
    const frame = requestAnimationFrame(() => setReentryFadeStarted(true));
    return () => cancelAnimationFrame(frame);
  }, [reentry]);

  return (
    <section
      className={`${styles.transit} ${reentry ? styles.reentry : ""}`}
      style={
        reentry
          ? {
              animation: "none",
              opacity: reentryFadeStarted ? 0 : 1,
              filter: reentryFadeStarted ? "brightness(2.2)" : "brightness(1)",
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
