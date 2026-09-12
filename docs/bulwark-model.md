# Bulwark-Class Cruiser

# Original Bulwark-Class Cruiser

`tools/models/bulwark-class-cruiser.mjs` generates the release model from
original procedural geometry. It replaces the earlier license-unverified STL
in both local and release builds. No downloaded mesh, texture, or source-image
pixels are incorporated; the Downloads archive is no longer a build dependency.

## Design references

- [Bulwark Mark I background](https://starwars.fandom.com/wiki/Bulwark_Mark_I)
- [New Order's Bulwark Mark I render](https://www.moddb.com/mods/new-order-mod/images/renders-former-cis-ships-of-the-alliance-fleet)

These references inform the broad design: heavy rounded bow, elongated armored
body, dorsal bridge, repeated broadside emplacements, tapered stern and aft
propulsion. Dimensions, armor panels, turret layout, engine arrangement and
materials are original artistic approximations, not a traced replica. Cosmetic
weapons do not set game statistics. This retains the previously selected Mark I
style; the Mark III is not assigned to this mesh.

## Build and review

Run `pnpm assets:ships:release`, followed by
`node tools/review-new-ships.mjs --model=bulwark-class-cruiser`.
The review directory `vendor-assets/ships/review/` receives:

- `bulwark-class-cruiser.png`: three views rendered from the mesh.
- `bulwark-class-cruiser.glb`: named parts, normals and simple preview materials.

Holocron uses the same geometry with its own tactical shading. +Y is up, +Z is
the bow. The source is deterministic and included in the asset-cache fingerprint.
All generated binaries can be recreated from source without the old STL.

## Release status

The catalog has `source.kind: generated` and `releaseEligible: true`. Release
validation requires this mesh, and its attribution identifies original Holocron
geometry. The in-game class aliases, cruiser scale and other category defaults
are unchanged. Praetorian now uses its own [original geometry](praetorian-model.md)
and is also included in releases; its old unverified STL is not used.

This removes the unverified third-party model dependency. It does not grant
rights to underlying Star Wars intellectual property, which remains with its
respective owners. Reference images are not shipped.
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
