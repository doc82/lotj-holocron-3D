import { useEffect, useState } from "react";

import { HyperspaceField } from "../hyperspace/HyperspaceField";
import styles from "./StartupSequence.module.css";

interface StartupSequenceProps {
  onComplete(): void;
}

export function StartupSequence({ onComplete }: StartupSequenceProps) {
  const [phase, setPhase] = useState<
    "lotj" | "lotjDeparting" | "intro" | "jumping" | "departing" | "skipping"
  >("lotj");

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let completed = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const complete = () => {
      if (completed) return;
      completed = true;
      onComplete();
    };
    const schedule = (callback: () => void, delay: number) => {
      timers.push(setTimeout(callback, delay));
    };
    const skip = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || completed) return;
      event.preventDefault();
      setPhase("skipping");
      schedule(complete, 180);
    };

    window.addEventListener("keydown", skip);
    if (reducedMotion) {
      schedule(() => setPhase("lotjDeparting"), 600);
      schedule(() => setPhase("intro"), 720);
      schedule(() => setPhase("departing"), 1_140);
      schedule(complete, 1_280);
    } else {
      schedule(() => setPhase("lotjDeparting"), 4_000);
      schedule(() => setPhase("intro"), 4_550);
      schedule(() => setPhase("jumping"), 8_450);
      schedule(() => setPhase("departing"), 9_750);
      schedule(complete, 10_450);
    }

    return () => {
      window.removeEventListener("keydown", skip);
      timers.forEach(clearTimeout);
    };
  }, [onComplete]);

  const jumping = phase === "jumping" || phase === "departing";
  return (
    <section
      className={`${styles.sequence} ${styles[phase]}`}
      aria-label="LotJ and Holocron3D startup sequence"
    >
      <HyperspaceField engaged={jumping} className={styles.hyperspace} />
      <div className={styles.vignette} aria-hidden="true" />
      {phase === "lotj" || phase === "lotjDeparting" ? (
        <div className={styles.lotjStage}>
          <p className={styles.lotjIntro}>A long time ago in a galaxy far, far away....</p>
          <h1 className={styles.lotjTitle}>
            Legends of
            <br />
            the Jedi
          </h1>
          <p className={styles.lotjSubtitle}>The Galaxy Awaits</p>
        </div>
      ) : (
        <div className={styles.titleStage}>
          <h1 className={styles.title} aria-label="Holocron3D">
            <span className={styles.word}>Holocron</span>
            <span className={styles.threeD}>3D</span>
          </h1>
          <p className={styles.veska}>Crafted by Veska</p>
        </div>
      )}
    </section>
  );
}
