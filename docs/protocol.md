# Mudlet bridge protocol

Protocol version: `1`

This document covers the private Mudlet/native-relay stream. The retired browser
POC protocol notes are preserved in `poc/docs/websocket-protocol.md`.

The Mudlet proxy and bridge exchange UTF-8 newline-delimited JSON. Each JSON
object occupies exactly one line. Writers must append `\n`; readers must retain
incomplete chunks until a newline arrives.

Mudlet's `spawn()` process wrapper merges the child's stdout and stderr. The
bridge must therefore encode **every** emitted line as a protocol message;
plaintext diagnostics on stderr would corrupt the stream. Use
`bridge_diagnostic` messages for logs intended for Mudlet.

Every message has these fields:

```json
{"v":1,"type":"hello"}
```

- `v`: protocol version.
- `type`: message discriminator.

## Mudlet to bridge

### `hello`

Sent when Mudlet starts the child process.

```json
{
  "v": 1,
  "type": "hello",
  "source": "mudlet",
  "proxyVersion": "0.1.3"
}
```

### `system_snapshot`

An authoritative observation assembled from one completed LotJ poll. Coordinates
remain in game/world units; projection belongs to the renderer.

```json
{
  "v": 1,
  "type": "system_snapshot",
  "sequence": 12,
  "observedAt": 1786359123,
  "observer": {"id":"player-ship","x":1250,"y":-400,"z":80,"sensorArray":7,"radarRange":570},
  "entities": [
    {"id":"ship-123","kind":"ship","name":"YT-1300","x":1500,"y":-250,"z":110}
  ],
  "metadata": {"system":"Prototype"}
}
```

`radarRange` represents the maximum range at which the observer can issue
remote `status` and `info` scans. It is always at least 500 units and grows as
`500 + (10 × sensorArray)`. Sensor strength may also unlock details such as
onboard lifeform counts. The parser publishes structured `statusCard` and
`infoCard` sections for the renderer's local ship dossier, including the access
codes returned by LotJ. Raw `info` output is still excluded from capture
diagnostics. An observer whose parsed
offensive weapon and armed-launcher counts are all zero publishes
`hasWeapons: false`, allowing both Mudlet and the renderer to block target orders.

Ship entities may also contain `shipCategory` (`Starfighter`, `Transport`,
`Frigate`, and so on), `disposition` (`neutral`, `ally`, or `enemy`), and safe
fields obtained from targeted status scans such as `hull`, `shields`, `speed`,
`target`, `lifeformScan`, `statusCard`, and `infoCard`. A lifeform scan that lacks sufficient sensors is
represented as unavailable with its required sensor count rather than as an
empty ship.

### `intent_ack`

Reports whether Mudlet accepted an intent for local handling.

```json
{
  "v": 1,
  "type": "intent_ack",
  "id": "cmd-204",
  "status": "accepted"
}
```

`status` is `accepted`, `rejected`, or `completed`. Rejections include a
human-readable `reason`. Initial acceptance confirms only local dispatch;
long-running operations such as course changes may later emit `completed` with
the same intent ID when LotJ reports their completion.

### `galaxy_catalog`

Publishes the live `gmcp.Galaxy.Systems` hierarchy independently of tactical
snapshots. `systems` contains timeline-owned systems and planets;
`customSystems` contains an optional read-only import from the official LotJ
Mudlet UI's personal registry. `shipSystem` is the current GMCP galactic
location. Clients must treat all three collections as dynamic.

```json
{"v":1,"type":"galaxy_catalog","systems":{"Esstran Sector":{"x":92,"y":12,"Dromund Kaas":{"x":0,"y":0,"z":0,"government":"Red"}}}}
```

### `shutdown`

Requests graceful bridge termination before Mudlet closes the process handle.

### `space_state`

Notifies the bridge immediately when the observer launches or lands. A landed
notification tells clients to stop presenting the previous space scene.

```json
{"v":1,"type":"space_state","observedAt":1786359123,"inSpace":false,"reason":"landing sequence complete"}
```

## Bridge to Mudlet

### `ready`

Confirms that the child initialized and states its protocol version.

```json
{"v":1,"type":"ready","bridge":"electron-host","websocketUrl":"ws://127.0.0.1:8787","renderer":"electron"}
```

`websocketUrl` is optional. The Electron/Mudlet pipe becomes ready immediately
after authentication; failure to bind the third-party compatibility WebSocket
must not block the primary desktop connection.

### `bridge_diagnostic`

Carries child-process logging without placing non-JSON text on the merged process
stream.

```json
{"v":1,"type":"bridge_diagnostic","level":"info","message":"bridge started"}
```

### `space_state_received`

Acknowledges receipt of `space_state` in bridges that support acknowledgements.

```json
{"v":1,"type":"space_state_received","inSpace":false}
```

### `intent`

Requests a named operation. The bridge cannot provide a literal game command.

```json
{
  "v": 1,
  "type": "intent",
  "id": "cmd-204",
  "action": "navigate_ship",
  "payload": {"mode":"relative","vector":{"x":500,"y":-120,"z":900}}
}
```

Mudlet rejects malformed messages, unknown actions, duplicate IDs, and handler
errors. Authorization and command translation live entirely in Mudlet.

`probe_space` has an empty payload and is issued once by the renderer after its
startup sequence completes and the Mudlet bridge is connected. Mudlet sends one
hidden `radar` command. A valid radar response establishes the in-space state
and starts the normal polling queue; an invalid or landed response disables ship
scraping and clears stale contacts. The renderer retries once after each bridge
reconnection.

`navigate_ship` accepts one of three typed payloads: a non-zero `relative`
vector, a current snapshot `targetId`, or an `away` order with a current snapshot
`targetId`. Speed changes use a separate `set_ship_speed` intent whose numeric
value must fall between zero and the observer's known maximum. Mudlet resolves
target names locally; the renderer can never supply a literal command string.
Navigation and speed are rejected unless the scraper has positively established
that the player ship is in space.

When the observer is stopped, `navigate_ship` may include a validated non-zero
`departureSpeed`. Mudlet sends that speed immediately before the course command,
allowing the renderer to stage both values as one departure order without racing
an independent speed intent against the maneuver lock.

Course intents keep telemetry polling and navigation controls paused until
LotJ prints `Maneuver complete.`. Mudlet then publishes a `completed`
acknowledgement using the original intent ID. Rejection output and a bounded
safety timeout also release the controls.

`scan_ship` accepts a current snapshot `targetId` and a `source` of either
`status` or `info`. Mudlet resolves the contact name, verifies that it is a ship
inside the observer's calculated sensor range, interrupts only a hidden
background capture, and publishes the parsed result before normal polling
resumes. A stale position that LotJ rejects as too distant produces a later
`intent_ack` rejection with the original intent ID.

`target_ship` accepts only a current ship `targetId`. Mudlet resolves the ship
name locally, interrupts only a hidden background capture, and issues LotJ's
`target <ship name>` command. An accepted target order marks the contact as an
enemy in both the authoritative snapshot and the renderer's persistent local
disposition store. Supplying a literal command or arbitrary target name is not
supported.

`scan_ship` info responses are identity-checked against the requested ship.
Only canonical overview, weapons, access-code, and systems fields with valid
value shapes are published. Unknown labels and Mudlet prompt fields are
discarded, and wrapped descriptive prose is normalized into one paragraph.

Target ownership is published in `system_snapshot.metadata.combatTargets`.
Entries are keyed by command scope (`local`, `fleet`, `wings`, `squadron`, or
`selected:<member id>`) and include the target name plus an owner label. The
legacy `metadata.combatTarget` remains the local cockpit's weapon target, so a
battlegroup target order cannot overwrite the player ship's independent lock.

`set_autotrack` accepts a boolean `enabled`. Because LotJ's `autotrack` command
is itself a toggle, Mudlet does not infer success from dispatch. It captures the
authoritative `Autotracking on.` or `Autotracking off.` response, publishes the
observed value on the observer, and completes the intent only after the desired
state is confirmed. If the first response is opposite the requested state,
Mudlet sends one corrective toggle. Targeting defaults to an enabled desired
state unless the player has explicitly switched that preference off.

Hyperspace uses typed `plot_hyperspace`, `stop_hyperspace`,
`engage_hyperdrive`, `escape_hyperspace`, and `refresh_navigation` intents. A local route contains
only bounded system coordinates. A galactic route additionally contains the
galactic X/Y location. Mudlet constructs `calculate` commands from those
validated numbers and never accepts a command string from Electron.

`system_snapshot.metadata.hyperspace` reports calculation, fuel-warning,
ready, engagement, transit, reentry, arrival, and failure states.
`metadata.navigation` carries parsed `navstat` and `calculate` destination-list
information. If an Electron-initiated route reports insufficient fuel, Mudlet
sends `calc stop` unless the payload explicitly acknowledges that risk.
During confirmed hyperspace transit, `escape_hyperspace` issues the explicit
`hyper off` command. Mudlet rejects that intent outside the `hyperspace` phase.

### `automation_lease`

Electron renews a short automation lease every two seconds. Mudlet disarms
polling, recharge loops, queued commands, and renderer-owned automation if the
lease expires. A lease never stores or executes an escape plan in Lua; escape
routing remains Electron-owned and can never engage the hyperdrive without a
current user action.

## Compatibility rules

- Unknown message types are ignored and reported through the proxy diagnostic
  callback.
- Additive fields are allowed.
- A different `v` is rejected rather than guessed.
- Messages larger than the proxy limits are discarded.
