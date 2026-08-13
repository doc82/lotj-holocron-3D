# LotJ Holocron 3D

LotJ Holocron 3D is a Windows desktop tactical renderer for space telemetry from
[Legends of the Jedi](https://www.legendsofthejedi.com/). A Mudlet package polls
the game's read-only ship and contact commands, normalizes their output, and
streams snapshots through a native local relay to a sandboxed React renderer in
Electron.

## Project status

The Windows MVP pipeline is operational and has been validated against live LotJ
output:

```text
LotJ
  -> Mudlet Holocron3D package
  -> authenticated native relay
  -> Electron main process
  -> sandboxed React + WebGL renderer
```

End users do not need Node.js, Go, Java, or a repository checkout. Those tools
are required only when developing or building releases.

macOS and Linux support are post-MVP deliverables. The current Windows installer
is not code-signed, so Windows SmartScreen may display a warning.

## Current capabilities

- Parses live `info`, `radar`, `prox`, `prox velocity`, `status`, and `fleetradar` output.
- Polls those commands sequentially while suppressing automated command output.
- Probes with one hidden `radar` after startup and Mudlet connection; recurring
  ship scraping starts only when that response confirms the player is in space.
- Preserves manually entered command output for normal Mudlet use.
- Tracks the player ship separately from radar contacts and updates its position,
  heading, speed, hull, shields, energy, class, and condition when available.
- Merges ships, celestial bodies, fleet positions, distance, velocity, and system
  metadata into authoritative snapshots.
- Detects launch and landing state, pauses polling while landed, and clears stale
  space presentation.
- Renders procedural low-poly 3D hulls with an observer-locked Homeworld-style
  orbit camera. Each LotJ ship class has a distinct generated model, and known
  heading vectors orient those models in three dimensions.
- Derives remote `status`/`info` scan range as `500 + (10 × Sensor Array)` and
  renders it as a toggleable blue sensor bubble instead of an infinite floor grid.
- Provides an optional three-plane coordinate grid centered on the system's true
  `0 / 0 / 0`. It extends at least 3,000 units along every positive and negative
  axis, then expands with coarser spacing for strategic-scale coordinates.
- Collapses contacts at identical coordinates into a larger numbered marker,
  including planets colocated with orbiting ships. Clicking it opens a member grid;
  hovering previews a contact and clicking pins its details.
- Scans in-range ships with targeted `status` and `info` requests. Enemy status is
  prioritized every four seconds by default; other status and safe identity info
  refresh every ten seconds, subject to Mudlet's serialized command queue.
- Provides `SCAN` and `INFO` controls for a selected ship so the player can
  immediately refresh its parsed telemetry without waiting for the automatic
  scan queue. Manual scans preempt only hidden polling and report range failures
  in the command panel.
- Switches the command bank to the selected ship's context, with `SCAN`, `INFO`,
  course-to, course-away, and aggressive `TARGET` actions. Target orders are
  resolved safely inside Mudlet and persistently mark the selected ship as enemy.
- Provides an authoritative autotrack switch. Combat targeting defaults to
  requesting autotrack, and the UI changes state only after LotJ returns
  `Autotracking on.` or `Autotracking off.`; an opposite toggle response is
  corrected once automatically.
- Uses icon-first command controls with keyboard-accessible hover/focus labels,
  including the radar, origin-grid, and sector-view controls.
- Restores the player-ship command context when empty space, the observer, or an
  already-selected contact is clicked. A cyan-white center reticle and persistent
  `YOUR SHIP` label distinguish the observer from neutral yellow contacts.
- Persists neutral, friendly, and enemy ship dispositions by ship name. Neutral
  markers are yellow, friendly markers blue, and enemies red.
- Uses strategic zoom inspired by large-scale space RTS games. Distant hulls
  collapse into compact glowing disposition-colored contacts; scrolling inward
  cross-fades them back into shaded 3D models.
- Uses a Homeworld-inspired command deck: selected-contact commands on the left,
  selected vessel telemetry in the center, and a fleet/battle-group bank on the
  right. Player speed controls live with the left-side ship commands so the
  right panel remains dedicated to the future battlegroup or squadron roster.
- Provides player-ship navigation orders from the command deck. `M` opens a
  Homeworld-style course vector: pointer movement chooses X/Z, holding Shift
  adjusts Y, and a blue arrow previews the continuing heading. Selected ships
  and planets can also be used for direct `course` or confirmed `course away`
  orders. The speed dial initializes from the ship's current velocity and sends
  a separate `speed` order when released or when a preset is selected. Rejected
  maneuver orders flash in the command panel, including LotJ's active-maneuver
  cooldown response. Course controls unlock from LotJ's authoritative
  `Maneuver complete.` output, with a safety timeout preventing a stranded UI.
- Hover cards show distance, world coordinates, and shield/hull bars. Missing
  health information is explicitly rendered as a gray `UNKNOWN // ?` state.
- Retains only safe capability fields from `info`, including sensors, maximum
  speed, and weapon counts; private ship access codes are excluded from
  snapshots and capture diagnostics. Confirmed unarmed player ships cannot issue
  target orders, and the disabled target icon explains why on hover.
- Interpolates contact movement between telemetry ticks.
- Opens with a cinematic gold-title and hyperspace transition into the tactical view.
- Presents a dedicated captain-facing uplink standby display while Mudlet is disconnected.
- Supports orbit, continuous strategic zoom, one-click sector view, hover
  details, and contact selection.
- Replays the latest snapshot to newly connected local clients.
- Packages the Mudlet integration and native relay inside the Windows installer.

## Windows installation

1. Install `Holocron3D-Setup.exe` and open Holocron3D once.
2. Open your normal LotJ profile in Mudlet.
3. Press **Alt+O** to open Mudlet's Package Manager.
4. Choose **Install New Package** and select:

```text
%LOCALAPPDATA%\Holocron3D\mudlet\Holocron3D.mpackage
```

5. Enter `h3d status` in Mudlet.

The Mudlet package starts automatically after installation. Enter a ship cockpit
where LotJ permits the telemetry commands; the renderer will begin updating as
polling results arrive.

### Mudlet commands

| Command | Purpose |
| --- | --- |
| `h3d start` | Start or reconnect telemetry and launch the desktop app if needed. |
| `h3d stop` | Stop polling and close the relay connection. |
| `h3d status` | Show bridge and polling state. |
| `h3d snapshot` | Display the current normalized snapshot inside Mudlet. |
| `h3d help` | Show the available package commands. |

The older `lua dofile(...)` launcher is no longer needed for normal use. It is
preserved under `poc/` solely for regression work.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit around the player ship. |
| Middle-mouse drag while plotting | Temporarily orbit the camera; release to resume course-vector adjustment. |
| Mouse wheel | Zoom. |
| `M` | Begin a relative player-ship course vector. |
| Pointer while moving | Adjust the course on the X/Z plane. |
| `Shift` + pointer | Adjust course elevation on the Y axis. |
| Left click / `Enter` | Stage and confirm a course order. |
| Right click / `Escape` | Cancel the current course order. |
| Click a contact | Select and inspect it. |
| `F` | Jump to strategic sector view. |
| `R` | Reset the camera. |
| Radar icon (top center) | Show or hide the player ship's sensor-range bubble. |
| Grid icon (top center) | Show or hide the true world-origin coordinate planes without changing zoom. |
| Sector icon (top center) | Fit the observed sector and switch to glowing strategic contacts. |

The player ship remains the camera focus and visual origin; entity positions are
rendered relative to its current world coordinates.

### Coordinate scale

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
camera scale; use `SECTOR VIEW` only when you explicitly want the entire grid framed.

## Runtime architecture

Mudlet spawns `holocron-relay.exe` and exchanges newline-delimited JSON through
stdin/stdout. The relay authenticates to Electron over loopback TCP before it can
send telemetry or replace an existing Mudlet connection. Electron forwards
validated snapshots to the renderer through a narrow preload API and typed IPC.
React and TypeScript own application state and feature composition. An
imperative WebGL engine owns the high-frequency render loop, interpolation,
picking, and camera controls.

Electron also exposes a compatibility WebSocket endpoint at
`ws://127.0.0.1:8787` for local third-party clients. It is not used by the
internal renderer, and failure to bind that optional endpoint does not block the
authenticated Mudlet-to-Electron connection.

Security boundaries include:

- a random per-user relay credential that is never exposed to renderer code;
- loopback-only network listeners;
- no raw game-command messages from Electron or WebSocket clients;
- locally registered, typed Mudlet intent handlers;
- renderer sandboxing, context isolation, disabled Node integration, blocked
  navigation, and a restrictive content security policy;
- ASAR integrity enforcement and hardened Electron production fuses.

LotJ remains authoritative. An accepted UI intent means only that a locally
trusted Mudlet handler accepted it—not that the game completed an action.

## Per-user Windows files

The installed application uses `%LOCALAPPDATA%\Holocron3D`:

| Path | Purpose |
| --- | --- |
| `bin\holocron-relay.exe` | Native Mudlet-to-Electron relay. |
| `mudlet\Holocron3D.mpackage` | Importable Mudlet package. |
| `bridge-token` | Per-user relay credential. |
| `logs\holocron3d.log` | Structured Electron diagnostics. |
| `Update.exe` | Squirrel launcher and updater. |

If the desktop window is blank or fails to launch, inspect
`%LOCALAPPDATA%\Holocron3D\logs\holocron3d.log` first.

## Development setup

Windows release development currently requires:

- a current Node.js installation;
- [pnpm](https://pnpm.io/);
- Go for the native relay;
- Java plus [Muddler](https://github.com/demonnic/muddler) when building the
  Mudlet package.

Install JavaScript dependencies and run the application:

```text
pnpm install
pnpm electron:dev
```

Build Muddler artifacts by setting `MUDDLER_HOME` to a Muddler distribution. For
local compatibility, the build script also recognizes the bundled Muddler in a
sibling `AutoPilot` checkout.

### Development commands

| Command | Purpose |
| --- | --- |
| `pnpm test` | Run Node protocol, renderer, package, and archived POC tests. |
| `pnpm check` | Syntax-check active code and archived POC JavaScript. |
| `pnpm renderer:dev` | Run the Vite renderer alone with hot module replacement. |
| `pnpm renderer:build` | Build the production renderer in `renderer/dist`. |
| `pnpm renderer:typecheck` | Type-check the React renderer without emitting files. |
| `pnpm relay:test` | Run Go relay tests. |
| `pnpm relay:build` | Build `relay/bin/holocron-relay.exe`. |
| `pnpm mudlet:package` | Build `out/mudlet/Holocron3D.mpackage`. |
| `pnpm electron:smoke` | Launch Electron with representative telemetry. |
| `pnpm package` | Build the relay, Mudlet package, and unpacked Electron app. |
| `pnpm make` | Build the complete Squirrel Windows installer. |

Lua parser and scraper fixtures can also be run with a Lua 5.1-compatible
interpreter:

```text
lua tests/parsers.test.lua
lua tests/scraper.test.lua
```

### Build artifacts

Generated outputs are ignored by Git:

- `out/LotJ Holocron 3D-win32-x64/` — unpacked Windows application;
- `out/make/squirrel.windows/x64/Holocron3D-Setup.exe` — Windows installer;
- `out/mudlet/Holocron3D.mpackage` — standalone Mudlet package;
- `relay/bin/holocron-relay.exe` — native relay executable.

## Repository layout

| Path | Contents |
| --- | --- |
| `electron/` | Main process, preload API, authentication, and Windows bootstrap. |
| `relay/` | Dependency-free Go relay and tests. |
| `renderer/` | React features with co-located CSS Modules, typed telemetry domain, and the WebGL tactical engine. |
| `mudlet/` | Authoritative Lua parser, proxy, scraper, and setup guide. |
| `mudlet-package/` | AutoPilot-style Muddler package source. |
| `tests/` | Active protocol, renderer, parser, scraper, and packaging tests. |
| `tools/` | Release build and Electron smoke-test utilities. |
| `docs/` | Protocol, architecture, and roadmap documentation. |
| `poc/` | Archived Node/browser proof of concept and its regression tests. |

## Known limitations

- Windows x64 is the only supported MVP target.
- The installer is currently unsigned.
- Contact visuals are intentionally simple points rather than ship models.
- Active enemy scans and detailed weapons, subsystem, crew, and sensor-quality
  metadata are deferred.
- Parsers may need adjustment when LotJ changes command output formatting.
- The third-party WebSocket interface is local-only and remains a compatibility
  surface rather than the primary renderer transport.

## Next phase

Core pipeline work is complete. Feature and experience work can now focus on:

- labels and velocity vectors;
- targeting and richer selection details;
- observation freshness, confidence, and sensor uncertainty;
- active enemy scans for weapons, shields, subsystems, tactical state, and
  detectable pilots or crew;
- improved visuals, product iconography, and Windows signing;
- macOS and Linux packaging after the Windows MVP.

See [the roadmap](docs/roadmap.md), [the relay protocol](docs/protocol.md), and
[the detailed Mudlet setup guide](mudlet/SETUP.md) for additional context.
