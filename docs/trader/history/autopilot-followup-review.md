# AutoPilot comparison before the first live circuit

Reviewed the upstream AutoPilot execution handlers, trigger definitions, aliases/configuration and local supplemental changes against the current Holocron transport. Baseline remains commit `c8f0e6ff3d293c562cad452a3b62b5b7f3d8ac01`; the local economy scanner is not an upstream feature. No flight implementation was changed during this review and no live game commands were sent.

## Findings that affect the first test

Clearance update: finding 3 is now implemented with proximity-driven recovery, the shared 500-unit threshold, fresh speed/measured separation estimates, fleet exemptions and a ten-check limit. Hyperspace completion now advances from its event during this workflow. The broader prompt/boarding findings and other items below remain review work; this update does not establish full live-test readiness.

1. **High: our flight progression assumes a prompt that AutoPilot does not require.** AutoPilot calls the next handler directly when launch, calculation completion, hyperspace exit, orbit or touchdown text matches. Holocron's `line()` only sets `active.matched`; `prompt()` is responsible for advancing. A valid asynchronous event without a subsequent prompt therefore leaves the operation waiting until timeout. Whether the game always sends a prompt in these cases is not established by the upstream triggers. Fix event-completed steps to advance from their event, while retaining response-boundary handling for multi-line queries.

2. **High: prompts are treated as success for boarding and internal movement.** Holocron steps for `enter`, hatch closing, cockpit directions, `pilot`, exit directions and `leave` have no success matcher. A prompt alone advances them unless a recognized failure was seen. Requiring saved paths checks configuration, not actual execution. AutoPilot also sends much of this as a burst, so copying its command sequence does not supply missing physical evidence. Confirm ship/control access with fresh observations and verify exit before commerce; expand explicit error handling. The existing cargo readout is not by itself proof that the character left the ship.

3. **Medium: clearance recovery was intentionally replaced with a stop, leaving an unattended-flight gap.** AutoPilot waits 20 seconds after `You are too close to ... to make the jump to lightspeed!` and retries hyperspace. Holocron treats that response as terminal. It can stop immediately after an otherwise successful launch. Add a bounded, cancellable retry of the specific pending jump, with appropriate clearance evidence. Do not copy the untracked timer or generic `!` retry.

4. **Medium: landing fallback is incomplete.** AutoPilot collects choices and advances to another pad on restriction. Holocron selects the first listed pad and stops on restriction, without filtering by ship size. A preferred pad avoids selection ambiguity for the first test, but automatic public-pad selection is not equivalent to upstream. Add bounded candidate selection with a useful failure when none are suitable.

5. **Medium: the overall timeout can expire before individual flight stages.** RouteRunner allows 15 minutes for the whole navigation operation; the Lua hyperspace and approach stages each independently allow 900 seconds, with launch, query and landing time in addition. A long valid flight can therefore be cancelled by the outer runner while its current stage is still within its allowed time. Align timeouts or renew the operation deadline from validated progress.

## Reproduction evidence

Ran a standalone Lua 5.1 probe against the actual navigation module with a fake command sink and timers. It produced:

```text
Before bare prompt: enter "Sunrise"
After bare prompt, without boarding evidence: close
After launch confirmation, without prompt: launch
After subsequent prompt: calculate "Wroona System" 389 489 589
```

These demonstrate implementation behavior, not a claim about observed live server timing. The existing circuit fixture supplies a prompt after every response and uses generic `Done.` lines for boarding/movement. Its passing result establishes the expected command sequence but does not establish physical access confirmation or asynchronous-event handling.

## Other differences and remaining scope

- **Resume:** currently requires standing outside the ship at the expected destination. GMCP aboard/cockpit reconciliation remains absent. Station landing uses the same workflow, as confirmed by the user, but independent station location detection after interruption is not established by AutoPilot.
- **Access paths:** AutoPilot stores comma-separated command sequences; Holocron currently permits directions only. Ships requiring additional door/control commands need explicit support. Ordinary direction-only paths are covered.
- **Refueling:** Holocron refuels at the end of navigation, again in the runner's stop-refuel stage and again before departure. That is generally three requests per intermediate visit rather than AutoPilot's two. Consolidate the duplicate stop refuel.
- **Accounting:** AutoPilot exposes actual net profit/hour from elapsed time and confirmed transactions. Holocron records transactions but still lacks the equivalent run report.
- **Contraband and repetition:** upstream supports contraband transactions and wraps manifests continuously. The current Holocron interface intentionally executes one normal-cargo circuit.
- **Manual routing:** exact stop sequences are now preserved and inferred gateway restrictions are bypassed for manual circuits; explicit monitored closures still block. AutoPilot's waypoint support confirms the sequencing approach, not the correctness of our galaxy model.

## Recommendation

Correct findings 1 and 2 and add regression cases that omit prompts and inject access failures before treating a live cargo circuit as ready. Then add bounded clearance recovery and reconcile timeout limits. For the first live trial, use known accessible preferred pads, a small load, and a direction-only ship configuration. Later-stage recovery and accounting can follow that controlled trial.

The previous description of the implementation as ready was too strong: successful simulations did not cover these execution assumptions.

Source references: [AutoPilot flight handlers](https://github.com/Xavious/AutoPilot/blob/c8f0e6ff3d293c562cad452a3b62b5b7f3d8ac01/src/scripts/autopilot.script.lua#L1077), [flight triggers](https://github.com/Xavious/AutoPilot/blob/c8f0e6ff3d293c562cad452a3b62b5b7f3d8ac01/src/triggers/autopilot.flight/triggers.json), [clearance retry and generic failure handler](https://github.com/Xavious/AutoPilot/blob/c8f0e6ff3d293c562cad452a3b62b5b7f3d8ac01/src/scripts/autopilot.script.lua#L1226). Local implementation: `mudlet/lotj_holocron_navigation.lua`, `renderer/src/features/autopilot/RouteRunner.ts`, and `tests/lua/navigation_spec.lua`.
