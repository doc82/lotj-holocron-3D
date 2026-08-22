import fs from "node:fs";
import net from "node:net";

import assignmentManifest from "../renderer/src/domain/planetTextureAssignments.json" with { type: "json" };
import { appDataPaths } from "../electron/shared/app-paths.mjs";

const relayPort = Number(process.env.HOLOCRON_RELAY_PORT || 8786);
const token = fs.readFileSync(appDataPaths().token, "utf8").trim();
const observedAt = Date.now() / 1_000;
const planets = assignmentManifest.assignments.map(({ planet }, index) => {
  const angle = (index / assignmentManifest.assignments.length) * Math.PI * 2;
  const radius = 1_400 + (index % 4) * 430;
  return {
    id: `preview:${planet.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: planet,
    kind: "planet",
    x: Math.round(Math.cos(angle) * radius),
    y: ((index % 3) - 1) * 260,
    z: Math.round(Math.sin(angle) * radius),
    renderPointSize: 22,
  };
});

const messages = [
  { v: 1, type: "relay_auth", token },
  { v: 1, type: "hello", bridge: "planet-texture-preview" },
  { v: 1, type: "space_state", inSpace: true, reason: "planet texture preview" },
  {
    v: 1,
    type: "galaxy_catalog",
    observedAt,
    shipSystem: { name: "Planet Texture Preview", x: 0, y: 0 },
    systems: {
      "Planet Texture Preview": {
        name: "Planet Texture Preview",
        x: 0,
        y: 0,
        planets: planets.map(({ name, x, y, z }) => ({
          name,
          government: "Preview",
          x,
          y,
          z,
        })),
      },
      "Preview Destination": {
        name: "Preview Destination",
        x: 8,
        y: 5,
        planets: [],
      },
    },
  },
  {
    v: 1,
    type: "system_snapshot",
    sequence: 1,
    observedAt,
    observer: {
      id: "player-ship",
      name: "Texture Observer",
      x: 0,
      y: 0,
      z: 0,
      radarRange: 5_000,
      hyperspeed: 8,
    },
    entities: planets,
    metadata: {
      system: "Planet Texture Preview",
      inSpace: true,
      lastCapturePolled: true,
      navigation: {
        galaxy: { x: 0, y: 0 },
        destinations: [
          {
            system: "Preview Destination",
            distanceParsecs: 9.4,
            reachable: true,
            travelTime: "1 minute",
            travelTimeSeconds: 60,
            fuelPercent: 3,
          },
        ],
      },
    },
  },
];

const socket = net.createConnection({ host: "127.0.0.1", port: relayPort });
socket.setEncoding("utf8");
socket.on("connect", () => {
  for (const message of messages) socket.write(`${JSON.stringify(message)}\n`);
  console.log(`Planet texture preview connected to the Electron relay on port ${relayPort}.`);
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
            reason: "Commands are disabled in the planet texture preview.",
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
