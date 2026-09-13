# Original Aurek Light Fighter, first pass

`tools/models/aurek-light-fighter.mjs` generates the original Holocron Aurek.
It uses a long spearhead nose, rear-set central cockpit, swept wing spars and
outer foils, paired cannon barrels, and compact rear engines. Wings are in a
fixed flight pose; this asset does not animate variable wing geometry.

The silhouette was checked against Jeff Carlisle's
[Aurek illustration for The Jedi Path](https://www.jeffcarlisle.com/node/434).
The proportions, mechanical details, and preview paint scheme are artistic
approximations, not an exact replica. No downloaded mesh, reference image, or
third-party texture is included in the model. Cosmetic barrels do not set
weapon counts or modify ship telemetry.

Run `pnpm review:ships` to rebuild local assets and generate the Aurek's
three-view PNG and named-part GLB in `vendor-assets/ships/review/`:

- `aurek-light-fighter.png`
- `aurek-light-fighter.glb`

The GLB includes simple ivory/red hull, canopy, and exhaust materials for
inspection in Blender or another glTF viewer. Holocron still applies its own
geometry-only tactical shading. Coordinate convention: +Y up, +Z bow.

The catalog maps Aurek Light Fighter and Aurek tactical-strikefighter aliases
to this mesh. Generic starfighter defaults and the Naboo remain unchanged.
The A-IR Wing download is not used. Aurek and YT-1000 share procedural geometry
helpers; a regression hash protects the approved YT-1000 mesh from changes.
Generated binaries are ignored by Git and reproducible from the source.

Original project geometry is credited separately from third-party assets.
Underlying Star Wars intellectual property remains with its respective owners.
