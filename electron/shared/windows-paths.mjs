import os from "node:os";
import path from "node:path";

export function appDataPaths(env = process.env) {
  const base = env.HOLOCRON_DATA_DIR
    || path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Holocron3D");
  return {
    base,
    bin: path.join(base, "bin"),
    relay: path.join(base, "bin", "holocron-relay.exe"),
    mudlet: path.join(base, "mudlet"),
    mudletPackage: path.join(base, "mudlet", "Holocron3D.mpackage"),
    token: env.HOLOCRON_RELAY_TOKEN_FILE || path.join(base, "bridge-token"),
    logs: path.join(base, "logs"),
    log: path.join(base, "logs", "holocron3d.log"),
  };
}
