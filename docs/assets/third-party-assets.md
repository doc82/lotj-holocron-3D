# Third-party asset notices

## Shiny_Man planet textures

Selected packaged releases of LotJ Holocron 3D incorporate resized and
compressed derivatives of Shiny_Man's free 4K planet texture packages.

- Creator: [Shiny_Man on CGTrader](https://www.cgtrader.com/designers/shinyman)
- Artist statement: [SchinyMan on DeviantArt](https://www.deviantart.com/schinyman)
- Marketplace license: CGTrader Royalty Free License (No AI)
- Project use: strictly non-profit and non-monetized

The original downloadable packages are not stored in this source repository.
Runtime derivatives are generated locally and incorporated into the packaged
Electron application. They are not covered by any license applying to the
Holocron source code and must not be extracted, republished, sublicensed, used
as a standalone texture pack, or used for machine learning or generative AI.

### Exact Star Wars planet packages

- [Coruscant](https://www.cgtrader.com/free-3d-models/space/planet/coruscant-star-wars-planet-texture)
- [Csilla](https://www.cgtrader.com/free-3d-models/space/planet/csilla-4k-star-wars-planet-texture)
- [Felucia](https://www.cgtrader.com/free-3d-models/space/planet/felucia-star-wars-planet-texture)
- [Korriban / Moraband](https://www.cgtrader.com/free-3d-models/space/planet/korriban-4k-star-wars-planet-texture)
- [Kuat](https://www.cgtrader.com/free-3d-models/space/planet/kuat-star-wars-planet)
- [Mandalore (Legends)](https://www.cgtrader.com/free-3d-models/space/planet/mandalore-legends-16k-star-wars-planet-texture)
- [Nar Shaddaa](https://www.cgtrader.com/free-3d-models/space/planet/nar-shaddaa-4k-star-wars-planet-texture)
- [Taris](https://www.cgtrader.com/free-3d-models/space/planet/taris-4k-star-wars-planet-texture)

### Generic terrain packages

Holocron also uses selected free Terran, desert, exotic, gas-giant, ice,
oceanic, and volcanic planet packages from the same
[Shiny_Man collection](https://www.cgtrader.com/free-3d-models?author=ShinyMan)
for worlds without a dedicated texture.

## Ship-model assets

Praetorian-class Frigate uses original Holocron geometry instead of the unverified
STL. See [Praetorian notes](models/praetorian-model.md).

Golan III station uses original Holocron procedural geometry with no third-party
mesh or texture dependency. See [Golan notes](models/golan-model.md) for visual references.

Valor-Class Cruiser uses original Holocron procedural geometry with no third-party
mesh or texture dependency. See [Valor notes](models/valor-model.md) for visual references.

Sprint-Class Rescue Craft uses original Holocron procedural geometry, with no
third-party model or texture dependency. See [Sprint notes](models/sprint-model.md).

Bulwark-Class Cruiser now uses original procedural Holocron geometry in local
and release builds. The earlier PopFeverMiniatures STL is no longer a build
input or runtime asset; its redistribution license remains unverified. No
third-party mesh or texture is incorporated in the replacement. See
[Bulwark notes](models/bulwark-model.md). Underlying Star Wars IP is not relicensed.

September 2026 additions: the Naboo N-1 GLB embeds JackJohn2942's CC BY 4.0
attribution. The JumpMaster 5000 STL archive is by PopFeverMiniatures and its
[source page](https://cults3d.com/en/3d-model/game/jumpmaster-5000) is marked
CC BY-NC (and No AI). Its geometry-only conversion is for this noncommercial
application; it is not used to generate other models. Keep those restrictions
and credits with the asset. The YT-1000 is separately authored project geometry,
not a derivative of either download; see [its source notes](models/yt-1000-model.md).

Packaged releases may include optimized geometry-only derivatives generated
from the source archives. The original downloads, source textures, and extracted
packages are excluded from both version control and application packages.

Eighteen currently verified Sketchfab source archives are licensed under CC BY
4.0. The Firespray/Slave I archive is CC BY-NC-SA 4.0 and must remain
noncommercial with attribution and ShareAlike. The standalone Praetorian STL has
no embedded license and is restricted to local evaluation; release validation
explicitly rejects it until its terms and creator are confirmed. Full creator,
source, status, and candidate details are maintained in
[`ship-model-sources.md`](ship-model-sources.md). A generated preview must retain
the attribution supplied in each archive's `license.txt`.

The in-app Credits page, available from the Escape menu, lists every cataloged
ship model and every included planet texture set with creator, source, and
license links.

### Confirmed in-game assignments

Each of these worlds has its own runtime diffuse and bump/normal pair: Alderaan,
Arkania, Bespin, Corellia, Coruscant, Dantooine, Dromund Kaas, Hapes, Ithor,
Kashyyyk, Korriban, Lorrd, Mandalore, Mon Cala, Mustafar, Nal Hutta, Nar
Shaddaa, Ryloth, Tatooine, and Wroona. Dac and Moraband are treated as aliases
for Mon Cala and Korriban rather than separate planets.
