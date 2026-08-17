# Current capabilities

Holocron3D's desktop pipeline has been validated against live Legends of the
Jedi output. Its current capabilities include:

- Parsing live `info`, `radar`, `prox`, `prox velocity`, `status`, and
  `fleetradar` output.
- Using `fleetradar` as the normal moving-ship feed, reconciling the complete
  `radar` contact list every 60 seconds, and switching to fast
  `radar projectiles` updates during combat. Contact proximity is derived from
  coordinates, avoiding redundant `prox` and `prox velocity` captures.
- Probing with one hidden `radar` after startup and Mudlet connection; recurring
  ship scraping starts only when that response confirms the player is in space.
- Preserving manually entered command output for normal Mudlet use.
- Tracking the player ship separately from radar contacts and updating its
  position, heading, speed, hull, shields, energy, class, and condition when
  available.
- Merging ships, celestial bodies, fleet positions, distance, velocity, and
  system metadata into authoritative snapshots.
- Detecting launch and landing state, pausing polling while landed, and clearing
  stale space presentation. Automatic command output can also be explicitly
  paused and resumed from Mudlet or the tactical UI without disconnecting the
  bridge; the UI clearly marks the retained snapshot as potentially stale.
- Rendering procedural low-poly 3D hulls with an observer-locked
  Homeworld-style orbit camera. Each LotJ ship class has a distinct generated
  model, and known heading vectors orient those models in three dimensions.
- Deriving remote `status`/`info` scan range as `500 + (10 × Sensor Array)` and
  rendering it as a toggleable blue sensor bubble instead of an infinite floor
  grid.
- Providing an optional three-plane coordinate grid centered on the system's
  true `0 / 0 / 0`. It extends at least 3,000 units along every positive and
  negative axis, then expands with coarser spacing for strategic-scale
  coordinates.
- Collapsing contacts at identical coordinates into a larger numbered marker,
  including planets colocated with orbiting ships. Clicking it opens a member
  grid; hovering previews a contact and clicking pins its details.
- Scanning in-range ships with targeted `status` and `info` requests. Enemy
  status is prioritized every four seconds by default; other status and safe
  identity info refresh every ten seconds, subject to Mudlet's serialized
  command queue.
- Providing `SCAN` and `INFO` controls for a selected ship so the player can
  immediately refresh its parsed telemetry without waiting for the automatic
  scan queue. Manual scans preempt only hidden polling and report range failures
  in the command panel.
- Switching the command bank to the selected ship's context, with `SCAN`,
  `INFO`, course-to, course-away, and aggressive `TARGET` actions. Target orders
  are resolved safely inside Mudlet and persistently mark the selected ship as
  enemy.
- Providing an authoritative autotrack switch. Combat targeting defaults to
  requesting autotrack, and the UI changes state only after LotJ returns
  `Autotracking on.` or `Autotracking off.`; an opposite toggle response is
  corrected once automatically.
- Using icon-first command controls with keyboard-accessible hover/focus labels,
  including the radar, origin-grid, and sector-view controls.
- Restoring the player-ship command context when empty space, the observer, or
  an already-selected contact is clicked. A cyan-white center reticle and
  persistent `YOUR SHIP` label distinguish the observer from neutral yellow
  contacts.
- Persisting neutral, friendly, and enemy ship dispositions by ship name.
  Neutral markers are yellow, friendly markers blue, and enemies red.
- Using strategic zoom inspired by large-scale space RTS games. Distant hulls
  collapse into compact glowing disposition-colored contacts; scrolling inward
  cross-fades them back into shaded 3D models.
- Using a Homeworld-inspired command deck: selected-contact commands on the
  left, selected vessel telemetry in the center, and a formation roster on the
  right. Active battlegroups and squadrons expose parsed member health,
  location, role, autopilot/order state, and command scopes appropriate to the
  player's role.
- Providing a first pass on formation commands. Battlegroup commanders can
  issue scoped movement, speed, targeting, weapon, shield, chaff, and autopilot
  orders to the whole fleet, all wings, or any highlighted subset of individual
  roster cards. An adjacent select-all control restores the full fleet selection;
  squadron leads can issue the lead-ship actions supported by LotJ plus
  squadron roll, chaff, Fire Assist, and subsystem-aim orders. Squadron wings
  continue to inherit navigation, targeting, and fire behavior from the lead
  ship.
- Allowing a battlegroup commander to request an isolated radar view from one
  wing ship through a dedicated camera-lock icon, pivot the tactical scene to
  that remote observer without changing command recipients, and safely use
  contacts from that view in selected-member target and navigation orders.
- Providing player-ship navigation orders from the command deck. `M` opens a
  Homeworld-style course vector: pointer movement chooses X/Z, holding Shift
  adjusts Y, and a blue arrow previews the continuing heading. Selected ships
  and planets can also be used for direct `course` or confirmed `course away`
  orders. The speed dial initializes from the ship's current velocity and sends
  a separate `speed` order when released or when a preset is selected. Rejected
  maneuver orders flash in the command panel, including LotJ's active-maneuver
  cooldown response. Course controls unlock from LotJ's authoritative
  `Maneuver complete.` output, with a safety timeout preventing a stranded UI.
- Showing distance, world coordinates, and shield/hull bars in hover cards.
  Missing health information is explicitly rendered as a gray
  `UNKNOWN // ?` state.
- Opening structured status and info dossiers for the local ship, formation
  members, and selected target. Cards include the systems, weapons, storage,
  ownership, and access-code fields returned by LotJ, while raw info output is
  still redacted from capture diagnostics. Confirmed unarmed player ships cannot
  issue target orders, and the disabled target icon explains why on hover.
- Interpolating contact movement between telemetry ticks.
- Opening with a cinematic gold-title and hyperspace transition into the
  tactical view.
- Presenting a dedicated captain-facing uplink standby display while Mudlet is
  disconnected.
- Supporting player-follow, selected-contact, and free RTS cameras, continuous
  strategic zoom, one-click sector view, hover details, and contact selection.
  The RTS camera pans with WASD and changes elevation with Q/E.
- Replaying the latest snapshot to newly connected local clients.
- Packaging the Mudlet integration and a platform-native relay inside Windows
  and macOS releases.
- Keeping normal Mudlet output quiet while retaining warnings and errors.
  Detailed bridge/parser traffic is opt-in with `h3d debug on`.
- Distinguishing the player ship from formation hyperspace departures and
  rendering observed wing-ship jumps as tactical-map streak, flare, and fade
  effects.
- Detecting named ships that explode in a blinding flash, immediately removing
  the destroyed contact and rendering its last known position as a white-hot
  fireball with expanding shockwaves, secondary bursts, and glowing debris.

## Known limitations

- Windows x64 and macOS Intel/Apple Silicon are supported release targets.
- Windows and macOS release artifacts are currently unsigned.
- Contact visuals are intentionally simple points rather than detailed ship
  models at strategic zoom levels.
- Active enemy scans and detailed weapons, subsystem, crew, and sensor-quality
  metadata are deferred.
- Parsers may need adjustment when LotJ changes command output formatting.
- The third-party WebSocket interface is local-only and remains a compatibility
  surface rather than the primary renderer transport.

Planned work is tracked in the [product roadmap](roadmap.md).
