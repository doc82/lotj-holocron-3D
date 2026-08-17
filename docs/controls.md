# Controls and Mudlet commands

## Tactical view controls

| Input                                           | Action                                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drag                                            | Orbit around the player ship.                                                                                                                                                                               |
| Middle-mouse drag while plotting                | Temporarily orbit the camera; release to resume course-vector adjustment.                                                                                                                                   |
| Mouse wheel                                     | Zoom.                                                                                                                                                                                                       |
| `M`                                             | Begin a relative player-ship course vector.                                                                                                                                                                 |
| Pointer while moving                            | Adjust the course on the X/Z plane.                                                                                                                                                                         |
| `Shift` + pointer                               | Adjust course elevation on the Y axis.                                                                                                                                                                      |
| Left click / `Enter`                            | Stage and confirm a course order.                                                                                                                                                                           |
| Right click / `Escape`                          | Cancel the current course order.                                                                                                                                                                            |
| Click a contact                                 | Select and inspect it.                                                                                                                                                                                      |
| `×` on a target shortcut                        | Clear that target in LotJ for every owner shown on the card. Local targets use `target none`, whole-fleet targets use `bg target all none`, and individual battlegroup targets use `bg target <ship> none`. |
| Click a battlegroup roster card                 | Toggle that craft in the recipient set. Movement and other fleet orders apply only to highlighted cards.                                                                                                    |
| Select-all icon beside the roster close button  | Restore every fleet craft to the recipient set.                                                                                                                                                             |
| Camera-lock icon on a battlegroup roster member | Request that ship's radar and switch to its tactical view without changing command recipients.                                                                                                              |
| Radar-signature / info icon on a roster member  | Open that ship's parsed status / information dossier.                                                                                                                                                       |
| `F`                                             | Jump to strategic sector view.                                                                                                                                                                              |
| `R`                                             | Reset the camera.                                                                                                                                                                                           |
| `W` / `A` / `S` / `D`                           | Pan the free RTS camera.                                                                                                                                                                                    |
| `Q` / `E`                                       | Change the free RTS camera elevation.                                                                                                                                                                       |
| Radar icon (top center)                         | Show or hide the player ship's sensor-range bubble.                                                                                                                                                         |
| Grid icon (top center)                          | Show or hide the true world-origin coordinate planes without changing zoom.                                                                                                                                 |
| Sector icon (top center)                        | Fit the observed sector and switch to glowing strategic contacts.                                                                                                                                           |

The player ship remains the default camera focus and visual origin. A remote
battlegroup tactical view temporarily makes the camera-locked wing ship the visual
origin; returning to `YOUR SHIP` restores the flagship view.

## Coordinate scale

The initial orthographic view fits the known tactical scene so distant contacts
do not begin off-screen. At sector scale, ships and landmarks render as compact
glowing contacts. Scrolling inward smoothly resolves ship contacts into shaded,
heading-oriented procedural models; full model detail is reached above roughly
2.25 screen pixels per LotJ unit. Zooming can reach and exceed the experimental
10-screen-pixels-per-LotJ-unit reference scale. `SECTOR VIEW` (or `F`) restores
the strategic overview without changing telemetry coordinates.

The origin grid always extends at least 3,000 LotJ units in every positive and
negative direction. At the 10 px/unit reference scale, that is a 60,000 px span
from `-3,000` to `+3,000` on each plane. Enabling the grid preserves the current
camera scale; use `SECTOR VIEW` only when you explicitly want the entire grid
framed.

## Mudlet commands

| Command                     | Purpose                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `h3d start`                 | Start or reconnect telemetry and launch the desktop app if needed.                                                                       |
| `h3d stop`                  | Stop polling and close the relay connection.                                                                                             |
| `h3d pause`                 | Suspend automatic command output without disconnecting the bridge, leaving a clear window for manual Mudlet commands.                    |
| `h3d resume`                | Resume automatic telemetry polling after a manual command window.                                                                        |
| `h3d status`                | Show bridge and polling state.                                                                                                           |
| `h3d confirmations on\|off` | Persistently enable or suppress successful `h3d` command confirmations; warnings and errors remain visible.                              |
| `h3d debug on\|off`         | Persistently enable or suppress detailed parser, snapshot, and bridge diagnostics. Debug output defaults to off.                         |
| `h3d snapshot`              | Display the current normalized snapshot inside Mudlet.                                                                                   |
| `h3d profile start`         | Begin collecting low-overhead Mudlet telemetry performance metrics.                                                                      |
| `h3d profile report`        | Report event rates, command/capture traffic, Lua timings, and active Mudlet object counts without stopping collection.                   |
| `h3d profile stop`          | Print a final performance report and stop collecting metrics.                                                                            |
| `h3d dev on <path>`         | Persistently use a packaged Windows executable or macOS `.app` from a repository, unpacked `out` directory, or explicit executable path. |
| `h3d dev off`               | Return to the installed application on subsequent starts.                                                                                |
| `h3d dev status`            | Display the configured desktop application mode.                                                                                         |
| `h3d help`                  | Show the available package commands.                                                                                                     |

The older `lua dofile(...)` launcher is no longer needed for normal use. It is
preserved under `poc/` solely for regression work.

The tactical UI exposes the same pause/resume control. While paused, a prominent
warning covers the command surface because the displayed tactical state may be
stale; the bridge remains connected and the warning includes a resume button.

## Performance profiling

For a useful performance sample, enter `h3d profile start`, play normally for
at least 30 seconds (preferably in a populated system or combat), and then enter
`h3d profile stop`. The report separates GMCP event and snapshot rates from
command captures, parsing, state merging, line deletion, and bridge publishing.
Mudlet object-count deltas are included on Mudlet 4.15 and newer to expose
trigger or timer leaks.

A selected or locked target does not by itself enable high-frequency projectile
polling. Holocron3D temporarily accelerates `radar projectiles` only after actual
combat telemetry or while live/incoming projectiles are known, returning to the
normal radar cycle after ten quiet seconds.
