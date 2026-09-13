# Releasing Holocron3D

Use this checklist for every Holocron3D release. A release is not complete until
the distributable artifact for every supported platform is attached to the
GitHub release and every download has been verified.

## Required release assets

Every release must include all five user-facing artifacts:

| Platform            | Required asset                                | Build location                                       |
| ------------------- | --------------------------------------------- | ---------------------------------------------------- |
| Windows x64         | `Holocron3D-Setup.exe`                        | `out/make/squirrel.windows/x64/Holocron3D-Setup.exe` |
| macOS Apple Silicon | `LotJ-Holocron-3D-<version>-arm64.dmg`        | `out/make/dmg/darwin/arm64/`                         |
| macOS Intel         | `LotJ-Holocron-3D-<version>-x64.dmg`          | `out/make/dmg/darwin/x64/`                           |
| Linux x64           | `LotJ-Holocron-3D-<version>-linux-x64.tar.gz` | `out/make/tar.gz/linux/x64/`                         |
| Mudlet package      | `Holocron3D.mpackage`                         | `out/mudlet/Holocron3D.mpackage`                     |

Do not substitute an unpacked application directory, source archive, relay
binary, or Squirrel `.nupkg` file for a listed release artifact. GitHub's
automatically generated source archives do not contain an installable application.

## Automated release path

Pull requests into `main` run the complete JavaScript/TypeScript, Node, Go, and
isolated Lua 5.1 behavior suites. Configure the repository's `main`
branch protection to require the **CI / Full test suite** check before merging.

After a PR merges, the **Release** workflow compares `package.json` between the
old and new `main` commits. If the version did not change, it exits without
creating a release. If the version increased, it repeats the full test suite,
builds all required Windows, macOS, Linux, and Mudlet artifacts, verifies their
names and sizes, generates `SHA256SUMS.txt`, and publishes the release only after
every job succeeds.

For a release PR, update all synchronized version declarations and let the
existing version-consistency test verify them. `package.json` is the trigger and
the source of the version embedded in DMG filenames. Do not manually create the
GitHub release before merging the version PR.

If a release run is interrupted after a merge, use **Actions > Release > Run
workflow** with the version currently in `package.json`. The workflow can resume
an existing draft release, replaces its artifacts, re-verifies the complete set,
and publishes it. It refuses to overwrite an already-published release.

### Private runtime asset configuration

The Windows, macOS, and Linux jobs fetch separately licensed optimized planet
and ship runtime bundles from private Google Drive files. Configure this once
before running a release:

1. Enable the Google Drive API in a Google Cloud project and create a dedicated
   service account with no project roles.
2. Create a JSON key for that service account and add the complete JSON document
   as the GitHub Actions repository secret `GOOGLE_DRIVE_CREDENTIALS`.
3. Generate both optimized runtime ZIPs using the commands in
   `vendor-assets/README.md`. In Google Drive, keep them restricted and share only
   those files with the service account email as a Viewer. Do not upload the raw
   marketplace archives.
4. Add the Drive file ID as the repository variable
   `HOLOCRON_PLANET_ASSET_FILE_ID`.
5. Add the lowercase SHA-256 printed beside the prepared ZIP as the repository
   variable `HOLOCRON_PLANET_ASSET_SHA256`.
6. Add the ship ZIP's Drive file ID and lowercase SHA-256 as repository variables
   `HOLOCRON_SHIP_ASSET_FILE_ID` and `HOLOCRON_SHIP_ASSET_SHA256`.

Changing the Drive file requires updating both repository variables. A release
fails before packaging if authentication, download, checksum validation,
extraction, the 40-file completeness check, or 1024×512 WebP validation fails.
After packaging, each Windows, macOS, and Linux job also opens the generated `app.asar`
and requires all 40 optimized maps under `renderer/dist/planet-textures`. The
release is blocked if a map is missing or empty, or if raw `vendor-assets`,
temporary `.codex-tmp` files, or duplicate `renderer/public` assets are present.
Each job also requires the 29 release-eligible ship meshes, `manifest.json`, and
`ATTRIBUTION.md` under `renderer/dist/ship-models`. It rejects missing or empty
geometry and attribution drift. Praetorian now uses original project geometry.

### Test the private asset pipeline in a PR

Open a pull request from a branch in this repository. The
**Private runtime asset validation** workflow authenticates with the same secret,
downloads both Drive ZIPs, verifies their SHA-256 digests, validates all 40
1024×512 WebPs and 29 ship meshes, builds the renderer, and confirms both asset
families reached `renderer/dist`. It does not package an installer, upload the
assets as an Actions artifact, or publish a release.

GitHub withholds repository secrets from fork and Dependabot pull requests, so
the private asset job intentionally skips those PRs. The regular
**CI / Full test suite** still runs. Never change this workflow to
`pull_request_target`: that event would expose the Drive credential while
running code from a pull request.

## Manual build and verification reference

The remaining instructions document the underlying build steps for local
verification and troubleshooting. The automated workflow is the authoritative
public release path.

## 1. Prepare the release

1. Start from a clean release branch and pull the intended release commit.
2. Run the appropriate synchronized version bump. A patch bump increments only
   the third component, a minor bump resets the patch component, and a major
   bump resets both the minor and patch components:

   ```powershell
   pnpm version:patch
   # or
   pnpm version:minor
   # or
   pnpm version:major
   ```

   The command updates `package.json`, `mudlet-package/mfile`, the Mudlet
   bootstrap, and the Mudlet proxy together. DMG filenames read the version
   directly from `package.json`. Search the repository for the previous version
   to catch other embedded values:

   ```powershell
   rg -n "<previous-version>" -g "!pnpm-lock.yaml"
   ```

3. Install the locked dependencies and run the full portable checks:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm check
   pnpm test
   pnpm relay:test
   ```

4. With a Lua 5.1-compatible interpreter available, run the isolated Lua suite:

   ```text
   pnpm test:lua
   ```

5. Record noteworthy changes, known issues, and the fact that the current
   Windows and macOS artifacts are unsigned in the release notes.

## 2. Build the Windows installer

Build Windows artifacts on Windows x64. Close every running development or
packaged Holocron3D window first so files under `out/` are not locked.

```powershell
pnpm make:win
pnpm mudlet:package
```

Verify both files exist and are non-empty:

```powershell
Get-Item -LiteralPath .\out\make\squirrel.windows\x64\Holocron3D-Setup.exe
Get-Item -LiteralPath .\out\mudlet\Holocron3D.mpackage
```

Install `Holocron3D-Setup.exe` on a clean or representative Windows account and
confirm that the application opens and the bundled Mudlet package can connect.

For an official release, the repository's **Release** GitHub
Actions workflow repeats this build on a clean Windows runner and preserves the
installer and Mudlet package as workflow artifacts.

## 3. Build the macOS installers

Build macOS artifacts on macOS with Xcode command-line tools available. Both
architectures are required even if the release was developed on only one Mac.

```bash
pnpm make:mac:arm64
pnpm make:mac:x64
```

Verify that one versioned DMG exists in each architecture directory:

```bash
ls -lh out/make/dmg/darwin/arm64/*.dmg
ls -lh out/make/dmg/darwin/x64/*.dmg
```

Mount each DMG and confirm it contains `LotJ Holocron 3D.app` plus the
`Applications` shortcut. Smoke-test the build on matching hardware when it is
available. Because the current builds are unsigned, document the expected
Gatekeeper warning in the release notes.

The **Release** GitHub Actions workflow builds both DMGs on
native macOS runners.

## 4. Build the Linux archive

Build the Linux x64 artifact on Linux:

```bash
pnpm make:linux
node tools/verify-packaged-planet-assets.mjs linux x64
node tools/verify-packaged-ship-assets.mjs linux x64
node tools/verify-linux-archive.mjs x64
```

Verify the versioned archive exists and is non-empty:

```bash
ls -lh out/make/tar.gz/linux/x64/*.tar.gz
```

Extract it on a representative x64 Linux desktop, open `Holocron3D/Holocron3D`
once, and confirm the bundled Mudlet package and relay are installed beneath
`${XDG_DATA_HOME:-$HOME/.local/share}/Holocron3D`. The **Release** workflow builds
and verifies this archive on an Ubuntu runner.

## 5. Create and attach the GitHub release

The automated workflow creates the tag from the exact merged commit and keeps
the GitHub release in draft state while uploading. It uploads all five assets
from the table above plus `SHA256SUMS.txt`; it will not publish a release
containing only GitHub's generated source archives.

The GitHub web interface can be used, or the GitHub CLI can create a draft and
upload the artifacts:

```text
gh release create v<version> --draft --title "Holocron3D v<version>" --notes-file <release-notes-file>
gh release upload v<version> <windows-exe> <arm64-dmg> <x64-dmg> <linux-tar-gz> <mudlet-mpackage>
```

Before publishing, open the draft release page and confirm its asset list
contains exactly the intended version of:

- `Holocron3D-Setup.exe`
- `LotJ-Holocron-3D-<version>-arm64.dmg`
- `LotJ-Holocron-3D-<version>-x64.dmg`
- `LotJ-Holocron-3D-<version>-linux-x64.tar.gz`
- `Holocron3D.mpackage`

If any required installer is missing, keep the release as a draft and finish
the corresponding platform build. Never publish first with a plan to attach an
installer later.

## 6. Verify the published downloads

After publishing:

1. Download every attached asset from the public release page rather than
   testing only the local build output.
2. Confirm each downloaded file is non-empty and opens as the expected file
   type.
3. Install or mount at least the Windows `.exe`, both macOS `.dmg` files, and the
   Linux archive on their supported platforms.
4. Confirm the release page prominently identifies which installer applies to
   Windows x64, macOS Apple Silicon, macOS Intel, and Linux x64 users.

Only after these checks pass should the release be announced to users.

## Release completion checklist

- [ ] Version metadata and artifact names agree.
- [ ] `pnpm check`, `pnpm test`, and `pnpm relay:test` pass.
- [ ] Windows x64 installer was built and smoke-tested.
- [ ] macOS Apple Silicon DMG was built and smoke-tested.
- [ ] macOS Intel DMG was built and smoke-tested.
- [ ] Linux x64 archive was built, verified, and smoke-tested.
- [ ] Standalone Mudlet package was built.
- [ ] Draft GitHub release contains all five required assets.
- [ ] `SHA256SUMS.txt` covers all five required assets.
- [ ] Assets were downloaded back from GitHub and verified.
- [ ] Release was published only after attachment verification.
