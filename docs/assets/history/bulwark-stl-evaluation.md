# Historical Bulwark STL evaluation

Superseded by the [original release model](../models/bulwark-model.md).
These notes describe the old downloaded asset, not the current catalog.

The local catalog maps `Bulwark-Class Cruiser` to PopFeverMiniatures' downloaded
Bulwark Mark I Warship. This is the Mark I hull, not a newly modeled Mark III.
The in-game category remains `cruiser`, at the existing cruiser scale; the
general cruiser fallback remains Quasar Fire.

Source archive: `bulwark-mark-i-warship20210921-512163-lgk9vz.zip` in Downloads.
Only `BulwarkMarkI.STL` is imported. The `_Front` and `_Back` files are duplicate
print-split alternatives and must not be added to the complete hull.
The labeled front split occupies the negative-Y end of the source; an explicit
orientation maps that end to Holocron's +Z bow (source Z is up). The automatic
narrowest-end heuristic would incorrectly point the long stern forward.

## Local review

Run `pnpm review:ships` to build the local catalog and generate
`vendor-assets/ships/review/bulwark-class-cruiser.png`. The local renderer uses
the mesh for Bulwark-Class Cruiser, Bulwark Cruiser, and Mark I aliases. Mark III
is not assigned this model. The STL has no textures; Holocron supplies tactical
shading.
To refresh only this image after building assets, run
`node tools/review-new-ships.mjs --model=bulwark-class-cruiser`.

## Distribution status

The archive contains only STL files, with no license notice. The creator and
model are identified on the
[source page](https://cults3d.com/en/3d-model/game/bulwark-mark-i-warship), but
redistribution terms could not be verified during import. Do not infer a
license from this creator's other models or from the download being free.

The catalog therefore sets `releaseEligible: false`. Local evaluation builds
include it; release builds exclude it, and release validation rejects bundles
containing it. Confirm the model's terms before enabling release inclusion.
The approved original Aurek remains included in release builds.
