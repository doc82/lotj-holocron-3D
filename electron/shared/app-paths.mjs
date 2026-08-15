import os from "node:os";
import path from "node:path";

export function appDataPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  let defaultBase;
  if (platform === "win32") {
    defaultBase = path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Holocron3D");
  } else if (platform === "darwin") {
    defaultBase = path.join(home, "Library", "Application Support", "Holocron3D");
  } else {
    defaultBase = path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "Holocron3D");
  }
  const base = env.HOLOCRON_DATA_DIR || defaultBase;
  const relayName = platform === "win32" ? "holocron-relay.exe" : "holocron-relay";
  return {
    base,
    bin: path.join(base, "bin"),
    relay: path.join(base, "bin", relayName),
    mudlet: path.join(base, "mudlet"),
    mudletPackage: path.join(base, "mudlet", "Holocron3D.mpackage"),
    token: env.HOLOCRON_RELAY_TOKEN_FILE || path.join(base, "bridge-token"),
    logs: path.join(base, "logs"),
    log: path.join(base, "logs", "holocron3d.log"),
  };
}
