# Autoflight implementation review — 2026-09-09

Reviewed mission construction, checkpoint transitions and persistence, renderer
transport and cancellation, Mudlet operation dispatch, polling ownership, ground
checks, cargo transactions, flight milestones, landing and interrupted-flight
recovery. This is a source and automated-test review, not a completed live circuit.
Private flight logs and discovered locations are not included here.

## Remaining findings

1. **High — station stops do not have a complete station arrival contract.**
   `useRouteAutopilot` creates station destinations, and the Lua navigator can
   calculate toward their coordinates. However, `location()` and reconciliation
   require a `showplanet` result whose planet equals the destination name. The
   final arrival checks also use this path. A station waypoint cannot be verified
   as a planet. Station-specific docking, exterior-location and service evidence
   need their own implementation and tests; station routes should be rejected
   before commerce until that exists.

2. **High — prelaunch recovery expects the future destination.**
   A pending `navigate` operation already names the next stop. If navigation is
   interrupted before `flightStarted`, the suspended-flight recovery branch does
   not apply. Ordinary reconciliation then requires the next stop's planet, even
   though the ship is still at the departure stop. This blocks safe retry from the
   origin. Recovery needs explicit departure-versus-arrival evidence and a
   corresponding renderer confirmation contract; it must not mark travel complete
   merely because departure was verified.

3. **Medium — plotted arrival offsets can exceed coordinate limits.**
   The Lua calculation adds 289 to each destination axis without checking the
   resulting coordinate against the supported local range. A valid destination
   near the positive boundary can therefore produce an invalid jump command.
   Choose a bounded offset while preserving stellar clearance, and test boundary
   destinations. This was identified by inspection, not in the supplied flight.

4. **Medium — some failure and recovery paths depend on prompts or manual help.**
   Boarding, movement and autopilot-toggle steps advance on a prompt without a
   positive success matcher. Recoverable maneuver failures now keep the flight
   active for manual assistance, and later milestones advance it. Explicitly
   paused flights still require Resume. Additional boarding/movement responses
   need tests with actual success/failure text rather than generic `Done.` replies.

5. **Low — redundant service checks remain.**
   Navigation refuels before departure and after arrival; cargo missions also
   request refueling at every stop. Landing-pad and cargo inspections repeat
   across operations. Some checks protect against external movement or trading;
   reducing them safely needs short-lived evidence invalidated by those actions.

## Fixed during this review

- Invalid movement directions now fail at mission preparation and Mudlet
  reconciliation, before purchases. Previously they were checked only while
  constructing the later flight operation.
- Cargo quantities must be positive safe integers at mission preparation; the
  Lua transaction boundary also rejects values above the safe integer limit.
- Manual routes validate every leg's configured range before commerce, in both
  mission preparation and Mudlet itinerary reconciliation. Per-leg checks remain.
- Rejected duplicate navigation requests preserve the active driver's polling
  ownership instead of restoring background polling mid-operation.
- An arrival confirmed immediately before pausing survives resume and proceeds
  to system verification without another arrival event or repeated jump.
- Updated an old source assertion that still required six-second fleet radar
  polling after the earlier change to fifteen seconds.
- Corrected outgoing-command classification so internally dispatched commands
  are recognized before the external-command cancellation path. Added a
  planet-flight integration test using registered line/prompt callbacks and
  outgoing command events from reconciliation through landed arrival, including
  an internal command while waiting for a navigation readout. Earlier fixtures
  recorded sends without exercising that outgoing callback.
- Compared the milestone behavior against the supplied AutoPilot launch,
  calculate, hyperspace-exit, orbit and landing triggers. After departure checks,
  a manual launch now advances to calculation even if the driver never issued
  launch. Failed flight maneuvers remain recoverable in the active run; manual
  controls and launch commands no longer cancel it. Orbit after a missed exit
  requires system verification before landing, and observed landing can skip a
  missed orbit event while retaining final planet/ship checks before commerce.
  Duplicate milestones no longer cancel the queued continuation.
- Normal player commands during the prepared flight no longer cancel navigation.
  Chat, inventory, equipment, interior movement and manual maneuvers are allowed;
  observed milestones still drive progress and final location checks gate trade.
  Unrelated generic action failures do not put the flight into maneuver recovery,
  and output arriving after a confirmed milestone cannot undo its continuation.
  Ground commerce retains its interruption/reconciliation checks.

## Validation and limits

The JavaScript suite, Lua suite and renderer typecheck are run for these changes.
New cases cover invalid paths, invalid quantities, later out-of-range manual
legs, duplicate intent ownership and pausing between a confirmation and its
deferred next step. Existing cases cover complete cargo circuits, prompt-free
transactions, wrong arrivals, clearance retries, cancellation, uncertain
purchases, storage failures and transport confirmation matching.

The fixtures do not emulate the full game or prove live station support. They
also do not yet exercise every recovery phase through a real renderer-to-Mudlet
connection. Passing these tests does not close the remaining findings above.
