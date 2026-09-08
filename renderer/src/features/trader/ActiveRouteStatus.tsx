import { useEffect, useId, useRef } from "react";
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
}: {
  execution: CargoExecutionState;
  connected: boolean;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}) {
  const route = execution.route;
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
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>ACTIVE ROUTE</p>
          <h3>{cargoRouteTitle(route)}</h3>
          <p>{execution.shipName ?? "Selected ship"} · One circuit</p>
        </div>
        <span className={styles.badge}>{execution.phase.replaceAll("_", " ")}</span>
      </div>
      <section className={styles.panel} aria-label="Run status">
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
        <div className={styles.workflowActions}>
          {resumable ? (
            <button
              className={styles.primary}
              type="button"
              disabled={!connected}
              onClick={onResume}
            >
              Start / resume one circuit
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
