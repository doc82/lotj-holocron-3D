const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") throw new TypeError("callback must be a function");
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("holocron", Object.freeze({
  getInitialState: () => ipcRenderer.invoke("holocron:get-initial-state"),
  getAppVersion: () => ipcRenderer.invoke("holocron:get-app-version"),
  sendIntent: (action, payload = {}) => ipcRenderer.invoke(
    "holocron:send-intent",
    { action, payload },
  ),
  onSnapshot: (callback) => subscribe("holocron:snapshot", callback),
  onSpaceState: (callback) => subscribe("holocron:space-state", callback),
  onConnectionState: (callback) => subscribe("holocron:connection", callback),
  onIntentAck: (callback) => subscribe("holocron:intent-ack", callback),
}));
