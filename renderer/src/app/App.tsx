import { useCallback, useMemo, useRef, useState } from "react";

import { buildScene, findScenePoint, formatCoordinate, sensorRangeFor, type ScenePoint } from "../domain/scene";
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
  if (point.condition) rows.push(["CONDITION", String(point.condition)]);
  for (const [label, key] of [["HULL", "hull"], ["SHIELDS", "shields"], ["ENERGY", "energy"]] as const) {
    const reading = point[key];
    if (typeof reading === "object" && reading) {
      const value = reading as { current?: number; maximum?: number };
      rows.push([label, `${formatCoordinate(value.current)} / ${formatCoordinate(value.maximum)}`]);
    }
  }
  if (point.target) rows.push(["TARGET", String(point.target)]);
  if (point.lifeforms) rows.push(["LIFEFORMS", String(point.lifeforms)]);
  if (point.lifeformScan) rows.push(["LIFEFORMS", String(point.lifeformScan)]);
  return rows;
}

export function App() {
  const telemetry = useTelemetry();
  const [starting, setStarting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [hoveredMemberId, setHoveredMemberId] = useState<string | null>(null);
  const [radarBubbleEnabled, setRadarBubbleEnabled] = useState(true);
  const [originGridEnabled, setOriginGridEnabled] = useState(false);
  const tacticalRef = useRef<TacticalCanvasHandle>(null);
  const scene = useMemo(() => buildScene(telemetry.snapshot), [telemetry.snapshot]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const finishStartup = useCallback(() => setStarting(false), []);
  const selectContact = useCallback((id: string | null) => {
    const point = findScenePoint(sceneRef.current, id);
    if (point?.kind === "cluster") {
      setExpandedClusterId(point.id);
      setSelectedId(null);
      setHoveredMemberId(null);
      return;
    }
    setExpandedClusterId(null);
    setHoveredMemberId(null);
    setSelectedId(id);
  }, []);
  const observer = scene.points[0];
  const expandedCluster = findScenePoint(scene, expandedClusterId);
  const selected = findScenePoint(scene, hoveredMemberId) ?? findScenePoint(scene, selectedId);
  const polling = telemetry.snapshot?.metadata?.polling;
  const landed = telemetry.spaceState?.inSpace === false;
  const sensorRange = telemetry.snapshot ? sensorRangeFor(telemetry.snapshot.observer) : null;

  return (
    <>
      {starting && <StartupSequence onComplete={finishStartup} />}
      <main className={`${styles.experience} ${starting ? styles.startupActive : ""}`}>
        <TacticalCanvas
          ref={tacticalRef}
          snapshot={telemetry.snapshot}
          radarBubbleEnabled={radarBubbleEnabled}
          originGridEnabled={originGridEnabled}
          onSelect={selectContact}
        />
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

        {telemetry.connected && (
          <aside className={`${styles.telemetry} ${styles.panel}`}>
            <p className={styles.eyebrow}>OBSERVER LOCK</p>
            <h2>{observer.name}</h2>
            <p className={styles.muted}>{observer.class || "Observer identity pending"}</p>
            <dl className={styles.readouts}>
              <div><dt>WORLD XYZ</dt><dd>{observer.worldPosition.map(formatCoordinate).join(" / ")}</dd></div>
              <div><dt>SPEED</dt><dd>{speedLabel(observer.speed)}</dd></div>
              <div><dt>SENSOR ARRAY</dt><dd>{observer.sensorArray === undefined ? "—" : formatCoordinate(observer.sensorArray)}</dd></div>
              <div><dt>SCAN RANGE</dt><dd>{sensorRange === null ? "—" : `${formatCoordinate(sensorRange)} u`}</dd></div>
              <div><dt>POLLING</dt><dd>{polling?.enabled ? String(polling.command || "ACTIVE").toUpperCase() : "OFF"}</dd></div>
              <div><dt>CONTACTS</dt><dd>{scene.contactCount}</dd></div>
              <div><dt>SEQUENCE</dt><dd>{telemetry.snapshot ? scene.sequence : "—"}</dd></div>
            </dl>
          </aside>
        )}

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

        {telemetry.connected && (
          <footer className={`${styles.controls} ${styles.panel}`}>
            <span><kbd>DRAG</kbd> orbit</span>
            <span><kbd>WHEEL</kbd> zoom</span>
            <span><kbd>F</kbd> fit system</span>
            <span><kbd>R</kbd> reset view</span>
            <button
              type="button"
              className={radarBubbleEnabled ? styles.activeControl : undefined}
              aria-pressed={radarBubbleEnabled}
              onClick={() => setRadarBubbleEnabled((enabled) => !enabled)}
            >
              RADAR {radarBubbleEnabled ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className={originGridEnabled ? styles.activeControl : undefined}
              aria-pressed={originGridEnabled}
              onClick={() => setOriginGridEnabled((enabled) => !enabled)}
            >
              ORIGIN GRID {originGridEnabled ? "ON" : "OFF"}
            </button>
            <button type="button" onClick={() => tacticalRef.current?.fitSystem()}>FIT SYSTEM</button>
          </footer>
        )}

        {expandedCluster?.members && (
          <section className={`${styles.clusterPanel} ${styles.panel}`} aria-label="Grouped ships">
            <header>
              <div>
                <p className={styles.eyebrow}>COLOCATED CONTACTS</p>
                <h2>{expandedCluster.memberCount} SHIPS AT {expandedCluster.worldPosition.map(formatCoordinate).join(" / ")}</h2>
              </div>
              <button
                type="button"
                className={styles.closeCluster}
                aria-label="Close grouped ships"
                onClick={() => {
                  setExpandedClusterId(null);
                  setHoveredMemberId(null);
                  setSelectedId(null);
                }}
              >
                ×
              </button>
            </header>
            <div className={styles.memberGrid}>
              {expandedCluster.members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={selectedId === member.id ? styles.selectedMember : undefined}
                  onMouseEnter={() => setHoveredMemberId(member.id)}
                  onMouseLeave={() => setHoveredMemberId(null)}
                  onFocus={() => setHoveredMemberId(member.id)}
                  onBlur={() => setHoveredMemberId(null)}
                  onClick={() => setSelectedId(member.id)}
                >
                  <strong>{member.name}</strong>
                  <span>{member.class || "Unknown ship class"}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
