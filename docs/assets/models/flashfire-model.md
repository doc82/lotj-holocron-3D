# Original Flashfire Starfighter

`tools/models/flashfire-starfighter.mjs` generates original Flashfire-inspired
Republic scout geometry: a pointed fuselage, glazed canopy, swept wings,
raised weapon pods and canted tail fins. The
[official scout article and Republic artwork](https://www.swtor.com/blog/developer-update-scout-class-starfighter)
provide the design reference. The artwork is a general Republic scout reference;
this is an artistic interpretation, not a verified exact Flashfire replica.
No extracted game mesh or image pixels are included. Underlying Star Wars IP
remains with its owners. Cosmetic weapons do not set telemetry capabilities.

Flashfire class aliases select this model at starfighter scale 0.9. X-wing stays
the generic fighter fallback; NovaDive, Sting and Skybolt are not aliases.

Run `pnpm assets:ships:release`, then
`node tools/review-new-ships.mjs --model=flashfire-starfighter`.
Outputs: `vendor-assets/ships/review/flashfire-starfighter.png` and
`flashfire-starfighter.glb`. Preview materials are separate from Holocron's
tactical shading. Coordinates are +Y up and +Z bow.

[Original models](README.md) · [Assets](../README.md)
