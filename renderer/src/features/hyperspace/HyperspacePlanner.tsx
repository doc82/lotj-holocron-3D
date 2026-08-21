import { useCallback, useEffect, useMemo, useState } from "react";

import { useLatestRef } from "../../hooks/useLatestRef";
import { PlanetSphere } from "../../components/PlanetSphere";
import {
  clampSectorCoordinate,
  escapeDestinationInRange,
  MIN_HYPERSPACE_CLEARANCE,
  randomSectorDestinationBeyond,
  sectorDistance,
} from "../../domain/hyperspace";
import type { MotionTrackMap } from "../../domain/hyperspacePrediction";
import type {
  GalaxyCatalog,
  GalaxyPlanet,
  GalaxySystem,
  HyperspaceRoutePayload,
  SystemSnapshot,
} from "../../types/telemetry";
import { LocalHyperspaceView } from "./LocalHyperspaceView";
import styles from "./HyperspacePlanner.module.css";

export interface EscapePlanDraft {
  route: HyperspaceRoutePayload;
  triggerGalaxy: { x: number; y: number };
}

interface Props {
  mode: "local" | "galactic";
  recipientLabel: string;
  escapeAllowed?: boolean;
  catalog: GalaxyCatalog | null;
  currentSystem?: string;
  currentGalaxy?: { x: number; y: number };
  observer: { x?: number; y?: number; z?: number };
  snapshot?: SystemSnapshot | null;
  hyperspeed?: number;
  motionTracks?: MotionTrackMap;
  destinations?: Array<{
    system: string;
    distanceParsecs: number;
    reachable: boolean;
    travelTime?: string;
    fuelPercent?: number;
  }>;
  onCancel(): void;
  onPlot(route: HyperspaceRoutePayload, escape?: EscapePlanDraft): void;
}

const numeric = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function normalizeCatalog(catalog: GalaxyCatalog | null): GalaxySystem[] {
  const merged = { ...(catalog?.systems || {}), ...(catalog?.customSystems || {}) };
  return Object.entries(merged)
    .flatMap(([name, raw]) => {
      const x = Number(raw.x);
      const y = Number(raw.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
      const keyedPlanets = Object.entries(raw).flatMap(([planetName, planetRaw]) => {
        if (
          ["x", "y", "name", "planets"].includes(planetName) ||
          typeof planetRaw !== "object" ||
          !planetRaw
        )
          return [];
        const planet = planetRaw as Record<string, unknown>;
        if (!("government" in planet || "z" in planet)) return [];
        return [
          {
            name: String(planet.name || planetName),
            government: String(planet.government || "A Neutral Government"),
            x: Number(planet.x) || 0,
            y: Number(planet.y) || 0,
            z: Number(planet.z) || 0,
          } satisfies GalaxyPlanet,
        ];
      });
      const listedPlanets = Array.isArray(raw.planets)
        ? raw.planets.flatMap((planetRaw) => {
            if (typeof planetRaw !== "object" || !planetRaw) return [];
            const planet = planetRaw as Record<string, unknown>;
            if (!planet.name) return [];
            return [
              {
                name: String(planet.name),
                government: String(planet.government || "A Neutral Government"),
                x: Number(planet.x) || 0,
                y: Number(planet.y) || 0,
                z: Number(planet.z) || 0,
              } satisfies GalaxyPlanet,
            ];
          })
        : [];
      const planets = [
        ...new Map(
          [...keyedPlanets, ...listedPlanets].map((planet) => [planet.name, planet]),
        ).values(),
      ];
      return [{ name, x, y, planets, custom: Boolean(catalog?.customSystems?.[name]) }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return Math.abs(result >>> 0);
}

function Planet({
  planet,
  selected,
  onClick,
}: {
  planet: GalaxyPlanet;
  selected?: boolean;
  onClick?(): void;
}) {
  return (
    <button
      type="button"
      className={`${styles.planet} ${selected ? styles.selectedPlanet : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      aria-label={`Select ${planet.name}`}
    >
      <PlanetSphere name={planet.name} className={styles.planetSphere} />
      <em>{planet.name}</em>
    </button>
  );
}

export function HyperspacePlanner({
  mode,
  recipientLabel,
  escapeAllowed = true,
  catalog,
  currentSystem,
  currentGalaxy,
  observer,
  snapshot = null,
  hyperspeed,
  motionTracks = new Map(),
  destinations = [],
  onCancel,
  onPlot,
}: Props) {
  const onCancelRef = useLatestRef(onCancel);
  const rangeDataPending = destinations.length === 0;
  const systems = useMemo(() => normalizeCatalog(catalog), [catalog]);
  const catalogPending = mode === "galactic" && systems.length === 0;
  const current = systems.find((system) => system.name === currentSystem);
  const [selectedName, setSelectedName] = useState(currentSystem || systems[0]?.name || "");
  const selectedSystem = systems.find((system) => system.name === selectedName) || systems[0];
  const [selectedPlanetName, setSelectedPlanetName] = useState("");
  const selectedPlanet = selectedSystem?.planets.find(
    (planet) => planet.name === selectedPlanetName,
  );
  const routeEstimate = destinations.find(
    (destination) => destination.system === selectedSystem?.name,
  );
  const [x, setX] = useState(clampSectorCoordinate(Number(observer.x) || 0));
  const [y, setY] = useState(clampSectorCoordinate(Number(observer.y) || 0));
  const [z, setZ] = useState(clampSectorCoordinate(Number(observer.z) || 0));
  const [tracking, setTracking] = useState<HyperspaceRoutePayload["tracking"]>();
  const [arrivalDistance, setArrivalDistance] = useState(500);
  const [escapeEnabled, setEscapeEnabled] = useState(false);
  const [escapeMode, setEscapeMode] = useState<"known" | "exact" | "random">("known");
  const [escapeSystemName, setEscapeSystemName] = useState(systems[0]?.name || "");
  const [escapeGx, setEscapeGx] = useState(0);
  const [escapeGy, setEscapeGy] = useState(0);
  const [escapeSx, setEscapeSx] = useState(0);
  const [escapeSy, setEscapeSy] = useState(0);
  const [escapeSz, setEscapeSz] = useState(0);
  const [escapeDistance, setEscapeDistance] = useState(1);
  const updateLocalDestination = useCallback((destination: [number, number, number]) => {
    setSelectedPlanetName("");
    setX(clampSectorCoordinate(destination[0]));
    setY(clampSectorCoordinate(destination[1]));
    setZ(clampSectorCoordinate(destination[2]));
  }, []);
  const updateTracking = useCallback((next: HyperspaceRoutePayload["tracking"] | undefined) => {
    setTracking((current) => {
      if (!current || !next) return current === next ? current : next;
      return current.targetId === next.targetId &&
        current.targetName === next.targetName &&
        current.hyperspeed === next.hyperspeed &&
        current.navigator === next.navigator &&
        current.lastObservedAt === next.lastObservedAt &&
        current.thresholdUnits === next.thresholdUnits
        ? current
        : next;
    });
  }, []);
  const reachableEscapeSystems = useMemo(() => {
    const origin = primaryGalaxyFor(mode, selectedSystem, currentGalaxy, catalog, current);
    return systems.filter(
      (system) =>
        system.name !== (mode === "local" ? currentSystem : selectedSystem?.name) &&
        escapeDestinationInRange(origin, system, destinations, system.name, mode === "local")
          .allowed,
    );
  }, [catalog, current, currentGalaxy, currentSystem, destinations, mode, selectedSystem, systems]);

  useEffect(() => {
    if (reachableEscapeSystems.some((system) => system.name === escapeSystemName)) return;
    setEscapeSystemName(reachableEscapeSystems[0]?.name || "");
  }, [escapeSystemName, reachableEscapeSystems]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onCancelRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectedPlanetPosition = selectedPlanet
    ? ([selectedPlanet.x || 0, selectedPlanet.y || 0, selectedPlanet.z || 0] as const)
    : null;
  const selectedPlanetDistance = selectedPlanetPosition
    ? sectorDistance(selectedPlanetPosition, [x, y, z])
    : null;
  const planetArrivalClear =
    selectedPlanetDistance === null || selectedPlanetDistance > MIN_HYPERSPACE_CLEARANCE;
  const randomizePlanetDestination = useCallback(() => {
    if (!selectedPlanetPosition) return;
    const destination = randomSectorDestinationBeyond(selectedPlanetPosition, arrivalDistance);
    setTracking(undefined);
    setX(destination[0]);
    setY(destination[1]);
    setZ(destination[2]);
  }, [arrivalDistance, selectedPlanetPosition]);

  const primaryGalaxy = primaryGalaxyFor(mode, selectedSystem, currentGalaxy, catalog, current);

  const randomEscapeGalaxy = useMemo(() => {
    const angle =
      ((hash(`${primaryGalaxy.x}:${primaryGalaxy.y}:${escapeDistance}`) % 360) * Math.PI) / 180;
    return {
      x: Math.round(primaryGalaxy.x + Math.cos(angle) * escapeDistance),
      y: Math.round(primaryGalaxy.y + Math.sin(angle) * escapeDistance),
    };
  }, [escapeDistance, primaryGalaxy.x, primaryGalaxy.y]);

  const escapeSelection = (() => {
    if (escapeMode === "known") {
      const known = systems.find((system) => system.name === escapeSystemName);
      return known ? { galaxy: { x: known.x, y: known.y }, systemName: known.name } : null;
    }
    if (escapeMode === "random") return { galaxy: randomEscapeGalaxy, systemName: undefined };
    return { galaxy: { x: escapeGx, y: escapeGy }, systemName: undefined };
  })();
  const escapeReachability = escapeSelection
    ? escapeDestinationInRange(
        primaryGalaxy,
        escapeSelection.galaxy,
        destinations,
        escapeSelection.systemName,
        mode === "local" && escapeMode === "known",
      )
    : { allowed: false, distance: 0, reason: "No reachable escape systems are available" };

  const buildEscape = (): EscapePlanDraft | undefined => {
    if (!escapeAllowed || !escapeEnabled) return undefined;
    if (!escapeSelection || !escapeReachability.allowed) return undefined;
    return {
      triggerGalaxy: primaryGalaxy,
      route: {
        mode: "galactic",
        galaxy: escapeSelection.galaxy,
        systemName: escapeSelection.systemName,
        destination: {
          x: clampSectorCoordinate(escapeSx),
          y: clampSectorCoordinate(escapeSy),
          z: clampSectorCoordinate(escapeSz),
        },
      },
    };
  };

  const submit = () =>
    onPlot(
      {
        mode,
        galaxy: mode === "galactic" ? primaryGalaxy : undefined,
        systemName: mode === "galactic" ? selectedSystem?.name : currentSystem,
        planetName: selectedPlanet?.name,
        tracking: mode === "local" ? tracking : undefined,
        destination: {
          x: clampSectorCoordinate(x),
          y: clampSectorCoordinate(y),
          z: clampSectorCoordinate(z),
        },
      },
      buildEscape(),
    );

  const minX = Math.min(...systems.map((system) => system.x), currentGalaxy?.x ?? 0, -10);
  const maxX = Math.max(...systems.map((system) => system.x), currentGalaxy?.x ?? 0, 10);
  const minY = Math.min(...systems.map((system) => system.y), currentGalaxy?.y ?? 0, -10);
  const maxY = Math.max(...systems.map((system) => system.y), currentGalaxy?.y ?? 0, 10);
  const occupiedSystem = currentGalaxy
    ? systems.find((system) => system.x === currentGalaxy.x && system.y === currentGalaxy.y)
    : undefined;

  return (
    <section
      className={styles.planner}
      aria-label={mode === "local" ? "Local hyperspace planner" : "Galactic route planner"}
    >
      <header>
        <div>
          <p>
            NAV COMPUTER // {mode === "local" ? "LOCAL JUMP" : "GALACTIC ROUTE"} // FOR{" "}
            {recipientLabel.toUpperCase()}
          </p>
          <h2>
            {mode === "local"
              ? currentSystem || "CURRENT SYSTEM"
              : selectedSystem?.name || "GALAXY CATALOG"}
          </h2>
        </div>
        <div className={styles.coordinates}>
          {[
            ["X", x, setX],
            ["Y", y, setY],
            ["Z", z, setZ],
          ].map(([label, value, setter]) => (
            <label key={String(label)}>
              {String(label)}
              <input
                type="number"
                min={-50000}
                max={50000}
                value={Number(value)}
                onChange={(event) =>
                  (setter as (value: number) => void)(
                    clampSectorCoordinate(numeric(event.target.value)),
                  )
                }
              />
            </label>
          ))}
        </div>
      </header>

      <div className={styles.workspace}>
        <div className={styles.map}>
          {mode === "local" ? (
            <LocalHyperspaceView
              snapshot={snapshot}
              recipientLabel={recipientLabel}
              observer={observer}
              destination={[x, y, z]}
              hyperspeed={hyperspeed}
              motionTracks={motionTracks}
              planetTargetName={selectedPlanetName}
              onDestinationChange={updateLocalDestination}
              onTrackingChange={updateTracking}
            />
          ) : (
            <>
              <div className={styles.galaxyGlow} />
              {catalogPending && (
                <div className={styles.catalogPending}>ACQUIRING GALAXY CATALOG</div>
              )}
              {currentGalaxy && (
                <button
                  type="button"
                  className={styles.galaxyPosition}
                  style={{
                    left: `${8 + ((currentGalaxy.x - minX) / Math.max(1, maxX - minX)) * 84}%`,
                    top: `${92 - ((currentGalaxy.y - minY) / Math.max(1, maxY - minY)) * 84}%`,
                  }}
                  aria-label={
                    occupiedSystem
                      ? `Select ${occupiedSystem.name}`
                      : `Current position ${currentGalaxy.x}, ${currentGalaxy.y}`
                  }
                  onClick={() => {
                    if (occupiedSystem) {
                      setSelectedName(occupiedSystem.name);
                      setSelectedPlanetName("");
                    }
                  }}
                >
                  <span />
                  <b>
                    {occupiedSystem ? `YOU // ${occupiedSystem.name}` : "YOU"} // {currentGalaxy.x}{" "}
                    / {currentGalaxy.y}
                  </b>
                  <small>
                    {occupiedSystem ? "CURRENT SYSTEM" : currentSystem || "UNCHARTED SPACE"}
                  </small>
                </button>
              )}
              {systems.map((system) => {
                if (system === occupiedSystem) return null;
                const estimate = destinations.find(
                  (destination) => destination.system === system.name,
                );
                return (
                  <button
                    key={system.name}
                    type="button"
                    className={`${styles.systemPoint} ${system.name === selectedSystem?.name ? styles.selectedSystem : ""} ${system.name === currentSystem ? styles.currentSystem : ""} ${estimate?.reachable === false ? styles.outOfRange : ""}`}
                    style={{
                      left: `${8 + ((system.x - minX) / Math.max(1, maxX - minX)) * 84}%`,
                      top: `${92 - ((system.y - minY) / Math.max(1, maxY - minY)) * 84}%`,
                    }}
                    onClick={() => {
                      setSelectedName(system.name);
                      setSelectedPlanetName("");
                    }}
                  >
                    <span />
                    {system.name}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <aside className={styles.sidebar}>
          {mode === "galactic" && (
            <>
              <p className={styles.kicker}>SYSTEM DOSSIER</p>
              <h3>{selectedSystem?.name || "No systems received"}</h3>
              <dl>
                <div>
                  <dt>GALAXY</dt>
                  <dd>
                    {selectedSystem?.x ?? "—"} / {selectedSystem?.y ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>CHART</dt>
                  <dd>{selectedSystem?.custom ? "PERSONAL" : "STANDARD"}</dd>
                </div>
                <div>
                  <dt>DISTANCE</dt>
                  <dd>{routeEstimate ? `${routeEstimate.distanceParsecs} pc` : "UNKNOWN"}</dd>
                </div>
                <div>
                  <dt>ROUTE</dt>
                  <dd>
                    {routeEstimate?.reachable === false
                      ? "OUT OF RANGE"
                      : routeEstimate?.travelTime || "UNCHECKED"}
                  </dd>
                </div>
                {routeEstimate?.fuelPercent !== undefined && (
                  <div>
                    <dt>FUEL</dt>
                    <dd>{routeEstimate.fuelPercent}%</dd>
                  </div>
                )}
              </dl>
            </>
          )}
          <p className={styles.kicker}>PLANETARY CONTACTS</p>
          <div className={styles.planetList}>
            {(mode === "local" ? current?.planets : selectedSystem?.planets)?.map((planet) => (
              <Planet
                key={planet.name}
                planet={planet}
                selected={selectedPlanetName === planet.name}
                onClick={() => setSelectedPlanetName(planet.name)}
              />
            )) || <span>NO PLANETS CATALOGED</span>}
          </div>
          {selectedPlanet && (
            <div className={styles.arrival}>
              <strong>PLANET ARRIVAL REFERENCE</strong>
              <p>
                {selectedPlanet.name.toUpperCase()} // {selectedPlanet.x} / {selectedPlanet.y} /{" "}
                {selectedPlanet.z}
              </p>
              <small>ENTER XYZ MANUALLY, OR GENERATE A RANDOM LOCATION BEYOND THE MINIMUM.</small>
              <div className={styles.arrivalOptions}>
                {[500, 1000, 2000].map((distance) => (
                  <button
                    key={distance}
                    type="button"
                    aria-pressed={arrivalDistance === distance}
                    onClick={() => setArrivalDistance(distance)}
                  >
                    {distance.toLocaleString()} u
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.randomArrival}
                onClick={randomizePlanetDestination}
              >
                RANDOM LOCATION
              </button>
              <div className={styles.arrivalStatus} data-clear={planetArrivalClear}>
                {planetArrivalClear
                  ? `CURRENT SEPARATION // ${Math.round(selectedPlanetDistance || 0).toLocaleString()} u`
                  : `MOVE DESTINATION MORE THAN ${MIN_HYPERSPACE_CLEARANCE.toLocaleString()} u FROM PLANET`}
              </div>
            </div>
          )}

          {escapeAllowed && (
            <div className={styles.escape}>
              <label className={styles.escapeToggle}>
                <input
                  type="checkbox"
                  checked={escapeEnabled}
                  onChange={(event) => setEscapeEnabled(event.target.checked)}
                />
                <span>ARM ESCAPE PLAN</span>
              </label>
              {escapeEnabled && (
                <>
                  <div className={styles.modeTabs}>
                    {(["known", "exact", "random"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={escapeMode === value}
                        onClick={() => setEscapeMode(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  {escapeMode === "known" && (
                    <select
                      value={escapeSystemName}
                      disabled={reachableEscapeSystems.length === 0}
                      onChange={(event) => setEscapeSystemName(event.target.value)}
                    >
                      {reachableEscapeSystems.length === 0 && (
                        <option value="">NO CONFIRMED DESTINATIONS</option>
                      )}
                      {reachableEscapeSystems.map((system) => (
                        <option key={system.name}>{system.name}</option>
                      ))}
                    </select>
                  )}
                  {escapeMode === "exact" && (
                    <div className={styles.miniCoordinates}>
                      <label>
                        GX
                        <input
                          type="number"
                          value={escapeGx}
                          onChange={(e) => setEscapeGx(numeric(e.target.value))}
                        />
                      </label>
                      <label>
                        GY
                        <input
                          type="number"
                          value={escapeGy}
                          onChange={(e) => setEscapeGy(numeric(e.target.value))}
                        />
                      </label>
                    </div>
                  )}
                  {escapeMode === "random" && (
                    <label className={styles.distance}>
                      SECTOR DISTANCE
                      <input
                        type="number"
                        min="1"
                        value={escapeDistance}
                        onChange={(e) => setEscapeDistance(Math.max(1, numeric(e.target.value)))}
                      />
                    </label>
                  )}
                  <div className={styles.miniCoordinates}>
                    {[
                      ["SX", escapeSx, setEscapeSx],
                      ["SY", escapeSy, setEscapeSy],
                      ["SZ", escapeSz, setEscapeSz],
                    ].map(([label, value, setter]) => (
                      <label key={String(label)}>
                        {String(label)}
                        <input
                          type="number"
                          min={-50000}
                          max={50000}
                          value={Number(value)}
                          onChange={(e) =>
                            (setter as (value: number) => void)(
                              clampSectorCoordinate(numeric(e.target.value)),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div
                    className={`${styles.rangeStatus} ${rangeDataPending ? styles.rangePending : escapeReachability.allowed ? styles.rangeSafe : styles.rangeBlocked}`}
                  >
                    {rangeDataPending
                      ? "ACQUIRING RANGE DATA // CALC REQUESTED"
                      : escapeReachability.allowed
                        ? `IN RANGE // ${escapeReachability.distance.toFixed(1)} PARSECS`
                        : `ROUTE BLOCKED // ${escapeReachability.reason}`}
                  </div>
                  <small>CALCULATES ON CONFIRMED ARRIVAL. ENGAGEMENT IS ALWAYS MANUAL.</small>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
      <footer>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          CANCEL
        </button>
        <div>
          <span>{escapeEnabled ? "PRIMARY + ESCAPE ROUTE" : "SINGLE ROUTE"}</span>
          <strong>
            {x} / {y} / {z}
          </strong>
        </div>
        <button
          type="button"
          className={styles.plot}
          disabled={
            catalogPending ||
            (mode === "galactic" && !selectedSystem) ||
            !planetArrivalClear ||
            (escapeEnabled && (rangeDataPending || !escapeReachability.allowed))
          }
          onClick={submit}
        >
          {routeEstimate?.reachable === false
            ? "CHECK ROUTE"
            : tracking
              ? "PLOT + TRACK"
              : "PLOT JUMP"}
        </button>
      </footer>
    </section>
  );
}

function primaryGalaxyFor(
  mode: "local" | "galactic",
  selectedSystem: GalaxySystem | undefined,
  currentGalaxy: { x: number; y: number } | undefined,
  catalog: GalaxyCatalog | null,
  current: GalaxySystem | undefined,
) {
  return mode === "galactic"
    ? { x: selectedSystem?.x || 0, y: selectedSystem?.y || 0 }
    : currentGalaxy || {
        x: Number(catalog?.shipSystem?.x) || current?.x || 0,
        y: Number(catalog?.shipSystem?.y) || current?.y || 0,
      };
}
