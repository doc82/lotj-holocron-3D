import fs from "node:fs";
import net from "node:net";

import { appDataPaths } from "../electron/shared/app-paths.mjs";
import shipModelCatalog from "../renderer/src/domain/shipModelCatalog.json" with { type: "json" };

const relayPort = Number(process.env.HOLOCRON_RELAY_PORT || 8786);
const observedAt = Date.now() / 1_000;
const runtimeRoot = new URL("../renderer/public/ship-models/", import.meta.url);
const runtimeManifest = JSON.parse(fs.readFileSync(new URL("manifest.json", runtimeRoot), "utf8"));
const runtimeModelsById = new Map(runtimeManifest.models.map((model) => [model.id, model]));
const missingModels = shipModelCatalog.models.filter((model) => !runtimeModelsById.has(model.id));
if (missingModels.length > 0) {
  throw new Error(
    `Ship preview bundle is missing catalog models: ${missingModels
      .map((model) => model.id)
      .join(", ")}`,
  );
}
for (const model of shipModelCatalog.models) {
  const runtimeModel = runtimeModelsById.get(model.id);
  if (!runtimeModel || !fs.existsSync(new URL(runtimeModel.file, runtimeRoot))) {
    throw new Error(`Ship preview mesh is missing for ${model.id}.`);
  }
}
if (process.argv.includes("--validate-only")) {
  console.log(`Ship preview bundle contains all ${shipModelCatalog.models.length} catalog models.`);
  process.exit(0);
}
const token = fs.readFileSync(appDataPaths().token, "utf8").trim();
const [observerModel, ...contactModels] = shipModelCatalog.models;
const columns = 5;
const spacing = 48;
const rows = Math.ceil(contactModels.length / columns);
const ships = contactModels.map((model, index) => ({
  id: `preview:${model.id}`,
  name: `${model.displayName} Review`,
  class: model.displayName,
  shipCategory: model.category,
  x: ((index % columns) - (columns - 1) / 2) * spacing,
  y: 0,
  z: (Math.floor(index / columns) - (rows - 1) / 2) * spacing,
}));

const messages = [
  { v: 1, type: "relay_auth", token },
  { v: 1, type: "hello", bridge: "ship-model-preview" },
  { v: 1, type: "space_state", inSpace: true, reason: "ship model preview" },
  {
    v: 1,
    type: "system_snapshot",
    sequence: 1,
    observedAt,
    observer: {
      id: "player-ship",
      name: `${observerModel.displayName} Review`,
      class: observerModel.displayName,
      kind: "ship",
      shipCategory: observerModel.category,
      x: 0,
      y: 0,
      z: 0,
      radarRange: 1_000,
      heading: { x: 0, y: 0, z: 1 },
    },
    entities: ships.map((ship, index) => ({
      ...ship,
      kind: "ship",
      disposition: index % 3 === 0 ? "enemy" : index % 3 === 1 ? "ally" : "neutral",
      heading: { x: 0, y: 0, z: 1 },
    })),
    metadata: { system: "Ship Model Review", inSpace: true, lastCapturePolled: true },
  },
];

const socket = net.createConnection({ host: "127.0.0.1", port: relayPort });
socket.setEncoding("utf8");
socket.on("connect", () => {
  for (const message of messages) socket.write(`${JSON.stringify(message)}\n`);
  console.log(
    `Ship-model preview connected ${shipModelCatalog.models.length} models to the Electron relay on port ${relayPort}.`,
  );
  console.log("Keep this process open while previewing; press Ctrl+C to disconnect.");
});
socket.on("data", (chunk) => {
  for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
    try {
      const message = JSON.parse(line);
      if (message.type === "intent") {
        socket.write(
          `${JSON.stringify({
            v: 1,
            type: "intent_ack",
            id: message.id,
            status: "rejected",
            reason: "Commands are disabled in the ship-model preview.",
          })}\n`,
        );
      }
    } catch {
      // Diagnostic output from a preview host must not interrupt the preview.
    }
  }
});
socket.on("error", (error) => {
  console.error(`Unable to connect to the Holocron relay: ${error.message}`);
  process.exitCode = 1;
});
