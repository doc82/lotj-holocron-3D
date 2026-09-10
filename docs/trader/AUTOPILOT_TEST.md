# First live cargo circuit

See the [autoflight implementation review](AUTOFLIGHT_REVIEW.md) for outstanding
station, prelaunch recovery and response-handling gaps found by automated review.

The route cards now connect to the reusable navigation runner and the Mudlet transport. Automated tests cover a complete outbound/return cargo circuit, command cancellation, wrong-location rejection, audited topology restrictions, and renderer intent/confirmation handling. A live game circuit has not yet been validated.

The first live attempt exposed a purchase completion arriving without a prompt.
Cargo and contraband confirmations now advance the runner directly after validating
the transaction. Regression coverage completes buys and sells without prompts and
checks that duplicate confirmations do not record a second transaction. Startup
reconciliation also uses one credit query for both balance and recovery checks.
Landing-pad, cargo, and price checks remain in place.

## Load this version

1. Install the newly built `out/mudlet/Holocron3D.mpackage` through Mudlet's Package Manager. It contains the new navigation runtime; updating only the desktop is insufficient.
2. Use the current development desktop from this checkout (`pnpm.cmd electron:dev`). If it is already running with hot reload, use its updated Trader workspace. An older installed desktop build needs to be rebuilt to get the new controls.
3. Start the relay with the usual `h3d start` command and verify the app connects. Stop any active AutoPilot cargo/flight run before starting Holocron navigation.

## Prepare the run

Open **Route Planner** to select a starting planet (or **Any planet**) and compare
routes. **Manual route** is a button on this page, not a tab. Both it and a
proposal's **Review route** button open a dedicated workflow with the tabs hidden:

1. **Review route**: inspect the proposal, or start a blank manual route.
2. **Craft / pick a route**: select the ship and edit all stops, pads and trade modes.
3. **Save route**: name the route and save it. Successful saving returns to **Routes**.

**Back to tabs** leaves the workflow. Step-back buttons let you edit without
leaving it. An invalid draft shows a reason and cannot proceed; a storage failure
keeps the draft open instead of claiming success.

In **Routes**, choose **Select route to run**. Successful preparation opens the
**Active route** tab, showing the ship, operation, progress and itinerary. Use
**Start / resume one circuit**, **Pause**, or **Stop route** there. Selecting a
route does not send flight commands. Offline start/resume is disabled. Existing
runs must be stopped before another route can be selected.

Each visit has its own landing pad and cargo/trafficking setting. The final return
has separate fields, so it can use a different pad or sell command. Unchanged pad
fields use saved defaults; explicitly clearing an edited pad uses automatic
landing. These overrides belong to the saved route, not the global pad list.

**Trafficking** selects `buycontraband` / `sellcontraband` at that visit. The
estimate skips local sale tax and assumes a successful skill check at the current
market price; it does not estimate the cost of becoming WANTED or police attacks.
Confirm command selection and both messages on a live test:

```text
You pay 100 credits to have 10 units of smuggled Food loaded on to your ship.
You find a contact willing to pay 100 credits to unload 10 units of smuggled Food.
```

These patterns come from the second purchase/sale entries in
`../AutoPilot/src/triggers/autopilot.cargo/triggers.json`. The normal cargo
confirmation is not accepted for a contraband operation. Unsupported failure
responses must stop or time out for reconciliation; they must never cause an
automatic trade retry. Verify a live failure transcript before extending them.

To choose the path yourself, open **Route Planner** and click **Manual route**. Select the ship and cargo quantity, add every outbound and return transit stop in order, and choose buy/sell actions. The final return to the origin and sale of remaining planned cargo are automatic. Continue to the Save step; select the saved route from Routes when ready to run. Manual circuits can explore unverified directions between known destinations. Observed No Path connections and temporary controls without fresh Passable status still block execution; maximum sector distance, ship access and cargo checks still apply. Missing market prices suppress the profit estimate but do not prevent saving the itinerary.

Ship access is mandatory for autopilot. Configure both internal movement paths, or explicitly select that boarding enters the cockpit directly. Leaving both fields blank does not count as confirmation. The app and Mudlet both reject missing access configuration before game commands are sent. The hatch code is needed only for a locked hatch that requires one.

1. Stand **outside** the cargo ship on the route's originating landing pad. `look` must list that ship. This first implementation reconciles a landed, outside starting state; it does not automatically find the hatch from an arbitrary room inside a ship.
2. In Trader / My ships, select the ship and verify its exact name, cockpit entry/exit directions and hatch code. Use a small planned cargo capacity for the first test (for example, 10 units); actual hold capacity is checked separately with `listcargo`.
3. Set preferred landing pads for the planets in the test circuit. Without a preference, the transport selects the first listed pad and stops on a restriction rather than guessing another pad.
4. Calculate a short circuit originating at your current planet using the stored markets. Review and save the desired route, choose **Select route to run** in Routes, then **Start / resume one circuit** in Active route.

Preparing does not send game commands. Starting refreshes `l hyp` and validates the itinerary before any commerce, then checks `showplanet`, `look`, `listcargo` and `credits`. Before departure it checks hyperlanes and resolves planetary coordinates. Stations use the same course/landing sequence, with Lodestar's recorded coordinates. Before every purchase or sale it checks the current planet with bare `showplanet` and verifies the named ship on the pad with `look`. Purchases also check current price, funds and free hold space. A mismatch pauses before sending the trade command. Purchases and sales must confirm the expected resource and quantity.

The Active route page shows the current command stage or blocked reason. One circuit includes return cargo when present in the selected route and the final sale at the origin. It does not repeat automatically.

## Stop and recover

If hyperspace is rejected for clearance, the transport runs `prox` and requires at least 500 units from non-exempt blocking objects. It uses fresh ship speed to estimate the next check, then prefers measured separation change from successive scans. Checks are 1–30 seconds apart (5 seconds when movement is unknown, stopped or closing). A fresh scan must confirm clearance before retrying `hyperspace`. After 10 unsuccessful checks/retries it stops and shows the reason. Missing proximity responses also consume this budget. Pause, Stop, reload and loss of the automation lease cancel pending checks.

Pause cancels pending automation commands and timers. Cancel route requires confirmation and discards flight recovery; a maneuver already accepted by the game may still finish. After cancellation or completion, Clear active route removes the checkpoint and returns to saved Routes without deleting the saved itinerary. Escape dismisses the topmost modal only. Losing the desktop automation lease stops the transport.

Resume starts with reconciliation. In the same Mudlet session, an interrupted flight retains its phase and can resume observation of the pending maneuver. Flight events received while paused are retained without sending commands. After a reload, or if the flight state cannot be reconciled, finish moving manually to the expected stop and stand outside the selected ship before resuming. If an interrupted cargo transaction cannot be proven complete from the current transport session, the run blocks rather than repeating it. Inspect the hold, stop the run and prepare an appropriate new route.

Calculation and approach failures wait for manual assistance with a bounded timeout; other failures pause for reconciliation. There is no blind `!` retry. If the first live test blocks, retain the command and the game response shown in Mudlet so the missing response variant can be added.

Remaining work beyond this controlled test: arbitrary aboard/cockpit recovery using GMCP transitions, automatic replanning after a blocked lane, broader landing-pad fallback, and an in-app realized-profit report. Confirmed transaction costs/revenues are already recorded in logistics telemetry.

## Browser workflow regression checks

Using isolated browser fixtures (no game commands), verify: proposal -> review -> editor -> save -> Routes; saved pad edits persist; selecting a route opens Active route; offline Start is disabled; Stop updates status; Manual route opens a blank workflow with validation; Back to tabs restores navigation. Saving must succeed before the workflow closes.

## Recoverable leg phases

Ground (location/ship, refuel and trade) -> pre-hyperspace (hatch, cockpit controls, launch, calculation and clearance) -> hyperspace -> post-hyperspace (system verification, approach and landing) -> ground.

Launch, calculation completion, hyperspace exit, named orbit and touchdown advance from their completion events without waiting for another prompt. Cockpit control acquisition requires the actual "You grip the controls." response or a fresh true piloting GMCP event received during that step. Cached flags and unrelated GMCP events cannot advance it. Internal directions still use prompt boundaries; inability to acquire controls blocks launch, and fresh planet/ship checks gate commerce after exit. Fresh corroborated GMCP room/planet observations can replace location-only `showplanet`; the ship-on-pad check still runs. See [GMCP transition validation](../../mudlet/SETUP.md#gmcp-transition-validation) for the live test procedure.

While flight is active, manual calculate/calc, hyperspace, course, land, speed, prox and navstat commands do not automatically stop the run. Their command text never counts as completion. Confirmed forward milestones advance the leg; the calculated jump and arrival system are checked with navstat, and the planet is checked again on the ground. Other manual commands interrupt automation.

Test manual hyperspace entry after a failed calculation: the route should observe hyperspace, verify the arrival system and continue approach. Test a wrong-system arrival: no approach or cargo transaction should follow. Test a missing ship before buying: return to the named ship's pad and click Resume. A preflight failure before the trade command was sent is retryable in the same session; a trade already sent without confirmation remains uncertain and must not be repeated.

Full App browser checks now cover preserving Active route through landed/space transitions, Escape dismissing confirmation without closing Trader, and Cancel followed by Clear preserving the saved route. No live game flight has been validated by these checks.
