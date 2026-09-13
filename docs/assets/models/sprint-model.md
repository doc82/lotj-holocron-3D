# Original Sprint-Class Rescue Craft

`tools/models/sprint-class-rescue-craft.mjs` generates an original Holocron
Med Runner. It is assigned to Sprint rescue-craft aliases as a transport, at
scale 1.2, and included in release builds. Other transport defaults are unchanged.

## Design basis

The [Legends description](https://starwars.fandom.com/wiki/Sprint-class_rescue_craft/Legends)
describes a flat, wide medical rescue vessel with sensitive life-form sensors,
strong propulsion and no weapons. Reliable visual references were limited, so
this is an artistic interpretation rather than an exact replica. The model uses
a broad medical cabin, panoramic cockpit, fore rescue bay, side docking collars,
sensor dome and twin rear engines. The folded skids, lighting, proportions and
orange/ivory preview scheme are original design choices. There are no gun barrels
or turrets. Geometry does not change telemetry, capacity or installed equipment.

The previously downloaded generic rescue spaceship is not used. No third-party
mesh, image pixels or textures are included. Underlying Star Wars intellectual
property remains with its respective owners.

## Review

Run `pnpm assets:ships:release`, then
`node tools/review-new-ships.mjs --model=sprint-class-rescue-craft`.
Generated files are in `vendor-assets/ships/review/`:

- `sprint-class-rescue-craft.png`: three views of the actual geometry.
- `sprint-class-rescue-craft.glb`: named parts, normals and preview materials.

The GLB can be opened in Blender or another glTF viewer. Holocron applies its
own tactical shading, so the preview colors are not rendered in-game. Coordinates
use +Y up and +Z forward. The deterministic generator is included in the build
cache fingerprint and needs no downloaded source assets.
