import { useEffect, useId, useRef, useState } from "react";
import type { CargoExecutionState } from "../../domain/cargoRouteExecution";
import { cargoRouteTitle } from "../../domain/cargoRoutes";
import { freighterStops } from "../../domain/freighterRoutes";
import styles from "./TraderWorkspace.module.css";

export function ActiveRouteStatus({
  execution,
  connected,
  onPause,
  onResume,
  onStop,
  onClear,
}: {
  execution: CargoExecutionState;
  connected: boolean;
  onPause(): void;
  onResume(repeatUntilStopped?: boolean): void;
  onStop(): void;
  onClear(): void;
}) {
  const route = execution.route;
  const [repeat, setRepeat] = useState(execution.repeatUntilStopped === true);
  useEffect(
    () => setRepeat(execution.repeatUntilStopped === true),
    [route, execution.repeatUntilStopped],
  );
  const finished = ["completed", "aborted"].includes(execution.phase);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const cancelTitle = useId();
  const cancelDescription = useId();
  useEffect(() => {
    cancelDialog.current?.close();
  }, [route, finished]);
  if (!route) return null;
  const resumable = ["paused", "blocked", "armed"].includes(execution.phase);
  const descriptions = freighterStops(route);
  const accounts = execution.accounts;
  const expenses = (accounts?.cargo ?? 0) + (accounts?.fuel ?? 0) + (accounts?.tax ?? 0);
  const revenue = accounts?.revenue ?? 0;
  const profit = revenue - expenses;
  const runningMs = execution.runningMs ?? 0;
  const credits = (value: number) => `${Math.round(value).toLocaleString()} cr`;
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>ACTIVE ROUTE</p>
          <h3>{cargoRouteTitle(route)}</h3>
          <p>
            {execution.shipName ?? "Selected ship"} · Circuit {execution.circuit ?? 1}
            {execution.repeatUntilStopped ? " · Repeating until stopped" : ""}
          </p>
        </div>
        <span className={styles.badge}>{execution.phase.replaceAll("_", " ")}</span>
      </div>
      <section className={styles.panel} aria-label="Run status">
        <dl className={styles.sessionMetrics} aria-label="Session finances">
          <div>
            <dt>Total profit</dt>
            <dd>{credits(profit)}</dd>
          </div>
          <div>
            <dt>Total expenses</dt>
            <dd>{credits(expenses)}</dd>
          </div>
          <div>
            <dt>Total revenue</dt>
            <dd>{credits(revenue)}</dd>
          </div>
          <div>
            <dt>Credits per hour</dt>
            <dd>{runningMs > 0 ? credits((profit * 3600000) / runningMs) : "—"}</dd>
          </div>
        </dl>
        <p>
          Running time: {Math.floor(runningMs / 3600000)}h {Math.floor(runningMs / 60000) % 60}m{" "}
          {Math.floor(runningMs / 1000) % 60}s · Pauses excluded
        </p>
        <p>
          Expenses: cargo {credits(accounts?.cargo ?? 0)} · fuel {credits(accounts?.fuel ?? 0)} ·
          tax {credits(accounts?.tax ?? 0)}
        </p>
        {execution.flightPhase && <p>Flight phase: {execution.flightPhase.replaceAll("_", " ")}</p>}
        <p role="status">
          {finished
            ? execution.phase === "completed"
              ? "Circuit completed."
              : "Route cancelled."
            : (execution.pendingAction ??
              (resumable ? "Ready for your next action." : "Waiting for Mudlet confirmation."))}
        </p>
        <progress
          max={execution.stops.length}
          value={execution.phase === "completed" ? execution.stops.length : execution.stopIndex}
        />
        <p>
          Stop {Math.min(execution.stopIndex + 1, execution.stops.length)} of{" "}
          {execution.stops.length}: {execution.stops[execution.stopIndex]?.planet}
        </p>
        {execution.error && (
          <p role="alert" className={styles.error}>
            {execution.error}
          </p>
        )}
        {!connected && <p>Connect to Mudlet to start or resume this route.</p>}
        {resumable && (
          <p>
            Start outside your ship at the origin. After an interruption, verify your location and
            any unfinished transaction before resuming.
          </p>
        )}
        <div className={`${styles.workflowActions} ${styles.routeControls}`}>
          {resumable && (
            <label className={styles.repeatCircuit}>
              <input
                type="checkbox"
                checked={repeat}
                onChange={(event) => setRepeat(event.target.checked)}
              />{" "}
              Repeat circuit until stopped
            </label>
          )}
          {finished && (
            <button type="button" onClick={onClear}>
              Clear active route
            </button>
          )}
          {resumable ? (
            <button
              className={styles.primary}
              type="button"
              disabled={!connected}
              onClick={() => onResume(repeat)}
            >
              {repeat ? "Start / resume repeating circuit" : "Start / resume circuit"}
            </button>
          ) : (
            <button type="button" disabled={finished} onClick={onPause}>
              Pause
            </button>
          )}
          <button
            type="button"
            disabled={finished}
            onClick={() => cancelDialog.current?.showModal()}
          >
            Cancel route
          </button>
        </div>
      </section>
      <h4>Route itinerary</h4>
      <ol className={styles.list}>
        {execution.stops.map((stop, index) => (
          <li
            key={index}
            className={styles.panel}
            aria-current={!finished && index === execution.stopIndex ? "step" : undefined}
          >
            <strong>
              {index + 1}. {stop.planet}
              {index === execution.stops.length - 1 ? " (return)" : ""}
            </strong>
            <p>
              {index === execution.stops.length - 1
                ? "Return to origin and finish remaining stop actions."
                : descriptions[index]?.actions.join(" · ") || "Transit / refuel"}
            </p>
            {route.stopSettings?.[index]?.pad && (
              <p>Landing pad: {route.stopSettings[index].pad}</p>
            )}
            {route.stopSettings?.[index]?.tradeMode === "contraband" && <p>Trafficking commands</p>}
          </li>
        ))}
      </ol>
      <dialog
        ref={cancelDialog}
        className={styles.cancelDialog}
        aria-labelledby={cancelTitle}
        aria-describedby={cancelDescription}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          cancelDialog.current?.close();
        }}
        onClose={(event) => event.stopPropagation()}
      >
        <h3 id={cancelTitle}>Cancel active route?</h3>
        <p>{cargoRouteTitle(route)}</p>
        <p id={cancelDescription}>
          This stops automation for this run. A command already sent to the game may still finish.
          Your saved route will be kept.
        </p>
        <div className={styles.workflowActions}>
          <button type="button" autoFocus onClick={() => cancelDialog.current?.close()}>
            Keep route
          </button>
          <button
            type="button"
            className={styles.danger}
            disabled={finished}
            onClick={() => {
              if (!cancelDialog.current?.open || finished) return;
              cancelDialog.current.close();
              onStop();
            }}
          >
            Yes, cancel route
          </button>
        </div>
      </dialog>
    </>
  );
}
