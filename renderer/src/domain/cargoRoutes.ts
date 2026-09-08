import { navigationJump, navigationNode, navigationWaypoints } from "./navigationTopology.ts";
export type HyperlaneStatus = "passable" | "no_route" | "unknown" | "stale";

export interface HyperlaneEdge {
  from: string;
  to: string;
  status: HyperlaneStatus;
  travelSeconds?: number;
}

export interface PlanetMarket {
  name: string;
  system?: string;
  galacticCoordinates?: { x: number; y: number };
  governedBy?: string;
  taxRate?: number;
  resources: Record<string, number>;
}

export interface CargoRouteConstraints {
  timing?: CargoTiming;
  maxJumpsPerLeg: number | "unlimited";
  maxDistance?: number;
  cargoCapacity: number;
  excludedClans?: ReadonlySet<string>;
  avoidedPlanets?: ReadonlySet<string>;
  secondsPerJump?: number;
}

export interface CargoTiming {
  minutesPer35Sectors: number;
  tradeStopMinutes: number;
  transitStopMinutes: number;
}

export const DEFAULT_CARGO_TIMING: CargoTiming = {
  minutesPer35Sectors: 6,
  tradeStopMinutes: 3,
  transitStopMinutes: 3,
};

export function validCargoTiming(timing: CargoTiming): boolean {
  return (
    Number.isFinite(timing.minutesPer35Sectors) &&
    timing.minutesPer35Sectors > 0 &&
    [timing.tradeStopMinutes, timing.transitStopMinutes].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  );
}

export interface CargoRouteLeg {
  from: string;
  to: string;
  path: string[];
  jumps: number;
  durationSeconds: number;
}

export interface CargoRoute {
  stopSettings?: RouteStopSettings[];
  manual?: boolean;
  maxDistance?: number;
  estimateAvailable?: boolean;
  legs?: CargoTradeLeg[];
  buyPlanet: string;
  sellPlanet: string;
  resource: string;
  quantity: number;
  purchaseCost: number;
  saleRevenue: number;
  expectedProfit: number;
  expectedProfitPerHour: number;
  outbound: CargoRouteLeg;
  returnLeg: CargoRouteLeg;
  totalLoopJumps: number;
  totalDurationSeconds: number;
}

export interface RouteStopSettings {
  planet: string;
  pad?: string;
  tradeMode?: "cargo" | "contraband";
}

export interface CargoTradeLeg extends CargoRouteLeg {
  trade: {
    resource: string;
    quantity: number;
    purchaseCost: number;
    saleRevenue: number;
    expectedProfit: number;
  } | null;
}

export function cargoRouteIdentity(route: CargoRoute): string {
  if (route.manual)
    return JSON.stringify([
      "manual",
      route.maxDistance,
      route.quantity,
      route.legs?.map((leg) => [leg.path, leg.trade?.resource ?? null]),
      route.stopSettings,
    ]);
  return route.legs
    ? JSON.stringify([
        route.legs.map((leg) => [leg.path, leg.trade?.resource ?? null]),
        route.stopSettings,
      ])
    : `${route.buyPlanet}:${route.sellPlanet}:${route.resource}`;
}

export function cargoRouteTitle(route: CargoRoute): string {
  if (route.manual && route.legs?.length)
    return [route.legs[0].from, ...route.legs.flatMap((leg) => leg.path.slice(1))]
      .slice(0, -1)
      .join(" → ");
  return route.legs
    ? route.legs.map((leg) => leg.from).join(" → ")
    : `${route.buyPlanet} → ${route.sellPlanet}`;
}

type NormalizedPlanet = PlanetMarket & { key: string };

interface PathState {
  key: string;
  path: string[];
  jumps: number;
  durationSeconds: number;
}

interface GraphNeighbor {
  key: string;
  name: string;
  seconds: number;
}

function key(value: string): string {
  return navigationNode(value)?.name.toLowerCase() ?? value.trim().toLowerCase();
}

function isExcluded(planet: NormalizedPlanet, constraints: CargoRouteConstraints): boolean {
  return (
    constraints.avoidedPlanets?.has(planet.key) === true ||
    (planet.governedBy !== undefined &&
      constraints.excludedClans?.has(key(planet.governedBy)) === true)
  );
}

export function cargoSystemCoordinates(
  catalog:
    | {
        systems?: Record<string, Record<string, unknown>>;
        customSystems?: Record<string, Record<string, unknown>>;
      }
    | null
    | undefined,
  system: string | undefined,
): { x: number; y: number } | undefined {
  if (!system) return undefined;
  const entries = [
    ...Object.entries(catalog?.customSystems ?? {}),
    ...Object.entries(catalog?.systems ?? {}),
  ];
  const raw = entries.find(([name]) => key(name) === key(system))?.[1];
  if (!raw || raw.x === null || raw.y === null || raw.x === "" || raw.y === "") return undefined;
  const x = Number(raw.x);
  const y = Number(raw.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function buildAdjacency(
  planets: readonly NormalizedPlanet[],
  edges: readonly HyperlaneEdge[],
  constraints: CargoRouteConstraints,
): Map<string, GraphNeighbor[]> {
  const adjacency = new Map<string, GraphNeighbor[]>();
  const defaultSeconds = constraints.secondsPerJump ?? 3600;
  for (const from of planets) {
    const neighbors: GraphNeighbor[] = [];
    for (const to of planets) {
      if (from.key === to.key) continue;
      if (constraints.maxDistance !== undefined) {
        const start = from.galacticCoordinates;
        const end = to.galacticCoordinates;
        if (!start || !end) continue;
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        if (!Number.isFinite(distance) || distance > constraints.maxDistance) continue;
      }
      const permission = navigationJump(from.name, to.name, edges);
      if (!permission.allowed) continue;
      const measuredSeconds = permission.travelSeconds;
      let seconds = measuredSeconds ?? defaultSeconds;
      if (constraints.timing) {
        if (!validCargoTiming(constraints.timing)) continue;
        const start = from.galacticCoordinates;
        const end = to.galacticCoordinates;
        if (measuredSeconds === undefined) {
          if (!start || !end) continue;
          seconds =
            (Math.hypot(end.x - start.x, end.y - start.y) / 35) *
            constraints.timing.minutesPer35Sectors *
            60;
        }
        if (!Number.isFinite(seconds) || seconds < 0) continue;
        seconds += constraints.timing.transitStopMinutes * 60;
      }
      if (!Number.isFinite(seconds) || seconds < 0) continue;
      neighbors.push({ key: to.key, name: to.name, seconds });
    }
    adjacency.set(from.key, neighbors);
  }
  return adjacency;
}

function shortestPath(
  from: NormalizedPlanet,
  to: NormalizedPlanet,
  adjacency: Map<string, GraphNeighbor[]>,
  maxJumpsPerLeg: number | "unlimited",
): CargoRouteLeg | null {
  if (from.key === to.key) {
    return {
      from: from.name,
      to: to.name,
      path: [from.name],
      jumps: 0,
      durationSeconds: 0,
    };
  }

  const queue: PathState[] = [{ key: from.key, path: [from.name], jumps: 0, durationSeconds: 0 }];
  // Keep distinct hop budgets: a slower, shorter prefix may be the only legal path.
  const stateKey = (planet: string, jumps: number) =>
    maxJumpsPerLeg === "unlimited" ? planet : planet + ":" + jumps;
  const best = new Map<string, number>([[stateKey(from.key, 0), 0]]);
  while (queue.length > 0) {
    queue.sort(
      (left, right) => left.durationSeconds - right.durationSeconds || left.jumps - right.jumps,
    );
    const current = queue.shift()!;
    if (current.durationSeconds > best.get(stateKey(current.key, current.jumps))!) continue;
    if (current.key === to.key) {
      return {
        from: from.name,
        to: to.name,
        path: current.path,
        jumps: current.jumps,
        durationSeconds: current.durationSeconds,
      };
    }
    for (const neighbor of adjacency.get(current.key) ?? []) {
      const jumps = current.jumps + 1;
      if (maxJumpsPerLeg !== "unlimited" && jumps > maxJumpsPerLeg) continue;
      const durationSeconds = current.durationSeconds + neighbor.seconds;
      const id = stateKey(neighbor.key, jumps);
      const previous = best.get(id);
      if (previous !== undefined && previous <= durationSeconds) continue;
      best.set(id, durationSeconds);
      queue.push({
        key: neighbor.key,
        path: [...current.path, neighbor.name],
        jumps,
        durationSeconds,
      });
    }
  }
  return null;
}

export function calculateCargoRoutes(
  planets: readonly PlanetMarket[],
  edges: readonly HyperlaneEdge[],
  constraints: CargoRouteConstraints,
): CargoRoute[] {
  if (
    constraints.maxDistance !== undefined &&
    (!Number.isFinite(constraints.maxDistance) || constraints.maxDistance <= 0)
  )
    return [];
  const destinations: readonly PlanetMarket[] = [
    ...planets,
    ...navigationWaypoints
      .filter((waypoint) => !planets.some((planet) => key(planet.name) === key(waypoint.name)))
      .map((waypoint) => ({ ...waypoint, resources: {} })),
  ];
  const normalized = destinations
    .map((planet) => ({
      ...planet,
      galacticCoordinates:
        planet.galacticCoordinates ??
        (navigationNode(planet.name)
          ? { x: navigationNode(planet.name)!.x, y: navigationNode(planet.name)!.y }
          : undefined),
      key: key(planet.name),
    }))
    .filter((planet) => !isExcluded(planet, constraints));
  const adjacency = buildAdjacency(normalized, edges, constraints);
  const routes: CargoRoute[] = [];

  for (const buyPlanet of normalized) {
    for (const sellPlanet of normalized) {
      if (buyPlanet.key === sellPlanet.key) continue;
      const outbound = shortestPath(buyPlanet, sellPlanet, adjacency, constraints.maxJumpsPerLeg);
      if (!outbound) continue;
      const returnLeg = shortestPath(sellPlanet, buyPlanet, adjacency, constraints.maxJumpsPerLeg);
      if (!returnLeg) continue;

      for (const [resource, buyPrice] of Object.entries(buyPlanet.resources)) {
        const sellPrice = sellPlanet.resources[resource];
        if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice) || sellPrice <= buyPrice) {
          continue;
        }
        const quantity = constraints.cargoCapacity;
        const purchaseCost = buyPrice * quantity;
        const saleRevenue = sellPrice * quantity * (1 - (sellPlanet.taxRate ?? 0) / 100);
        const expectedProfit = saleRevenue - purchaseCost;
        if (expectedProfit <= 0) continue;
        const totalDurationSeconds = outbound.durationSeconds + returnLeg.durationSeconds;
        const expectedProfitPerHour =
          totalDurationSeconds > 0 ? expectedProfit / (totalDurationSeconds / 3600) : 0;
        routes.push({
          buyPlanet: buyPlanet.name,
          sellPlanet: sellPlanet.name,
          resource,
          quantity,
          purchaseCost,
          saleRevenue,
          expectedProfit,
          expectedProfitPerHour,
          outbound,
          returnLeg,
          totalLoopJumps: outbound.jumps + returnLeg.jumps,
          totalDurationSeconds,
        });
      }
    }
  }

  return routes.sort((left, right) => {
    if (right.expectedProfitPerHour !== left.expectedProfitPerHour) {
      return right.expectedProfitPerHour - left.expectedProfitPerHour;
    }
    return right.expectedProfit - left.expectedProfit;
  });
}

export function cargoTravelLegs(
  planets: readonly PlanetMarket[],
  edges: readonly HyperlaneEdge[],
  constraints: CargoRouteConstraints,
): CargoRouteLeg[] {
  if (
    constraints.maxDistance !== undefined &&
    (!Number.isFinite(constraints.maxDistance) || constraints.maxDistance <= 0)
  )
    return [];
  const destinations: readonly PlanetMarket[] = [
    ...planets,
    ...navigationWaypoints
      .filter((waypoint) => !planets.some((planet) => key(planet.name) === key(waypoint.name)))
      .map((waypoint) => ({ ...waypoint, resources: {} })),
  ];
  const normalized = destinations
    .map((planet) => ({
      ...planet,
      key: key(planet.name),
      galacticCoordinates:
        planet.galacticCoordinates ??
        (navigationNode(planet.name)
          ? { x: navigationNode(planet.name)!.x, y: navigationNode(planet.name)!.y }
          : undefined),
    }))
    .filter((planet) => !isExcluded(planet, constraints));
  const adjacency = buildAdjacency(normalized, edges, constraints);
  const markets = normalized.filter((planet) => Object.keys(planet.resources).length > 0);
  return markets.flatMap((from) =>
    markets.flatMap((to) => {
      if (from.key === to.key) return [];
      const leg = shortestPath(from, to, adjacency, constraints.maxJumpsPerLeg);
      if (leg && constraints.timing) {
        // Each edge includes one transit stop. Replace only the final stop with
        // market turnaround time, including an empty departure or return arrival.
        leg.durationSeconds +=
          (constraints.timing.tradeStopMinutes - constraints.timing.transitStopMinutes) * 60;
      }
      return leg ? [leg] : [];
    }),
  );
}

export function routePlanetNames(route: CargoRoute): string[] {
  if (route.legs) return route.legs.flatMap((leg) => leg.path.slice(0, -1));
  const names = [...route.outbound.path, ...route.returnLeg.path.slice(1, -1)];
  return names.filter((name, index) => index === 0 || key(name) !== key(names[index - 1]));
}

export function normalizeExcludedNames(names: readonly string[]): Set<string> {
  return new Set(names.map(key));
}

export function findPlanet(
  planets: readonly PlanetMarket[],
  name: string,
): PlanetMarket | undefined {
  const wanted = key(name);
  return planets.find((planet) => key(planet.name) === wanted);
}
