import type { CargoRoute, CargoTradeLeg } from "./cargoRoutes.ts";
import type {
  NavigationDestination,
  NavigationMission,
  NavigationStop,
  RouteStopAction,
} from "./routeAutopilot.ts";

// Cargo is a stop-action plugin. Non-cargo planners can supply NavigationMission
// directly, with empty actions or their own actions, without importing this file.
export function cargoMission(
  route: CargoRoute,
  id: string,
  ship: NavigationMission["ship"],
  resolve: (planet: string) => NavigationDestination | undefined,
  repetitions = 1,
): NavigationMission {
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
  if (!legs.length) throw new Error("The cargo route is empty.");
  const destination = (planet: string) => {
    const found = resolve(planet);
    if (!found)
      throw new Error(
        `Navigation coordinates and landing/docking details are missing for ${planet}.`,
      );
    return found;
  };
  const action = (
    kind: "buy" | "sell",
    trade: NonNullable<CargoTradeLeg["trade"]>,
  ): RouteStopAction => ({
    kind: `cargo.${kind}`,
    label: `${kind} ${trade.quantity} ${trade.resource}`,
    payload: {
      resource: trade.resource,
      quantity: trade.quantity,
      expectedCredits: kind === "buy" ? trade.purchaseCost : trade.saleRevenue,
    },
  });
  const stops: NavigationStop[] = [
    { destination: destination(legs[0].from), actions: [], refuel: true },
  ];
  for (const [index, leg] of legs.entries()) {
    if (
      leg.path.length < 2 ||
      leg.path[0] !== leg.from ||
      leg.path.at(-1) !== leg.to ||
      (index > 0 && legs[index - 1].to !== leg.from)
    )
      throw new Error("Cargo route legs are not connected.");
    if (leg.trade) stops.at(-1)!.actions.push(action("buy", leg.trade));
    for (const planet of leg.path.slice(1))
      stops.push({ destination: destination(planet), actions: [], refuel: true });
    if (leg.trade) stops.at(-1)!.actions.push(action("sell", leg.trade));
  }
  if (stops.at(-1)!.destination.name !== stops[0].destination.name)
    throw new Error("Cargo circuits must return to their origin.");
  if (route.stopSettings) {
    if (route.stopSettings.length !== stops.length)
      throw new Error("Route stop settings do not match its path.");
    for (const [index, settings] of route.stopSettings.entries()) {
      const stop = stops[index];
      if (
        settings.planet !== stop.destination.name ||
        (settings.tradeMode !== undefined &&
          settings.tradeMode !== "cargo" &&
          settings.tradeMode !== "contraband")
      )
        throw new Error("Invalid route stop settings.");
      if (settings.pad !== undefined) {
        if (
          typeof settings.pad !== "string" ||
          settings.pad.length > 200 ||
          /[\x00-\x1f"]/.test(settings.pad)
        )
          throw new Error("Invalid landing pad.");
        stop.destination = {
          ...stop.destination,
          arrival: { ...stop.destination.arrival, pad: settings.pad || undefined },
        };
      }
      for (const action of stop.actions) {
        action.payload.tradeMode = settings.tradeMode ?? "cargo";
        if (settings.tradeMode === "contraband") action.label += " (contraband)";
      }
    }
  }
  return {
    id,
    ship,
    stops,
    repetitions,
    routingMode: route.manual ? "manual" : undefined,
    maxDistance: route.maxDistance,
  };
}

export function cargoActionPreflight(
  action: RouteStopAction,
  actual: {
    credits: number;
    capacity: number;
    used: number;
    cargo: Record<string, number>;
    unitPrice: number;
  },
): string | null {
  const quantity = action.payload.quantity;
  const resource = action.payload.resource;
  if (!Number.isSafeInteger(quantity) || Number(quantity) <= 0 || typeof resource !== "string")
    return "Invalid cargo action.";
  if (
    ![actual.credits, actual.capacity, actual.used, actual.unitPrice].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    actual.used > actual.capacity
  )
    return "Current credits, cargo and market price must be confirmed.";
  if (action.kind === "cargo.buy") {
    if (actual.capacity - actual.used < Number(quantity))
      return "Insufficient free cargo space; replan the load.";
    if (actual.credits < Number(quantity) * actual.unitPrice)
      return "Insufficient credits; replan the load.";
    return null;
  }
  if (action.kind === "cargo.sell") {
    const held = Object.entries(actual.cargo).find(
      ([name]) => name.toLowerCase() === resource.toLowerCase(),
    )?.[1];
    return Number.isFinite(held) && held! >= Number(quantity)
      ? null
      : "The planned cargo is not in the hold.";
  }
  return "Unsupported cargo action.";
}
