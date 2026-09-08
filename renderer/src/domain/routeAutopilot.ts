// The navigation runner deliberately knows nothing about cargo or game commands.
// A transport must confirm the physical outcome, not merely accept a command.
export interface NavigationDestination {
  name: string;
  system: string;
  galaxy: { x: number; y: number };
  // Planet coordinates may be resolved with showplanet immediately before flight.
  position?: { x: number; y: number; z: number };
  arrival: { kind: "planet"; pad?: string } | { kind: "station"; station: string; pad?: string };
}

export interface RouteStopAction {
  kind: string;
  label: string;
  payload: Record<string, string | number | boolean>;
}

export interface NavigationStop {
  destination: NavigationDestination;
  actions: RouteStopAction[];
  refuel: boolean;
}

export interface NavigationMission {
  routingMode?: "manual";
  maxDistance?: number;
  id: string;
  ship: {
    name: string;
    enterPath: string[];
    exitPath: string[];
    hatchCode?: string;
    directCockpit?: boolean;
  };
  stops: NavigationStop[];
  repetitions: number;
}

export interface RouteOperation {
  id: string;
  runId: string;
  stop: number;
  lap: number;
  kind: "reconcile" | "navigate" | "refuel" | "stop_action";
  destination: NavigationDestination;
  action?: RouteStopAction;
}

export interface RouteCheckpoint {
  version: 1;
  mission: NavigationMission;
  runId: string;
  sequence: number;
  lap: number;
  stop: number;
  stage: "arrival" | "refuel" | "actions";
  action: number;
  status: "paused" | "running" | "blocked" | "completed" | "aborted";
  pending?: RouteOperation;
  interrupted?: RouteOperation;
  reason?: string;
  needsReconciliation: boolean;
}

export interface RouteConfirmation {
  operationId: string;
  runId: string;
  outcome: "completed" | "rejected" | "unknown";
  // Required for arrival and reconciliation. Supplied by confirmed telemetry.
  location?: { ship: string; destination: string; landedOrDocked: boolean };
  // Reconciliation must determine whether an interrupted operation happened.
  interruptedOutcome?: "completed" | "not_started" | "unknown";
  reason?: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function prepareMission(mission: NavigationMission, runId: string): RouteCheckpoint {
  if (
    !Array.isArray(mission.ship.enterPath) ||
    !Array.isArray(mission.ship.exitPath) ||
    (mission.ship.directCockpit === true
      ? mission.ship.enterPath.length !== 0 || mission.ship.exitPath.length !== 0
      : mission.ship.enterPath.length === 0 || mission.ship.exitPath.length === 0)
  )
    throw new Error(
      "Configure both cockpit entry and exit paths in My ships, or confirm that boarding enters the cockpit directly.",
    );
  if (
    !runId ||
    !mission.id ||
    !mission.ship.name.trim() ||
    mission.stops.length === 0 ||
    !Number.isSafeInteger(mission.repetitions) ||
    mission.repetitions < 1
  )
    throw new Error("Invalid navigation mission.");
  for (const stop of mission.stops) {
    if (
      !stop.destination.name ||
      !stop.destination.system ||
      ![
        stop.destination.galaxy.x,
        stop.destination.galaxy.y,
        ...Object.values(stop.destination.position ?? {}),
      ].every(Number.isFinite) ||
      !["planet", "station"].includes(stop.destination.arrival.kind) ||
      (stop.destination.arrival.kind === "station" && !stop.destination.arrival.station.trim()) ||
      (stop.destination.arrival.kind === "station" && !stop.destination.position)
    )
      throw new Error("Every stop needs a resolved destination.");
  }
  return {
    version: 1,
    mission: structuredClone(mission),
    runId,
    sequence: 0,
    lap: 0,
    stop: 0,
    stage: "arrival",
    action: 0,
    status: "paused",
    needsReconciliation: true,
  };
}

export function pauseMission(state: RouteCheckpoint, reason = "Paused by user."): RouteCheckpoint {
  if (["completed", "aborted"].includes(state.status)) return state;
  return { ...state, status: "paused", needsReconciliation: true, reason };
}

export function resumeMission(state: RouteCheckpoint): RouteCheckpoint {
  if (!["paused", "blocked"].includes(state.status)) return state;
  return {
    ...state,
    pending: state.pending?.kind === "reconcile" ? undefined : state.pending,
    status: "running",
    needsReconciliation: true,
    reason: undefined,
  };
}

export function restoreMission(state: RouteCheckpoint): RouteCheckpoint {
  // Restoration never launches a ship or replays an uncertain purchase.
  prepareMission(state.mission, state.runId);
  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.stop) ||
    state.stop < 0 ||
    state.stop >= state.mission.stops.length ||
    !Number.isSafeInteger(state.lap) ||
    state.lap < 0 ||
    state.lap >= state.mission.repetitions ||
    !Number.isSafeInteger(state.sequence) ||
    state.sequence < 0 ||
    !Number.isSafeInteger(state.action) ||
    state.action < 0 ||
    state.action > state.mission.stops[state.stop].actions.length ||
    !["arrival", "refuel", "actions"].includes(state.stage)
  )
    throw new Error("Invalid route checkpoint.");
  return pauseMission(
    structuredClone(state),
    "Restored; verify location and any interrupted operation before continuing.",
  );
}

export function abortMission(state: RouteCheckpoint): RouteCheckpoint {
  return {
    ...state,
    status: "aborted",
    reason: "Aborted. An operation already sent may still finish in game.",
  };
}

function advance(state: RouteCheckpoint): RouteCheckpoint {
  if (state.stage === "arrival") return { ...state, stage: "refuel" };
  if (state.stage === "refuel") return { ...state, stage: "actions" };
  return { ...state, action: state.action + 1 };
}

export function nextRouteOperation(state: RouteCheckpoint): {
  state: RouteCheckpoint;
  operation?: RouteOperation;
} {
  if (state.status !== "running") return { state };
  if (state.pending && !state.needsReconciliation) return { state };
  let next = state;
  if (!next.needsReconciliation) {
    if (next.stage === "refuel" && !next.mission.stops[next.stop].refuel)
      next = { ...next, stage: "actions" };
    if (next.stage === "actions" && next.action >= next.mission.stops[next.stop].actions.length) {
      if (next.stop + 1 < next.mission.stops.length)
        next = { ...next, stop: next.stop + 1, action: 0, stage: "arrival" };
      else if (next.lap + 1 < next.mission.repetitions)
        next = {
          ...next,
          stop: 0,
          lap: next.lap + 1,
          action: 0,
          stage: "arrival",
          needsReconciliation: true,
        };
      else return { state: { ...next, status: "completed" } };
    }
  }
  // Keep an interrupted operation in the checkpoint while reconciling it.
  if (next.pending?.kind === "reconcile") return { state: next };
  const operation: RouteOperation = {
    id: `${next.runId}:${next.sequence + 1}`,
    runId: next.runId,
    stop: next.stop,
    lap: next.lap,
    kind: next.needsReconciliation
      ? "reconcile"
      : next.stage === "arrival"
        ? "navigate"
        : next.stage === "refuel"
          ? "refuel"
          : "stop_action",
    destination: next.mission.stops[next.stop].destination,
    action:
      next.stage === "actions" ? next.mission.stops[next.stop].actions[next.action] : undefined,
  };
  return {
    state: {
      ...next,
      interrupted: next.needsReconciliation ? (next.pending ?? next.interrupted) : next.interrupted,
      sequence: next.sequence + 1,
      pending: operation,
    },
    operation,
  };
}

export function confirmRouteOperation(
  state: RouteCheckpoint,
  result: RouteConfirmation,
): RouteCheckpoint {
  const pending = state.pending;
  if (
    !pending ||
    result.operationId !== pending.id ||
    result.runId !== state.runId ||
    state.status === "aborted"
  )
    return state;
  if (result.outcome !== "completed")
    return {
      ...state,
      status: "blocked",
      needsReconciliation: true,
      reason: result.reason ?? "Operation outcome is uncertain; reconciliation is required.",
    };
  if (pending.kind === "navigate" || pending.kind === "reconcile") {
    const actual = result.location;
    if (
      !actual ||
      !actual.landedOrDocked ||
      !same(actual.ship, state.mission.ship.name) ||
      !same(actual.destination, pending.destination.name)
    ) {
      return {
        ...state,
        status: "blocked",
        needsReconciliation: true,
        reason: "Confirmed ship and landed/docked destination do not match the route.",
      };
    }
  }
  if (pending.kind === "reconcile") {
    if (result.interruptedOutcome === "unknown" || result.interruptedOutcome === undefined)
      return {
        ...state,
        pending: undefined,
        status: "blocked",
        needsReconciliation: true,
        reason: "The interrupted operation must be reconciled before retrying.",
      };
    const reconciled = {
      ...state,
      pending: undefined,
      interrupted: undefined,
      needsReconciliation: false,
      reason: undefined,
    };
    return state.stage === "arrival" || result.interruptedOutcome === "completed"
      ? advance(reconciled)
      : reconciled;
  }
  return advance({ ...state, pending: undefined, reason: undefined });
}
