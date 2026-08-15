import fs from "node:fs";
import path from "node:path";

import squirrelStartup from "electron-squirrel-startup";

import { appDataPaths } from "../shared/app-paths.mjs";

function installResource(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.copyFileSync(source, destination);
  } catch (error) {
    // A resource can be in use during an update. The next app launch retries.
    if (!fs.existsSync(destination)) throw error;
  }
}

function installStableResources() {
  if (!process.resourcesPath) return;
  const paths = appDataPaths();
  const relayName = process.platform === "win32" ? "holocron-relay.exe" : "holocron-relay";
  installResource(path.join(process.resourcesPath, relayName), paths.relay);
  if (process.platform !== "win32" && fs.existsSync(paths.relay)) fs.chmodSync(paths.relay, 0o755);
  installResource(path.join(process.resourcesPath, "Holocron3D.mpackage"), paths.mudletPackage);
}

installStableResources();
if (!squirrelStartup) await import("./main.mjs");
