import { useEffect, useState } from "react";

import type {
  GalaxyCatalog,
  InitialState,
  SpaceState,
  SystemSnapshot,
} from "../../types/telemetry";

export interface TelemetryState {
  connected: boolean;
  connectionLabel: string;
  snapshot: SystemSnapshot | null;
  spaceState: SpaceState | null;
  galaxyCatalog: GalaxyCatalog | null;
}

const initialTelemetry: TelemetryState = {
  connected: false,
  connectionLabel: "CONNECTING",
  snapshot: null,
  spaceState: null,
  galaxyCatalog: null,
};

function mergeInitial(current: TelemetryState, initial: InitialState): TelemetryState {
  const connected = initial.connected === true;
  const spaceState = current.spaceState ?? initial.spaceState ?? null;
  const snapshot =
    spaceState?.inSpace === false ? null : (current.snapshot ?? initial.snapshot ?? null);
  return {
    connected,
    connectionLabel: connected ? "MUDLET LINK" : "WAITING FOR MUDLET",
    snapshot,
    spaceState,
    galaxyCatalog: initial.galaxyCatalog ?? current.galaxyCatalog,
  };
}

function receiveSnapshot(current: TelemetryState, snapshot: SystemSnapshot): TelemetryState {
  if (current.spaceState?.inSpace === false || snapshot.metadata?.inSpace === false) {
    return { ...current, snapshot: null };
  }
  return { ...current, snapshot };
}

function receiveSpaceState(current: TelemetryState, spaceState: SpaceState): TelemetryState {
  // A space-state transition is a hard renderer session boundary. Even on
  // launch, wait for a new snapshot instead of briefly restoring the old system.
  return { ...current, spaceState, snapshot: null };
}

export function useTelemetry(): TelemetryState {
  const [telemetry, setTelemetry] = useState(initialTelemetry);

  useEffect(() => {
    let active = true;
    const cleanups: Array<() => void> = [];

    if (window.holocron) {
      const api = window.holocron;
      setTelemetry((current) => ({ ...current, connectionLabel: "WAITING FOR MUDLET" }));
      cleanups.push(
        api.onSnapshot((snapshot) => setTelemetry((current) => receiveSnapshot(current, snapshot))),
        api.onSpaceState((spaceState) =>
          setTelemetry((current) => receiveSpaceState(current, spaceState)),
        ),
        api.onGalaxyCatalog((galaxyCatalog) =>
          setTelemetry((current) => ({ ...current, galaxyCatalog })),
        ),
        api.onConnectionState((connection) => {
          const connected = connection?.connected === true;
          setTelemetry((current) => ({
            ...current,
            connected,
            connectionLabel: connected ? "MUDLET LINK" : "WAITING FOR MUDLET",
            ...(!connected ? { snapshot: null, spaceState: null } : {}),
          }));
        }),
      );
      void api.getInitialState().then((initial) => {
        if (!active) return;
        if (!initial) {
          setTelemetry((current) => ({
            ...current,
            connected: false,
            connectionLabel: "IPC REJECTED",
          }));
          return;
        }
        setTelemetry((current) => mergeInitial(current, initial));
      });
      return () => {
        active = false;
        cleanups.forEach((cleanup) => cleanup());
      };
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectDelay = 500;

    const connect = async () => {
      if (!active) return;
      setTelemetry((current) => ({ ...current, connected: false, connectionLabel: "CONNECTING" }));
      let websocketUrl = `ws://${location.hostname || "127.0.0.1"}:8787`;
      try {
        const response = await fetch("/config.json", { cache: "no-store" });
        if (response.ok) websocketUrl = (await response.json()).websocketUrl || websocketUrl;
      } catch {
        // The loopback default supports the archived static-browser POC.
      }
      if (!active) return;
      socket = new WebSocket(websocketUrl);
      socket.addEventListener("open", () => {
        reconnectDelay = 500;
        setTelemetry((current) => ({
          ...current,
          connected: true,
          connectionLabel: "BRIDGE LINK",
        }));
      });
      socket.addEventListener("message", (event) => {
        let message: { type?: string } & Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "bridge_ready") {
          setTelemetry((current) => ({
            ...current,
            connected: true,
            connectionLabel: "LIVE LINK",
          }));
        } else if (message.type === "system_snapshot") {
          setTelemetry((current) => receiveSnapshot(current, message as unknown as SystemSnapshot));
        } else if (message.type === "space_state") {
          setTelemetry((current) => receiveSpaceState(current, message as unknown as SpaceState));
        } else if (message.type === "galaxy_catalog") {
          setTelemetry((current) => ({
            ...current,
            galaxyCatalog: message as unknown as GalaxyCatalog,
          }));
        }
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setTelemetry((current) => ({
          ...current,
          connected: false,
          connectionLabel: "RECONNECTING",
          snapshot: null,
          spaceState: null,
        }));
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
      });
      socket.addEventListener("error", () => socket?.close());
    };

    void connect();
    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return telemetry;
}
