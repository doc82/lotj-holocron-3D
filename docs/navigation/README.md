# Galaxy navigation

The editable runtime source is [data/navigation/galaxy.json](../../data/navigation/galaxy.json). Maps describe connectivity, not live lane availability or ship range.

The live galactic map also reads the current player's GMAP discoveries from
their local Mudlet profile. Keep these personal records out of the shared
topology, generated maps, test fixtures, and release assets. Use fictional
locations when testing discovery imports. See the
[`galaxy_catalog` protocol](../architecture/protocol.md#galaxy_catalog) for the runtime source.

- [Connection map and edge register](galaxy-hyperlane-map.md)
- [PNG map](galaxy-hyperlane-map.png) and [SVG map](galaxy-hyperlane-map.svg)
- [Sector coordinates and flight observations](galaxy-sector-map.md)
- [GMCP noise review and implementation follow-up](GMCP_NOISE_REVIEW.md)
- [Initial coordinate-only map](galaxy-sector-map.svg)
- [Maintenance instructions](../../CLAUDE.md#navigation-topology-and-map-maintenance)

Run `pnpm navigation:build` from the repository root after changing the topology. Generated connection maps are written here; the generated Lua module remains under `mudlet/`.

## Historical evidence

[Initial connectivity audit](history/hyperlane-connectivity-audit.md) preserves superseded assumptions. Use the current topology and flight observations for maintenance.

[All documentation](../README.md)
