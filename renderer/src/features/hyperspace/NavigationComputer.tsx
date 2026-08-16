import { useState } from "react";

import { MIN_HYPERSPACE_CLEARANCE, type HyperspaceClearance } from "../../domain/hyperspace";
import type { HyperspaceRoutePayload, HyperspaceState } from "../../types/telemetry";
import type { EscapePlanDraft } from "./HyperspacePlanner";
import styles from "./NavigationComputer.module.css";

interface Props {
  route: HyperspaceRoutePayload;
  state: HyperspaceState;
  escape?: EscapePlanDraft;
  clearance: HyperspaceClearance;
  onStop(): void;
  onDismiss(): void;
  onEngage(): void;
  onCalculateAnyway(): void;
}

const fmt = (value?: number) => Number.isFinite(value) ? Number(value).toLocaleString() : "—";

export function NavigationComputer({ route, state, escape, clearance, onStop, onDismiss, onEngage, onCalculateAnyway }: Props) {
  const [confirmDangerousEngage, setConfirmDangerousEngage] = useState(false);
  const phase = state.phase || "calculating";
  const destination = route.destination;
  const warning = phase === "fuel_warning";
  return <>
    <aside className={`${styles.computer} ${styles[phase]}`} aria-label="Hyperspace navigation computer">
      <header><span>NAV COMPUTER</span><strong>{phase.replace("_", " ").toUpperCase()}</strong></header>
      <div className={styles.recipient}>ROUTE FOR // {(route.recipientLabel || "YOUR SHIP").toUpperCase()}</div>
      <h3>{route.mode === "local" ? "LOCAL JUMP" : route.systemName || `GX ${route.galaxy?.x} / ${route.galaxy?.y}`}</h3>
      <p>SX {fmt(destination.x)} // SY {fmt(destination.y)} // SZ {fmt(destination.z)}</p>
      {Number.isFinite(state.remainingSeconds) && <div className={styles.countdown}><span style={{ width: `${Math.max(3, Math.min(100, Number(state.remainingSeconds)))}%` }} />
        <b>{state.remainingSeconds}s REMAINING</b></div>}
      {(state.fuelRequired || state.fuelPercent !== undefined) && <dl>
        <div><dt>FUEL REQUIRED</dt><dd>{fmt(state.fuelRequired)}</dd></div>
        <div><dt>RESERVES</dt><dd>{state.fuelPercent !== undefined ? `${state.fuelPercent}%` : fmt(state.fuelAvailable)}</dd></div>
      </dl>}
      {escape && <div className={styles.escape}><span>ESCAPE PLAN ARMED</span><b>GX {escape.route.galaxy?.x} / {escape.route.galaxy?.y}</b></div>}
      {phase === "ready" && <div className={`${styles.clearance} ${!clearance.known ? styles.clearancePending : clearance.allowed ? styles.clearanceSafe : styles.clearanceBlocked}`}>
        {!clearance.known
          ? `VERIFYING ${MIN_HYPERSPACE_CLEARANCE} U CLEARANCE // RADAR REQUESTED`
          : clearance.allowed
          ? `CLEARANCE CONFIRMED // ${clearance.nearestDistance === undefined ? "NO CONTACTS" : `NEAREST ${clearance.nearestName} ${Math.round(clearance.nearestDistance)} U`}`
          : `HYPERSPACE BLOCKED // ${clearance.reason?.toUpperCase()} // ${MIN_HYPERSPACE_CLEARANCE} U REQUIRED`}
      </div>}
      {state.error && <div className={styles.error}>{state.error}</div>}
      <footer>
        {phase === "calculating" && <button type="button" onClick={onStop}>ABORT CALC</button>}
        {phase === "ready" && <><button type="button" onClick={onDismiss}>DISMISS</button><button type="button" className={styles.engage} disabled={!clearance.allowed}
          onClick={() => state.insufficientFuel ? setConfirmDangerousEngage(true) : onEngage()}>ENGAGE</button></>}
        {["failed", "arrived"].includes(phase) && <button type="button" onClick={onDismiss}>CLOSE</button>}
      </footer>
    </aside>
    {warning && <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="fuel-title">
      <p>HYPERSPACE SAFETY INTERLOCK</p><h2 id="fuel-title">INSUFFICIENT FUEL</h2>
      <div className={styles.fuelComparison}><span><small>REQUIRED</small>{fmt(state.fuelRequired)}</span><i>›</i><span><small>AVAILABLE</small>{fmt(state.fuelAvailable)}</span></div>
      <p>This calculation was safely aborted. Continuing may leave the ship stranded or unable to complete the jump.</p>
      <footer><button type="button" onClick={onDismiss}>CANCEL ROUTE</button><button type="button" className={styles.danger} onClick={onCalculateAnyway}>CALCULATE ANYWAY</button></footer>
    </section></div>}
    {confirmDangerousEngage && <div className={styles.modalBackdrop} role="presentation"><section className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="engage-fuel-title">
      <p>FINAL COMMAND CONFIRMATION</p><h2 id="engage-fuel-title">ENGAGE WITHOUT SUFFICIENT FUEL?</h2>
      <div className={styles.fuelComparison}><span><small>REQUIRED</small>{fmt(state.fuelRequired)}</span><i>›</i><span><small>AVAILABLE NOW</small>{fmt(state.fuelAvailable)}</span></div>
      <p>The server accepted this calculation after your override. Holocron3D cannot guarantee that the ship will complete the jump.</p>
      <footer><button type="button" onClick={() => setConfirmDangerousEngage(false)}>GO BACK</button><button type="button" className={styles.danger} onClick={() => { setConfirmDangerousEngage(false); onEngage(); }}>ENGAGE ANYWAY</button></footer>
    </section></div>}
  </>;
}
