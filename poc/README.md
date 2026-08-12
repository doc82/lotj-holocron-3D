# Proof-of-concept archive

This directory preserves the pre-Electron transport and browser-hosting proof
of concept. It is not part of the supported Windows runtime or installer.

- `tools/network-bridge.mjs` is the original Node pipe/WebSocket/HTTP bridge.
- `tools/mock-bridge.mjs` is its dependency-free pipe test double.
- `tools/websocket-observer.mjs` is the original command-line observer.
- `mudlet/start_prototype.lua` is the repository-based development launcher.
- `tests/` contains regression coverage for the legacy bridges.
- `docs/websocket-protocol.md` documents the browser POC behavior.

The POC remains runnable for regression work, but production development belongs
in `electron/`, `relay/`, `renderer/`, `mudlet/`, and `mudlet-package/`.
