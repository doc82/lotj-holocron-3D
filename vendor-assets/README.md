# Local third-party asset sources

Source packages in this directory are intentionally excluded from Git.

For Shiny_Man planet textures, download each free package through your own
CGTrader account and extract the confirmed diffuse and bump/normal maps into
the matching destination directory:

```text
vendor-assets/shinyman/
  alderaan/
  arkania/
  bespin/
  corellia/
  coruscant/
  dantooine/
  dromund-kaas/
  hapes/
  ithor/
  kashyyyk/
  korriban/
  lorrd/
  mandalore/
  mon-cala/
  mustafar/
  nal-hutta/
  ryloth/
  tatooine/
  wroona/
```

Each directory is named for the destination planet, not necessarily the title
of its confirmed source package. Keep the chosen diffuse and bump/normal maps
together in that directory.

Run `pnpm assets:planets` to create the ignored 1024x512 WebP runtime maps in
`renderer/public/planet-textures`. Release builds require and regenerate every
confirmed diffuse and bump/normal pair; packaging stops if any set is missing.

For a live local review, start `pnpm electron:dev`, then run
`pnpm preview:planets` in a second terminal. The preview relay lays out every
confirmed planet in one tactical system and supplies the same catalog to the
local and galactic hyperspace planners. A real Mudlet relay connection safely
replaces the preview connection.

See `docs/third-party-assets.md` for attribution and usage restrictions.

## Ship-model evaluation

Place the downloaded sources listed in the ship catalog in your Downloads
folder, then run `pnpm assets:ships`. Original models are generated from project
source and need no download, including Praetorian. The importer leaves
the downloads untouched, extracts or copies complete source packages (including
textures and licenses where supplied) under ignored `vendor-assets/ships/`, and
creates optimized geometry-only tactical preview meshes under ignored
`renderer/public/ship-models/`. Eighteen archives are CC BY 4.0; the
Firespray/Slave I archive is the more restrictive CC BY-NC-SA 4.0.

For a live review, start `pnpm electron:dev`, then run `pnpm preview:ships` in a
second terminal. That command rebuilds the local ship bundle, verifies every
catalog model and mesh, and lays out all 28 ships and stations in one tactical
system. Categorize model aliases in `renderer/src/domain/shipModelCatalog.json`;
use `renderer/src/domain/shipModelAssignments.json` only for exact named-ship
overrides and category defaults. Resolution proceeds through explicit name,
exact alias, longest unambiguous partial alias, category fallback, and finally
the procedural category model.

The tactical shader currently uses flat lighting and contact/disposition color,
so downloaded textures are preserved in `vendor-assets/ships/` but are not yet
drawn. See `docs/ship-model-sources.md` for the complete roster and attribution.

## Private Google Drive release bundles

Release automation does not upload or fetch the raw source packages. It expects
two private ZIPs containing only the optimized runtime derivatives.

The planet archive root must be `planet-textures/`, with all 40 generated
`.webp` files directly inside it and no extra wrapper directory. Create it after
a required build:

```powershell
node tools/build-planet-textures.mjs --required
New-Item -ItemType Directory -Path .\.codex-tmp\drive-assets -Force
tar -a -cf .\.codex-tmp\drive-assets\holocron-planet-runtime-v1.zip `
  -C .\renderer\public planet-textures
Get-FileHash -Algorithm SHA256 `
  .\.codex-tmp\drive-assets\holocron-planet-runtime-v1.zip
```

Store the ZIP privately in Google Drive and share it only with the read-only
release service account.

The ship archive root must be `ship-models/`. Build it in release mode, then
archive all 28 meshes (licensed imports and original project geometry), manifest,
and attribution notice. The unverified Praetorian STL is no longer used:

```powershell
node tools/build-ship-models.mjs --release
tar -a -cf .\.codex-tmp\drive-assets\holocron-ship-runtime-v1.zip `
  -C .\renderer\public ship-models
Get-FileHash -Algorithm SHA256 `
  .\.codex-tmp\drive-assets\holocron-ship-runtime-v1.zip
```

Release validation rejects evaluation-only assets and any bundle whose model IDs or embedded attribution
do not match the committed catalog.

The Release workflow authenticates with the `GOOGLE_DRIVE_CREDENTIALS` GitHub
secret and reads these repository variables:

- `HOLOCRON_PLANET_ASSET_FILE_ID` — the Drive file ID for the ZIP
- `HOLOCRON_PLANET_ASSET_SHA256` — the lowercase SHA-256 of that exact ZIP
- `HOLOCRON_SHIP_ASSET_FILE_ID` — the Drive file ID for the ship ZIP
- `HOLOCRON_SHIP_ASSET_SHA256` — the lowercase SHA-256 of that exact ZIP

`tools/fetch-planet-assets.mjs` downloads the file through the Drive API,
verifies the checksum before extraction, and confirms all 40 runtime files are
present. `tools/fetch-ship-assets.mjs` applies the same checksum-first flow to
the 28 releasable ship meshes and their attribution files. `tools/release-build.mjs`
then verifies both asset families reached `renderer/dist` before Forge runs.
