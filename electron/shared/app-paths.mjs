import os from "node:os";
import path from "node:path";

export function appDataPaths(env = process.env, platform = process.platform, home = os.homedir()) {
  const targetPath = platform === "win32" ? path.win32 : path.posix;
  let defaultBase;
  if (platform === "win32") {
    defaultBase = targetPath.join(
      env.LOCALAPPDATA || targetPath.join(home, "AppData", "Local"),
      "Holocron3D",
    );
  } else if (platform === "darwin") {
    defaultBase = targetPath.join(home, "Library", "Application Support", "Holocron3D");
  } else {
    defaultBase = targetPath.join(
      env.XDG_DATA_HOME || targetPath.join(home, ".local", "share"),
      "Holocron3D",
    );
  }
  const base = env.HOLOCRON_DATA_DIR || defaultBase;
  const relayName = platform === "win32" ? "holocron-relay.exe" : "holocron-relay";
  return {
    base,
    bin: targetPath.join(base, "bin"),
    relay: targetPath.join(base, "bin", relayName),
    mudlet: targetPath.join(base, "mudlet"),
    mudletPackage: targetPath.join(base, "mudlet", "Holocron3D.mpackage"),
    token: env.HOLOCRON_RELAY_TOKEN_FILE || targetPath.join(base, "bridge-token"),
    logs: targetPath.join(base, "logs"),
    log: targetPath.join(base, "logs", "holocron3d.log"),
  };
}
