# Mudlet setup: first-time walkthrough

This guide assumes you have never added a package to Mudlet before. Holocron3D
listens for read-only space-information commands and streams normalized data to
the Windows desktop renderer without competing with existing LotJ aliases.

## Installed Windows setup

1. Install and open `Holocron3D-Setup.exe` once.
2. Open your normal LotJ profile in Mudlet.
3. Open the Package Manager with **Alt+O** and choose **Install New Package**.
4. Select:

```text
%LOCALAPPDATA%\Holocron3D\mudlet\Holocron3D.mpackage
```

The package starts automatically. Enter `h3d status` in Mudlet to verify it, or
use `h3d start`, `h3d stop`, `h3d snapshot`, and `h3d help` as needed. Mudlet
stores its own copy after import, so the source `.mpackage` does not need to
remain selected or open. This follows Mudlet's standard Package Manager flow.

The remaining steps document the repository-based development fallback.

## What this test does

The test starts this chain on your computer:

```text
Mudlet -> Holocron3D proxy -> network bridge -> WebSocket client
Mudlet <- Holocron3D proxy <- network bridge <- WebSocket client
```

If it works, Mudlet will say that the bridge connected. Holocron3D polls
`status`, `info`, `radar`, `prox`, `prox velocity`, and `fleetradar` sequentially while
hiding automated output. Typing one yourself still performs a visible refresh.
Only `Sensor Array` is retained from `info`; access codes are discarded and
redacted from the package's last-capture diagnostics.

## Development Step 1: Make sure the files are present

Open Windows File Explorer and browse to the archived launcher:

```text
C:\Users\bjork\OneDrive\Documents\GitHub\lotj-holocron-3D\poc\mudlet
```

The runtime modules remain in the repository's top-level `mudlet` directory.
The legacy launcher is now:

- `lotj_holocron_proxy.lua`
- `lotj_holocron_parsers.lua`
- `lotj_holocron_scraper.lua`
- `poc/mudlet/start_prototype.lua`

Do not move the launcher or runtime modules; their relative paths are intentional.

## Development Step 2: Choose the desktop app or development bridge

For an installed Windows build, no Node.js or Go installation is required. The
launcher automatically uses the native relay under `%LOCALAPPDATA%\Holocron3D`
and starts the Electron app through its updater.

When working from this repository, the launcher uses the locally built Electron
relay when available and otherwise falls back to the Node.js browser prototype.

### Browser-prototype fallback

The network bridge is a small Node.js program. The launcher checks these locations,
in this order:

1. `C:\Program Files\nodejs\node.exe`
2. Codex's bundled Node runtime under your user profile
3. A program named `node` available through Windows `PATH`

Your current Codex installation includes a bundled Node runtime, and the required
WebSocket dependency has been installed in this repository.

To check manually, open **Command Prompt** from the Windows Start menu and enter:

```text
node --version
```

Seeing a version such as `v22.x.x` means a normal Node installation is available.
Seeing “not recognized” is okay for this prototype because the launcher can use
Codex's bundled copy. The standalone Electron release packages the bridge, so
end users do not need to install Node.js.

## Development Step 3: Open your LotJ profile in Mudlet

1. Start Mudlet.
2. Select your normal Legends of the Jedi profile.
3. Connect normally and log in.
4. Wait until you can type regular game commands.

The connection is not technically required for this first test, but using the
correct profile ensures later triggers and settings are created in the right
place.

## Development Step 4: Run the one-line prototype

At the very bottom of Mudlet is the same command box where you normally type LotJ
commands.

Copy this entire line, paste it into that box, and press **Enter**:

```lua
lua dofile([[C:/Users/bjork/OneDrive/Documents/GitHub/lotj-holocron-3D/poc/mudlet/start_prototype.lua]])
```

Important details:

- The line begins with `lua`. This tells Mudlet to run code locally instead of
  sending it to LotJ.
- The path uses forward slashes. That is intentional even though this is Windows.
- Keep both opening brackets `[[` and both closing brackets `]]`.

## Step 5: Check the result

The following messages should appear in Mudlet, usually within a second:

```text
[Holocron3D] Bridge process started; waiting for its reply...
[Holocron3D] live scraping enabled for info, radar, prox, status, and fleetradar
[Holocron3D] bridge is ready: network-bridge
[Holocron3D] Mudlet and the bridge are connected.
[Holocron3D] WebSocket endpoint: ws://127.0.0.1:8787
[Holocron3D] 3D renderer: http://127.0.0.1:8788
[Holocron3D] Telemetry polling is automatic; commands remain available for manual refreshes.
```

The exact order of the last few lines can vary. That is normal.

At this point we have proven all of the plumbing needed for bidirectional
communication:

- Mudlet loaded our Lua proxy.
- Mudlet started an external bridge process.
- The bridge opened a loopback-only WebSocket endpoint.
- The bridge opened a loopback-only browser renderer.

## Step 6: Collect live LotJ space data

Enter a ship cockpit or other location where LotJ permits the space-information
commands. Polling begins automatically. For an immediate visible refresh, these
commands may still be typed normally:

```text
status
info
radar
prox
prox velocity
fleetradar
```

Holocron3D does not hide or alter their output. After each successful response,
you should see a diagnostic similar to:

```text
[Holocron3D] parsed radar (4 data lines)
[Holocron3D] bridge received snapshot 1
```

To inspect the accumulated structured state inside Mudlet, run:

```lua
lua display(lotjHolocron3D.scraper.getSnapshot())
```

If Holocron3D says it could not parse a response, print the exact text it
captured with:

```lua
lua lotjHolocron3D.scraper.showLastCapture()
```

Copy that numbered capture so the parser can be adjusted to the live format.

Polling uses a one-second gap between commands and waits five seconds after a
complete cycle. It pauses while landed and resumes after launch. To control it:

```lua
lua lotjHolocron3D.scraper.stopPolling()
lua lotjHolocron3D.scraper.startPolling({commandGapSeconds = 1, cycleDelaySeconds = 5})
```

## Step 7: Open the 3D renderer

Open this address in a browser on the same computer:

```text
http://127.0.0.1:8788
```

The yellow observer dot remains fixed at the center of the scene. Contacts ease
between observations instead of jumping. Drag in the map to orbit, use the mouse wheel to zoom, click a dot to inspect it, and
press `F` to fit the whole observed system. Newly connected pages immediately
receive the latest snapshot, so the renderer may be opened before or after the
LotJ commands are run.

## Step 8: Stop the prototype

Paste this into Mudlet's command box and press **Enter**:

```lua
lua lotjHolocron3D.stop()
```

You can start it again at any time by repeating the command from Step 4.

## If something goes wrong

### Mudlet says it cannot open `start_prototype.lua`

Confirm the repository is located at exactly:

```text
C:\Users\bjork\OneDrive\Documents\GitHub\lotj-holocron-3D
```

If you moved it, update the path inside the Development Step 4 command. Continue using
forward slashes in the Mudlet command.

### Mudlet says the bridge could not start

Look for the line beginning with `Node program tried:`. The launcher could not
run that executable.

Install the current Node.js LTS release, restart Mudlet, and repeat Step 4. A
normal Node installation usually places the executable here:

```text
C:\Program Files\nodejs\node.exe
```

### Mudlet reports a Lua error

Copy the complete error text, including any filename and line number. The most
useful errors begin with one of these messages:

- `Holocron3D could not load its Mudlet proxy`
- `Bridge could not start`
- `invalid bridge JSON`

### Nothing appears

Make sure the command started with `lua ` and that you pressed Enter in Mudlet's
main command box. If Mudlet sent the text to LotJ instead, check for a typo before
`dofile`.

## Make it start automatically later

Do not configure automatic startup yet. First confirm that live captures parse
correctly. The temporary listeners are removed by `lotjHolocron3D.stop()` and
do not persist after Mudlet restarts. Once the live formats are confirmed, this
can be packaged as a Mudlet module.

## Developer reference: loading by hand

The beginner launcher performs these steps automatically. This lower-level form
is useful only while developing the proxy itself:

```lua
package.path = package.path
  .. ";C:/Users/bjork/OneDrive/Documents/GitHub/lotj-holocron-3D/mudlet/?.lua"

package.loaded["lotj_holocron_proxy"] = nil
lotjHolocron3D = require("lotj_holocron_proxy")
```

Actual game commands remain intentionally disabled. Later, each renderer action
will be mapped to a locally defined and validated Mudlet handler; the renderer
will never be allowed to submit arbitrary command text.
