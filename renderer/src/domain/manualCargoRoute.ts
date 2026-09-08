import {
  DEFAULT_CARGO_TIMING,
  validCargoTiming,
  type CargoRoute,
  type CargoTradeLeg,
  type CargoTiming,
  type PlanetMarket,
  type RouteStopSettings,
} from "./cargoRoutes.ts";

export interface ManualStop extends RouteStopSettings {
  planet: string;
  action: "transit" | "buy" | "sell" | "sell_buy";
  resource: string;
}

// Expand every transit occurrence, including the return journey, into editable stops.
export function routeReviewStops(route: CargoRoute): ManualStop[] {
  const legs = route.legs ?? [
    { ...route.outbound, trade: { resource: route.resource } },
    { ...route.returnLeg, trade: null },
  ];
  const stops: ManualStop[] = [{ planet: legs[0].from, action: "transit", resource: "" }];
  for (const leg of legs) {
    if (leg.trade) {
      const start = stops.at(-1)!;
      start.action = start.action === "sell" ? "sell_buy" : "buy";
      start.resource = leg.trade.resource;
    }
    for (const planet of leg.path.slice(1)) stops.push({ planet, action: "transit", resource: "" });
    if (leg.trade) stops.at(-1)!.action = "sell";
  }
  return stops.slice(0, -1).map((stop, index) => ({ ...stop, ...route.stopSettings?.[index] }));
}

// Compile the user's exact path. No graph search or inferred gateway rules.
export function manualCargoRoute(
  stops: ManualStop[],
  markets: PlanetMarket[],
  quantity: number,
  maxDistance = 35,
  timing: CargoTiming = DEFAULT_CARGO_TIMING,
  returnSettings?: RouteStopSettings,
): CargoRoute {
  if (stops.length < 2) throw new Error("Add an origin and at least one destination.");
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error("Enter a positive whole cargo quantity.");
  if (!Number.isFinite(maxDistance) || maxDistance <= 0 || !validCargoTiming(timing))
    throw new Error("Enter a valid maximum distance and ship timing.");
  const lookup = (name: string) =>
    markets.find((market) => market.name.toLowerCase() === name.trim().toLowerCase());
  const selected = stops.map((stop) => {
    const market = lookup(stop.planet);
    if (!market) throw new Error(`Select a known destination for ${stop.planet || "each stop"}.`);
    return market;
  });
  if (selected.at(-1)!.name === selected[0].name)
    throw new Error(
      "The return to the origin is added automatically; remove the duplicate final stop.",
    );
  const path = [...selected, selected[0]];
  const stopSettings = [
    ...stops.map((stop, i) => ({
      planet: selected[i].name,
      pad: stop.pad,
      tradeMode: stop.tradeMode ?? "cargo",
    })),
    {
      planet: selected[0].name,
      pad: returnSettings?.pad ?? stops[0].pad,
      tradeMode: returnSettings?.tradeMode ?? stops[0].tradeMode ?? "cargo",
    },
  ];
  for (const stop of stopSettings) {
    if (stop.tradeMode !== "cargo" && stop.tradeMode !== "contraband")
      throw new Error("Choose cargo or contraband for each stop.");
    if (stop.pad !== undefined && (stop.pad.length > 200 || /[\r\n\x00-\x1f"]/.test(stop.pad)))
      throw new Error("Enter a valid landing pad.");
  }
  const durations = path.slice(1).map((to, i) => {
    const from = path[i];
    if (from.name === to.name) throw new Error("Consecutive stops must be different.");
    if (!from.galacticCoordinates || !to.galacticCoordinates)
      throw new Error(`Sector coordinates are missing for ${from.name} or ${to.name}.`);
    const distance = Math.hypot(
      from.galacticCoordinates.x - to.galacticCoordinates.x,
      from.galacticCoordinates.y - to.galacticCoordinates.y,
    );
    if (!Number.isFinite(distance) || distance > maxDistance)
      throw new Error(
        `${from.name} → ${to.name} exceeds the maximum sector distance of ${maxDistance}.`,
      );
    const action = stops[i + 1]?.action ?? "sell";
    return (
      ((distance / 35) * timing.minutesPer35Sectors +
        (action === "transit" ? timing.transitStopMinutes : timing.tradeStopMinutes)) *
      60
    );
  });
  let estimateAvailable = true;
  const legs: CargoTradeLeg[] = [];
  let cursor = 0;
  let held: { start: number; resource: string } | undefined;
  const leg = (start: number, end: number, resource?: string) => {
    let trade: CargoTradeLeg["trade"] = null;
    if (resource) {
      const price = (index: number) =>
        Object.entries(path[index].resources).find(
          ([name]) => name.toLowerCase() === resource.toLowerCase(),
        )?.[1];
      const buy = price(start),
        sell = price(end);
      if (buy === undefined || sell === undefined) estimateAvailable = false;
      const purchaseCost = (buy ?? 0) * quantity;
      const saleRevenue =
        (sell ?? 0) *
        quantity *
        (1 - (stopSettings[end].tradeMode === "contraband" ? 0 : (path[end].taxRate ?? 0)) / 100);
      trade = {
        resource,
        quantity,
        purchaseCost,
        saleRevenue,
        expectedProfit: saleRevenue - purchaseCost,
      };
    }
    legs.push({
      from: path[start].name,
      to: path[end].name,
      path: path.slice(start, end + 1).map((p) => p.name),
      jumps: end - start,
      durationSeconds: durations.slice(start, end).reduce((a, b) => a + b, 0),
      trade,
    });
  };
  for (let i = 0; i < path.length; i++) {
    const action = i === stops.length ? (held ? "sell" : "transit") : stops[i].action;
    if (action === "sell" || action === "sell_buy") {
      if (!held) throw new Error(`There is no planned cargo to sell at stop ${i + 1}.`);
      leg(held.start, i, held.resource);
      cursor = i;
      held = undefined;
    }
    if (action === "buy" || action === "sell_buy") {
      if (held)
        throw new Error(
          `Sell the carried cargo before buying at stop ${i + 1}, or choose Sell and buy.`,
        );
      const resource = stops[i].resource.trim();
      if (!resource || /[\r\n"]/.test(resource))
        throw new Error(`Choose a cargo good to buy at stop ${i + 1}.`);
      if (cursor < i) leg(cursor, i);
      held = { start: i, resource };
    }
  }
  if (cursor < path.length - 1) leg(cursor, path.length - 1);
  const purchaseCost = legs.reduce((sum, leg) => sum + (leg.trade?.purchaseCost ?? 0), 0);
  const saleRevenue = legs.reduce((sum, leg) => sum + (leg.trade?.saleRevenue ?? 0), 0);
  const totalDurationSeconds = durations.reduce((a, b) => a + b, 0);
  if (totalDurationSeconds <= 0)
    throw new Error("The circuit needs a positive travel or stop duration.");
  return {
    manual: true,
    stopSettings,
    maxDistance,
    estimateAvailable,
    legs,
    quantity,
    buyPlanet: path[0].name,
    sellPlanet: path[1].name,
    resource: legs.find((leg) => leg.trade)?.trade?.resource ?? "Transit",
    purchaseCost,
    saleRevenue,
    expectedProfit: saleRevenue - purchaseCost,
    expectedProfitPerHour: ((saleRevenue - purchaseCost) / totalDurationSeconds) * 3600,
    totalDurationSeconds,
    totalLoopJumps: durations.length,
    outbound: {
      from: path[0].name,
      to: path[1].name,
      path: [path[0].name, path[1].name],
      jumps: 1,
      durationSeconds: durations[0],
    },
    returnLeg: {
      from: path[1].name,
      to: path[0].name,
      path: path.slice(1).map((p) => p.name),
      jumps: durations.length - 1,
      durationSeconds: totalDurationSeconds - durations[0],
    },
  };
}
