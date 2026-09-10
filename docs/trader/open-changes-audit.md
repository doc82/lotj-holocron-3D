# Open changes audit — 2026-09-07

> Implementation follow-up: flight milestone progression/manual assistance, ground-location and ship checks, full-App Escape/workspace fixes, static itinerary validation plus live preflight, cancel/clear, polling failure cleanup, and a longer outer deadline have since been implemented. See [the current test guide](AUTOPILOT_TEST.md). Findings below preserve the audit baseline; arbitrary room/GMCP recovery and suitable-pad fallback remain limitations.

## Verdict

The architecture is a useful foundation, but the current implementation is not ready to call a solid end-to-end autopilot. Correct the execution and integration findings below before the first cargo circuit. No production code was changed during this audit and no game commands were sent.

Scope: tracked changes and new feature files, including the versioned topology and generated artifacts, market parsing/capture and archive, route optimization, manual/review/save workflow, configuration, reusable mission runner, Electron transport, Mudlet navigation, bootstrap/package wiring, and their tests. This is a source and automated-behavior audit, not a completed live flight.

## Findings

### 1. High — most asynchronous flight events still require a subsequent prompt

`mudlet/lotj_holocron_navigation.lua:266` only sets `active.matched` for launch, calculation completion, orbit and touchdown. Only hyperspace completion explicitly advances from its event. `prompt()` at line 284 gates the remaining steps. A valid event without another prompt waits until timeout, stopping an otherwise successful flight.

Reproduced against the actual Lua module with its existing test fixture:

```text
After launch event without prompt: launch
After later prompt: calculate "Wroona System" 389 489 589
```

Make single-event completion advance without requiring a prompt. Keep prompt/boundary collection for multi-line queries. Add missing-prompt tests for every flight event. This finding remains unresolved from `docs/trader/history/autopilot-followup-review.md`; the clearance change fixed hyperspace exit only.

### 2. High — ship access and movement advance without positive confirmation

`mudlet/lotj_holocron_navigation.lua:597` and the surrounding entry/exit sequence issue boarding, directions, pilot, hatch and leave commands without success matchers. A prompt advances each command unless one of the generic failure strings was detected. Configuration validation does not prove that boarding or movement happened.

Reproduced:

```text
Before unconfirmed boarding: enter "Sunrise"
After bare prompt: close
```

The normal flight test supplies `Done.` and a prompt for these steps. It therefore validates ordering, not actual ship/control access. Add fresh aboard/cockpit/outside observations and explicit movement failure handling before launch and commerce. A cargo readout alone is not independent proof that the character has left the ship. This also remains unresolved from the earlier review.

### 3. Medium — Escape bypasses the cancellation modal in the real app

`renderer/src/app/App.tsx:487` handles Escape by closing Trader, and line 519 registers that listener on the window in the capture phase. It runs before the dialog's React handlers, prevents the native cancel event and stops propagation. Escape therefore closes the entire workspace, including any creation draft, instead of dismissing only the confirmation.

The earlier isolated modal test did not include this App listener; its successful Escape check was insufficient. Let the topmost dialog own Escape and cover this through the real App integration. The cancellation confirm button itself is connected to the existing abort behavior; this finding concerns dismissal and lost workspace state.

### 4. Medium — launch and landing remount the workspace and reset its selected page

`renderer/src/app/App.tsx:613` switches between separate landed and space trees, each containing Trader at a different position (lines 625 and 719). `TraderWorkspace.tsx:49` initializes its tab to Route Planner on mount. As telemetry crosses the landed/space boundary, the open workspace is recreated and the Active route selection is lost. An open draft is also lost.

The runner lives above that conditional and continues, so this does not itself abort flight. It does remove the status page the user is watching. Render one stable workspace outside the conditional scene trees and test launch/touchdown transitions with Active route and a draft open.

### 5. Medium — a known impossible manual itinerary can buy cargo before it is rejected

`renderer/src/domain/manualCargoRoute.ts:80` checks sector distance but not topology. All reviewed routes are rebuilt through this compiler. Neither mission preparation nor initial reconciliation checks the complete remaining itinerary; the first live lane check occurs inside the later navigation operation.

Reproduced: Corellia → Tatooine → Corellia compiles at maximum distance 50 even though `navigationJump("Corellia", "Tatooine", [], true)` rejects the observed No Path direction. The initial refuel and purchase can execute before navigation discovers the blockage.

Validate known blocked connections in the editor and mission preparation. Refresh relevant temporary conditions before the first purchase, while retaining per-jump checks. Preserve the deliberate ability to explore unverified directions in manual mode; distinguish those from known blocked connections.

### 6. Medium — archived temporary lane status never expires in planning

`renderer/src/features/trader/marketArchive.ts:43` retains the latest lane reading and `TraderWorkspace.tsx:137` passes it directly to planning. The observation timestamp is displayed but never used to mark the reading stale. `navigationJump` rejects an explicitly stale status, but no archive age policy produces that status.

Reproduced: a Passable reading with `hyperlanesObservedAt: 1` still authorizes Corellia → Wroona. This conflicts with the freshness policy in `CLAUDE.md`. Mudlet's fresh check before departure prevents blindly flying that stored edge, but the shortlist and purchase decision can still depend on obsolete availability.

Define a lane freshness policy independently of market age. Expire or explicitly require revalidation of cached temporary connections; recalculating routes should not require refreshing every market price.

### 7. Medium — the outer flight timeout is shorter than the supported stage budget

`renderer/src/features/autopilot/RouteRunner.ts:42` allows 15 minutes for the entire operation. Lua permits 15 minutes for hyperspace and another 15 for approach, plus launch, calculation, landing and queries. The renderer can cancel a progressing flight while Lua is still within a valid stage deadline.

Use consistent operation/stage budgets, or renew a bounded deadline from validated progress. Test a flight exceeding 15 minutes in total while every individual stage remains within its limit.

### 8. Medium — automatic landing selects the first pad without checking suitability

`mudlet/lotj_holocron_navigation.lua:662` accepts either an All Sizes or Max-size pad and immediately selects the first match. It does not compare the size limit to the ship or try another candidate on restriction. A usable second pad will not be reached if the first is unsuitable.

Use explicit known accessible pads for a controlled test. For the advertised automatic option, implement bounded suitable-pad selection and exhaustion handling. This behavior is documented in the test guide, but remains an incomplete automatic workflow.

### 9. Medium — rejected/failed operations can leave normal polling owned and paused

`mudlet/lotj_holocron_scraper.lua:8870` acquires polling ownership before `Navigation.start` succeeds. The finish callback at line 8569 publishes failure without releasing ownership. Restoration occurs in `route_stop` at line 8882. A rejected start or a Lua-reported blocked operation can finish the renderer transport without sending that stop, leaving normal telemetry paused until the user explicitly cancels the run.

Release ownership on failed start and terminal blocked/interrupted operations, preserving the previous pause preference. Keep ownership across successful operations in the same active run. Test validation rejection, explicit game failure and loss of the automation lease, not just successful completion and user cancellation.

## What is working well

- The authoritative galaxy artifact feeds both planners and Mudlet. Directed evidence, range limits and the five bidirectional temporary controls are separate; unknown edges are not assumed open by automatic planning.
- The freighter search considers purchases and sales on return legs, with distance/stop timing. Its bounded shortlist and excluded fuel/credit costs are disclosed.
- Cargo actions compile into a generic navigation mission. The runner persists pending operations before dispatch, correlates confirmations, freezes mission data, and requires reconciliation on restoration rather than blindly replaying purchases.
- Clearance recovery uses fresh proximity, the shared 500-unit threshold and a cancellable ten-check limit.
- Cargo and contraband confirmations validate action, mode, resource and quantity. Current cargo, credits and purchase price are checked before trading.
- Market observations are archived separately from current state; ships, pads and saved routes persist locally. Save failure keeps the route draft open.
- The dedicated creation workflow and separate saved/active route views are a substantial improvement. The remaining App-level integration gaps need coverage.
- Bootstrap and package generation include the navigation modules; topology validation and generated-file consistency checks pass.

## Validation and practical limits

- `pnpm.cmd test`: **179 passed**, including renderer build.
- `pnpm.cmd test:lua`: **216 passed** on Lua 5.1.
- `pnpm.cmd check`: passed formatting, type checking, source checks and topology consistency (era 2026-09, revision 2; 15 nodes, 44 directed permanent edges).
- Additional source-module probes reproduced findings 1, 2, 5 and 6. Findings 3 and 4 follow from App event registration/component placement; the earlier component-only browser test does not cover them.
- No live Mudlet session or completed cargo circuit was exercised. No package was rebuilt or installed during the audit.
- Only seven origins have flight evidence; automatic routing intentionally excludes unverified return directions. This data limitation is not a planner defect.
- Recovery still requires the user outside the ship at the expected stop. Arbitrary cockpit/in-flight recovery and independent station recovery remain unimplemented. Uncertain interrupted cargo transactions intentionally block.
- Realized profit/hour is still absent. `AUTOPILOT_TEST.md` also has stale wording listing contraband execution as future work despite its implementation; update readiness documentation with the fixes.

## Recommended order

1. Fix event progression and physical access confirmation; add realistic response fixtures without synthetic success prompts.
2. Fix App-level Escape handling and preserve the workspace across launch/landing. Verify the complete workflow through App, including cancellation.
3. Validate the itinerary before purchases; separate lane refresh/freshness from market refresh.
4. Align deadlines and restore polling on all failure paths. Either finish automatic pad selection or require a verified pad for the first trial.
5. Re-run checks, rebuild the Mudlet package, then conduct a supervised small-load circuit with known pads, a return purchase/sale, a pause/resume and a confirmed cancellation.
