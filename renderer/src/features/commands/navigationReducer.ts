import type { FleetScope } from "../fleet/FleetRoster";
import type { Vector3 } from "../../types/telemetry";

export type NavigationMode = "idle" | "vector" | "target" | "away" | "confirm";
export type NavigationCommandMode = "relative" | "target" | "away";

export interface NavigationState {
  mode: NavigationMode;
  commandMode: NavigationCommandMode;
  targetId: string | null;
  vector: Vector3;
  requestedSpeed: number;
  knownMaximumSpeed: number;
  status: string;
  fleetScope: FleetScope | null;
}

export const initialNavigationState: NavigationState = {
  mode: "idle",
  commandMode: "relative",
  targetId: null,
  vector: [100, 0, 0],
  requestedSpeed: 0,
  knownMaximumSpeed: 0,
  status: "",
  fleetScope: null,
};

export type NavigationAction =
  | { type: "begin-vector"; fleetScope: FleetScope | null }
  | {
      type: "arm-target";
      mode: "target" | "away";
      targetId: string;
      fleetScope: FleetScope | null;
    }
  | { type: "stage" }
  | { type: "set-vector"; vector: Vector3 }
  | { type: "set-speed"; speed: number; status?: string }
  | { type: "observe-speed"; speed: number; maximum: number }
  | { type: "set-status"; status: string }
  | { type: "finish"; status: string }
  | { type: "reset"; speed: number };

export function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case "begin-vector":
      return {
        ...state,
        mode: "vector",
        commandMode: "relative",
        targetId: null,
        fleetScope: action.fleetScope,
        status: "MOVE CURSOR // SHIFT ELEVATION // MMB ORBIT // WASD PAN // Q/E CAMERA ELEVATION",
      };
    case "arm-target":
      return {
        ...state,
        mode: action.mode,
        commandMode: action.mode,
        targetId: action.targetId,
        fleetScope: action.fleetScope,
        status: action.mode === "away" ? "CONFIRM REVERSE COURSE" : "CONFIRM INTERCEPT COURSE",
      };
    case "stage":
      return { ...state, mode: "confirm", status: "COURSE READY // CONFIRM ORDER" };
    case "set-vector":
      return { ...state, vector: action.vector };
    case "set-speed":
      return {
        ...state,
        requestedSpeed: action.speed,
        ...(action.status === undefined ? {} : { status: action.status }),
      };
    case "observe-speed":
      return {
        ...state,
        requestedSpeed: Math.max(0, Math.min(action.maximum, action.speed)),
        knownMaximumSpeed: action.maximum > 0 ? action.maximum : state.knownMaximumSpeed,
      };
    case "set-status":
      return { ...state, status: action.status };
    case "finish":
      return { ...state, mode: "idle", fleetScope: null, status: action.status };
    case "reset":
      return {
        ...state,
        mode: "idle",
        commandMode: "relative",
        targetId: null,
        requestedSpeed: action.speed,
        status: "",
        fleetScope: null,
      };
  }
}
