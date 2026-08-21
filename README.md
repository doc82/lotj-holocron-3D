# LotJ Holocron 3D

LotJ Holocron 3D is a Windows and macOS desktop tactical renderer for space
telemetry from [Legends of the Jedi](https://www.legendsofthejedi.com/). A
Mudlet package polls the game's read-only ship and contact commands, normalizes
their output, and streams snapshots through a native local relay to a sandboxed
React renderer in Electron.

```text
LotJ
  -> Mudlet Holocron3D package
  -> authenticated native relay
  -> Electron main process
  -> sandboxed React + WebGL renderer
```

The desktop pipeline is operational and has been validated against live LotJ
output. Windows x64 and macOS Intel/Apple Silicon release builds are supported.
The current artifacts are unsigned, so Windows SmartScreen or macOS Gatekeeper
may display a warning. Linux packaging remains a post-MVP deliverable.

End users do not need Node.js, Go, Java, or a repository checkout. Those tools
are required only when developing or building releases.

## Installation

Download the appropriate installer from the project's
[GitHub releases](https://github.com/doc82/lotj-holocron-3D/releases), then
connect it to your normal LotJ Mudlet profile.

### Windows

1. Install `Holocron3D-Setup.exe` and open Holocron3D once.
2. Open your normal LotJ profile in Mudlet.
3. Press **Alt+O** to open Mudlet's Package Manager.
4. Choose **Install New Package** and select:

   ```text
   %LOCALAPPDATA%\Holocron3D\mudlet\Holocron3D.mpackage
   ```

5. Enter `h3d status` in Mudlet.

### macOS

1. Choose the `arm64` DMG for Apple Silicon or the `x64` DMG for an Intel Mac.
2. Open the DMG, drag **LotJ Holocron 3D** to **Applications**, and open it once.
3. If Gatekeeper blocks this unsigned beta, Control-click the app, choose
   **Open**, and confirm that you want to run it.
4. In Mudlet's Package Manager, install:

   ```text
   ~/Library/Application Support/Holocron3D/mudlet/Holocron3D.mpackage
   ```

5. Enter `h3d status` in Mudlet. The package launches the installed application
   from `/Applications/LotJ Holocron 3D.app` when it is not already running.

The Mudlet package starts automatically after installation. Enter a ship
cockpit where LotJ permits the telemetry commands; the renderer will begin
updating as polling results arrive.

## Documentation

### Using Holocron3D

- [Current capabilities](docs/capabilities.md) describes telemetry, rendering,
  formation commands, navigation, and known limitations.
- [Controls and Mudlet commands](docs/controls.md) covers the tactical view,
  coordinate scale, package commands, debugging, and profiling.
- [Detailed Mudlet setup](mudlet/SETUP.md) contains the first-time walkthrough
  and troubleshooting reference.

### Contributing and development

- [Development setup](docs/development.md) covers prerequisites, cloning,
  Muddler configuration, and the local development workflow.
- [Building and packaging](docs/building.md) lists build commands, outputs, and
  clean-setup troubleshooting.
- [Testing](docs/testing.md) documents test selection and Lua isolation rules.
- [Release runbook](docs/releasing.md) covers producing and verifying a release.

### Design and project direction

- [Architecture](docs/architecture.md) explains the runtime boundaries,
  transports, security model, and per-user files.
- [Relay protocol](docs/protocol.md) defines messages exchanged between Mudlet,
  the relay, and Electron.
- [Product roadmap](docs/roadmap.md) tracks completed and planned milestones.
- [Electron migration notes](docs/electron-migration.md) preserve the desktop
  migration history and distribution considerations.

## Planet texture credits

Packaged releases may include optimized planet textures created by
[Shiny_Man on CGTrader](https://www.cgtrader.com/designers/shinyman). His
photorealistic planet work is used with attribution in this strictly non-profit
project. The artist's usage statement and gallery are available from
[SchinyMan on DeviantArt](https://www.deviantart.com/schinyman).

These planet textures are separately licensed assets. They are not covered by
the Holocron source code terms, may not be extracted or redistributed as a
standalone texture pack, and may not be used for AI training or generation.
See [third-party asset notices](docs/third-party-assets.md) for details and
source links.
