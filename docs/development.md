# Development setup

Holocron3D supports development on Windows x64 and macOS Intel/Apple Silicon.
The clean-build baseline is Node.js 24.19.0, pnpm 11.19.0, Go 1.25.3, and JDK 17. A second successful setup used JDK 21. The minimum versions imposed by the
project are Node.js 22.12, Go 1.22, and Java 17.

## 1. Install the prerequisites

Install the following tools and restart your terminal so their `PATH` changes
take effect:

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/) 22.12 or newer
- [pnpm](https://pnpm.io/installation) 11.19
- [Go](https://go.dev/dl/) 1.22 or newer
- A Java 17 or 21 JDK
- [Muddler](https://github.com/demonnic/muddler) 1.1 when building the Mudlet
  package or a release

If pnpm is not already installed, enable the copy distributed through Corepack:

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
```

If `corepack` is unavailable on Windows, install the same pnpm version with
`npm.cmd install --global pnpm@11.19.0`. The `.cmd` form avoids a common
PowerShell execution-policy error involving `npm.ps1`.

Verify the toolchain before installing dependencies:

```powershell
node --version
pnpm --version
go version
java -version
```

## 2. Clone and install

```powershell
git clone https://github.com/doc82/lotj-holocron-3D.git
Set-Location .\lotj-holocron-3D
pnpm install --frozen-lockfile
```

pnpm is the repository's package manager. Do not run `npm install` or commit a
`package-lock.json`; `pnpm-lock.yaml` is the authoritative dependency lockfile.

## 3. Configure Muddler

Download and extract a Muddler 1.1 distribution such as
`muddle-shadow-1.1.0`. Set `MUDDLER_HOME` to that extracted directory—not its
`bin` directory. On Windows, the following file must exist:

```text
%MUDDLER_HOME%\bin\muddle.bat
```

Set the value for the current PowerShell session:

```powershell
$env:MUDDLER_HOME = "C:\tools\muddle-shadow-1.1.0"
Test-Path -LiteralPath "$env:MUDDLER_HOME\bin\muddle.bat"
```

The final command must print `True`. To persist the value for future terminals,
run this once and then open a new PowerShell window:

```powershell
[Environment]::SetEnvironmentVariable(
  "MUDDLER_HOME",
  "C:\tools\muddle-shadow-1.1.0",
  "User"
)
```

On macOS, set `MUDDLER_HOME` to a distribution containing `bin/muddle` or
`bin/muddle.sh`.

The build script also recognizes `../AutoPilot/muddler` automatically when the
AutoPilot repository is checked out directly beside this repository. It does
not search Downloads or other arbitrary directories.

Confirm that all build prerequisites work:

```powershell
pnpm check
pnpm test
pnpm relay:test
pnpm mudlet:package
```

## Formatting

The repository uses Prettier for TypeScript, TSX, JavaScript, CSS, JSON, YAML,
Markdown, and HTML; StyLua for Lua 5.1; and `gofmt` for Go. The formatter
packages are installed by `pnpm install`, while `gofmt` comes with the required
Go toolchain.

Format the entire repository before committing:

```powershell
pnpm format
```

To check formatting without changing files, run:

```powershell
pnpm format:check
```

`pnpm check` includes the non-mutating formatting check. The recommended VS
Code extensions and format-on-save settings are committed under `.vscode`.

## 4. Run the development application

```powershell
pnpm electron:dev
```

This starts Vite and Electron together. Close the Electron window or press
`Ctrl+C` in the terminal to stop both processes. To test live Mudlet telemetry,
also run `pnpm relay:build`, import `out\mudlet\Holocron3D.mpackage` into Mudlet,
and start the package with `h3d start`.

To test the unpacked Electron application produced under `out`, enable the
Mudlet package's opt-in development mode once, using your checkout path:

```text
h3d dev on "C:\path\to\lotj-holocron-3D"
```

Close any installed Holocron3D window before entering `h3d start`; an existing
desktop listener would otherwise receive the relay connection. The setting is
stored in the Mudlet profile and survives package reinstalls. Use `h3d dev off`
to restore the installed application.

## Next steps

- Use the [building and packaging guide](building.md) to create application and
  installer artifacts.
- Use the [testing guide](testing.md) to run or extend the test suites.
- Follow the [release runbook](releasing.md) for an actual release.
- Consult the [architecture](architecture.md) and
  [relay protocol](protocol.md) when changing runtime boundaries.
