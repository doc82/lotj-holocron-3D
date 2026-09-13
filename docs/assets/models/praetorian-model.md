# Original Praetorian-class Frigate

`tools/models/praetorian-frigate.mjs` generates original geometry replacing the
unverified local STL. Its existing ID, class aliases, frigate fallback and scale
2.55 remain intact; it is now included in release builds.

The [visual reference](https://swi.siifr.net/ships/l/praetorian_02) informed the
segmented pressure hull, vertically stacked bow pods, circular engineering
emplacements and clustered stern machinery. This is a low-poly interpretation,
not an extracted model or exact replica. No third-party mesh or image pixels
are incorporated. Star Wars IP remains with its respective owners. Cosmetic
armament does not set telemetry weapon counts. The Praetor battlecruiser is a
different ship and is not aliased to this model.

Run `pnpm assets:ships:release`, followed by
`node tools/review-new-ships.mjs --model=praetorian-frigate`.
Review PNG and editable GLB: `vendor-assets/ships/review/praetorian-frigate.png`
and `vendor-assets/ships/review/praetorian-frigate.glb`.
Coordinates are +Y up and +Z bow. Preview materials are separate from Holocron's
tactical faction shading. The original downloaded STL is not modified or used.
