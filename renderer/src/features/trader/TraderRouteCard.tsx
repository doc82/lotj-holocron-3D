import { navigationWaypoint } from "../../domain/navigationTopology";
import { freighterStops } from "../../domain/freighterRoutes";
import { useState } from "react";
import { cargoRouteTitle, type CargoRoute } from "../../domain/cargoRoutes";
import { padForPlanet, type TraderConfigState, type TraderSavedRoute } from "./traderConfig";
import { RemoveButton } from "./TraderSetup";
import styles from "./TraderWorkspace.module.css";

const credits = (value: number) => `${Math.round(value).toLocaleString()} cr`;

export function TraderRouteCard({
  route,
  config,
  saved,
  featured,
  onSave,
  onArm,
  onReview,
  armLabel = "Prepare autopilot",
  readOnly = false,
  onRename,
  onDelete,
  onPad,
}: {
  route: CargoRoute;
  armLabel?: string;
  readOnly?: boolean;
  config: TraderConfigState;
  saved?: TraderSavedRoute;
  featured?: boolean;
  onSave?(route: CargoRoute, name: string): void;
  onReview?(route: CargoRoute, shipId?: string): void;
  onArm?(route: CargoRoute, shipId?: string): void;
  onRename?(id: string, name: string): void;
  onDelete?(id: string): void;
  onPad(planet: string): void;
}) {
  const [name, setName] = useState(saved?.name ?? cargoRouteTitle(route));
  const [notice, setNotice] = useState("");
  const ship = config.ships.find(
    (entry) => entry.id === (saved ? saved.shipId : config.selectedShipId),
  );
  const stops = freighterStops(route).map((stop) => ({
    ...stop,
    purpose: stop.actions.length ? "Trade stop" : "Pit stop",
  }));
  return (
    <article className={`${styles.routeCard} ${featured ? styles.featured : ""}`}>
      {onReview && (
        <button type="button" onClick={() => onReview(route, ship?.id)}>
          Review route
        </button>
      )}
      {onArm && (
        <button type="button" disabled={!ship} onClick={() => onArm(route, ship?.id)}>
          {armLabel}
        </button>
      )}
      {saved && onDelete && !readOnly && (
        <RemoveButton label={saved.name} onRemove={() => onDelete(saved.id)} />
      )}
      <div className={styles.cardHeading}>
        <div>
          <p className={styles.kicker}>
            {route.manual
              ? "MANUAL CIRCUIT"
              : saved
                ? "SAVED LOOP"
                : featured
                  ? "TOP ESTIMATE"
                  : "CARGO LOOP"}{" "}
            ·{" "}
            {route.manual
              ? `${route.totalLoopJumps} jumps`
              : route.legs
                ? `${route.legs.length} trade stops`
                : route.resource}
          </p>
          <h4>{saved?.name ?? cargoRouteTitle(route)}</h4>
          <p className={styles.hint}>
            {ship?.name ?? "No ship assigned"} · {route.quantity.toLocaleString()} units ·{" "}
            {route.totalLoopJumps} loop jumps ·{" "}
            {(route.totalDurationSeconds / 60).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{" "}
            estimated minutes
          </p>
        </div>
        <div className={styles.profit}>
          <strong>
            {route.estimateAvailable === false
              ? "Prices missing"
              : credits(route.expectedProfitPerHour)}
          </strong>
          <small>
            {route.estimateAvailable === false ? "Profit estimate unavailable" : "estimated / hour"}
          </small>
        </div>
      </div>
      {saved?.savedAt && (
        <p className={styles.hint}>
          Saved {new Date(saved.savedAt * 1000).toLocaleString()}. This estimate retains its
          original market prices.
        </p>
      )}
      {route.estimateAvailable !== false && (
        <div className={styles.routeMetrics}>
          <span>
            Buy cost <b>{credits(route.purchaseCost)}</b>
          </span>
          <span>
            Sale after tax <b>{credits(route.saleRevenue)}</b>
          </span>
          <span>
            Loop profit <b>{credits(route.expectedProfit)}</b>
          </span>
        </div>
      )}
      <details className={styles.details} open={featured || undefined}>
        <summary>Stops & landing pads · {route.totalLoopJumps} total jumps</summary>
        <ol className={styles.stops}>
          {stops.map((stop, index) => {
            const settings = route.stopSettings?.[index];
            const pad =
              settings?.pad !== undefined
                ? settings.pad
                  ? { planet: stop.planet, pad: settings.pad }
                  : undefined
                : padForPlanet(config.pads, stop.planet);
            const waypoint = navigationWaypoint(stop.planet);
            const stationStop = stop.purpose === "Pit stop" && waypoint;
            return (
              <li key={`${index}-${stop.planet}`}>
                <span className={styles.stopNumber}>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{stop.planet}</strong>
                  {settings?.tradeMode === "contraband" && (
                    <small>Trafficking: contraband commands</small>
                  )}
                  {stop.actions.length ? (
                    stop.actions.map((action) => <small key={action}>{action}</small>)
                  ) : (
                    <small>Pit stop · no cargo trade</small>
                  )}
                  <small>
                    {stationStop
                      ? `Refuel: ${stationStop.refuelStation}`
                      : pad
                        ? `Secret pad: ${pad.pad}`
                        : "No preferred pad"}
                  </small>
                  {stationStop && (
                    <small>
                      Station coordinates: {stationStop.refuelCoordinates.x}{" "}
                      {stationStop.refuelCoordinates.y} {stationStop.refuelCoordinates.z}
                    </small>
                  )}
                </div>
                <span className={stop.purpose === "Pit stop" ? styles.transitBadge : styles.badge}>
                  {stop.purpose}
                </span>
                {!readOnly && !stationStop && !route.stopSettings && !onReview && (
                  <button
                    type="button"
                    className={styles.quiet}
                    aria-label={`Set pad for ${stop.planet} at stop ${index + 1}`}
                    onClick={() => onPad(stop.planet)}
                  >
                    {pad ? "Edit pad" : "Set pad"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <p className={styles.hint}>
          Round trip: return to {route.buyPlanet} after the final listed stop. Return travel is
          included in the estimate.
        </p>
        {(onSave || (saved && onRename)) && (
          <form
            className={styles.routeNaming}
            onSubmit={(event) => {
              event.preventDefault();
              if (saved) onRename?.(saved.id, name);
              else onSave?.(route, name);
              setNotice(saved ? "Route renamed." : "Route saved. Find it in Saved routes.");
            }}
          >
            <label>
              Route name
              <input
                aria-label={`Route name for ${route.buyPlanet} to ${route.sellPlanet}`}
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button type="submit" className={styles.primary} disabled={!name.trim()}>
              {saved ? "Rename route" : "Save route"}
            </button>
          </form>
        )}
        <p role="status" className={styles.hint}>
          {notice}
        </p>
      </details>
    </article>
  );
}
