import fs from "node:fs";
const data = JSON.parse(fs.readFileSync("data/navigation/galaxy.json", "utf8"));
if (data.schemaVersion !== 1) throw new Error("Unsupported topology schema");
if (!data.era || !Number.isSafeInteger(data.revision) || data.revision < 1 || !data.nodes.length)
  throw new Error("Topology requires an era, positive revision and destinations");
const ids = new Set();
const aliases = new Set();
for (const n of data.nodes) {
  if (
    ids.has(n.id) ||
    !n.id ||
    !n.name ||
    !n.system ||
    !Number.isFinite(n.x) ||
    !Number.isFinite(n.y)
  )
    throw new Error("Invalid/duplicate node");
  ids.add(n.id);
  for (const alias of new Set(
    [n.id, n.name, n.system, ...n.aliases].map((a) => a.trim().toLowerCase()),
  )) {
    if (aliases.has(alias)) throw new Error(`Ambiguous alias: ${alias}`);
    aliases.add(alias);
  }
}
for (const region of Object.values(data.regions))
  if (!region.members.length || region.members.some((id) => !ids.has(id)))
    throw new Error("Invalid region");
const edgeKeys = new Set();
for (const e of data.permanentEdges) {
  const k = `${e.from}|${e.to}`;
  if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to || edgeKeys.has(k))
    throw new Error(`Invalid edge ${k}`);
  edgeKeys.add(k);
}
const members = (id) => data.regions[id]?.members ?? [id];
const controls = new Set();
for (const c of data.temporaryControls) {
  if (
    controls.has(c.id) ||
    !c.id ||
    c.monitor.length !== 2 ||
    [...members(c.from), ...members(c.to)].some((id) => !ids.has(id))
  )
    throw new Error("Invalid control");
  controls.add(c.id);
  for (const a of members(c.from))
    for (const b of members(c.to))
      if (a === b || edgeKeys.has(`${a}|${b}`) || edgeKeys.has(`${b}|${a}`))
        throw new Error("Temporary/permanent overlap");
}
for (const o of data.observations)
  if (
    !ids.has(o.from) ||
    !ids.has(o.to) ||
    !["Available", "No Path", "Out of Range", "Same system"].includes(o.status)
  )
    throw new Error("Invalid observation");
for (const o of data.observations)
  if (o.status === "No Path" && edgeKeys.has(`${o.from}|${o.to}`))
    throw new Error(`Permanent edge contradicts current No Path evidence: ${o.from}/${o.to}`);
for (const [id, waypoint] of Object.entries(data.waypoints ?? {})) {
  const node = data.nodes.find((n) => n.id === id);
  if (
    !node ||
    node.name !== waypoint.name ||
    node.system !== waypoint.system ||
    node.x !== waypoint.galacticCoordinates.x ||
    node.y !== waypoint.galacticCoordinates.y ||
    !waypoint.refuelStation ||
    (waypoint.landingTarget !== undefined &&
      (typeof waypoint.landingTarget !== "string" ||
        !/^[\w\s'-]+$/.test(waypoint.landingTarget))) ||
    (waypoint.landingPad !== undefined &&
      (typeof waypoint.landingPad !== "string" || !/^[1-9]\d*$/.test(waypoint.landingPad))) ||
    !["x", "y", "z"].every((axis) => Number.isFinite(waypoint.refuelCoordinates[axis]))
  )
    throw new Error(`Invalid or inconsistent refueling waypoint: ${id}`);
}
function lua(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return "{" + value.map(lua).join(",") + "}";
  return (
    "{" +
    Object.entries(value)
      .map(([k, v]) => "[" + lua(k) + "]=" + lua(v))
      .join(",") +
    "}"
  );
}
const output =
  "-- Generated from data/navigation/galaxy.json; do not edit.\nreturn " + lua(data) + "\n";
const target = "mudlet/lotj_holocron_topology_data.lua";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8") !== output)
    throw new Error("Generated Lua topology is stale; run pnpm navigation:build");
} else fs.writeFileSync(target, output);
console.log(
  `Validated topology ${data.era} revision ${data.revision}: ${data.nodes.length} nodes, ${data.permanentEdges.length} directed edges.`,
);
