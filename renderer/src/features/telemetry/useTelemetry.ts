import { useEffect, useState } from "react";

import type { InitialState, SpaceState, SystemSnapshot } from "../../types/telemetry";

export interface TelemetryState {
  connected: boolean;
  connectionLabel: string;
  snapshot: SystemSnapshot | null;
  spaceState: SpaceState | null;
}

const initialTelemetry: TelemetryState = {
  connected: false,
  connectionLabel: "CONNECTING",
  snapshot: null,
  spaceState: null,
};

function mergeInitial(current: TelemetryState, initial: InitialState): TelemetryState {
  const connected = initial.connected === true;
  return {
    connected,
    connectionLabel: connected ? "MUDLET LINK" : "WAITING FOR MUDLET",
    snapshot: initial.snapshot ?? current.snapshot,
    spaceState: initial.spaceState ?? current.spaceState,
  };
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
        api.onSnapshot((snapshot) => setTelemetry((current) => ({ ...current, snapshot }))),
        api.onSpaceState((spaceState) => setTelemetry((current) => ({ ...current, spaceState }))),
        api.onConnectionState((connection) => {
          const connected = connection?.connected === true;
          setTelemetry((current) => ({
            ...current,
            connected,
            connectionLabel: connected ? "MUDLET LINK" : "WAITING FOR MUDLET",
          }));
        }),
      );
      void api.getInitialState().then((initial) => {
        if (!active) return;
        if (!initial) {
          setTelemetry((current) => ({ ...current, connected: false, connectionLabel: "IPC REJECTED" }));
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
        setTelemetry((current) => ({ ...current, connected: true, connectionLabel: "BRIDGE LINK" }));
      });
      socket.addEventListener("message", (event) => {
        let message: { type?: string } & Record<string, unknown>;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.type === "bridge_ready") {
          setTelemetry((current) => ({ ...current, connected: true, connectionLabel: "LIVE LINK" }));
        } else if (message.type === "system_snapshot") {
          setTelemetry((current) => ({ ...current, snapshot: message as unknown as SystemSnapshot }));
        } else if (message.type === "space_state") {
          setTelemetry((current) => ({ ...current, spaceState: message as unknown as SpaceState }));
        }
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setTelemetry((current) => ({ ...current, connected: false, connectionLabel: "RECONNECTING" }));
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
