import {
  navigationWaypoints,
  navigationNode,
  validateNavigationPath,
} from "../../domain/navigationTopology";
import { useEffect, useMemo, useRef, useState } from "react";
import { manualCargoRoute, routeReviewStops, type ManualStop } from "../../domain/manualCargoRoute";
import {
  cargoSystemCoordinates,
  cargoRouteTitle,
  type CargoRoute,
  type PlanetMarket,
} from "../../domain/cargoRoutes";
import type { GalaxyCatalog, LogisticsState } from "../../types/telemetry";
import type { TraderConfigState } from "./traderConfig";
import { TraderRouteCard } from "./TraderRouteCard";
import styles from "./TraderWorkspace.module.css";

export function ManualRouteBuilder({
  initialRoute,
  config,
  logistics,
  catalog,
  onSave,
  onBack,
  onConfigureShip,
  onPad,
  onSelectShip,
}: {
  initialRoute?: CargoRoute;
  config: TraderConfigState;
  logistics: LogisticsState;
  catalog?: GalaxyCatalog | null;
  onSave(route: CargoRoute, name?: string): boolean | void;
  onBack(): void;
  onConfigureShip(): void;
  onPad(planet: string): void;
  onSelectShip(id: string): void;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  useEffect(() => {
    backRef.current?.scrollIntoView({ block: "start" });
  }, [step]);
  const [routeName, setRouteName] = useState(initialRoute ? cargoRouteTitle(initialRoute) : "");
  const [saveError, setSaveError] = useState("");
  const [stops, setStops] = useState<ManualStop[]>(() =>
    initialRoute
      ? routeReviewStops(initialRoute)
      : [
          { planet: "", action: "buy", resource: "" },
          { planet: "", action: "sell_buy", resource: "" },
        ],
  );
  const [quantity, setQuantity] = useState(String(initialRoute?.quantity ?? 10));
  const [maxDistance, setMaxDistance] = useState(String(initialRoute?.maxDistance ?? 35));
  const [returnSettings, setReturnSettings] = useState(initialRoute?.stopSettings?.at(-1));
  const ship = config.ships.find((ship) => ship.id === config.selectedShipId);
  const markets = useMemo(() => {
    const known = new Map<string, PlanetMarket>();
    for (const planet of logistics.planets ?? [])
      known.set(planet.name.toLowerCase(), {
        name: planet.name,
        system: planet.system,
        galacticCoordinates: cargoSystemCoordinates(catalog, planet.system),
        resources: {},
      });
    for (const market of Object.values(logistics.markets ?? {}))
      if (market.planet)
        known.set(market.planet.toLowerCase(), {
          name: market.planet,
          system: market.system,
          taxRate: market.taxRate,
          galacticCoordinates: cargoSystemCoordinates(catalog, market.system),
          resources: market.resources ?? {},
        });
    for (const waypoint of navigationWaypoints)
      known.set(waypoint.name.toLowerCase(), { ...waypoint, resources: {} });
    for (const market of known.values()) {
      const node = navigationNode(market.name);
      market.galacticCoordinates ??= node ? { x: node.x, y: node.y } : undefined;
    }
    return [...known.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [logistics, catalog]);
  const resources = [...new Set(markets.flatMap((market) => Object.keys(market.resources)))].sort();
  const preview = useMemo(() => {
    try {
      if (!ship) throw new Error("Select a ship to prepare a manual circuit.");
      if (Number(quantity) > ship.capacity)
        throw new Error("Cargo quantity exceeds the selected ship's capacity.");
      const route = manualCargoRoute(
        stops,
        markets,
        Number(quantity),
        Number(maxDistance),
        ship.timing,
        returnSettings,
      );
      validateNavigationPath(
        [route.legs![0].from, ...route.legs!.flatMap((leg) => leg.path.slice(1))],
        true,
      );
      return { route };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Check the route." };
    }
  }, [stops, markets, quantity, maxDistance, ship, returnSettings]);
  const update = (index: number, patch: Partial<ManualStop>) =>
    setStops((current) => current.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)));
  const move = (index: number, delta: number) =>
    setStops((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  return (
    <>
      <button type="button" className={styles.quiet} ref={backRef} onClick={onBack}>
        Back to tabs
      </button>
      <ol className={styles.workflowSteps} aria-label="Route creation steps">
        {["Review route", "Craft / pick a route", "Save route"].map((label, index) => (
          <li key={label} aria-current={step === index + 1 ? "step" : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>{initialRoute ? "REVIEW ROUTE" : "MANUAL ROUTE"}</p>
          <h3>
            {step === 1 ? "Review your route" : step === 2 ? "Craft your route" : "Save your route"}
          </h3>
          <p>
            Your exact stop order is used. Unverified directions can be explored, but known No Path
            connections and unavailable temporary lanes stop autopilot.
          </p>
        </div>
      </div>
      {step === 1 && (
        <section aria-label="Review route">
          <p>
            {initialRoute
              ? "Review the proposed circuit, then adjust its stops, pads and trading commands."
              : "Build a route from scratch. Choose your ship and every stop in the next step."}
          </p>
          {initialRoute && (
            <TraderRouteCard route={initialRoute} config={config} onPad={onPad} readOnly />
          )}
          <div className={styles.workflowActions}>
            <button type="button" className={styles.primary} onClick={() => setStep(2)}>
              Continue to route editor
            </button>
          </div>
        </section>
      )}
      <div hidden={step !== 2}>
        <div className={styles.panel}>
          {!config.ships.length && (
            <div role="status">
              <p>Add a ship before saving a route.</p>
              <button type="button" onClick={onConfigureShip}>
                Add a ship
              </button>
            </div>
          )}
          <label>
            Ship
            <select value={ship?.id ?? ""} onChange={(event) => onSelectShip(event.target.value)}>
              <option value="" disabled>
                Select a ship
              </option>
              {config.ships.map((ship) => (
                <option key={ship.id} value={ship.id}>
                  {ship.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cargo quantity per purchase
            <input
              type="number"
              min="1"
              max={ship?.capacity}
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            Maximum sector distance
            <input
              type="number"
              min="1"
              value={maxDistance}
              onChange={(event) => setMaxDistance(event.target.value)}
            />
          </label>
          <datalist id="manual-planets">
            {markets.map((planet) => (
              <option key={planet.name} value={planet.name} />
            ))}
          </datalist>
          <datalist id="manual-goods">
            {resources.map((resource) => (
              <option key={resource} value={resource} />
            ))}
          </datalist>
          <ol className={styles.list}>
            {stops.map((stop, index) => (
              <li key={index} className={styles.panel}>
                <label>
                  {index === 0 ? "Origin" : `Stop ${index + 1}`}
                  <input
                    list="manual-planets"
                    value={stop.planet}
                    onChange={(event) => update(index, { planet: event.target.value })}
                  />
                </label>
                <label>
                  Action at stop {index + 1}
                  <select
                    value={stop.action}
                    onChange={(event) =>
                      update(index, { action: event.target.value as ManualStop["action"] })
                    }
                  >
                    <option value="transit">Transit / refuel (keep cargo)</option>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell carried cargo</option>
                    <option value="sell_buy">Sell and buy</option>
                  </select>
                </label>
                {(stop.action === "buy" || stop.action === "sell_buy") && (
                  <label>
                    Good to buy at stop {index + 1}
                    <input
                      list="manual-goods"
                      value={stop.resource}
                      onChange={(event) => update(index, { resource: event.target.value })}
                    />
                  </label>
                )}
                <label>
                  Landing pad at stop {index + 1}
                  <input
                    value={
                      stop.pad ??
                      config.pads.find(
                        (pad) => pad.planet.toLowerCase() === stop.planet.toLowerCase(),
                      )?.pad ??
                      ""
                    }
                    placeholder="Automatic landing"
                    onChange={(event) => update(index, { pad: event.target.value })}
                  />
                </label>
                <label>
                  Trading commands at stop {index + 1}
                  <select
                    value={stop.tradeMode ?? "cargo"}
                    onChange={(event) =>
                      update(index, { tradeMode: event.target.value as "cargo" | "contraband" })
                    }
                  >
                    <option value="cargo">Cargo (buycargo / sellcargo)</option>
                    <option value="contraband">Trafficking (buycontraband / sellcontraband)</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move stop ${index + 1} up`}
                  onClick={() => move(index, -1)}
                >
                  Move up
                </button>{" "}
                <button
                  type="button"
                  disabled={index === stops.length - 1}
                  aria-label={`Move stop ${index + 1} down`}
                  onClick={() => move(index, 1)}
                >
                  Move down
                </button>{" "}
                <button
                  type="button"
                  disabled={stops.length <= 2}
                  aria-label={`Remove stop ${index + 1}`}
                  onClick={() => setStops((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() =>
              setStops((current) => [...current, { planet: "", action: "transit", resource: "" }])
            }
          >
            Add stop
          </button>
          <label>
            Landing pad on final return to {stops[0].planet || "origin"}
            <input
              value={
                returnSettings?.pad ??
                stops[0].pad ??
                config.pads.find(
                  (pad) => pad.planet.toLowerCase() === stops[0].planet.toLowerCase(),
                )?.pad ??
                ""
              }
              placeholder="Use origin pad"
              onChange={(event) =>
                setReturnSettings({
                  ...returnSettings,
                  planet: stops[0].planet,
                  pad: event.target.value,
                })
              }
            />
          </label>
          <label>
            Trading commands on final return
            <select
              value={returnSettings?.tradeMode ?? stops[0].tradeMode ?? "cargo"}
              onChange={(event) =>
                setReturnSettings({
                  ...returnSettings,
                  planet: stops[0].planet,
                  tradeMode: event.target.value as "cargo" | "contraband",
                })
              }
            >
              <option value="cargo">Cargo (sellcargo)</option>
              <option value="contraband">Trafficking (sellcontraband)</option>
            </select>
          </label>
          {(stops.some((stop) => stop.tradeMode === "contraband") ||
            returnSettings?.tradeMode === "contraband") && (
            <p className={styles.hint}>
              Trafficking skips local sale tax, cargo permits and embargoes. Failed skill checks can
              alert authorities and make you WANTED. The estimate assumes success and uses current
              market prices.
            </p>
          )}
          <p className={styles.hint}>
            Return to {stops[0].planet || "the origin"} is added automatically, including the final
            sale of any carried cargo. Add every return transit stop before that return. Cargo stays
            aboard at transit stops.
          </p>
          {preview.error && (
            <p role="status" className={styles.hint}>
              {preview.error}
            </p>
          )}
        </div>
        <div className={styles.workflowActions}>
          <button type="button" onClick={() => setStep(1)}>
            Back to review
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!preview.route}
            onClick={() => {
              if (!routeName.trim() && preview.route) setRouteName(cargoRouteTitle(preview.route));
              setStep(3);
            }}
          >
            Continue to save
          </button>
        </div>
      </div>
      {step === 3 && (
        <section aria-label="Save route">
          {preview.route ? (
            <>
              <label>
                Route name
                <input
                  value={routeName}
                  maxLength={100}
                  onChange={(event) => setRouteName(event.target.value)}
                />
              </label>
              <p>
                Saved routes are available in Routes. Select one there to open Active route and
                start the run.
              </p>
              <TraderRouteCard route={preview.route} config={config} onPad={onPad} readOnly />
            </>
          ) : (
            <p role="alert">{preview.error}</p>
          )}
          {saveError && (
            <p role="alert" className={styles.error}>
              {saveError}
            </p>
          )}
          <div className={styles.workflowActions}>
            <button type="button" onClick={() => setStep(2)}>
              Back to route editor
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={!preview.route || !routeName.trim()}
              onClick={() => {
                if (!preview.route) return;
                try {
                  if (onSave(preview.route, routeName.trim()) === false)
                    setSaveError(
                      "Could not save the route. Your draft is still here; please try again.",
                    );
                } catch {
                  setSaveError(
                    "Could not save the route. Your draft is still here; please try again.",
                  );
                }
              }}
            >
              Save route
            </button>
          </div>
        </section>
      )}
    </>
  );
}
