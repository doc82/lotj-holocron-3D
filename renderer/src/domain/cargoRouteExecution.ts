import type { CargoRoute } from "./cargoRoutes";

export type CargoExecutionPhase =
  | "idle"
  | "armed"
  | "arrived"
  | "refuel_on_exit"
  | "exit_ship"
  | "enter_ship"
  | "refuel_on_entry"
  | "commerce"
  | "transit"
  | "plotting"
  | "engaging"
  | "in_transit"
  | "paused"
  | "completed"
  | "aborted"
  | "blocked";

export type CargoStopPurpose = "buy" | "sell" | "transit";

export interface CargoExecutionStop {
  planet: string;
  purpose: CargoStopPurpose;
  resource?: string;
  quantity?: number;
  legIndex: number;
}

export interface CargoRouteCheckpoint {
  routeId: string;
  stopIndex: number;
  phase: CargoExecutionPhase;
  currentPlanet?: string;
  completedActions: string[];
  updatedAt: number;
}

export interface CargoExecutionState {
  shipName?: string;
  route: CargoRoute | null;
  stops: CargoExecutionStop[];
  stopIndex: number;
  phase: CargoExecutionPhase;
  pendingAction?: string;
  error?: string;
  checkpoint?: CargoRouteCheckpoint;
}

export type CargoExecutionAction =
  | { type: "arm"; route: CargoRoute; routeId: string; now?: number }
  | { type: "restore"; route: CargoRoute; checkpoint: CargoRouteCheckpoint }
  | { type: "pause"; now?: number }
  | { type: "resume"; now?: number }
  | { type: "arrived"; planet: string; now?: number }
  | { type: "refuel_on_exit"; now?: number }
  | { type: "ship_exited"; now?: number }
  | { type: "ship_entered"; now?: number }
  | { type: "refuel_on_entry"; now?: number }
  | { type: "commerce_complete"; now?: number }
  | { type: "transit_complete"; now?: number }
  | { type: "leg_plotted"; now?: number }
  | { type: "leg_engaged"; now?: number }
  | { type: "leg_arrived"; planet: string; now?: number }
  | { type: "block"; reason: string; now?: number }
  | { type: "abort"; now?: number };

function timestamp(now?: number): number {
  return now ?? Date.now() / 1_000;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function executionStops(route: CargoRoute): CargoExecutionStop[] {
  const outbound = route.outbound.path.map((planet, index) => ({
    planet,
    purpose:
      index === 0
        ? ("buy" as const)
        : index === route.outbound.path.length - 1
          ? ("sell" as const)
          : ("transit" as const),
    resource: index === 0 || index === route.outbound.path.length - 1 ? route.resource : undefined,
    quantity: index === 0 || index === route.outbound.path.length - 1 ? route.quantity : undefined,
    legIndex: 0,
  }));
  const returning = route.returnLeg.path.slice(1).map((planet, index, path) => ({
    planet,
    purpose: index === path.length - 1 ? ("buy" as const) : ("transit" as const),
    resource: index === path.length - 1 ? route.resource : undefined,
    quantity: index === path.length - 1 ? route.quantity : undefined,
    legIndex: 1,
  }));
  return [...outbound, ...returning];
}

function checkpoint(state: CargoExecutionState, now?: number): CargoExecutionState {
  if (!state.route) return state;
  const stop = state.stops[state.stopIndex];
  return {
    ...state,
    checkpoint: {
      routeId: `${state.route.buyPlanet}:${state.route.sellPlanet}:${state.route.resource}`,
      stopIndex: state.stopIndex,
      phase: state.phase,
      currentPlanet: stop?.planet,
      completedActions: state.pendingAction ? [] : [state.phase],
      updatedAt: timestamp(now),
    },
  };
}

function transition(
  state: CargoExecutionState,
  phase: CargoExecutionPhase,
  pendingAction?: string,
  now?: number,
): CargoExecutionState {
  return checkpoint({ ...state, phase, pendingAction }, now);
}

export const initialCargoExecutionState: CargoExecutionState = {
  route: null,
  stops: [],
  stopIndex: 0,
  phase: "idle",
};

export function cargoExecutionReducer(
  state: CargoExecutionState,
  action: CargoExecutionAction,
): CargoExecutionState {
  switch (action.type) {
    case "arm": {
      if (action.route.legs)
        return {
          ...initialCargoExecutionState,
          route: action.route,
          phase: "blocked",
          error: "Freighter circuit execution is not implemented yet.",
        };
      const stops = executionStops(action.route);
      return checkpoint(
        {
          route: action.route,
          stops,
          stopIndex: 0,
          phase: "armed",
          pendingAction: "confirm_current_planet",
        },
        action.now,
      );
    }
    case "restore":
      return restoreCargoCheckpoint(action.route, action.checkpoint);
    case "pause":
      if (state.phase === "completed" || state.phase === "aborted" || state.phase === "idle")
        return state;
      return transition(state, "paused", undefined, action.now);
    case "resume":
      if (state.phase !== "paused") return state;
      return transition(state, "arrived", "reconcile_current_planet_and_cargo", action.now);
    case "arrived": {
      const stop = state.stops[state.stopIndex];
      if (!stop || normalized(stop.planet) !== normalized(action.planet)) {
        return transition(
          { ...state, error: `unexpected arrival at ${action.planet}` },
          "blocked",
          undefined,
          action.now,
        );
      }
      return transition(state, "arrived", "refuel_on_exit", action.now);
    }
    case "refuel_on_exit":
      if (state.phase !== "arrived") return state;
      return transition(state, "exit_ship", "exit_ship", action.now);
    case "ship_exited":
      if (state.phase !== "exit_ship") return state;
      return transition(state, "enter_ship", "enter_ship", action.now);
    case "ship_entered":
      if (state.phase !== "enter_ship") return state;
      return transition(state, "refuel_on_entry", "refuel_on_entry", action.now);
    case "refuel_on_entry":
      if (state.phase !== "refuel_on_entry") return state;
      return transition(
        state,
        state.stops[state.stopIndex]?.purpose === "transit" ? "transit" : "commerce",
        "complete_stop_action",
        action.now,
      );
    case "commerce_complete":
    case "transit_complete": {
      if (state.phase !== "commerce" && state.phase !== "transit") return state;
      const nextIndex = state.stopIndex + 1;
      if (nextIndex >= state.stops.length) {
        return transition({ ...state, stopIndex: nextIndex }, "completed", undefined, action.now);
      }
      return checkpoint(
        {
          ...state,
          stopIndex: nextIndex,
          phase: "plotting",
          pendingAction: "plot_next_leg",
        },
        action.now,
      );
    }
    case "leg_plotted":
      if (state.phase !== "plotting") return state;
      return transition(state, "engaging", "engage_hyperdrive", action.now);
    case "leg_engaged":
      if (state.phase !== "engaging") return state;
      return transition(state, "in_transit", "await_arrival", action.now);
    case "leg_arrived":
      if (state.phase !== "in_transit") return state;
      return cargoExecutionReducer(state, {
        type: "arrived",
        planet: action.planet,
        now: action.now,
      });
    case "block":
      return transition({ ...state, error: action.reason }, "blocked", undefined, action.now);
    case "abort":
      return transition(state, "aborted", undefined, action.now);
    default:
      return state;
  }
}

export function restoreCargoCheckpoint(
  route: CargoRoute,
  checkpointValue: CargoRouteCheckpoint,
): CargoExecutionState {
  if (route.legs)
    return {
      ...initialCargoExecutionState,
      route,
      phase: "blocked",
      error: "Freighter circuit execution is not implemented yet.",
    };
  const stops = executionStops(route);
  return {
    route,
    stops,
    stopIndex: Math.min(checkpointValue.stopIndex, stops.length),
    phase: checkpointValue.phase === "paused" ? "paused" : "paused",
    checkpoint: checkpointValue,
  };
}

export function cargoExecutionStops(route: CargoRoute): CargoExecutionStop[] {
  return executionStops(route);
}
