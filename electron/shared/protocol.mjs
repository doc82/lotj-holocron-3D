export const PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 256 * 1024;

export function validateIntent(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "message must be an object";
  }
  if (message.v !== PROTOCOL_VERSION) return "unsupported protocol version";
  if (message.type !== "intent") return "clients may only send intent messages";
  if (typeof message.id !== "string" || !message.id || message.id.length > 128) {
    return "intent id must be a non-empty string no longer than 128 characters";
  }
  if (typeof message.action !== "string" || !message.action) {
    return "intent action must be a non-empty string";
  }
  if (message.payload !== undefined
      && (!message.payload || typeof message.payload !== "object"
        || Array.isArray(message.payload))) {
    return "intent payload must be an object";
  }
  return null;
}

export function createTelemetryHost({ write, emit, broadcast, shutdown }) {
  const state = {
    mudletConnected: false,
    websocketUrl: null,
    latestSnapshot: null,
    latestSpaceState: null,
    latestGalaxyCatalog: null,
    readySent: false,
  };

  function send(message) {
    write({ v: PROTOCOL_VERSION, ...message });
  }

  function diagnostic(level, message) {
    send({ type: "bridge_diagnostic", level, message });
  }

  function maybeReady() {
    if (!state.mudletConnected || state.readySent) return;
    state.readySent = true;
    const message = {
      type: "ready",
      bridge: "electron-host",
      renderer: "electron",
    };
    if (state.websocketUrl) message.websocketUrl = state.websocketUrl;
    send(message);
    emit("connection", { connected: true, transport: "mudlet-pipe" });
  }

  function setWebsocketUrl(websocketUrl) {
    state.websocketUrl = websocketUrl;
  }

  function disconnectMudlet() {
    state.mudletConnected = false;
    state.readySent = false;
    emit("connection", { connected: false, transport: "mudlet-relay" });
  }

  function handleMudletMessage(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      diagnostic("warn", "ignored a non-object message from Mudlet");
      return;
    }
    if (message.v !== PROTOCOL_VERSION) {
      diagnostic("warn", `unsupported protocol version: ${String(message.v)}`);
      return;
    }

    switch (message.type) {
      case "hello":
        state.mudletConnected = true;
        maybeReady();
        break;
      case "system_snapshot":
        state.latestSnapshot = message;
        emit("snapshot", message);
        broadcast(message);
        send({
          type: "snapshot_received",
          sequence: message.sequence,
          entityCount: Array.isArray(message.entities) ? message.entities.length : 0,
          polled: message.metadata?.lastCapturePolled === true,
        });
        break;
      case "space_state":
        state.latestSpaceState = message;
        emit("space-state", message);
        broadcast(message);
        send({ type: "space_state_received", inSpace: message.inSpace === true });
        break;
      case "galaxy_catalog":
        state.latestGalaxyCatalog = message;
        emit("galaxy-catalog", message);
        broadcast(message);
        break;
      case "intent_ack":
        emit("intent-ack", message);
        broadcast(message);
        break;
      case "shutdown":
        shutdown();
        break;
      default:
        diagnostic("warn", `ignored Mudlet message type: ${String(message.type)}`);
    }
  }

  function handleIntent(message) {
    const error = validateIntent(message);
    if (error) return { accepted: false, reason: error };
    send({
      type: "intent",
      id: message.id,
      action: message.action,
      payload: message.payload ?? {},
    });
    return { accepted: true };
  }

  function initialState() {
    return {
      connected: state.mudletConnected,
      snapshot: state.latestSnapshot,
      spaceState: state.latestSpaceState,
      galaxyCatalog: state.latestGalaxyCatalog,
      websocketUrl: state.websocketUrl,
    };
  }

  return {
    state,
    setWebsocketUrl,
    disconnectMudlet,
    handleMudletMessage,
    handleIntent,
    initialState,
  };
}
