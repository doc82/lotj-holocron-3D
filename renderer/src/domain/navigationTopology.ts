import data from "../../../data/navigation/galaxy.json" with { type: "json" };
import type { HyperlaneEdge } from "./cargoRoutes.ts";

export interface NavigationTopology {
  schemaVersion: number;
  era: string;
  revision: number;
  nodes: { id: string; name: string; system: string; aliases: string[]; x: number; y: number }[];
  regions: Record<string, { name: string; members: string[] }>;
  permanentEdges: { from: string; to: string }[];
  temporaryControls: { id: string; from: string; to: string; monitor: string[] }[];
  observations: { from: string; to: string; status: string }[];
  waypoints: Record<string, NavigationWaypoint>;
}
const topology: NavigationTopology = data;
export { topology as navigationTopology };
export interface NavigationWaypoint {
  name: string;
  system: string;
  galacticCoordinates: { x: number; y: number };
  refuelStation: string;
  landingTarget?: string;
  approachTarget?: string;
  landingPad?: string;
  refuelCoordinates: { x: number; y: number; z: number };
}
export const navigationWaypoints: NavigationWaypoint[] = Object.values(topology.waypoints);
export function navigationWaypoint(value: string): NavigationWaypoint | undefined {
  const node = navigationNode(value);
  return navigationWaypoints.find((waypoint) => waypoint.name === node?.name);
}
const normalize = (value: string) => value.trim().toLowerCase();
export function navigationNode(value: string) {
  return topology.nodes.find((node) =>
    [node.id, node.name, node.system, ...node.aliases].some(
      (alias) => normalize(alias) === normalize(value),
    ),
  );
}
const regions: Record<string, { name: string; members: string[] }> = topology.regions;
const members = (id: string) => regions[id]?.members ?? [id];
function endpointMatches(value: string, endpoint: string, monitor: string): boolean {
  return (
    normalize(value) === normalize(monitor) ||
    normalize(value) === normalize(regions[endpoint]?.name ?? endpoint) ||
    navigationNode(value)?.id === endpoint
  );
}

// Directed permanent evidence; bidirectional temporary controls. No default-open fallback.
// A manual route can explore unverified edges, but cannot override observed No Path or a control.
export function navigationJump(
  from: string,
  to: string,
  lanes: readonly HyperlaneEdge[],
  manual = false,
): { allowed: boolean; reason?: string; travelSeconds?: number } {
  const a = navigationNode(from),
    b = navigationNode(to);
  if (!a || !b)
    return { allowed: false, reason: "Destination is not in the current galaxy topology." };
  if (a.id === b.id) return { allowed: false, reason: "A jump needs different destinations." };
  const controls = topology.temporaryControls.filter(
    (control) =>
      (members(control.from).includes(a.id) && members(control.to).includes(b.id)) ||
      (members(control.from).includes(b.id) && members(control.to).includes(a.id)),
  );
  if (controls.length) {
    let travelSeconds: number | undefined;
    for (const control of controls) {
      const matching = lanes.filter(
        (lane) =>
          (endpointMatches(lane.from, control.from, control.monitor[0]) &&
            endpointMatches(lane.to, control.to, control.monitor[1])) ||
          (endpointMatches(lane.to, control.from, control.monitor[0]) &&
            endpointMatches(lane.from, control.to, control.monitor[1])),
      );
      if (!matching.length || matching.some((lane) => lane.status !== "passable"))
        return {
          allowed: false,
          reason: `Temporary control ${control.id} needs a fresh Passable reading.`,
        };
      travelSeconds = matching.find((lane) => lane.travelSeconds !== undefined)?.travelSeconds;
    }
    return { allowed: true, travelSeconds };
  }
  if (topology.permanentEdges.some((edge) => edge.from === a.id && edge.to === b.id))
    return { allowed: true };
  const blocked = topology.observations.some(
    (o) => o.from === a.id && o.to === b.id && o.status === "No Path",
  );
  return {
    allowed: manual && !blocked,
    reason: blocked ? "This direction reports No Path." : "This direction has not been verified.",
  };
}

// Static validation permits temporary edges pending a fresh runtime check.
export function validateNavigationPath(names: readonly string[], manual = false): void {
  const controls = topology.temporaryControls.map((c) => ({
    from: c.monitor[0],
    to: c.monitor[1],
    status: "passable" as const,
  }));
  for (let i = 1; i < names.length; i++) {
    const permission = navigationJump(names[i - 1], names[i], controls, manual);
    if (!permission.allowed)
      throw new Error(names[i - 1] + " -> " + names[i] + ": " + permission.reason);
  }
}
