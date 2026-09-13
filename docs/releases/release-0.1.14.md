# Release 0.1.14 handoff

## Changes

- Original YT-1000, Aurek, Bulwark, Sprint, Valor, Golan III and Praetorian models.
- Imported Naboo N-1 and JumpMaster models with attribution; Naboo names share one model.
- Golan III is the common station/platform model. Praetorian replaces the unverified STL.
- Flashfire adds an original scout model; all 29 catalog models are release eligible.
- Source meshes and review GLBs stay out of Git.
- Manual hyperspace navstat reconciles ship identity without ending confirmed transit.
- Bare CALC listings no longer restart calculation polling after an abort.
- Electron and Mudlet version declarations are synchronized to 0.1.14.

## Private runtime bundle handoff

The `r2` ship bundle includes Flashfire and supersedes the earlier 28-model ZIP.
Use the exact archive and checksum below; do not upload the old ship ZIP.

Prepared locally under `.codex-tmp/drive-assets/` (not committed or uploaded to the PR):

| Archive                               | Contents                                         | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `holocron-ship-runtime-0.1.14-r2.zip` | `ship-models/`: 29 meshes, manifest, attribution | `28b8c0baffd53a98429a31ece4ed58dbba78ff6626f1e748b2dee43d2afe01fc` |
| `holocron-planet-runtime-0.1.14.zip`  | `planet-textures/`: 40 optimized maps            | `5d66b962e5163c236a7faff4c22f0add18aa5253840b7614809e725fb55dc5fd` |

Before marking the PR ready or merging:

- Upload the new ship ZIP privately to Google Drive; grant the existing release
  service account Viewer access. Update `HOLOCRON_SHIP_ASSET_FILE_ID` and
  `HOLOCRON_SHIP_ASSET_SHA256` together. The currently configured bundle predates
  this catalog and cannot satisfy its completeness/attribution validation.
- Planet assets are unchanged; retain the current Drive bundle if it validates.
  If replacing it with the prepared ZIP, update both planet variables and sharing.
- Run **Private runtime asset validation** against the PR branch.
- Confirm PR checks and review. Merging the version bump into main triggers the
  release workflow, which builds all installers and publishes only after verification.

No public release or tag has been created by this preparation step.
The local Mudlet package is `out/mudlet/Holocron3D.mpackage`.

## Exact ship ZIP update steps

1. Upload `.codex-tmp/drive-assets/holocron-ship-runtime-0.1.14-r2.zip` as a new
   private file in Google Drive. Leave General access restricted.
2. Share it as Viewer with the same release service account that can read the
   existing ship ZIP. A private folder alone does not guarantee this access.
3. Copy its file ID from the sharing URL: the value between `/d/` and `/view`.
4. In GitHub repository Settings > Secrets and variables > Actions > Variables,
   update `HOLOCRON_SHIP_ASSET_FILE_ID` to that ID and
   `HOLOCRON_SHIP_ASSET_SHA256` to the `r2` checksum above. Do not change the
   Google credentials secret or either planet variable.
5. Run Actions > Private runtime asset validation > Run workflow, selecting
   branch `release/0.1.14-ship-models`. Wait for success before merging PR #26.

Alternatively, after uploading and sharing, run these commands from the checkout
with an authenticated GitHub CLI (replace the file-ID placeholder first):

```powershell
gh variable set HOLOCRON_SHIP_ASSET_FILE_ID --repo doc82/lotj-holocron-3D --body "NEW_DRIVE_FILE_ID"
gh variable set HOLOCRON_SHIP_ASSET_SHA256 --repo doc82/lotj-holocron-3D --body "28b8c0baffd53a98429a31ece4ed58dbba78ff6626f1e748b2dee43d2afe01fc"
gh workflow run planet-assets.yml --repo doc82/lotj-holocron-3D --ref release/0.1.14-ship-models
```
