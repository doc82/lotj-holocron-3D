# Windows Electron migration

The Windows Electron migration is complete for the MVP. The browser proof of
concept is archived under `poc/`. Electron bundles its own Node.js runtime, so
end users do not install Node.js separately.

## Current development architecture

```text
Mudlet Lua
  <-> stdin/stdout
native holocron-relay.exe
  <-> loopback TCP 127.0.0.1:8786
Electron main process
  <-> typed, sandboxed IPC
WebGL renderer
```

Electron also keeps the loopback WebSocket endpoint on port `8787` for external
clients. It is not used for the application's internal renderer connection.

The native relay is necessary because a Windows GUI-subsystem Electron process
does not reliably retain the stdin/stdout handles expected by Mudlet's `spawn()`
API. The relay is a small Go executable with no installed runtime dependency.
It also gives the final application a clean reconnect boundary.

The loopback relay endpoint requires a random per-user credential before it
accepts telemetry or replaces the current Mudlet connection. Electron creates
the credential at `%LOCALAPPDATA%\Holocron3D\bridge-token`; it is never exposed
to the renderer or the WebSocket compatibility endpoint.

The Windows application also uses stable per-user locations:

- native relay: `%LOCALAPPDATA%\Holocron3D\bin\holocron-relay.exe`
- Mudlet package: `%LOCALAPPDATA%\Holocron3D\mudlet\Holocron3D.mpackage`
- structured log: `%LOCALAPPDATA%\Holocron3D\logs\holocron3d.log`
- Squirrel updater: `%LOCALAPPDATA%\Holocron3D\Update.exe`

## Development setup

```text
pnpm install
go -C relay test ./...
go -C relay build -trimpath -ldflags "-s -w" -o bin/holocron-relay.exe .
```

The supported Mudlet integration is built from `mudlet-package/`. The retired
repository launcher and Node/browser fallback remain under `poc/` for historical
testing only.

The renderer remains sandboxed with Node integration disabled, context
isolation enabled, navigation blocked, and a narrow preload API.

## Windows packaging

Build the native relay and unpacked Electron application with:

```text
pnpm package
```

Create the Squirrel installer with:

```text
pnpm make
```

Forge writes build products beneath `out/`. The installer copies the bundled
relay and Muddler-built client package to stable per-user paths during
install/update. The Mudlet package can then start the installed application
through Squirrel's `Update.exe`.

`pnpm mudlet:package` builds the `.mpackage` independently. It uses
`MUDDLER_HOME` when set and otherwise recognizes the sibling AutoPilot checkout's
bundled Muddler distribution for local development.

## Before public Windows distribution

- Add application icons and Windows metadata.
- Add a packaged-app integration test on a clean Windows VM.
- Select and configure Windows code signing.

macOS and Linux launch adapters and packaging remain post-MVP work.
