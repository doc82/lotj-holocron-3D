# Repository instructions

When preparing, building, publishing, or updating a release, read and follow
[`docs/releasing.md`](docs/releasing.md) in full.

Treat its required release assets and completion checklist as blocking release
requirements. In particular, do not publish or describe a GitHub release as
complete until the Windows installer, both macOS installers, and the Mudlet
package are attached and verified from the release page.

## Navigation topology and map maintenance

Iteration documentation is indexed in [`docs/README.md`](docs/README.md).
Keep navigation maps and flight evidence in `docs/navigation/`, Trader audits and
test guides in `docs/trader/`, and superseded notes in their `history/` directories.

The authoritative, versioned artifact is [`data/navigation/galaxy.json`](data/navigation/galaxy.json).
Both the renderer planner and Mudlet navigation use it. Do not restore hardcoded
gateway rules or infer that unlisted planet pairs are open. This galaxy changes
regularly and may be replaced entirely roughly every two years.

- `schemaVersion` describes the file format. `era` identifies the galaxy roster;
  `revision` increases for corrections within that era.
- `nodes` contains stable IDs, display names, system names, aliases, and sector
  X/Y coordinates. These are not local landing coordinates.
- `regions` groups node IDs (Core Worlds currently comprises Coruscant, Alderaan,
  and Mon Cala). A regional temporary control expands to all configured members.
- `waypoints` maps station node IDs to refueling station names and local X/Y/Z
  coordinates. Its name, system and sector coordinates must match the node.
  Stations are injected as transit destinations without market prices. An empty
  object is supported in an era without stations; adding/removing stations needs
  no Eeropha-specific code change.
- `permanentEdges` is directed: add both directions only with supporting evidence.
  Unknown, hidden, unscanned and Out of Range destinations do not imply edges.
- `temporaryControls` contains bidirectional endpoints and the exact two labels
  reported by `l hyp`. These five controls are the only temporary connections in
  this era. Do not store live open/closed state in the topology. A missing,
  unknown, stale or No Route reading blocks that control at runtime; a fresh
  Passable reading enables it. Alderaan/Mon Cala is not a temporary control.
- `observations` preserves directional flight evidence. No Path and Out of Range
  remain distinct. When correcting evidence, reconcile obsolete observations
  rather than leaving contradictory current records.

To update the current galaxy:

1. Record new readouts in `docs/navigation/galaxy-sector-map.md`, then update the JSON nodes,
   regions, evidence and directed edges. Increment `revision`. Do not edit the
   generated Lua, SVG, PNG or connection-map Markdown directly.
2. Run `pnpm navigation:build`. This validates the data and regenerates
   `mudlet/lotj_holocron_topology_data.lua`, `docs/navigation/galaxy-hyperlane-map.svg`,
   `docs/navigation/galaxy-hyperlane-map.png`, and `docs/navigation/galaxy-hyperlane-map.md`. PNG conversion uses
   the existing Sharp dependency. Review the PNG visually.
3. Run `pnpm navigation:check`, `pnpm renderer:typecheck`, `pnpm test`, and
   `pnpm test:lua`. Update topology-specific expectations for intentional rule
   changes, preserving tests for range, temporary closures, and unknown edges.
4. Run `pnpm mudlet:package` and reload/reinstall the resulting package so Mudlet
   receives the same revision as the desktop build. Bootstrap clears both topology
   modules on reload. Commit source and generated artifacts together.

For a new galaxy era, archive the old JSON and map artifacts under
`data/navigation/archive/<era>/` before replacing the active file. Replace the
roster, coordinates, regions, controls and evidence together, set the new `era`
and reset `revision` to 1. Remove obsolete aliases; do not silently carry old
edges or observations into a new era. Re-audit landing pads, ship destinations,
saved routes and market data. Saved route paths are rechecked by Mudlet before
each jump, but names reused in a new era still need a user review and fresh market
scan. The existing ship range filter remains separate from topology.

Runtime code: `renderer/src/domain/navigationTopology.ts` is cargo-independent;
the cargo/freighter planner uses its jump permission checks.
`mudlet/lotj_holocron_topology.lua` applies the same policy before each autopilot
jump after requesting `l hyp`. Manual routes may explore unverified directions
between known nodes, but cannot override an observed No Path or a temporary
control. The current audit has only seven scanned origins, so automatic planning
deliberately excludes unverified return legs.

The original `docs/navigation/history/hyperlane-connectivity-audit.md` is historical, superseded evidence;
`docs/navigation/galaxy-sector-map.svg` is the initial coordinate-only map. The maintained runtime
map is `docs/navigation/galaxy-hyperlane-map.png` / `.svg`, generated from JSON.
