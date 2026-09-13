# Original Valor-Class Cruiser

`tools/models/valor-class-cruiser.mjs` builds original low-poly geometry for the
Valor-Class Cruiser and D-Class Attack Cruiser aliases. It is release eligible,
uses cruiser scale 3.1, and does not change other cruiser defaults.

The [SWTOR reference render](https://www.aureusknights.com/swtor-event/) informed
the elongated layered hull, separate dorsal armor shells, raised command bridge,
and deep suspended engine cluster. The
[class reference](https://starwars.fandom.com/wiki/Valor-class_cruiser) identifies
the vessel. This is an artistic interpretation, not an extracted game model or
an exact replica. All geometry is original; no downloaded meshes or image pixels
are incorporated. Star Wars intellectual property remains with its owners.
Surface weapons are cosmetic and do not set telemetry armament or ship statistics.

Run `pnpm assets:ships:release`, then
`node tools/review-new-ships.mjs --model=valor-class-cruiser`.
The PNG review and editable GLB are written to `vendor-assets/ships/review/` as
`valor-class-cruiser.png` and `valor-class-cruiser.glb`.
The GLB includes preview colors; Holocron uses its usual tactical shading.
Coordinates are +Y up and +Z forward. No downloaded source asset is needed.
