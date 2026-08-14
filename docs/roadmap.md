# Product roadmap

## Completed foundation

- Mudlet child-process transport with newline-delimited JSON framing.
- Safe typed-intent boundary from external clients back to Mudlet.
- Live parsing and snapshot merging for radar, proximity, velocity, status, and
  fleet radar; automatic polling derives proximity from coordinates instead of
  issuing redundant proximity commands.
- Tiered spatial polling: fleetradar tracks ordinary ship movement, full radar
  periodically reconciles celestial and omitted contacts, and projectile radar
  becomes the high-frequency combat feed.
- Launch/landing state propagation and stale-scene clearing.

## Completed network milestone

- Broadcast snapshots and launch/landing state over a localhost WebSocket.
- Replay the latest known state to newly connected clients.
- Accept only validated typed intents from network clients; never accept raw
  game commands.
- Exercise the complete Mudlet-pipe/WebSocket round trip with a mock client.

## Completed renderer milestone

- Interactive WebGL system view built from authoritative snapshots.
- Observer-locked orbit camera with pitch, rotation, zoom, and system fitting.
- Sequential read-only telemetry polling and eased movement between snapshots.
- Contact type and fleet-position color cues, hover inspection, selection, and
  landed-state handling.
- Preserve LotJ world units in the protocol and project them only in the renderer.

## Completed Windows desktop milestone

- Electron-hosted renderer with sandboxed, context-isolated IPC.
- Native Go relay so installed users do not need Node.js.
- Per-user relay authentication, stable application-data paths, and structured logs.
- Electron Forge/Squirrel packaging with hardened production fuses.
- Installed-app and development-host discovery from the Mudlet launcher.
- AutoPilot-style Muddler package embedded in the Windows installer.
- Successful live LotJ-to-Mudlet-to-Electron end-to-end validation.

## Current core-experience milestone

- Add labels, velocity vectors, and stronger spatial orientation cues.
- Expand selection details and targeting-oriented UI interactions.
- Communicate observation freshness, confidence, and sensor uncertainty.
- Add product icons and Windows code signing before public distribution.
- Exercise installation and upgrades in a clean Windows VM.

## Hyperspace navigation milestone

- Parse `navstat`, destination listings, calculation countdowns, fuel checks,
  cancellation, engagement, transit, and realspace reentry.
- Provide full-screen local and galactic route planners backed by live GMCP
  systems, planets, governments, and personal charts.
- Plot safe 500-unit planet arrivals with editable stand-off distances.
- Support an optional, Electron-owned escape leg that calculates only after the
  expected primary system arrival and never engages automatically.
- Offer escape planning for both local and galactic primary jumps. Known OOR
  systems are excluded, while exact and randomized galactic coordinates must
  remain inside the ship's conservatively confirmed `calculate` range.
- Abort unacknowledged insufficient-fuel calculations and require explicit
  confirmation before calculating or engaging anyway.
- Render seeded rotating planet previews and progressively improve them toward
  full tactical WebGL planet materials.

## Deferred advanced scan metadata

Add active enemy-ship scans whose results depend on the observer's installed
systems and scan strength. The normalized contact model should eventually hold:

- weapons, launchers, ammunition, and firing state;
- shield capacity, current shield strength, and shield state;
- hull and subsystem condition;
- current speed, heading, target, and tactical state;
- detected pilots or crew onboard, only when LotJ reveals that information;
- scan quality, observation time, source command, and which fields remain
  unknown because the observer's systems were insufficient.

The data model must distinguish `unknown` from a confirmed empty/zero value so
the renderer can communicate sensor uncertainty instead of inventing facts.
