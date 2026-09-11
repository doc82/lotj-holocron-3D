import { format } from "prettier";
import fs from "node:fs";
import sharp from "sharp";
const outputDirectory = "docs/navigation";
fs.mkdirSync(outputDirectory, { recursive: true });
const topology = JSON.parse(fs.readFileSync("data/navigation/galaxy.json", "utf8"));
const nodes = topology.nodes;
const byName = new Map(nodes.map((n) => [n.name, n]));
const name = (id) => nodes.find((n) => n.id === id).name;
const key = (a, b) => [a, b].sort().join("|");
const members = (id) => topology.regions[id]?.members ?? [id];
const temporary = new Map();
for (const c of topology.temporaryControls)
  for (const a of members(c.from))
    for (const b of members(c.to))
      temporary.set(key(name(a), name(b)), { a: name(a), b: name(b), control: c.id });
const observed = new Map();
for (const edge of topology.permanentEdges) {
  const a = name(edge.from),
    b = name(edge.to),
    k = key(a, b);
  if (!observed.has(k)) observed.set(k, { a, b, directions: [] });
  observed.get(k).directions.push([a, b]);
}
for (const edge of topology.observations.filter((o) => o.status === "Available")) {
  const a = name(edge.from),
    b = name(edge.to),
    k = key(a, b);
  if (!temporary.has(k)) continue;
  if (!observed.has(k)) observed.set(k, { a, b, directions: [] });
  observed.get(k).directions.push([a, b]);
}
const xmin = Math.floor(Math.min(...nodes.map((n) => n.x)) / 10) * 10;
const xmax = Math.ceil(Math.max(...nodes.map((n) => n.x)) / 10) * 10;
const ymin = Math.floor(Math.min(...nodes.map((n) => n.y)) / 10) * 10;
const ymax = Math.ceil(Math.max(...nodes.map((n) => n.y)) / 10) * 10 + 10;
const scale = Math.min(1210 / Math.max(10, xmax - xmin), 1100 / Math.max(10, ymax - ymin));
const px = (x) => 170 + (x - xmin) * scale;
const py = (y) => 200 + (ymax - y) * scale;
const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="1540" height="1510" viewBox="0 0 1540 1510" role="img" aria-labelledby="title desc">
<title id="title">Galaxy hyperlane audit: observed connections and temporary routes</title>
<desc id="desc">All ${nodes.length} destinations at equal-scale sector coordinates. Blue arrows show observed permanently open directions under the user's exhaustive temporary-route list. Solid red identifies temporary connections that can randomly open or close; current status is not encoded. Regional controls expand to their configured members. Unobserved non-temporary connections are omitted.</desc>
<rect width="1540" height="1510" fill="#101923"/>
<defs>${["blue", "red"].map((c, i) => `<marker id="${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${i ? "#ff626b" : "#509dff"}"/></marker>`).join("")}</defs>
<g font-family="Segoe UI, Arial, sans-serif" fill="#eaf1f8">
<text x="70" y="52" font-size="30" font-weight="700">Galaxy connections / current audit</text>
<text x="70" y="84" font-size="17">${nodes.length} destinations | Equal X/Y scale | Era ${topology.era} / revision ${topology.revision}</text>
<path d="M 70 118 h 50" stroke="#509dff" stroke-width="3" marker-end="url(#blue)"/><text x="135" y="124" font-size="16">Blue: permanent, observed direction</text>
<path d="M 535 118 h 50" stroke="#ff626b" stroke-width="3"/><text x="600" y="124" font-size="16">Red: temporary (can open or close)</text>

<text x="70" y="157" font-size="15" fill="#b5c4d4">Blue arrowheads show observed directions. Red lines show temporary controls, independent of current status.</text>`,
];
for (let x = xmin; x <= xmax; x += 10)
  parts.push(
    `<path d="M ${px(x)} 200 V 1300" stroke="${x === 0 ? "#526477" : "#263340"}"/><text x="${px(x)}" y="1325" text-anchor="middle" font-size="14">${x}</text>`,
  );
for (let y = ymin; y <= ymax; y += 10)
  parts.push(
    `<path d="M 170 ${py(y)} H 1380" stroke="${y === 0 ? "#526477" : "#263340"}"/><text x="150" y="${py(y) + 5}" text-anchor="end" font-size="14">${y}</text>`,
  );
function line(a, b, color, arrows, dashed, title) {
  const start = byName.get(a),
    end = byName.get(b);
  const dx = px(end.x) - px(start.x),
    dy = py(end.y) - py(start.y),
    length = Math.hypot(dx, dy);
  const x1 = px(start.x) + (dx / length) * 12,
    y1 = py(start.y) + (dy / length) * 12;
  const x2 = px(end.x) - (dx / length) * 12,
    y2 = py(end.y) - (dy / length) * 12;
  parts.push(
    `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${color === "blue" ? "#509dff" : "#ff626b"}" stroke-width="${color === "blue" ? 2 : 3}" opacity="${color === "blue" ? 0.7 : 0.95}" ${dashed ? 'stroke-dasharray="9 7"' : ""} ${arrows ? `marker-end="url(#${color})"` : ""} ${arrows === 2 ? `marker-start="url(#${color})"` : ""}><title>${escape(title)}</title></path>`,
  );
}
for (const [k, edge] of observed)
  if (!temporary.has(k))
    line(
      edge.a,
      edge.b,
      "blue",
      edge.directions.length,
      false,
      edge.directions.map((d) => d.join(" -> ")).join("; ") + ": permanent / observed available",
    );
for (const edge of temporary.values())
  line(
    edge.a,
    edge.b,
    "red",
    0,
    false,
    `${edge.a} / ${edge.b}: (T) can randomly open or close${edge.a === "Kashyyyk" ? "; expanded from Core Worlds regional control" : ""}`,
  );
const offsets = {
  Ithor: [14, 20],
  Lorrd: [-14, -20],
  "Mon Cala": [14, 24],
  "Nal Hutta": [-14, 27],
  Ryloth: [14, -8],
  Arkania: [-14, -24],
  Corellia: [-14, 25],
  Wroona: [-14, -24],
  Eeropha: [-14, -22],
};
for (const n of nodes) {
  const [dx, dy] = offsets[n.name] || [14, -16];
  const x = px(n.x),
    y = py(n.y);
  parts.push(
    `<g><title>${escape(n.name + " | " + n.system)}</title>${Object.hasOwn(topology.waypoints, n.id) ? `<path d="M ${x} ${y - 9} l 9 9 -9 9 -9 -9 Z" fill="#e4c5ff"/>` : `<circle cx="${x}" cy="${y}" r="7" fill="#eef5ff" stroke="#101923" stroke-width="2"/>`}<text x="${x + dx}" y="${y + dy}" text-anchor="${dx < 0 ? "end" : "start"}" font-size="19" font-weight="700" stroke="#101923" stroke-width="5" paint-order="stroke">${escape(n.name)}</text><text x="${x + dx}" y="${y + dy + 20}" text-anchor="${dx < 0 ? "end" : "start"}" font-size="14" stroke="#101923" stroke-width="4" paint-order="stroke">(${n.x}, ${n.y})</text></g>`,
  );
}
parts.push(
  '<text x="1380" y="1355" text-anchor="end" font-size="16">X / east (positive); Y / north (positive upward)</text><text x="70" y="1400" font-size="17">A regional temporary control is drawn to each of its configured members.</text><text x="70" y="1430" font-size="16" fill="#b5c4d4">Multiple regional red lines share one monitor status; they are not independent controls.</text><text x="70" y="1460" font-size="16" fill="#b5c4d4">No range cutoff added. Out of Range does not establish connectivity. Hover a line for endpoints and evidence.</text></g></svg>',
);
fs.writeFileSync(`${outputDirectory}/galaxy-hyperlane-map.svg`, parts.join("\n") + "\n");
const table = [
  "| Origin | Observed permanent outgoing connections | Observed temporary outgoing connections |",
  "| --- | --- | --- |",
];
for (const n of nodes) {
  const permanent = [],
    temp = [];
  for (const [k, e] of observed)
    for (const [a, b] of e.directions)
      if (a === n.name) (temporary.has(k) ? temp : permanent).push(b);
  table.push(
    `| ${n.name} | ${permanent.sort().join(", ") || "Not yet observed"} | ${
      temp
        .sort()
        .map((n) => n + " (T)")
        .join(", ") || "Not yet observed"
    } |`,
  );
}
const controls = topology.temporaryControls.map(
  (c) =>
    "| " +
    c.monitor.join(" / ") +
    " | " +
    members(c.from).map(name).join(", ") +
    " / " +
    members(c.to).map(name).join(", ") +
    " |",
);
fs.writeFileSync(
  `${outputDirectory}/galaxy-hyperlane-map.md`,
  "# Galaxy navigation topology map\n\n![Galaxy connections](galaxy-hyperlane-map.png)\n\n[SVG](galaxy-hyperlane-map.svg) | [PNG](galaxy-hyperlane-map.png) | [Editable topology](../../data/navigation/galaxy.json)\n\nBlue arrows show directed permanent connections. All temporary connections are solid red without arrowheads; they can randomly open or close. The map represents topology, not live availability. Missing permanent directions are unverified and automatic navigation does not use them.\n\nEra: **" +
    topology.era +
    "**. Revision: **" +
    topology.revision +
    "**. No ship-range cutoff is applied to this map. Station destinations and refueling details are recorded in the topology artifact.\n\n## Temporary controls\n\n| Monitor endpoints | Expanded destinations |\n| --- | --- |\n" +
    controls.join("\n") +
    "\n\nCore Worlds expands to its configured members. Regional red segments represent one control, not independent monitor entries. Open-state direct access to each member remains untested.\n\n## Outgoing connections\n\n" +
    table.join("\n") +
    "\n\nPermanent columns come from the authoritative topology; temporary outgoing columns retain available scan evidence and are not live status. Source observations remain in [the flight audit](galaxy-sector-map.md). Update instructions: [CLAUDE.md](../../CLAUDE.md). Regenerate with `pnpm navigation:build`.\n",
);
fs.writeFileSync(
  `${outputDirectory}/galaxy-hyperlane-map.md`,
  await format(fs.readFileSync(`${outputDirectory}/galaxy-hyperlane-map.md`, "utf8"), {
    parser: "markdown",
  }),
);
await sharp(`${outputDirectory}/galaxy-hyperlane-map.svg`)
  .png()
  .toFile(`${outputDirectory}/galaxy-hyperlane-map.png`);
console.log(
  "Rendered SVG and PNG from topology " + topology.era + " revision " + topology.revision,
);
