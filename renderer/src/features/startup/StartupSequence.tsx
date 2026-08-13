import { useEffect, useRef, useState } from "react";

import styles from "./StartupSequence.module.css";

interface StartupSequenceProps {
  onComplete(): void;
}

interface Star {
  x: number;
  y: number;
  z: number;
  previousZ: number;
  brightness: number;
}

export function StartupSequence({ onComplete }: StartupSequenceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<
    "lotj" | "lotjDeparting" | "intro" | "jumping" | "departing" | "skipping"
  >("lotj");

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      onComplete();
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 1;
    let height = 1;
    let ratio = 1;
    let stars: Star[] = [];
    let jumpStartedAt: number | null = null;
    let stopped = false;
    let completed = false;
    let animationFrame = 0;
    let previous = performance.now();
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const clamp = (value: number, minimum: number, maximum: number) => (
      Math.min(maximum, Math.max(minimum, value))
    );

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

    const resetStar = (star: Partial<Star>, initial = false): Star => {
      const spread = Math.max(width, height);
      star.x = (Math.random() - 0.5) * spread * 1.7;
      star.y = (Math.random() - 0.5) * spread * 1.1;
      star.z = initial ? Math.random() * spread + 1 : spread;
      star.previousZ = star.z + 1;
      star.brightness = 0.35 + Math.random() * 0.65;
      return star as Star;
    };

    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      stars = Array.from(
        { length: Math.min(320, Math.floor((width * height) / 4200)) },
        () => resetStar({}, true),
      );
    };

    const draw = (now: number) => {
      if (stopped) return;
      const delta = Math.min(50, now - previous) / 16.67;
      previous = now;
      const focal = Math.min(width, height) * 0.82;
      const jumpProgress = jumpStartedAt === null
        ? 0
        : clamp((now - jumpStartedAt) / 950, 0, 1);
      context.fillStyle = jumpProgress > 0 ? "rgba(1, 3, 10, 0.24)" : "rgba(1, 3, 10, 0.58)";
      context.fillRect(0, 0, width, height);
      context.lineCap = "round";

      for (const star of stars) {
        star.previousZ = star.z;
        const projectedX = (star.x / star.z) * focal;
        const projectedY = (star.y / star.z) * focal;
        const edgeFactor = clamp(
          Math.hypot(projectedX, projectedY) / (Math.hypot(width, height) * 0.48),
          0,
          1,
        );
        const edgeActivation = clamp(jumpProgress * 1.75 - (1 - edgeFactor) * 0.95, 0, 1);
        star.z -= (1.15 + edgeActivation * 29) * delta;
        if (star.z < 1) resetStar(star);
        const sx = width / 2 + (star.x / star.z) * focal;
        const sy = height / 2 + (star.y / star.z) * focal;
        const tailDepth = star.previousZ + 2 + edgeActivation * 42;
        const px = width / 2 + (star.x / tailDepth) * focal;
        const py = height / 2 + (star.y / tailDepth) * focal;
        if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) {
          resetStar(star);
          continue;
        }
        const proximity = 1 - Math.min(1, star.z / Math.max(width, height));
        const color = edgeActivation > 0 ? "176, 222, 255" : "116, 173, 205";
        context.strokeStyle = `rgba(${color}, ${Math.max(0.12, proximity * star.brightness)})`;
        context.lineWidth = (0.7 + proximity + edgeActivation * 1.7) * star.brightness;
        context.beginPath();
        context.moveTo(px, py);
        context.lineTo(sx, sy);
        context.stroke();
      }
      animationFrame = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", skip);
    animationFrame = requestAnimationFrame(draw);
    if (reducedMotion) {
      schedule(() => setPhase("lotjDeparting"), 600);
      schedule(() => setPhase("intro"), 720);
      schedule(() => setPhase("departing"), 1_140);
      schedule(complete, 1_280);
    } else {
      schedule(() => setPhase("lotjDeparting"), 4_000);
      schedule(() => setPhase("intro"), 4_550);
      schedule(() => {
        jumpStartedAt = performance.now();
        setPhase("jumping");
      }, 8_450);
      schedule(() => setPhase("departing"), 9_750);
      schedule(complete, 10_450);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", skip);
      timers.forEach(clearTimeout);
    };
  }, [onComplete]);

  return (
    <section className={`${styles.sequence} ${styles[phase]}`} aria-label="LotJ and Holocron3D startup sequence">
      <canvas ref={canvasRef} className={styles.hyperspace} aria-hidden="true" />
      <div className={styles.vignette} aria-hidden="true" />
      {(phase === "lotj" || phase === "lotjDeparting") ? (
        <div className={styles.lotjStage}>
          <p className={styles.lotjIntro}>A long time ago in a galaxy far, far away....</p>
          <h1 className={styles.lotjTitle}>Legends of<br />the Jedi</h1>
          <p className={styles.lotjSubtitle}>The Galaxy Awaits</p>
        </div>
      ) : (
        <div className={styles.titleStage}>
          <h1 className={styles.title} aria-label="Holocron3D">
            <span className={styles.word}>Holocron</span><span className={styles.threeD}>3D</span>
          </h1>
          <p className={styles.veska}>Crafted by Veska</p>
        </div>
      )}
    </section>
  );
}
