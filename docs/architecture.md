# Runtime architecture

Mudlet spawns `holocron-relay.exe` on Windows or `holocron-relay` on macOS and
exchanges newline-delimited JSON through stdin/stdout. The relay authenticates
to Electron over loopback TCP before it can send telemetry or replace an
existing Mudlet connection. Electron forwards validated snapshots to the
renderer through a narrow preload API and typed IPC.

React and TypeScript own application state and feature composition. An
imperative WebGL engine owns the high-frequency render loop, interpolation,
picking, and camera controls.

Electron also exposes a compatibility WebSocket endpoint at
`ws://127.0.0.1:8787` for local third-party clients. It is not used by the
internal renderer, and failure to bind that optional endpoint does not block the
authenticated Mudlet-to-Electron connection.

See the [relay protocol](protocol.md) for the message schemas and compatibility
rules.

## Security boundaries

- A random per-user relay credential is never exposed to renderer code.
- Network listeners bind only to loopback.
- Electron and WebSocket clients cannot send raw game-command messages.
- Mudlet intent handlers are typed and registered locally.
- The renderer uses sandboxing, context isolation, disabled Node integration,
  blocked navigation, and a restrictive content security policy.
- Production builds enforce ASAR integrity and hardened Electron fuses.

LotJ remains authoritative. An accepted UI intent means only that a locally
trusted Mudlet handler accepted it—not that the game completed an action.

## Per-user files

### Windows

The installed application uses `%LOCALAPPDATA%\Holocron3D`:

| Path                         | Purpose                          |
| ---------------------------- | -------------------------------- |
| `bin\holocron-relay.exe`     | Native Mudlet-to-Electron relay. |
| `mudlet\Holocron3D.mpackage` | Importable Mudlet package.       |
| `bridge-token`               | Per-user relay credential.       |
| `logs\holocron3d.log`        | Structured Electron diagnostics. |
| `Update.exe`                 | Squirrel launcher and updater.   |

If the desktop window is blank or fails to launch, inspect
`%LOCALAPPDATA%\Holocron3D\logs\holocron3d.log` first.

### macOS

The installed application uses `~/Library/Application Support/Holocron3D`:

| Path                         | Purpose                          |
| ---------------------------- | -------------------------------- |
| `bin/holocron-relay`         | Native Mudlet-to-Electron relay. |
| `mudlet/Holocron3D.mpackage` | Importable Mudlet package.       |
| `bridge-token`               | Per-user relay credential.       |
| `logs/holocron3d.log`        | Structured Electron diagnostics. |

The `h3d confirmations` and `h3d debug` preferences are stored in the Mudlet
profile, so package reinstalls do not reset them.

## Repository layout

| Path              | Contents                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `electron/`       | Main process, preload API, authentication, and cross-platform bootstrap.                           |
| `relay/`          | Dependency-free Go relay and tests.                                                                |
| `renderer/`       | React features with co-located CSS Modules, typed telemetry domain, and the WebGL tactical engine. |
| `mudlet/`         | Authoritative Lua parser, proxy, scraper, and setup guide.                                         |
| `mudlet-package/` | AutoPilot-style Muddler package source.                                                            |
| `tests/`          | Active protocol, renderer, parser, scraper, and packaging tests.                                   |
| `tools/`          | Release build and Electron smoke-test utilities.                                                   |
| `docs/`           | User, contributor, protocol, architecture, and roadmap documentation.                              |
| `poc/`            | Archived Node/browser proof of concept and its regression tests.                                   |
