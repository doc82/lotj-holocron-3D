import {
  cargoTravelLegs,
  type CargoRoute,
  type CargoTradeLeg,
  type PlanetMarket,
  type HyperlaneEdge,
  type CargoRouteConstraints,
} from "./cargoRoutes.ts";

const key = (name: string) => name.trim().toLowerCase();
const pair = (from: string, to: string) => JSON.stringify([from, to]);
const score = (route: CargoRoute) => route.expectedProfitPerHour;

export function calculateFreighterRoutes(
  planets: readonly PlanetMarket[],
  edges: readonly HyperlaneEdge[],
  constraints: CargoRouteConstraints & {
    maxTradeStops?: number | "unlimited";
    startingPlanet?: string;
  },
): CargoRoute[] {
  if (!Number.isFinite(constraints.cargoCapacity) || constraints.cargoCapacity <= 0) return [];
  const markets = new Map(planets.map((planet) => [key(planet.name), planet]));
  const connections = new Map<string, CargoTradeLeg>();
  for (const leg of cargoTravelLegs(planets, edges, constraints)) {
    const from = markets.get(key(leg.from))!;
    const to = markets.get(key(leg.to))!;
    let trade: CargoTradeLeg["trade"] = null;
    const salePrices = new Map(
      Object.entries(to.resources).map(([name, price]) => [key(name), price]),
    );
    for (const [resource, price] of Object.entries(from.resources)) {
      const sell = salePrices.get(key(resource));
      if (!Number.isFinite(price) || price < 0 || sell === undefined || !Number.isFinite(sell))
        continue;
      const purchaseCost = price * constraints.cargoCapacity;
      const saleRevenue = sell * constraints.cargoCapacity * (1 - (to.taxRate ?? 0) / 100);
      const expectedProfit = saleRevenue - purchaseCost;
      if (!Number.isFinite(expectedProfit) || expectedProfit <= (trade?.expectedProfit ?? 0))
        continue;
      trade = {
        resource,
        quantity: constraints.cargoCapacity,
        purchaseCost,
        saleRevenue,
        expectedProfit,
      };
    }
    connections.set(pair(leg.from, leg.to), { ...leg, trade });
  }
  const names = [...new Set([...connections.values()].flatMap((leg) => [leg.from, leg.to]))].sort();
  const maxStops =
    constraints.maxTradeStops === "unlimited"
      ? names.length
      : Math.min(names.length, constraints.maxTradeStops ?? 6);
  if (!Number.isFinite(maxStops) || maxStops < 2) return [];
  const results: CargoRoute[] = [];
  function circuit(legs: CargoTradeLeg[]): CargoRoute | null {
    const expectedProfit = legs.reduce((sum, leg) => sum + (leg.trade?.expectedProfit ?? 0), 0);
    if (expectedProfit <= 0) return null;
    const totalDurationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
    if (!Number.isFinite(totalDurationSeconds) || totalDurationSeconds <= 0) return null;
    const firstTrade = legs.find((leg) => leg.trade)!.trade!;
    const remainder = legs.slice(1);
    return {
      maxDistance: constraints.maxDistance,
      legs,
      buyPlanet: legs[0].from,
      sellPlanet: legs[0].to,
      resource: firstTrade.resource,
      quantity: constraints.cargoCapacity,
      purchaseCost: legs.reduce((sum, leg) => sum + (leg.trade?.purchaseCost ?? 0), 0),
      saleRevenue: legs.reduce((sum, leg) => sum + (leg.trade?.saleRevenue ?? 0), 0),
      expectedProfit,
      expectedProfitPerHour: expectedProfit / (totalDurationSeconds / 3600),
      outbound: legs[0],
      returnLeg: {
        from: legs[0].to,
        to: legs[0].from,
        path: [legs[0].to, ...remainder.flatMap((leg) => leg.path.slice(1))],
        jumps: remainder.reduce((sum, leg) => sum + leg.jumps, 0),
        durationSeconds: remainder.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      },
      totalLoopJumps: legs.reduce((sum, leg) => sum + leg.jumps, 0),
      totalDurationSeconds,
    };
  }
  // A bounded beam keeps long-circuit searches responsive. It is a shortlist, not
  // an exhaustive enumeration or a guarantee of the globally optimal circuit.
  for (let start = 0; start < names.length; start++) {
    if (constraints.startingPlanet && key(names[start]) !== key(constraints.startingPlanet))
      continue;
    let frontier: { stops: string[]; legs: CargoTradeLeg[]; rank: number }[] = [
      { stops: [names[start]], legs: [], rank: 0 },
    ];
    for (let depth = 1; depth < maxStops && frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const state of frontier) {
        for (const destination of constraints.startingPlanet
          ? names.filter((name) => name !== names[start])
          : names.slice(start + 1)) {
          if (state.stops.includes(destination)) continue;
          const leg = connections.get(pair(state.stops.at(-1)!, destination));
          if (!leg) continue;
          const legs = [...state.legs, leg];
          const closing = connections.get(pair(destination, names[start]));
          const closed = closing ? circuit([...legs, closing]) : null;
          if (closed) results.push(closed);
          const profit = legs.reduce((sum, entry) => sum + (entry.trade?.expectedProfit ?? 0), 0);
          const seconds = legs.reduce((sum, entry) => sum + entry.durationSeconds, 0);
          next.push({
            stops: [...state.stops, destination],
            legs,
            rank: closed ? score(closed) : profit / (seconds / 3600),
          });
        }
      }
      next.sort((a, b) => b.rank - a.rank);
      frontier = next.slice(0, 100);
      if (results.length > 1000) {
        results.sort((a, b) => score(b) - score(a) || b.expectedProfit - a.expectedProfit);
        results.length = 500;
      }
    }
  }
  return results
    .sort((a, b) => score(b) - score(a) || b.expectedProfit - a.expectedProfit)
    .slice(0, 500);
}

export function freighterStops(route: CargoRoute): { planet: string; actions: string[] }[] {
  const describe = (action: string, trade: NonNullable<CargoTradeLeg["trade"]>) =>
    `${action} ${trade.quantity.toLocaleString()} units of ${trade.resource}`;
  const legs: CargoTradeLeg[] = route.legs ?? [
    {
      ...route.outbound,
      trade: {
        resource: route.resource,
        quantity: route.quantity,
        purchaseCost: route.purchaseCost,
        saleRevenue: route.saleRevenue,
        expectedProfit: route.expectedProfit,
      },
    },
    { ...route.returnLeg, trade: null },
  ];
  return legs.flatMap((leg, index) => {
    const incoming = index > 0 ? legs[index - 1].trade : null;
    const actions = [
      ...(incoming ? [describe("Sell", incoming)] : []),
      ...(leg.trade ? [describe("Buy", leg.trade)] : ["Depart empty"]),
    ];
    if (index === 0 && legs.at(-1)!.trade)
      actions.push(describe("On return, sell", legs.at(-1)!.trade!));
    return [
      { planet: leg.from, actions },
      ...leg.path.slice(1, -1).map((planet) => ({ planet, actions: [] })),
    ];
  });
}
