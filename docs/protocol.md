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
  "proxyVersion": "0.1.0"
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
  "observer": {"id":"player-ship","x":1250,"y":-400,"z":80},
  "entities": [
    {"id":"ship-123","kind":"ship","name":"YT-1300","x":1500,"y":-250,"z":110}
  ],
  "metadata": {"system":"Prototype"}
}
```

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

`status` is `accepted` or `rejected`. Rejections include a human-readable
`reason`. Acceptance is not game-level confirmation.

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
  "action": "navigate",
  "payload": {"destination":{"x":12500,"y":-8200,"z":450}}
}
```

Mudlet rejects malformed messages, unknown actions, duplicate IDs, and handler
errors. Authorization and command translation live entirely in Mudlet.

## Compatibility rules

- Unknown message types are ignored and reported through the proxy diagnostic
  callback.
- Additive fields are allowed.
- A different `v` is rejected rather than guessed.
- Messages larger than the proxy limits are discarded.
