# Releasing Holocron3D

Use this checklist for every Holocron3D release. A release is not complete until
the installers for every supported platform are attached to the GitHub release
and their downloads have been verified.

## Required release assets

Every release must include all four user-facing artifacts:

| Platform            | Required asset                         | Build location                                       |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| Windows x64         | `Holocron3D-Setup.exe`                 | `out/make/squirrel.windows/x64/Holocron3D-Setup.exe` |
| macOS Apple Silicon | `LotJ-Holocron-3D-<version>-arm64.dmg` | `out/make/dmg/darwin/arm64/`                         |
| macOS Intel         | `LotJ-Holocron-3D-<version>-x64.dmg`   | `out/make/dmg/darwin/x64/`                           |
| Mudlet package      | `Holocron3D.mpackage`                  | `out/mudlet/Holocron3D.mpackage`                     |

Do not substitute an unpacked application directory, source archive, relay
binary, or Squirrel `.nupkg` file for an installer. GitHub's automatically
generated source archives do not contain an installable application.

## Automated release path

Pull requests into `main` run the complete JavaScript/TypeScript, Node, Go, and
isolated Lua 5.1 behavior suites. Configure the repository's `main`
branch protection to require the **CI / Full test suite** check before merging.

After a PR merges, the **Release** workflow compares `package.json` between the
old and new `main` commits. If the version did not change, it exits without
creating a release. If the version increased, it repeats the full test suite,
builds all required Windows, macOS, and Mudlet artifacts, verifies their names
and sizes, generates `SHA256SUMS.txt`, and publishes the release only after every
job succeeds.

For a release PR, update all synchronized version declarations and let the
existing version-consistency test verify them. `package.json` is the trigger and
the source of the version embedded in DMG filenames. Do not manually create the
GitHub release before merging the version PR.

If a release run is interrupted after a merge, use **Actions > Release > Run
workflow** with the version currently in `package.json`. The workflow can resume
an existing draft release, replaces its artifacts, re-verifies the complete set,
and publishes it. It refuses to overwrite an already-published release.

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
native macOS runners. Run it for the merged release commit and download all four
workflow artifacts before creating the GitHub release.

## 4. Create and attach the GitHub release

The automated workflow creates the tag from the exact merged commit and keeps
the GitHub release in draft state while uploading. It uploads all four assets
from the table above plus `SHA256SUMS.txt`; it will not publish a release
containing only GitHub's generated source archives.

The GitHub web interface can be used, or the GitHub CLI can create a draft and
upload the artifacts:

```text
gh release create v<version> --draft --title "Holocron3D v<version>" --notes-file <release-notes-file>
gh release upload v<version> <windows-exe> <arm64-dmg> <x64-dmg> <mudlet-mpackage>
```

Before publishing, open the draft release page and confirm its asset list
contains exactly the intended version of:

- `Holocron3D-Setup.exe`
- `LotJ-Holocron-3D-<version>-arm64.dmg`
- `LotJ-Holocron-3D-<version>-x64.dmg`
- `Holocron3D.mpackage`

If any required installer is missing, keep the release as a draft and finish
the corresponding platform build. Never publish first with a plan to attach an
installer later.

## 5. Verify the published downloads

After publishing:

1. Download every attached asset from the public release page rather than
   testing only the local build output.
2. Confirm each downloaded file is non-empty and opens as the expected file
   type.
3. Install or mount at least the Windows `.exe` and both macOS `.dmg` files on
   their supported platforms.
4. Confirm the release page prominently identifies which installer applies to
   Windows x64, macOS Apple Silicon, and macOS Intel users.

Only after these checks pass should the release be announced to users.

## Release completion checklist

- [ ] Version metadata and artifact names agree.
- [ ] `pnpm check`, `pnpm test`, and `pnpm relay:test` pass.
- [ ] Windows x64 installer was built and smoke-tested.
- [ ] macOS Apple Silicon DMG was built and smoke-tested.
- [ ] macOS Intel DMG was built and smoke-tested.
- [ ] Standalone Mudlet package was built.
- [ ] Draft GitHub release contains all four required assets.
- [ ] `SHA256SUMS.txt` covers all four required assets.
- [ ] Assets were downloaded back from GitHub and verified.
- [ ] Release was published only after attachment verification.
