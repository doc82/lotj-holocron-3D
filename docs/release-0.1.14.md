# Release 0.1.14 handoff

## Changes

- Original YT-1000, Aurek, Bulwark, Sprint, Valor, Golan III and Praetorian models.
- Imported Naboo N-1 and JumpMaster models with attribution; Naboo names share one model.
- Golan III is the common station/platform model. Praetorian replaces the unverified STL.
- All 28 catalog models are release eligible; source meshes and review GLBs stay out of Git.
- Manual hyperspace navstat reconciles ship identity without ending confirmed transit.
- Bare CALC listings no longer restart calculation polling after an abort.
- Electron and Mudlet version declarations are synchronized to 0.1.14.

## Private runtime bundle handoff

Prepared locally under `.codex-tmp/drive-assets/` (not committed or uploaded to the PR):

| Archive                              | Contents                                         | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| `holocron-ship-runtime-0.1.14.zip`   | `ship-models/`: 28 meshes, manifest, attribution | `bd016db40a3f56dc37bcba9c740fa2834095bcc11cff8cecf14f8717281b2a4e` |
| `holocron-planet-runtime-0.1.14.zip` | `planet-textures/`: 40 optimized maps            | `5d66b962e5163c236a7faff4c22f0add18aa5253840b7614809e725fb55dc5fd` |

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
