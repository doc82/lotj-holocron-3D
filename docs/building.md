# Building and packaging

Holocron3D produces platform-native relays, Mudlet packages, unpacked Electron
applications, and Windows/macOS installers. Complete the
[development setup](development.md) before running these workflows.

## Windows artifacts

Close every running Holocron3D development or packaged window before building;
Windows will otherwise keep files beneath `out\` locked.

```powershell
pnpm package:win
pnpm make:win
```

`pnpm package:win` creates the unpacked application. `pnpm make:win` creates the
Squirrel installer at
`out\make\squirrel.windows\x64\Holocron3D-Setup.exe`.

## macOS artifacts

Run these commands on macOS with Xcode command-line tools available. Set
`MUDDLER_HOME` to a distribution containing `bin/muddle` or `bin/muddle.sh`.

```bash
pnpm package:mac:arm64
pnpm make:mac:arm64
pnpm package:mac:x64
pnpm make:mac:x64
```

The release wrapper builds the matching Go relay, creates the Muddler package,
packages Electron, generates the `.icns` icon with `sips`/`iconutil`, and creates
the DMG with Apple's `hdiutil`. A macOS application or DMG cannot be produced on
Windows. Signing and notarization can be added later without changing the
artifact layout.

For an actual release, follow the complete [release runbook](releasing.md). It
requires attaching and verifying the Windows installer, both macOS DMGs, and
the Mudlet package before the GitHub release is published.

## Development commands

| Command                      | Purpose                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `pnpm test`                  | Run Node protocol, renderer, package, and archived POC tests.                    |
| `pnpm check`                 | Syntax-check active code and archived POC JavaScript.                            |
| `pnpm renderer:dev`          | Run the Vite renderer alone with hot module replacement.                         |
| `pnpm renderer:build`        | Build the production renderer in `renderer/dist`.                                |
| `pnpm renderer:typecheck`    | Type-check the React renderer without emitting files.                            |
| `pnpm relay:test`            | Run Go relay tests.                                                              |
| `pnpm relay:build`           | Build the native relay for the current platform and architecture.                |
| `pnpm relay:build:win`       | Build the Windows x64 relay.                                                     |
| `pnpm relay:build:mac:arm64` | Cross-build the Apple Silicon relay.                                             |
| `pnpm relay:build:mac:x64`   | Cross-build the Intel macOS relay.                                               |
| `pnpm mudlet:package`        | Build `out/mudlet/Holocron3D.mpackage`.                                          |
| `pnpm electron:smoke`        | Launch Electron with representative telemetry.                                   |
| `pnpm package`               | Build the relay, Mudlet package, and unpacked Electron app for the current host. |
| `pnpm make:win`              | Build the complete Squirrel Windows installer.                                   |
| `pnpm make:mac:arm64`        | Build the Apple Silicon application and DMG on macOS.                            |
| `pnpm make:mac:x64`          | Build the Intel application and DMG on macOS.                                    |

The parser and scraper use isolated Lua 5.1 tests with fresh Mudlet globals,
timers, captures, and snapshots for every test:

```text
pnpm test:lua
pnpm test:lua -- --file scraper_polling_spec
pnpm test:lua -- --filter "first-contact hydration"
```

See the [testing guide](testing.md) for Windows/WSL setup, test selection, and
the isolation rules for adding Lua coverage.

## Build artifacts

Generated outputs are ignored by Git:

- `out/LotJ Holocron 3D-win32-x64/` — unpacked Windows application
- `out/make/squirrel.windows/x64/Holocron3D-Setup.exe` — Windows installer
- `out/mudlet/Holocron3D.mpackage` — standalone Mudlet package
- `relay/bin/windows-x64/holocron-relay.exe` — Windows relay executable
- `relay/bin/darwin-arm64/holocron-relay` and
  `relay/bin/darwin-x64/holocron-relay` — macOS relays
- `out/LotJ Holocron 3D-darwin-{arm64,x64}/` — unpacked macOS applications
- `out/make/dmg/darwin/{arm64,x64}/` — macOS DMG releases

## Clean dependency reinstall

Close Holocron3D before removing installed dependencies:

```powershell
Remove-Item -LiteralPath .\node_modules -Recurse -Force
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm make:win
```

## Clean-setup troubleshooting

Several independent prerequisite errors can appear during the same first build:

| Symptom                                                    | Resolution                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `go` is not recognized                                     | Install Go 1.22 or newer, reopen PowerShell, and confirm `go version` works.                                                                                                                                                                              |
| `java` is not recognized or `muddle.bat` immediately exits | Install a Java 17 or 21 JDK, reopen PowerShell, and confirm `java -version` works.                                                                                                                                                                        |
| `Set MUDDLER_HOME to a Muddler distribution directory`     | Point `MUDDLER_HOME` at the extracted distribution containing `bin\muddle.bat`; use the `Test-Path` check in the development guide.                                                                                                                       |
| pnpm reports a blocked exotic Electron dependency          | Confirm `pnpm --version` reports 11.19.x, remove `node_modules`, and rerun `pnpm install --frozen-lockfile`. The committed lockfile passes the supported pnpm policy; do not disable the policy project-wide as a first step.                             |
| Forge reports missing or mismatched Electron fuses         | Run `pnpm list electron @electron/fuses @electron-forge/plugin-fuses --depth 0`. The verified set is Electron 43.4.0, `@electron/fuses` 2.1.3, and Forge plugin 7.11.2. Restore it with a clean frozen-lockfile install before changing fuse enforcement. |
| Files beneath `out\` are locked                            | Close all running Holocron3D windows and rerun the build.                                                                                                                                                                                                 |

If a clean install still fails, include the four version commands from the
development guide, the exact `pnpm install --frozen-lockfile` error, and the
output of the dependency list command above when reporting the problem. Avoid
adding an npm lockfile or changing security policy until that environment
information has been captured.
