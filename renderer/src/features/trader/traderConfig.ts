import type { LogisticsMarket } from "../../types/telemetry";
import {
  cargoRouteIdentity,
  validCargoTiming,
  type CargoTiming,
  type CargoRoute,
} from "../../domain/cargoRoutes.ts";

export interface TraderShipConfig {
  timing?: CargoTiming;
  id: string;
  name: string;
  capacity: number;
  enterPath: string[];
  exitPath: string[];
  directCockpit?: boolean;
  hatchCode?: string;
}

export interface TraderPadConfig {
  planet: string;
  pad: string;
}

export interface TraderSavedRoute extends CargoRoute {
  savedAt?: number;
  marketSnapshot?: LogisticsMarket[];
  id: string;
  name: string;
  shipId?: string;
}

export interface TraderConfigState {
  ships: TraderShipConfig[];
  pads: TraderPadConfig[];
  routes: TraderSavedRoute[];
  selectedShipId?: string;
}

export const EMPTY_TRADER_CONFIG: TraderConfigState = {
  ships: [],
  pads: [],
  routes: [],
};

export function parsePath(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

const DIRECTIONS = new Set([
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
  "u",
  "d",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "up",
  "down",
]);

export function shipValidation(
  ship: TraderShipConfig,
  ships: readonly TraderShipConfig[],
): string | null {
  if (!ship.name.trim()) return "Enter the ship's name.";
  if (ship.timing && !validCargoTiming(ship.timing))
    return "Travel time must be greater than zero; stop times must be zero or greater.";
  if (!/^[\w\s'-]+$/.test(ship.name) || /[\r\n]/.test(ship.name))
    return "Use letters, numbers, spaces, hyphens or apostrophes for the ship name.";
  if (
    ships.some(
      (other) =>
        other.id !== ship.id && other.name.toLowerCase() === ship.name.trim().toLowerCase(),
    )
  )
    return "A ship with that name is already saved. Edit its existing entry.";
  if (!Number.isSafeInteger(ship.capacity) || ship.capacity <= 0 || ship.capacity > 100_000_000)
    return "Cargo capacity must be a whole number between 1 and 100,000,000.";
  if ([...ship.enterPath, ...ship.exitPath].some((step) => !DIRECTIONS.has(step)))
    return "Use directions for paths, such as n, n, u. Separate steps with spaces or commas.";
  if (ship.hatchCode && (typeof ship.hatchCode !== "string" || !/^\d+$/.test(ship.hatchCode)))
    return "Hatch code must contain digits only.";
  return null;
}

export function upsertShip(config: TraderConfigState, ship: TraderShipConfig): TraderConfigState {
  if (shipValidation(ship, config.ships)) return config;
  return {
    ...config,
    selectedShipId: config.selectedShipId ?? ship.id,
    ships: [...config.ships.filter((entry) => entry.id !== ship.id), ship],
  };
}

export function removeShip(config: TraderConfigState, id: string): TraderConfigState {
  const ships = config.ships.filter((ship) => ship.id !== id);
  return {
    ...config,
    ships,
    selectedShipId: config.selectedShipId === id ? ships[0]?.id : config.selectedShipId,
    routes: config.routes.map((route) =>
      route.shipId === id ? { ...route, shipId: undefined } : route,
    ),
  };
}

export function padForPlanet(pads: readonly TraderPadConfig[], planet: string) {
  return pads.find((pad) => pad.planet.toLowerCase() === planet.trim().toLowerCase());
}

export function upsertPad(
  config: TraderConfigState,
  pad: TraderPadConfig,
  previousPlanet?: string,
): TraderConfigState {
  const planet = pad.planet.trim();
  const name = pad.pad.trim();
  if (!planet || !name) return config;
  return {
    ...config,
    pads: [
      ...config.pads.filter(
        (entry) =>
          entry.planet.toLowerCase() !== planet.toLowerCase() &&
          entry.planet.toLowerCase() !== previousPlanet?.toLowerCase(),
      ),
      { planet, pad: name },
    ],
  };
}

export function savedRouteId(route: CargoRoute, shipId?: string): string {
  return `${shipId ?? "unassigned"}:${cargoRouteIdentity(route)}`;
}

// Recover older add-only configurations without trusting malformed local storage.
export function readTraderConfig(value: unknown): TraderConfigState {
  if (!value || typeof value !== "object") return { ...EMPTY_TRADER_CONFIG };
  const raw = value as Partial<TraderConfigState>;
  let config: TraderConfigState = { ships: [], pads: [], routes: [] };
  for (const ship of Array.isArray(raw.ships) ? raw.ships : []) {
    if (
      ship &&
      typeof ship.id === "string" &&
      typeof ship.name === "string" &&
      Array.isArray(ship.enterPath) &&
      Array.isArray(ship.exitPath)
    ) {
      // Keep old entries with an unfinished capacity editable on upgrade.
      if (ship.capacity === 0 && !shipValidation({ ...ship, capacity: 1 }, config.ships)) {
        config.ships.push(ship);
      } else config = upsertShip(config, ship);
    }
  }
  for (const pad of Array.isArray(raw.pads) ? raw.pads : []) {
    if (pad && typeof pad.planet === "string" && typeof pad.pad === "string")
      config = upsertPad(config, pad);
  }
  config.selectedShipId = config.ships.some((ship) => ship.id === raw.selectedShipId)
    ? raw.selectedShipId
    : config.ships[0]?.id;
  config.routes = (Array.isArray(raw.routes) ? raw.routes : [])
    .filter(
      (route) =>
        route &&
        typeof route.buyPlanet === "string" &&
        typeof route.sellPlanet === "string" &&
        typeof route.resource === "string" &&
        (route.stopSettings === undefined ||
          (Array.isArray(route.stopSettings) &&
            route.stopSettings.length === route.totalLoopJumps + 1 &&
            route.stopSettings.every(
              (stop) =>
                stop &&
                typeof stop.planet === "string" &&
                (stop.pad === undefined ||
                  (typeof stop.pad === "string" &&
                    stop.pad.length <= 200 &&
                    !/[\x00-\x1f"]/.test(stop.pad))) &&
                (stop.tradeMode === undefined ||
                  stop.tradeMode === "cargo" ||
                  stop.tradeMode === "contraband"),
            ))) &&
        (route.legs === undefined ||
          (Array.isArray(route.legs) &&
            route.legs.length >= (route.manual ? 1 : 2) &&
            route.legs.every(
              (leg, index, legs) =>
                leg &&
                typeof leg.from === "string" &&
                typeof leg.to === "string" &&
                leg.to === legs[(index + 1) % legs.length]?.from &&
                Array.isArray(leg.path) &&
                leg.path.length >= 2 &&
                leg.path.every((name) => typeof name === "string") &&
                leg.path[0] === leg.from &&
                leg.path.at(-1) === leg.to &&
                Number.isFinite(leg.jumps) &&
                Number.isFinite(leg.durationSeconds) &&
                (leg.trade === null ||
                  (leg.trade &&
                    typeof leg.trade.resource === "string" &&
                    [
                      leg.trade.quantity,
                      leg.trade.purchaseCost,
                      leg.trade.saleRevenue,
                      leg.trade.expectedProfit,
                    ].every(Number.isFinite))),
            ))) &&
        [
          route.quantity,
          route.purchaseCost,
          route.saleRevenue,
          route.expectedProfit,
          route.expectedProfitPerHour,
          route.totalLoopJumps,
          route.totalDurationSeconds,
        ].every(Number.isFinite) &&
        [route.outbound, route.returnLeg].every(
          (leg) =>
            leg &&
            Array.isArray(leg.path) &&
            leg.path.length >= 2 &&
            leg.path.every((planet) => typeof planet === "string") &&
            Number.isFinite(leg.jumps),
        ),
    )
    .map((route) => ({
      ...route,
      id: typeof route.id === "string" ? route.id : savedRouteId(route),
      name:
        typeof route.name === "string" ? route.name : `${route.buyPlanet} to ${route.sellPlanet}`,
      shipId: config.ships.some((ship) => ship.id === route.shipId) ? route.shipId : undefined,
    }));
  return config;
}

export function traderConfigId(name: string): string {
  return `${name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
}
