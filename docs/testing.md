# Testing Holocron3D

Run the complete portable gate before opening a pull request:

```text
pnpm test:all
```

This runs type and syntax checks, Node and renderer tests, Go relay tests, and
the Lua 5.1 parser/scraper suite.

## Lua 5.1 on Windows

The Lua suite intentionally targets Mudlet's Lua 5.1 runtime. The launcher
rejects newer Lua versions so a locally green result cannot conceal a runtime
compatibility problem.

The recommended Windows setup is WSL with Ubuntu:

```powershell
wsl --install -d Ubuntu
```

Then install Lua inside Ubuntu:

```text
sudo apt update
sudo apt install -y lua5.1
```

`pnpm test:lua` searches for `lua5.1`, then `lua`, then `wsl lua5.1` on
Windows. To use a portable interpreter explicitly, set `LUA_BIN` to its full
path before running the command.

## Running Lua tests

Run every Lua spec:

```text
pnpm test:lua
```

Run one spec file:

```text
pnpm test:lua -- --file scraper_polling_spec
```

Run tests whose full suite/name contains a phrase:

```text
pnpm test:lua -- --filter "first-contact hydration"
```

File and filter options can be combined. A filter that selects no tests fails
the command rather than reporting a misleading success.

## Lua suite architecture

`tests/lua/run.lua` loads spec files in a fixed order. The small test harness in
`tests/lua/support/harness.lua` provides named suites, named tests, per-test
setup and teardown, filtering, and failure isolation without adding a LuaRocks
dependency.

Scraper specs construct `MudletFixture` in `before_each` and close it in
`after_each`. Every test receives fresh:

- loaded parser and scraper modules;
- Mudlet event handlers and triggers;
- timers and sent-command history;
- proxy intent handlers and acknowledgements;
- snapshots, diagnostics, GMCP, and space state.

Teardown runs even when a test assertion fails. Tests must not depend on a
snapshot index, timer, command, or mutation created by another test.

Add new behavior to the narrowest relevant spec. Prefer one observable behavior
per `it` block and assert through the public parser, scraper, intent, snapshot,
or command interfaces. Extend `MudletFixture` only for reusable Mudlet behavior;
do not add scenario-specific state to the shared fixture.
