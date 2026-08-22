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

## Private Google Drive release bundle

Release automation does not upload or fetch the raw source packages. It expects
one private ZIP containing only the optimized runtime derivatives. The archive
root must be `planet-textures/`, with all 38 generated `.webp` files directly
inside it and no extra wrapper directory. Create it after a required build:

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

The Release workflow authenticates with the `GOOGLE_DRIVE_CREDENTIALS` GitHub
secret and reads these repository variables:

- `HOLOCRON_PLANET_ASSET_FILE_ID` — the Drive file ID for the ZIP
- `HOLOCRON_PLANET_ASSET_SHA256` — the lowercase SHA-256 of that exact ZIP

`tools/fetch-planet-assets.mjs` downloads the file through the Drive API,
verifies the checksum before extraction, and confirms all 38 runtime files are
present. `tools/release-build.mjs` then validates that every file is a 1024×512
WebP and refuses to package a release if any diffuse or bump/normal map is
missing or malformed.
