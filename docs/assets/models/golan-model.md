# Original Golan III station

`tools/models/golan-iii-station.mjs` generates original Golan III-inspired geometry.
The [Interregnum visual reference](https://www.moddb.com/mods/star-wars-interregnum/images/golan-iii-space-defense-platform)
informed the broad armored base, twin towers, central command block and ventral
spire. This is a low-poly interpretation, not imported or extracted game geometry.
No third-party mesh or image pixels are included. Star Wars IP remains with its owners.

All contacts classified as `battlestation` or `platform` use this model, including
Black Market Station, starbases and shipyards recognized by the existing parser.
Installation category takes precedence over ship-name aliases and named-ship
overrides, so a station called X-wing or Pollution stays a station. Ordinary ships,
planets, contact identity and telemetry capabilities are unchanged. Station model
scale is 4.8; category-specific marker shapes remain intact. The old procedural
shapes remain available if model assets cannot load.

Run `pnpm assets:ships:release`, then
`node tools/review-new-ships.mjs --model=golan-iii-station` to produce
`vendor-assets/ships/review/golan-iii-station.png` and `golan-iii-station.glb`.
Preview materials do not replace Holocron's tactical faction shading.
Coordinates use +Y up and +Z as the docking approach, not a thrust direction.
