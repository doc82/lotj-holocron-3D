import { useCallback, useMemo, useRef, useState } from "react";

import { buildScene, formatCoordinate, type ScenePoint } from "../domain/scene";
import { UplinkNotice } from "../features/connection/UplinkNotice";
import { StartupSequence } from "../features/startup/StartupSequence";
import { TacticalCanvas, type TacticalCanvasHandle } from "../features/tactical/TacticalCanvas";
import { useTelemetry } from "../features/telemetry/useTelemetry";
import styles from "./App.module.css";

function speedLabel(speed: ScenePoint["speed"]): string {
  if (typeof speed === "object" && speed) {
    return `${formatCoordinate(speed.current)} / ${formatCoordinate(speed.maximum)}`;
  }
  return speed === undefined ? "—" : formatCoordinate(speed);
}

function detailRows(point: ScenePoint): Array<[string, string]> {
  const worldCoordinates = point.worldPosition.map(formatCoordinate).join(" / ");
  const rows: Array<[string, string]> = [["TYPE", point.kind || "unknown"]];
  if (point.id === "player-ship") {
    rows.push(["WORLD XYZ", worldCoordinates], ["CAMERA FOCUS", "LOCKED"]);
  } else {
    rows.push(
      ["SYSTEM XYZ", worldCoordinates],
      ["RELATIVE XYZ", point.position3d.map(formatCoordinate).join(" / ")],
    );
  }
  if (point.distance !== undefined) rows.push(["PROXIMITY", formatCoordinate(point.distance)]);
  if (point.speed !== undefined) rows.push(["VELOCITY", speedLabel(point.speed)]);
  if (point.position) rows.push(["FORMATION", point.position]);
  return rows;
}

export function App() {
  const telemetry = useTelemetry();
  const [starting, setStarting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const finishStartup = useCallback(() => setStarting(false), []);
  const selectContact = useCallback((id: string | null) => setSelectedId(id), []);
  const scene = useMemo(() => buildScene(telemetry.snapshot), [telemetry.snapshot]);
  const observer = scene.points[0];
  const selected = selectedId ? scene.points.find((point) => point.id === selectedId) ?? null : null;
  const polling = telemetry.snapshot?.metadata?.polling;
  const landed = telemetry.spaceState?.inSpace === false;

  return (
    <>
      {starting && <StartupSequence onComplete={finishStartup} />}
      <main className={`${styles.experience} ${starting ? styles.startupActive : ""}`}>
        <TacticalCanvas ref={tacticalRef} snapshot={telemetry.snapshot} onSelect={selectContact} />
        <div className={styles.scanlines} aria-hidden="true" />

        <header className={`${styles.topbar} ${styles.panel}`}>
          <div>
            <p className={styles.eyebrow}>HOLOCRON 3D // LIVE TACTICAL</p>
            <h1 id="system-name">{telemetry.snapshot ? scene.system : "Awaiting telemetry"}</h1>
          </div>
          <div className={styles.connection}>
            <span className={`${styles.light} ${telemetry.connected ? styles.live : ""}`} />
            <span>{telemetry.connectionLabel}</span>
          </div>
        </header>

        <aside className={`${styles.telemetry} ${styles.panel}`}>
          <p className={styles.eyebrow}>OBSERVER LOCK</p>
          <h2>{observer.name}</h2>
          <p className={styles.muted}>{observer.class || "Observer identity pending"}</p>
          <dl className={styles.readouts}>
            <div><dt>WORLD XYZ</dt><dd>{observer.worldPosition.map(formatCoordinate).join(" / ")}</dd></div>
            <div><dt>SPEED</dt><dd>{speedLabel(observer.speed)}</dd></div>
            <div><dt>POLLING</dt><dd>{polling?.enabled ? String(polling.command || "ACTIVE").toUpperCase() : "OFF"}</dd></div>
            <div><dt>CONTACTS</dt><dd>{Math.max(0, scene.points.length - 1)}</dd></div>
            <div><dt>SEQUENCE</dt><dd>{telemetry.snapshot ? scene.sequence : "—"}</dd></div>
            <div><dt>RANGE</dt><dd>{telemetry.snapshot ? `${formatCoordinate(scene.radius)} u` : "—"}</dd></div>
          </dl>
        </aside>

        {selected && (
          <aside className={`${styles.selection} ${styles.panel}`}>
            <p className={styles.eyebrow}>SELECTED CONTACT</p>
            <h2>{selected.name}</h2>
            <p className={styles.muted}>{selected.class || selected.kind || "Unknown contact"}</p>
            <dl className={styles.readouts}>
              {detailRows(selected).map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </aside>
        )}

        {landed && (
          <section className={styles.landed} role="status">
            <span>SPACE TELEMETRY PAUSED</span>
            <small>{telemetry.spaceState?.reason || "Ship is landed"}</small>
          </section>
        )}

        {!telemetry.connected && <UplinkNotice />}

        <footer className={`${styles.controls} ${styles.panel}`}>
          <span><kbd>DRAG</kbd> orbit</span>
          <span><kbd>WHEEL</kbd> zoom</span>
          <span><kbd>F</kbd> fit system</span>
          <span><kbd>R</kbd> reset view</span>
          <button type="button" onClick={() => tacticalRef.current?.fitSystem()}>FIT SYSTEM</button>
        </footer>
      </main>
    </>
  );
}
