import { ActiveRouteStatus } from "./ActiveRouteStatus";
import { emptyMarketArchive, mergeMarketArchive } from "./marketArchive";
import { calculateFreighterRoutes } from "../../domain/freighterRoutes";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cargoRouteIdentity,
  DEFAULT_CARGO_TIMING,
  cargoSystemCoordinates,
  normalizeExcludedNames,
  type CargoRoute,
} from "../../domain/cargoRoutes";
import type { CargoExecutionState } from "../../domain/cargoRouteExecution";
import type { GalaxyCatalog, LogisticsState, SystemSnapshot } from "../../types/telemetry";
import type { TraderConfigState, TraderPadConfig, TraderShipConfig } from "./traderConfig";
import { ShipSetup, PadSetup } from "./TraderSetup";
import { TraderRouteCard } from "./TraderRouteCard";
import { ManualRouteBuilder } from "./ManualRouteBuilder";
import styles from "./TraderWorkspace.module.css";

type Tab = "create" | "ships" | "pads" | "routes" | "active";
interface Props {
  connected: boolean;
  refreshError?: string | null;
  storageError?: string | null;
  snapshot: SystemSnapshot | null;
  catalog?: GalaxyCatalog | null;
  storedLogistics?: LogisticsState;
  execution: CargoExecutionState;
  config: TraderConfigState;
  onClose(): void;
  onRefresh(): void;
  onPauseRoute(): void;
  onArmRoute?(route: CargoRoute, shipId?: string): boolean;
  onResumeRoute(): void;
  onAbortRoute(): void;
  onAddShip(ship: TraderShipConfig): void;
  onDeleteShip(id: string): void;
  onSelectShip(id: string): void;
  onAddPad(pad: TraderPadConfig, previousPlanet?: string): void;
  onDeletePad(planet: string): void;
  onSaveRoute(route: CargoRoute, name?: string): boolean | void;
  onRenameRoute(id: string, name: string): void;
  onDeleteRoute(id: string): void;
}

export function TraderWorkspace(props: Props) {
  const { connected, snapshot, config, execution, onClose, onRefresh, refreshError, storageError } =
    props;
  const [tab, setTab] = useState<Tab>("create");
  const [maxJumps, setMaxJumps] = useState<number | "unlimited">(3);
  const [maxTradeStops, setMaxTradeStops] = useState<number | "unlimited">(6);
  const [startingPlanet, setStartingPlanet] = useState("");
  const [review, setReview] = useState<{ route?: CargoRoute; key: number } | undefined>();
  const reviewRoute = (route: CargoRoute, shipId?: string) => {
    if (shipId) props.onSelectShip(shipId);
    setReview({ route, key: Date.now() });
  };
  const [maxDistance, setMaxDistance] = useState("35");
  const [excludedClans, setExcludedClans] = useState<string[]>([]);
  const [avoidedPlanets, setAvoidedPlanets] = useState("");
  const [padPlanet, setPadPlanet] = useState("");
  const [padRequest, setPadRequest] = useState(0);
  const [visibleCount, setVisibleCount] = useState(10);
  const [calculationRequest, setCalculationRequest] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [tab, review]);
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const liveLogistics = snapshot?.metadata?.logistics;
  const logistics = useMemo(
    () =>
      mergeMarketArchive(
        { ...emptyMarketArchive, logistics: props.storedLogistics ?? {} },
        liveLogistics,
      ).logistics,
    [props.storedLogistics, liveLogistics],
  );
  const clanNames = useMemo(
    () =>
      [
        ...new Map(
          (logistics?.clans ?? [])
            .map((clan) => clan.name.trim())
            .filter(Boolean)
            .map((name) => [name.toLowerCase(), name]),
        ).values(),
      ].sort((left, right) => left.localeCompare(right)),
    [logistics?.clans],
  );
  const availableClans = clanNames.filter(
    (name) => !excludedClans.some((excluded) => excluded.toLowerCase() === name.toLowerCase()),
  );
  const refreshState = liveLogistics?.refresh;
  const refreshing = connected && refreshState?.phase === "refreshing";
  const planets = useMemo(() => logistics?.planets ?? [], [logistics?.planets]);
  const ship = config.ships.find((entry) => entry.id === config.selectedShipId);
  const freshMarkets = useMemo(
    () =>
      Object.values(logistics?.markets ?? {}).filter(
        (market) =>
          market.planet &&
          market.resources &&
          Number.isFinite(market.observedAt) &&
          planets.some((planet) => planet.name.toLowerCase() === market.planet?.toLowerCase()),
      ),
    [logistics?.markets, planets],
  );
  const capacityReady = !!ship && ship.capacity > 0;
  const ready = capacityReady && freshMarkets.length >= 2;
  const calculation = useMemo(() => {
    const routes =
      !ready || !ship
        ? []
        : calculateFreighterRoutes(
            planets.map((planet) => {
              const market = freshMarkets.find(
                (entry) => entry.planet?.toLowerCase() === planet.name.toLowerCase(),
              );
              return {
                name: planet.name,
                system: market?.system ?? planet.system,
                galacticCoordinates: cargoSystemCoordinates(
                  props.catalog,
                  market?.system ?? planet.system,
                ),
                governedBy: market?.governedBy ?? planet.governedBy,
                taxRate: market?.taxRate,
                resources: market?.resources ?? {},
              };
            }),
            logistics?.hyperlanes ?? [],
            {
              maxJumpsPerLeg: maxJumps,
              maxTradeStops,
              maxDistance: Number(maxDistance),
              startingPlanet: startingPlanet || undefined,
              cargoCapacity: ship.capacity,
              timing: ship.timing ?? DEFAULT_CARGO_TIMING,
              excludedClans: normalizeExcludedNames(excludedClans),
              avoidedPlanets: normalizeExcludedNames(avoidedPlanets.split(",").filter(Boolean)),
            },
          );
    return { routes, computedAt: Date.now() };
  }, [
    calculationRequest,
    ready,
    ship,
    freshMarkets,
    planets,
    logistics?.hyperlanes,
    maxJumps,
    maxDistance,
    startingPlanet,
    maxTradeStops,
    props.catalog,
    excludedClans,
    avoidedPlanets,
  ]);
  const routes = calculation.routes;
  useEffect(() => {
    setVisibleCount(10);
  }, [calculation]);
  const setPad = (planet: string) => {
    setPadPlanet(planet);
    setPadRequest((request) => request + 1);
    setTab("pads");
  };
  const refreshLabel = refreshing
    ? "Refreshing markets…"
    : refreshState?.phase === "failed"
      ? "Retry market refresh"
      : refreshState?.phase === "completed"
        ? "Refresh market rates"
        : "Refresh & find routes";
  const tabs: { id: Tab; title: string; count?: number }[] = [
    { id: "create", title: "Route Planner" },
    { id: "ships", title: "My ships", count: config.ships.length },
    { id: "pads", title: "Secret pads", count: config.pads.length },
    { id: "routes", title: "Routes", count: config.routes.length },
    ...(execution.route ? [{ id: "active" as const, title: "Active route" }] : []),
  ];
  return (
    <dialog
      ref={dialogRef}
      className={styles.workspace}
      aria-label="Trader workspace"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>HOLOCRON / TRADER</p>
          <h2>Plan your next cargo run.</h2>
        </div>
        <div className={styles.headerTools}>
          <span className={styles.connection}>
            <i data-connected={connected} />
            {connected ? "Mudlet connected" : "Offline setup"}
          </span>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close trader"
          >
            ×
          </button>
        </div>
      </header>
      {!review && (
        <nav className={styles.tabs} aria-label="Trader sections">
          {tabs.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={tab === item.id ? "page" : undefined}
              className={tab === item.id ? styles.activeTab : ""}
              onClick={() => setTab(item.id)}
            >
              {item.title}
              {item.count !== undefined && <span>{item.count}</span>}
            </button>
          ))}
        </nav>
      )}
      <main className={styles.content} ref={contentRef}>
        {storageError && (
          <p className={styles.error} role="alert">
            {storageError}
          </p>
        )}
        {review && (
          <section aria-label="Route creation workflow">
            <ManualRouteBuilder
              key={review.key}
              initialRoute={review.route}
              config={config}
              logistics={logistics}
              catalog={props.catalog}
              onBack={() => setReview(undefined)}
              onConfigureShip={() => {
                setReview(undefined);
                setTab("ships");
              }}
              onSave={(route, name) => {
                if (props.onSaveRoute(route, name) === false) return false;
                setReview(undefined);
                setTab("routes");
                return true;
              }}
              onPad={setPad}
              onSelectShip={props.onSelectShip}
            />
          </section>
        )}
        <div hidden={!!review}>
          {execution.route && (
            <section hidden={tab !== "active"} aria-label="Active route status">
              <ActiveRouteStatus
                execution={execution}
                connected={connected}
                onPause={props.onPauseRoute}
                onResume={props.onResumeRoute}
                onStop={props.onAbortRoute}
              />
            </section>
          )}
          <section hidden={tab !== "create"}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>ROUTE BUILDER</p>
                <h3>A ship. A market. A profitable loop.</h3>
                <p>
                  Compare market opportunities or craft your own route, then review and save it.
                </p>
              </div>
              <button
                type="button"
                className={styles.primary}
                onClick={() => setReview({ key: Date.now() })}
              >
                Manual route
              </button>
            </div>
            <div className={styles.plannerGrid}>
              <aside className={styles.panel}>
                <div className={styles.stepHeading}>
                  <span>01</span>
                  <h4>Choose your ship</h4>
                </div>
                {config.ships.length ? (
                  <>
                    <label>
                      Ship for this route
                      <select
                        value={config.selectedShipId ?? ""}
                        onChange={(event) => props.onSelectShip(event.target.value)}
                      >
                        {config.ships.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name} · {entry.capacity.toLocaleString()} units
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className={styles.hint}>
                      {capacityReady
                        ? `Estimates use an empty hold with ${ship?.capacity.toLocaleString()} units of capacity.`
                        : "Set this ship's cargo capacity in My ships before planning a route."}
                    </p>
                    <button type="button" className={styles.quiet} onClick={() => setTab("ships")}>
                      Manage ships
                    </button>
                  </>
                ) : (
                  <div className={styles.callout}>
                    <p>Add your ship's name and capacity to start planning.</p>
                    <button
                      type="button"
                      className={styles.primary}
                      onClick={() => setTab("ships")}
                    >
                      Add your first ship
                    </button>
                  </div>
                )}
                <div className={styles.stepHeading}>
                  <span>02</span>
                  <h4>Set route preferences</h4>
                </div>
                <label>
                  Starting planet
                  <select
                    value={startingPlanet}
                    onChange={(event) => setStartingPlanet(event.target.value)}
                  >
                    <option value="">Any planet</option>
                    {planets.map((planet) => (
                      <option key={planet.name} value={planet.name}>
                        {planet.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Maximum trade stops
                  <select
                    value={maxTradeStops}
                    onChange={(event) =>
                      setMaxTradeStops(
                        event.target.value === "unlimited"
                          ? "unlimited"
                          : Number(event.target.value),
                      )
                    }
                  >
                    {[2, 3, 4, 5, 6, 8, 10].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                    <option value="unlimited">Unlimited</option>
                  </select>
                  <small>
                    Distinct markets in the circuit, including the origin. Cargo is chosen
                    independently for every leg, including the return.
                  </small>
                </label>
                <label>
                  Maximum jumps between trade stops
                  <select
                    value={maxJumps}
                    onChange={(event) =>
                      setMaxJumps(
                        event.target.value === "unlimited"
                          ? "unlimited"
                          : Number(event.target.value),
                      )
                    }
                  >
                    {[1, 2, 3, 4, 5].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                    <option value="unlimited">Unlimited</option>
                  </select>
                  <small>
                    Applies independently to the outbound and return legs. Transit stops count as
                    jumps.
                  </small>
                </label>
                <label>
                  Max distance (sectors per jump)
                  <input
                    type="number"
                    min="0.1"
                    step="any"
                    required
                    value={maxDistance}
                    onChange={(event) => setMaxDistance(event.target.value)}
                  />
                  <small>
                    Each jump must fit your ship's range. Uses galactic system coordinates;
                    destinations with unknown coordinates are excluded.
                  </small>
                </label>
                {(!Number.isFinite(Number(maxDistance)) || Number(maxDistance) <= 0) && (
                  <p className={styles.error}>Enter a maximum distance greater than zero.</p>
                )}
                <details className={styles.details}>
                  <summary>Places to avoid</summary>
                  <label>
                    Excluded clans
                    <select
                      value=""
                      disabled={availableClans.length === 0}
                      onChange={(event) => {
                        const name = event.target.value;
                        if (availableClans.includes(name))
                          setExcludedClans((current) => [...current, name]);
                      }}
                    >
                      <option value="" disabled>
                        {clanNames.length === 0
                          ? "No clans loaded"
                          : availableClans.length === 0
                            ? "All known clans excluded"
                            : "Choose a clan to exclude"}
                      </option>
                      {availableClans.map((name) => (
                        <option key={name.toLowerCase()} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <small>
                      {clanNames.length === 0
                        ? "Refresh market rates to load the clan list."
                        : "Choose one or more clans. Their planets are excluded from trade and transit stops."}
                    </small>
                  </label>
                  {excludedClans.length > 0 && (
                    <ul className={styles.clanSelections} aria-label="Excluded clans">
                      {excludedClans.map((name) => (
                        <li key={name.toLowerCase()}>
                          <span>{name}</span>
                          <button
                            type="button"
                            className={styles.quiet}
                            aria-label={`Remove exclusion for ${name}`}
                            onClick={() =>
                              setExcludedClans((current) =>
                                current.filter((entry) => entry !== name),
                              )
                            }
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <label>
                    Avoided planets
                    <input
                      value={avoidedPlanets}
                      onChange={(event) => setAvoidedPlanets(event.target.value)}
                      placeholder="Planet names, separated by commas"
                    />
                  </label>
                </details>
                <div className={styles.padCallout}>
                  <span>
                    <strong>
                      {config.pads.length} secret {config.pads.length === 1 ? "pad" : "pads"}
                    </strong>
                    <small>Applied to matching route stops</small>
                  </span>
                  <button type="button" onClick={() => setTab("pads")}>
                    Manage
                  </button>
                </div>
                <div className={styles.stepHeading}>
                  <span>03</span>
                  <h4>Find profitable loops</h4>
                </div>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!ready}
                  onClick={() => setCalculationRequest((value) => value + 1)}
                >
                  Recalculate routes
                </button>
                <p className={styles.hint}>
                  Uses your current filters and available prices. No market scan is sent. Filter
                  changes also recalculate automatically.
                </p>
                {ready && (
                  <p className={styles.hint} role="status">
                    Calculated {new Date(calculation.computedAt).toLocaleTimeString()} using max
                    distance {maxDistance}, {maxJumps} jumps per leg and {maxTradeStops} trade
                    stops. {routes.length} results; the best routes may stay the same when limits
                    are relaxed.
                  </p>
                )}
                <p className={styles.hint}>
                  {connected
                    ? "Refreshes planets, clans, hyperlanes and every current market."
                    : "Offline planning uses stored markets and lane conditions. Connect Mudlet to refresh them."}
                </p>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={onRefresh}
                  disabled={!connected || refreshing || !capacityReady}
                >
                  {refreshLabel}
                </button>
                {refreshing && (
                  <div role="status" className={styles.refreshProgress}>
                    <progress value={refreshState.completed} max={refreshState.total} />
                    <span>
                      {refreshState.completed} of {refreshState.total} updates received
                    </span>
                  </div>
                )}
                {freshMarkets.length > 0 && (
                  <p className={styles.hint}>
                    {freshMarkets.length} stored markets. Oldest prices:{" "}
                    {new Date(
                      Math.min(...freshMarkets.map((market) => market.observedAt!)) * 1000,
                    ).toLocaleString()}
                    . Newest:{" "}
                    {new Date(
                      Math.max(...freshMarkets.map((market) => market.observedAt!)) * 1000,
                    ).toLocaleString()}
                    . Planning uses the latest stored observation for each planet; prices may come
                    from different scans. Refresh when you need current prices and lane conditions.
                    {logistics?.hyperlanesObservedAt
                      ? ` Lane conditions recorded ${new Date(logistics.hyperlanesObservedAt * 1000).toLocaleString()}.`
                      : " Lane observation time unavailable."}
                  </p>
                )}
                {(refreshError || refreshState?.error) && (
                  <p className={styles.error} role="alert">
                    {refreshError || refreshState?.error}
                  </p>
                )}
              </aside>
              <section aria-label="Route results">
                <div className={styles.listHeading}>
                  <h4>{ready ? `${routes.length} shortlisted loops` : "Your route shortlist"}</h4>
                  <span>Ranked by estimated profit / hour</span>
                </div>
                {routes.length ? (
                  <>
                    <p className={styles.hint}>
                      Shortlist of up to 500 circuits from a bounded search; longer circuits may not
                      be exhaustive. Estimates include purchases and after-tax sales on every leg.
                      Timing uses this ship's distance-based travel and market/transit stop
                      estimates, including empty legs. Fuel costs and available credits are not
                      included. Adjust timing in My ships.
                    </p>
                    <div className={styles.list}>
                      {routes.slice(0, visibleCount).map((route, index) => (
                        <TraderRouteCard
                          key={`${ship?.id}:${cargoRouteIdentity(route)}`}
                          route={route}
                          config={config}
                          featured={index === 0}
                          onReview={reviewRoute}
                          onPad={setPad}
                        />
                      ))}
                    </div>
                    {routes.length > visibleCount && (
                      <button type="button" onClick={() => setVisibleCount((count) => count + 10)}>
                        Show 10 more routes
                      </button>
                    )}
                  </>
                ) : (
                  <div className={styles.empty}>
                    <span className={styles.emptyMark}>{!ship ? "01" : "03"}</span>
                    <h4>
                      {!ship
                        ? "Every route starts with a ship"
                        : refreshing
                          ? "Reading the markets"
                          : ready
                            ? "No profitable loops match"
                            : refreshState?.phase === "failed"
                              ? "The refresh was interrupted"
                              : "Find your next opportunity"}
                    </h4>
                    <p>
                      {!ship
                        ? "Add a ship on the left. Its capacity determines the size of each planned load."
                        : refreshing
                          ? "Your shortlist will appear when the full market refresh finishes."
                          : ready
                            ? "Try allowing more jumps, increasing max distance, removing an exclusion, or refreshing market rates. Destinations also need known galactic coordinates."
                            : refreshState?.phase === "failed"
                              ? "Retry the refresh to build routes from a complete set of rates."
                              : "Refresh market rates to compare cargo loops across the current hyperlane network."}
                    </p>
                  </div>
                )}
              </section>
            </div>
          </section>
          <section hidden={tab !== "ships"}>
            <ShipSetup
              config={config}
              onSave={props.onAddShip}
              onSelect={props.onSelectShip}
              onDelete={props.onDeleteShip}
              onContinue={() => setTab("create")}
            />
          </section>
          <section hidden={tab !== "pads"}>
            <PadSetup
              key={padRequest}
              pads={config.pads}
              planets={planets.map((planet) => planet.name)}
              initialPlanet={padPlanet}
              onSave={props.onAddPad}
              onDelete={props.onDeletePad}
              onContinue={() => setTab("create")}
            />
          </section>
          <section hidden={tab !== "routes"}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.kicker}>YOUR SHORTLIST</p>
                <h3>Saved routes</h3>
                <p>
                  Keep useful loops with the ship they were planned for. Refresh rates before your
                  next run.
                </p>
              </div>
              <button type="button" onClick={() => setTab("create")}>
                Create a route →
              </button>
            </div>
            {!config.routes.length ? (
              <div className={styles.empty}>
                <span className={styles.emptyMark}>↗</span>
                <h4>Your next run belongs here</h4>
                <p>Find a loop, review its stops and pads, then give it a name and save it.</p>
                <button type="button" className={styles.primary} onClick={() => setTab("create")}>
                  Find a route
                </button>
              </div>
            ) : (
              <div className={styles.list}>
                {config.routes.map((route) => (
                  <TraderRouteCard
                    key={route.id}
                    route={route}
                    saved={route}
                    config={config}
                    onRename={props.onRenameRoute}
                    onReview={reviewRoute}
                    onArm={(route, shipId) => {
                      if (props.onArmRoute?.(route, shipId)) setTab("active");
                    }}
                    armLabel="Select route to run"
                    onDelete={props.onDeleteRoute}
                    onPad={setPad}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <footer className={styles.footer}>
        <span>Ships, pads and routes are saved on this device.</span>
        <span>Save a route, then select it in Routes to open Active route.</span>
      </footer>
    </dialog>
  );
}
