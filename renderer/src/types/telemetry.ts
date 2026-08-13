export type Vector3 = [number, number, number];
export type Color3 = [number, number, number];
export type ShipDisposition = "neutral" | "ally" | "enemy";
export type WeaponType = "best" | "autoblaster" | "laser" | "turbolaser" | "ion"
  | "missile" | "torpedo" | "rocket" | "burst";

export interface CombatEvent {
  id: number;
  type: "launch" | "impact" | "charged" | "failure";
  weapon: WeaponType;
  targetName?: string;
  count?: number;
  outcome?: "hit" | "miss";
  reason?: string;
  observedAt?: number;
}

export interface SpeedReading {
  current?: number;
  maximum?: number;
}

export interface TelemetryEntity {
  id: string;
  name?: string;
  class?: string;
  kind?: string;
  x?: number;
  y?: number;
  z?: number;
  distance?: number;
  speed?: number | SpeedReading;
  position?: string;
  disposition?: ShipDisposition;
  shipCategory?: string;
  heading?: { x?: number; y?: number; z?: number };
  [key: string]: unknown;
}

export interface Observer extends TelemetryEntity {
  coordinates?: { x?: number; y?: number; z?: number };
  sensorArray?: number;
  radarRange?: number;
  autotrack?: boolean;
  hasWeapons?: boolean;
  weapons?: Record<string, number>;
}

export interface PollingState {
  enabled?: boolean;
  command?: string;
}

export interface SystemSnapshot {
  v?: number;
  type?: "system_snapshot";
  sequence?: number;
  observedAt?: number;
  observer?: Observer;
  entities?: TelemetryEntity[];
  metadata?: {
    system?: string;
    inSpace?: boolean;
    polling?: PollingState;
    autotrackDesired?: boolean;
    autotrackPending?: boolean;
    autotrackObservedAt?: number;
    autotrackResponse?: string;
    combatTarget?: string;
    combatEvent?: CombatEvent;
    combatEvents?: CombatEvent[];
    autoRechargeEnabled?: boolean;
    shieldRecharging?: boolean;
    shieldRechargeAttempts?: number;
    shieldStatusPending?: boolean;
    [key: string]: unknown;
  };
}

export interface SpaceState {
  type?: "space_state";
  inSpace: boolean;
  reason?: string;
}

export interface ConnectionState {
  connected?: boolean;
}

export interface InitialState {
  connected?: boolean;
  snapshot?: SystemSnapshot | null;
  spaceState?: SpaceState | null;
}

export interface HolocronApi {
  getInitialState(): Promise<InitialState | null>;
  getAppVersion(): Promise<string | null>;
  sendIntent(action: string, payload?: Record<string, unknown>): Promise<{ accepted?: boolean; reason?: string; id?: string }>;
  onSnapshot(callback: (snapshot: SystemSnapshot) => void): () => void;
  onSpaceState(callback: (state: SpaceState) => void): () => void;
  onConnectionState(callback: (state: ConnectionState) => void): () => void;
  onIntentAck(callback: (ack: { id?: string; status?: "accepted" | "rejected" | "completed"; reason?: string }) => void): () => void;
}

declare global {
  interface Window {
    holocron?: HolocronApi;
  }
}
