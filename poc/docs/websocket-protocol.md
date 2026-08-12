# Third-party WebSocket protocol

Protocol version: `1`

The network bridge listens on `ws://127.0.0.1:8787` by default. Loopback binding
keeps the prototype inaccessible to other machines. Pass `--port=0` during tests
to request an ephemeral port.

The same process serves the browser renderer at `http://127.0.0.1:8788`. Pass
`--http-port=0` to request an ephemeral renderer port. `/config.json` tells the
browser which WebSocket endpoint belongs to that bridge instance.

Every message is a UTF-8 JSON object containing `v` and `type`.

## Bridge to client

- `bridge_ready`: sent when a client connects.
- `system_snapshot`: the latest observer, entities, and metadata from Mudlet.
- `space_state`: an immediate launch/landing transition.
- `intent_ack`: Mudlet's acceptance or rejection of a client intent.
- `client_error`: a client message failed bridge validation.

The latest `space_state` and `system_snapshot` are replayed when a new client
connects, so renderers do not need to wait for the next LotJ command.

Snapshot metadata includes polling state and the most recent source command.
Renderers may interpolate toward snapshots for presentation, but interpolated
values are never authoritative game observations.

## Client to bridge

Clients may send only a typed `intent`:

```json
{
  "v": 1,
  "type": "intent",
  "id": "renderer-204",
  "action": "prototype_ping",
  "payload": {"message":"hello from a client"}
}
```

The bridge validates message shape and forwards the intent to Mudlet. Mudlet
then applies its local action allowlist. Literal game commands are rejected at
both boundaries.

Prototype limits:

- maximum eight simultaneous clients;
- maximum 64 KiB per client message;
- text JSON only; binary frames are rejected;
- no remote binding, authentication, or TLS yet.
