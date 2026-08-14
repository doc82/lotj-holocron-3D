import { useEffect, useMemo, useRef, useState } from "react";

import { escapeDestinationInRange } from "../../domain/hyperspace";
import type { GalaxyCatalog, GalaxyPlanet, GalaxySystem, HyperspaceRoutePayload } from "../../types/telemetry";
import styles from "./HyperspacePlanner.module.css";

export interface EscapePlanDraft {
  route: HyperspaceRoutePayload;
  triggerGalaxy: { x: number; y: number };
}

interface Props {
  mode: "local" | "galactic";
  catalog: GalaxyCatalog | null;
  currentSystem?: string;
  currentGalaxy?: { x: number; y: number };
  observer: { x?: number; y?: number; z?: number };
  destinations?: Array<{ system: string; distanceParsecs: number; reachable: boolean; travelTime?: string; fuelPercent?: number }>;
  onCancel(): void;
  onPlot(route: HyperspaceRoutePayload, escape?: EscapePlanDraft): void;
}

const clamp = (value: number) => Math.max(-50_000, Math.min(50_000, Math.round(value || 0)));
const numeric = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;

function normalizeCatalog(catalog: GalaxyCatalog | null): GalaxySystem[] {
  const merged = { ...(catalog?.systems || {}), ...(catalog?.customSystems || {}) };
  return Object.entries(merged).flatMap(([name, raw]) => {
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    const keyedPlanets = Object.entries(raw).flatMap(([planetName, planetRaw]) => {
      if (["x", "y", "name", "planets"].includes(planetName)
          || typeof planetRaw !== "object" || !planetRaw) return [];
      const planet = planetRaw as Record<string, unknown>;
      if (!("government" in planet || "z" in planet)) return [];
      return [{
        name: String(planet.name || planetName),
        government: String(planet.government || "A Neutral Government"),
        x: Number(planet.x) || 0,
        y: Number(planet.y) || 0,
        z: Number(planet.z) || 0,
      } satisfies GalaxyPlanet];
    });
    const listedPlanets = Array.isArray(raw.planets) ? raw.planets.flatMap((planetRaw) => {
      if (typeof planetRaw !== "object" || !planetRaw) return [];
      const planet = planetRaw as Record<string, unknown>;
      if (!planet.name) return [];
      return [{
        name: String(planet.name),
        government: String(planet.government || "A Neutral Government"),
        x: Number(planet.x) || 0,
        y: Number(planet.y) || 0,
        z: Number(planet.z) || 0,
      } satisfies GalaxyPlanet];
    }) : [];
    const planets = [...new Map([...keyedPlanets, ...listedPlanets]
      .map((planet) => [planet.name, planet])).values()];
    return [{ name, x, y, planets, custom: Boolean(catalog?.customSystems?.[name]) }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function hash(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return Math.abs(result >>> 0);
}

function planetPalette(name: string) {
  const named: Record<string, [string, string, string]> = {
    "dromund kaas": ["#193d48", "#52717c", "#101c2d"], tatooine: ["#c99143", "#f1d294", "#6d4023"],
    coruscant: ["#343c53", "#e7b454", "#080b12"], kashyyyk: ["#164f35", "#4f8d62", "#123d58"],
    mustafar: ["#1b1718", "#ff5a1f", "#581412"], kamino: ["#164c78", "#7fc4d9", "#d1e9ee"],
    mandalore: ["#735f43", "#b6a57d", "#2f3941"], "mon cala": ["#0b5f86", "#58b8c7", "#183d70"],
  };
  if (named[name.toLowerCase()]) return named[name.toLowerCase()];
  const seed = hash(name);
  const hue = seed % 360;
  return [`hsl(${hue} 48% 28%)`, `hsl(${(hue + 38) % 360} 54% 55%)`, `hsl(${(hue + 190) % 360} 42% 18%)`] as const;
}

function Planet({ planet, selected, onClick }: { planet: GalaxyPlanet; selected?: boolean; onClick?(): void }) {
  const palette = planetPalette(planet.name);
  return <button type="button" className={`${styles.planet} ${selected ? styles.selectedPlanet : ""}`}
    style={{ "--planet-a": palette[0], "--planet-b": palette[1], "--planet-c": palette[2] } as React.CSSProperties}
    onClick={(event) => { event.stopPropagation(); onClick?.(); }} aria-label={`Select ${planet.name}`}><span /><em>{planet.name}</em></button>;
}

export function HyperspacePlanner({ mode, catalog, currentSystem, currentGalaxy, observer, destinations = [], onCancel, onPlot }: Props) {
  const rangeDataPending = destinations.length === 0;
  const systems = useMemo(() => normalizeCatalog(catalog), [catalog]);
  const catalogPending = mode === "galactic" && systems.length === 0;
  const current = systems.find((system) => system.name === currentSystem);
  const [selectedName, setSelectedName] = useState(currentSystem || systems[0]?.name || "");
  const selectedSystem = systems.find((system) => system.name === selectedName) || systems[0];
  const [selectedPlanetName, setSelectedPlanetName] = useState("");
  const selectedPlanet = selectedSystem?.planets.find((planet) => planet.name === selectedPlanetName);
  const routeEstimate = destinations.find((destination) => destination.system === selectedSystem?.name);
  const [x, setX] = useState(Math.round(observer.x || 0));
  const [y, setY] = useState(Math.round(observer.y || 0));
  const [z, setZ] = useState(Math.round(observer.z || 0));
  const [arrivalDistance, setArrivalDistance] = useState(500);
  const [pan, setPan] = useState({ x: 0, z: 0 });
  const [elevationDragging, setElevationDragging] = useState(false);
  const elevationDragRef = useRef<{ pointerId: number; startY: number; startClientY: number } | null>(null);
  const suppressMapClickRef = useRef(false);
  const [escapeEnabled, setEscapeEnabled] = useState(false);
  const [escapeMode, setEscapeMode] = useState<"known" | "exact" | "random">("known");
  const [escapeSystemName, setEscapeSystemName] = useState(systems[0]?.name || "");
  const [escapeGx, setEscapeGx] = useState(0);
  const [escapeGy, setEscapeGy] = useState(0);
  const [escapeSx, setEscapeSx] = useState(0);
  const [escapeSy, setEscapeSy] = useState(0);
  const [escapeSz, setEscapeSz] = useState(0);
  const [escapeDistance, setEscapeDistance] = useState(1);
  const reachableEscapeSystems = useMemo(() => {
    const origin = primaryGalaxyFor(mode, selectedSystem, currentGalaxy, catalog, current);
    return systems.filter((system) => system.name !== (mode === "local" ? currentSystem : selectedSystem?.name)
      && escapeDestinationInRange(origin, system, destinations, system.name, mode === "local").allowed);
  }, [catalog, current, currentGalaxy, currentSystem, destinations, mode, selectedSystem, systems]);

  useEffect(() => {
    if (reachableEscapeSystems.some((system) => system.name === escapeSystemName)) return;
    setEscapeSystemName(reachableEscapeSystems[0]?.name || "");
  }, [escapeSystemName, reachableEscapeSystems]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onCancel();
      const amount = event.shiftKey ? 5_000 : 2_000;
      if (event.key.toLowerCase() === "w") setPan((value) => ({ ...value, z: clamp(value.z - amount) }));
      if (event.key.toLowerCase() === "s") setPan((value) => ({ ...value, z: clamp(value.z + amount) }));
      if (event.key.toLowerCase() === "a") setPan((value) => ({ ...value, x: clamp(value.x - amount) }));
      if (event.key.toLowerCase() === "d") setPan((value) => ({ ...value, x: clamp(value.x + amount) }));
      if (event.key.toLowerCase() === "q") setY((value) => clamp(value - amount));
      if (event.key.toLowerCase() === "e") setY((value) => clamp(value + amount));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    if (!selectedPlanet) return;
    const angle = (hash(`${selectedSystem?.name}/${selectedPlanet.name}/${arrivalDistance}`) % 360) * Math.PI / 180;
    const elevation = ((hash(selectedPlanet.name) % 120) - 60) * Math.PI / 180;
    setX(clamp((selectedPlanet.x || 0) + Math.cos(angle) * Math.cos(elevation) * arrivalDistance));
    setY(clamp((selectedPlanet.y || 0) + Math.sin(elevation) * arrivalDistance));
    setZ(clamp((selectedPlanet.z || 0) + Math.sin(angle) * Math.cos(elevation) * arrivalDistance));
  }, [arrivalDistance, selectedPlanet, selectedSystem?.name]);

  const primaryGalaxy = primaryGalaxyFor(mode, selectedSystem, currentGalaxy, catalog, current);

  const randomEscapeGalaxy = useMemo(() => {
    const angle = (hash(`${primaryGalaxy.x}:${primaryGalaxy.y}:${escapeDistance}`) % 360) * Math.PI / 180;
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
    ? escapeDestinationInRange(primaryGalaxy, escapeSelection.galaxy, destinations,
      escapeSelection.systemName, mode === "local" && escapeMode === "known")
    : { allowed: false, distance: 0, reason: "No reachable escape systems are available" };

  const buildEscape = (): EscapePlanDraft | undefined => {
    if (!escapeEnabled) return undefined;
    if (!escapeSelection || !escapeReachability.allowed) return undefined;
    return {
      triggerGalaxy: primaryGalaxy,
      route: { mode: "galactic", galaxy: escapeSelection.galaxy, systemName: escapeSelection.systemName,
        destination: { x: clamp(escapeSx), y: clamp(escapeSy), z: clamp(escapeSz) } },
    };
  };

  const submit = () => onPlot({
    mode,
    galaxy: mode === "galactic" ? primaryGalaxy : undefined,
    systemName: mode === "galactic" ? selectedSystem?.name : currentSystem,
    planetName: selectedPlanet?.name,
    destination: { x: clamp(x), y: clamp(y), z: clamp(z) },
  }, buildEscape());

  const minX = Math.min(...systems.map((system) => system.x), currentGalaxy?.x ?? 0, -10);
  const maxX = Math.max(...systems.map((system) => system.x), currentGalaxy?.x ?? 0, 10);
  const minY = Math.min(...systems.map((system) => system.y), currentGalaxy?.y ?? 0, -10);
  const maxY = Math.max(...systems.map((system) => system.y), currentGalaxy?.y ?? 0, 10);

  return <section className={styles.planner} aria-label={mode === "local" ? "Local hyperspace planner" : "Galactic route planner"}>
    <header><div><p>NAV COMPUTER // {mode === "local" ? "LOCAL JUMP" : "GALACTIC ROUTE"}</p>
      <h2>{mode === "local" ? currentSystem || "CURRENT SYSTEM" : selectedSystem?.name || "GALAXY CATALOG"}</h2></div>
      <div className={styles.coordinates}>
        {[["X", x, setX], ["Y", y, setY], ["Z", z, setZ]].map(([label, value, setter]) =>
          <label key={String(label)}>{String(label)}<input type="number" min={-50000} max={50000} value={Number(value)}
            onChange={(event) => (setter as (value: number) => void)(clamp(numeric(event.target.value)))} /></label>)}
      </div>
    </header>

    <div className={styles.workspace}>
      <div className={`${styles.map} ${elevationDragging ? styles.elevationActive : ""}`}
        onPointerDown={mode === "local" ? (event) => {
          if (!event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          elevationDragRef.current = { pointerId: event.pointerId, startY: y, startClientY: event.clientY };
          suppressMapClickRef.current = true;
          setElevationDragging(true);
        } : undefined}
        onPointerMove={mode === "local" ? (event) => {
          const drag = elevationDragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const unitsPerPixel = 100_000 / Math.max(1, rect.height);
          setY(clamp(drag.startY + (drag.startClientY - event.clientY) * unitsPerPixel));
        } : undefined}
        onPointerUp={mode === "local" ? (event) => {
          if (elevationDragRef.current?.pointerId !== event.pointerId) return;
          elevationDragRef.current = null;
          setElevationDragging(false);
          setTimeout(() => { suppressMapClickRef.current = false; }, 0);
        } : undefined}
        onPointerCancel={() => { elevationDragRef.current = null; setElevationDragging(false); suppressMapClickRef.current = false; }}
        onClick={mode === "local" ? (event) => {
        if (event.shiftKey || suppressMapClickRef.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setX(clamp(pan.x + ((event.clientX - rect.left) / rect.width - 0.5) * 100_000));
        setZ(clamp(pan.z + ((event.clientY - rect.top) / rect.height - 0.5) * 100_000));
      } : undefined}>
        {mode === "local" ? <>
          <div className={styles.localGrid} /><div className={styles.axisX}>X</div><div className={styles.axisZ}>Z</div>
          <div className={styles.currentShip} style={{ left: `${50 + ((observer.x || 0) - pan.x) / 1000}%`, top: `${50 + ((observer.z || 0) - pan.z) / 1000}%` }}>◆</div>
          <div className={styles.jumpMarker} style={{ left: `${50 + (x - pan.x) / 1000}%`, top: `${50 + (z - pan.z) / 1000}%` }}><span />
            <b>{x} / {y} / {z}</b></div>
          {elevationDragging && <div className={styles.elevationGuide}><span /><b>Y {y.toLocaleString()}</b><small>DRAG UP / DOWN</small></div>}
          {(current?.planets || []).map((planet) => <div key={planet.name} className={styles.localPlanet}
            style={{ left: `${50 + ((planet.x || 0) - pan.x) / 1000}%`, top: `${50 + ((planet.z || 0) - pan.z) / 1000}%` }}>
            <Planet planet={planet} onClick={() => { setSelectedPlanetName(planet.name); setArrivalDistance(500); }} /></div>)}
          <aside className={styles.mapLegend}>CLICK X/Z // SHIFT + DRAG Y<br />WASD PAN // Q/E ELEVATION // GRID ±50,000</aside>
        </> : <>
          <div className={styles.galaxyGlow} />
          {catalogPending && <div className={styles.catalogPending}>ACQUIRING GALAXY CATALOG</div>}
          {currentGalaxy && <div className={styles.galaxyPosition}
            style={{ left: `${8 + (currentGalaxy.x - minX) / Math.max(1, maxX - minX) * 84}%`, top: `${92 - (currentGalaxy.y - minY) / Math.max(1, maxY - minY) * 84}%` }}>
            <span /><b>YOU // {currentGalaxy.x} / {currentGalaxy.y}</b><small>{currentSystem || "UNCHARTED SPACE"}</small>
          </div>}
          {systems.map((system) => { const estimate = destinations.find((destination) => destination.system === system.name); return <button key={system.name} type="button"
            className={`${styles.systemPoint} ${system.name === selectedSystem?.name ? styles.selectedSystem : ""} ${system.name === currentSystem ? styles.currentSystem : ""} ${estimate?.reachable === false ? styles.outOfRange : ""}`}
            style={{ left: `${8 + (system.x - minX) / Math.max(1, maxX - minX) * 84}%`, top: `${92 - (system.y - minY) / Math.max(1, maxY - minY) * 84}%` }}
            onClick={() => { setSelectedName(system.name); setSelectedPlanetName(""); }}><span />{system.name}</button>; })}
        </>}
      </div>

      <aside className={styles.sidebar}>
        {mode === "galactic" && <><p className={styles.kicker}>SYSTEM DOSSIER</p><h3>{selectedSystem?.name || "No systems received"}</h3>
          <dl><div><dt>GALAXY</dt><dd>{selectedSystem?.x ?? "—"} / {selectedSystem?.y ?? "—"}</dd></div>
            <div><dt>CHART</dt><dd>{selectedSystem?.custom ? "PERSONAL" : "STANDARD"}</dd></div>
            <div><dt>DISTANCE</dt><dd>{routeEstimate ? `${routeEstimate.distanceParsecs} pc` : "UNKNOWN"}</dd></div>
            <div><dt>ROUTE</dt><dd>{routeEstimate?.reachable === false ? "OUT OF RANGE" : routeEstimate?.travelTime || "UNCHECKED"}</dd></div>
            {routeEstimate?.fuelPercent !== undefined && <div><dt>FUEL</dt><dd>{routeEstimate.fuelPercent}%</dd></div>}</dl></>}
        <p className={styles.kicker}>PLANETARY CONTACTS</p>
        <div className={styles.planetList}>{(mode === "local" ? current?.planets : selectedSystem?.planets)?.map((planet) =>
          <Planet key={planet.name} planet={planet} selected={selectedPlanetName === planet.name} onClick={() => setSelectedPlanetName(planet.name)} />)
          || <span>NO PLANETS CATALOGED</span>}</div>
        {selectedPlanet && <div className={styles.arrival}><strong>ARRIVAL STAND-OFF</strong>
          <div>{[500, 1000, 2500].map((distance) => <button key={distance} type="button" aria-pressed={arrivalDistance === distance}
            onClick={() => setArrivalDistance(distance)}>{distance.toLocaleString()} u</button>)}</div></div>}

        <div className={styles.escape}>
          <label className={styles.escapeToggle}><input type="checkbox" checked={escapeEnabled} onChange={(event) => setEscapeEnabled(event.target.checked)} />
            <span>ARM ESCAPE PLAN</span></label>
          {escapeEnabled && <><div className={styles.modeTabs}>{(["known", "exact", "random"] as const).map((value) =>
            <button key={value} type="button" aria-pressed={escapeMode === value} onClick={() => setEscapeMode(value)}>{value}</button>)}</div>
            {escapeMode === "known" && <select value={escapeSystemName} disabled={reachableEscapeSystems.length === 0} onChange={(event) => setEscapeSystemName(event.target.value)}>
              {reachableEscapeSystems.length === 0 && <option value="">NO CONFIRMED DESTINATIONS</option>}
              {reachableEscapeSystems.map((system) => <option key={system.name}>{system.name}</option>)}</select>}
            {escapeMode === "exact" && <div className={styles.miniCoordinates}><label>GX<input type="number" value={escapeGx} onChange={(e) => setEscapeGx(numeric(e.target.value))} /></label>
              <label>GY<input type="number" value={escapeGy} onChange={(e) => setEscapeGy(numeric(e.target.value))} /></label></div>}
            {escapeMode === "random" && <label className={styles.distance}>SECTOR DISTANCE<input type="number" min="1" value={escapeDistance} onChange={(e) => setEscapeDistance(Math.max(1, numeric(e.target.value)))} /></label>}
            <div className={styles.miniCoordinates}>{[["SX", escapeSx, setEscapeSx], ["SY", escapeSy, setEscapeSy], ["SZ", escapeSz, setEscapeSz]].map(([label, value, setter]) =>
              <label key={String(label)}>{String(label)}<input type="number" min={-50000} max={50000} value={Number(value)} onChange={(e) => (setter as (value: number) => void)(clamp(numeric(e.target.value)))} /></label>)}</div>
            <div className={`${styles.rangeStatus} ${rangeDataPending ? styles.rangePending : escapeReachability.allowed ? styles.rangeSafe : styles.rangeBlocked}`}>
              {rangeDataPending
                ? "ACQUIRING RANGE DATA // CALC REQUESTED"
                : escapeReachability.allowed
                ? `IN RANGE // ${escapeReachability.distance.toFixed(1)} PARSECS`
                : `ROUTE BLOCKED // ${escapeReachability.reason}`}
            </div>
            <small>CALCULATES ON CONFIRMED ARRIVAL. ENGAGEMENT IS ALWAYS MANUAL.</small></>}
        </div>
      </aside>
    </div>
    <footer><button type="button" className={styles.cancel} onClick={onCancel}>CANCEL</button>
      <div><span>{escapeEnabled ? "PRIMARY + ESCAPE ROUTE" : "SINGLE ROUTE"}</span><strong>{x} / {y} / {z}</strong></div>
      <button type="button" className={styles.plot} disabled={catalogPending || (mode === "galactic" && !selectedSystem) || (escapeEnabled && (rangeDataPending || !escapeReachability.allowed))} onClick={submit}>{routeEstimate?.reachable === false ? "CHECK ROUTE" : "PLOT JUMP"}</button></footer>
  </section>;
}

function primaryGalaxyFor(mode: "local" | "galactic", selectedSystem: GalaxySystem | undefined,
  currentGalaxy: { x: number; y: number } | undefined, catalog: GalaxyCatalog | null, current: GalaxySystem | undefined) {
  return mode === "galactic"
    ? { x: selectedSystem?.x || 0, y: selectedSystem?.y || 0 }
    : currentGalaxy || { x: Number(catalog?.shipSystem?.x) || current?.x || 0, y: Number(catalog?.shipSystem?.y) || current?.y || 0 };
}
