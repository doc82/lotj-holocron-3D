# Where We Are At

Date: 2026-09-04

## Latest Implementation Checkpoint

### Reusable autopilot engine (live transport pending)

- `domain/routeAutopilot.ts` defines cargo-independent navigation missions, resolved planet/station destinations, stop actions, repetition, correlated confirmations, and versioned checkpoints. Restoration pauses for reconciliation; hyperspace exit alone never confirms a landed/docked arrival.
- `features/autopilot/RouteRunner.ts` serializes operations, writes checkpoints before dispatch, enforces operation deadlines, and stops on pause, abort, uncertain outcomes, or journal failures. Transport and journal implementations are injected. The transport must confirm physical outcomes rather than resolve on command acceptance.
- `domain/cargoAutopilot.ts` compiles existing cargo circuits into navigation missions, preserving transit stops, sell-before-buy ordering and the final return sale. It separately validates cargo space, inventory and affordability against supplied current observations. Non-cargo callers can create navigation missions without this adapter.
- Removed the legacy controller's fabricated landed-arrival event derived only from hyperspace arrival telemetry.
- **Not yet connected to Mudlet or the Trader UI.** This is the tested execution core, not a working live autopilot. The required transport must implement fresh ship/location/cargo reconciliation, exit/refuel/commerce/entry/refuel ordering, launch, plot/engage, approach and confirmed landing/docking, with polling ownership and matched operation IDs. Journal persistence must be connected to app storage.
- User was asked for entry/exit, launch/landing and Lodestar docking/refueling output. Existing Lua logistics handlers lack authoritative completion for several access operations, and current telemetry does not reliably identify the landed planet. These are the immediate blockers for live command dispatch. Do not replace them with timers or inferred destinations.
- Validation: renderer typecheck/build and 173 Node tests pass, including 8 new autopilot tests. No live commands were sent.

### Bidirectional gateway restrictions

- Naboo/Bespin now require Arkania for both arrivals and departures; their mutual shortcut still requires a confirmed passable lane. Alderaan/Mon Cala apply the same rule through Coruscant.
- New calculations cannot jump directly from these restricted planets to unrelated systems such as Ryloth. Existing saved estimates remain historical; use Recalculate routes and save the replacement.
- Validation: typecheck, renderer build and 165 Node tests passed, including departure paths for all four planets, hop limits, gateway exclusions and both shortcut directions.

### Recalculation controls

- Create route now has an explicit **Recalculate routes** button that reruns the planner using current filters and available prices without sending a refresh intent. Filter changes still recalculate automatically.
- Calculation feedback shows the run time, distance/jump/trade-stop limits, and result count. Relaxed limits can legitimately leave the highest-ranked routes unchanged. Result pagination resets when calculations change.
- Planning merges live observations with stored data so an archive write delay cannot hide newer live prices. Older live observations cannot replace newer stored prices.
- Validation: typecheck, renderer build and 161 Node tests passed. Regression tests exercise changed filters against unchanged cached prices and merging newer live prices. The originally reported UI behavior was not reproduced in a live session.

### Persistent markets and route provenance

- Timestamped market observations are stored locally in IndexedDB (`holocron3d.market-history`). Observations are indexed by planet and observation time for future historical analysis. Identical repeated telemetry is deduplicated; later observations with unchanged prices remain separate samples. No automatic history pruning is applied.
- The latest valid prices, planet/clan/lane context, and galaxy catalogue are retained across restarts. Older price and lane updates do not replace newer ones. Failed/partial refreshes keep previously observed prices for other planets. Refresh progress itself is not persisted as active work.
- Trader can plan from cached data without a new complete scan. It shows oldest/newest price timestamps and the lane observation time; cached lane conditions may have changed. Refresh remains manual. History and routes are local to this app profile/device, not a cloud backup.
- Named routes already persist in localStorage. Newly saved routes additionally retain their save timestamp and market observations used for estimation. Existing saved estimates are preserved when market prices change.
- Storage read/write errors are surfaced in Trader. A failed history load does not trigger replacement of the stored database with empty data.
- Validation: renderer typecheck, build and all 158 Node tests passed, including archive merging, reload serialization, history deduplication, and stale/partial observations. These tests cover the archive model; an actual app-restart IndexedDB integration check remains outstanding.

### Distance-based freighter timing

- New in-app circuit estimates use 6 travel minutes per 35 sectors, 3 minutes per market stop, and 3 minutes per transit/refuel stop by default. These assumptions are editable per ship under My ships; older ships use the defaults when no timing configuration exists.
- Each actual jump uses galactic distance; explicit lane travel seconds take precedence when supplied. Path selection includes transit overhead, and the final stop in each trade leg uses market turnaround time instead. Empty legs and return arrivals are included. Stop overhead is charged once per visit, not separately for buying and selling.
- Route cards show total estimated circuit minutes. Profit/hour remains total after-tax circuit profit divided by total circuit hours. Existing saved estimates remain unchanged until a new route is calculated and saved.
- The 3-minute transit default is an editable estimate, not a measured refueling duration. Stop time covers approach, landing/docking, refueling, commerce and departure as applicable. Fuel costs and affordability remain outside the estimate.
- Validation: renderer typecheck, build and all 155 Node tests passed, including the 18-minute 35-sector round trip, transit/empty-leg timing, path weighting, and saved ship timing.

### Freighter circuit planning

- Create route now uses `calculateFreighterRoutes`: each leg selects its best positive after-tax cargo margin, including the final return leg. Empty legs are explicit when no profitable commodity is available. Circuit estimates total every purchase, sale, and jump.
- Maximum trade stops defaults to 6 and offers Unlimited (up to the number of available markets). This is separate from maximum transit jumps between trade stops. Range, gateway restrictions, and avoidance still apply to every leg.
- Longer circuits use a beam of 100 candidates per depth and origin, returning up to 500 ranked circuits. This is a bounded shortlist, not exhaustive enumeration or a guarantee of the global optimum. Rotations of the same circuit are deduplicated; reverse trading orders remain distinct.
- Stop previews show incoming sales and outgoing purchases, with the return sale at the origin labelled separately. Circuit titles and saved identities include the full itinerary. Legacy saved routes retain their original estimates and can still be read.
- Saved circuit legs are validated and preserved. The unfinished executor explicitly blocks circuits rather than treating them as legacy one-commodity routes.
- Validation: typecheck, renderer build, and all 151 Node tests passed. An 18-market synthetic Unlimited search completed in approximately 192 ms and returned 500 candidates, including circuits with more than two markets. Timing is a local measurement, not a runtime guarantee.

### Lane rules and route previews

- Create route has a **Max distance (sectors per jump)** filter, defaulting to **35**. Every outbound and return jump must fit the Euclidean distance between galactic system coordinates, including with unlimited jumps selected. Catalogue system coordinates and Eeropha's known galactic position are used; local planet/station coordinates are never used for this filter. Unknown coordinates exclude a destination while filtering by range.
- The hazards monitor lists restricted lanes, not the complete travel network. Unlisted pairs are open; listed pairs require `passable`. Planet and exact system names are matched against the catalogue.
- Lorrd can only be entered or left through Kashyyyk or Eeropha. Both directions enforce this restriction. A Lorrd–Ryloth round trip via Eeropha therefore visits Eeropha before Ryloth and again on the return; the repeated origin remains implicit in the preview.
- Entry to Bespin/Naboo requires Arkania, except that a confirmed passable Bespin–Naboo lane allows travel between the pair. Entry to Alderaan/Mon Cala likewise requires Coruscant, with a confirmed passable Alderaan–Mon Cala shortcut. Missing, unknown, stale, or blocked shortcut data requires the gateway. Mon-Cal/Mon Cal aliases normalize to Mon Cala.
- Eeropha System is at galactic coordinates `(39, 30)`. Its refuel destination is **Lodestar Utopia Refueling Station**, at local coordinates `(9137, 4521, -18941)`, confirmed by the user. These are stored separately in `eerophaWaypoint` in `cargoRoutes.ts`.
- Catalogue destinations without market prices can be transit stops. Eeropha is available as a waypoint even when absent from the market catalogue; no market prices are invented for it.
- Route previews show the good and quantity at buy/sell stops and explicitly label pit stops. Eeropha pit stops show Lodestar and its coordinates rather than a planet landing-pad editor.
- Round-trip notation omits the repeated origin from the stop list. Return travel remains included in profit/hour and jump estimates, and return transit stops remain visible.
- Weighted path selection respects each leg's hop limit. Unlimited jumps remove that limit without bypassing blocked lanes or exclusions.
- Validation: renderer typecheck, build, and all 146 Node tests passed, including sector range boundaries, coordinate lookup, both gateway groups, shortcut statuses, jump limits, and gateway exclusions. The autonomous driver remains unfinished; these coordinates are available to planning, not yet wired into station docking/refueling execution.

### Trader setup experience

The workspace now opens on Create route with a connected setup flow:

- My ships supports adding, editing, deleting, and selecting a ship. Capacity drives route quantities. Optional entry/exit paths and hatch codes are validated.
- Secret pads supports adding, editing, and deleting one preferred pad per planet, with catalogue suggestions. Route stop shortcuts open the matching pad editor.
- Route previews show purchase cost, sale revenue, estimated profit, independent leg jump counts, and buy/sell/transit/return stops with their preferred pads.
- Routes can be named, saved with their selected ship, renamed, and deleted. Estimates explain their assumptions; new routes wait for a complete market refresh.
- Ship, pad, and route configuration survives reload. Older records migrate, including unfinished ships that still need capacity. Storage failures are visible.
- Avoidance filters now exclude transit planets as well as commercial endpoints.
- The workspace uses a scrollable modal with keyboard dismissal and focus containment. Route arming is not offered while the autonomous driver is incomplete.

Browser checks used synthetic market data to exercise ship creation/editing and validation, pad creation and editing from a route, named route saving/renaming, reload persistence, no-match filters, and deletion confirmation. Pure configuration tests cover ship removal and route-association preservation.

The renderer build and all 137 Node tests pass after the setup changes. Keyboard verification confirmed Escape closes Trader without opening Management, and tactical shortcuts are disabled while Trader is open.

### Logistics foundation

The first continuation milestone (logistics discovery and capture) is implemented:

- Trader can open from the landed/disconnected screen.
- Logistics snapshots reach Trader while tactical snapshots remain cleared on landing.
- Refresh starts with `planets`, then refreshes clans, lanes, and markets from the newly discovered catalogue; no pre-existing catalogue is required.
- Refresh progress and failures are visible. Overlapping requests are rejected; interruption, send failure, and incomplete responses release refresh ownership without continuing the queue.
- Background polling and shield activation defer to logistics capture.
- Manual landed logistics commands and typed buy/sell/refuel confirmations are captured without setting the ship's state to in-space.
- The `cargo_transaction` parser dispatch key is registered. Captured typed transactions acknowledge their intent after a matching action confirmation; ambiguous outcomes are not retried automatically.
- Route calculation waits for a completed refresh and uses current-catalogue markets observed during that batch.

The autonomous driver is still unfinished. Before connecting it, address authoritative landed-location and operation correlation, weighted path selection, affordable quantity based on actual cargo and credits, and checkpoint recovery semantics. Hyperspace arrival must not be treated as confirmation of the planned landing planet. The current reducer also needs corrected exit/refuel ordering and explicit loop repetition.

Validation for this milestone: `pnpm check`, renderer build and all 130 Node tests, and all 192 Lua tests passed. Live Mudlet validation remains outstanding.

## What We Are Building

Holocron3D is gaining a Trader workspace that can discover profitable cargo loops and eventually fly them autonomously through the LOTJ galaxy.

The target experience is:

1. Open Trader from the top application bar.
2. Inspect live logistics status.
3. Manage ship configurations, entry/exit paths, and cargo capacity.
4. Manage preferred landing pads.
5. Refresh the current galaxy's clans, hyperlanes, and every planet's market data.
6. Generate profitable routes automatically.
7. Select a route based on profit per hour.
8. Arm the route and let Holocron3D execute the multi-stop loop.
9. Pause and resume safely from a persisted checkpoint.

The route planner is specifically designed for dynamic hyperlanes. A route may contain transit-only planets where no cargo is bought or sold because the active hyperlane graph requires an intermediate stop.

## Product Decisions

### Route limits

The filter is named **Maximum jumps between trade stops** and is represented internally as `maxJumpsPerLeg`.

A leg is the path between two commercial stops. Transit planets count toward the leg's jump count. The outbound and return legs are calculated independently.

Example:

```text
Naboo [buy]
  -> Arkania [transit]
  -> Bespin [sell]
  -> Arkania [transit]
  -> Naboo [buy]
```

With a maximum of three jumps per leg, the outbound and return legs may each contain up to three jumps. The UI displays total loop jumps separately.

### Market data

Route creation refreshes `showplanet <planet> resources` for every candidate planet. Market rates are dynamic and must not be treated as permanent.

Buy limits are not part of the current game model. Route quantity is based on available cargo capacity and available credits, with later reconciliation against the actual cargo manifest.

Trade-cast effects are intentionally ignored for the first implementation.

### Fuel

Fuel-level verification is intentionally not required. The defensive fuel policy is:

- Refuel after leaving the ship at every stop.
- Refuel again after entering the ship before departure.

The repeated refuel commands are the safety mechanism.

### User-managed configuration

The user supplies configuration that cannot be safely inferred:

- Ship name and capacity.
- Ship entry path.
- Ship exit path.
- Hatch code when required.
- Preferred or restricted landing pads.
- Any location-specific trafficking or clan setting.

## Existing Reference Material

The external [Xavious/AutoPilot](https://github.com/Xavious/AutoPilot) package provided the operational reference for:

- Ship entry and exit paths.
- Hatch handling.
- Refueling on ship access transitions.
- `showplanet` navigation lookup.
- `calculate`, `hyperspace`, `course`, and landing flow.
- `buycargo`, `sellcargo`, and contraband variants.
- Multi-planet waypoint execution.
- Pause state and profit tracking.

The AutoPilot implementation uses fixed waypoint and manifest logic. It does not calculate the best route, parse the hyperlane monitor, refresh every market, or reconcile cargo after an interrupted run. Holocron3D is replacing that fixed trigger chain with typed telemetry, a live graph, and a resumable executor.

The session log at `C:\Users\bjork\.config\mudlet\profiles\Legends of the Jedi1\log\2026-09-04#18-37-54.html` supplied confirmed live formats for:

- `l hyp` hyperlane status.
- `planets` catalogue output.
- `clans` organization output.
- `showp <planet> resources` market output.
- `listc <ship>` cargo manifests.
- `buycargo` and `sellcargo` confirmations.
- `refuel <ship>` confirmations.
- Hyperlane calculation failure output.

## Implemented

### Logistics parsers and telemetry

The Lua parser now recognizes:

- Hyperlane rows and `passable` / `no_route` status.
- Planet catalogue rows and governing organizations.
- Clan tables.
- Planet metadata, tax rates, coordinates, and resource prices.
- Cargo slots, used cargo, and total capacity.
- Buy, sell, and refuel confirmations.

The scraper publishes these under `metadata.logistics`, including a per-planet market cache and bounded transaction events.

The typed `refresh_logistics` intent refreshes:

```text
planets
clans
l hyp
showp <planet> resources   for every validated planet
```

### Route calculation

[cargoRoutes.ts](../../../renderer/src/domain/cargoRoutes.ts) implements pure route calculation:

- Passable hyperlane graph traversal.
- Independent outbound and return paths.
- Transit-only planet retention.
- Maximum jumps per leg.
- Excluded clans and avoided planets.
- Tax-aware expected profit.
- Profit-per-hour ranking.
- No planet buy-limit assumption.

### Trader workspace

[TraderWorkspace.tsx](../../../renderer/src/features/trader/TraderWorkspace.tsx) is opened from the Trader icon and currently contains:

- My ships tab.
- Secret pads tab.
- Saved routes tab.
- Create route tab.
- Live market refresh control.
- Route filters for maximum jumps, excluded clans, and avoided planets.
- Calculated route display with transit stops and loop jumps.
- Named route previews with pad shortcuts, saving, renaming, and deletion.
- Pause, resume, and abort controls for existing checkpoints; arming new runs is withheld until execution is implemented.

The demo configuration is persisted locally through [traderConfig.ts](../../../renderer/src/features/trader/traderConfig.ts) and [useTraderController.ts](../../../renderer/src/features/trader/useTraderController.ts):

- Ship templates with capacity, enter path, and exit path.
- Preferred planet pads.
- Saved calculated routes.
- Active route checkpoints and the route definition needed to restore them.

### Executor foundation

[cargoRouteExecution.ts](../../../renderer/src/domain/cargoRouteExecution.ts) defines the pure reducer and checkpoint model.

Each stop follows this intended sequence:

```text
arrive
  -> refuel on exit
  -> exit ship
  -> enter ship
  -> refuel on entry
  -> buy/sell or transit completion
  -> plot next leg
  -> engage hyperspace
  -> confirm arrival
```

The reducer blocks unexpected arrivals, preserves transit-only stops, pauses safely, and restores a paused checkpoint.

The controller currently consumes hyperspace `arrived` state using the expected route stop. This is scaffolding only: it must be replaced with correlated jump completion and confirmed actual landing location before autonomous execution.

### Typed action boundary

Lua now exposes a closed `logistics_action` intent for:

- Opening and closing a ship.
- Entering and leaving a ship.
- Piloting and launching.
- Toggling autopilot.
- Refueling.
- Buying and selling cargo.

Ship names, resource names, quantities, and action names are validated in Lua. The renderer cannot send raw game commands.

## Validation Status

The following currently pass:

- Full Node and renderer test suite.
- Full Lua suite: 192 tests.
- Renderer typecheck.
- Prettier formatting check.
- Route graph tests.
- Executor reducer tests.
- App architecture boundary tests.

## Current Gaps

The executor is not yet fully autonomous. The remaining gap is authoritative access and location telemetry.

### Missing normalized events

Lua needs to publish structured logistics state for:

- Current landed planet.
- Current ship name.
- Hatch open/closed state.
- Aboard ship state.
- Piloting/control-seat state.
- Confirmed ship entry.
- Confirmed ship exit.
- Confirmed launch and landing planet.
- Transaction operation identity and completion association.

The existing scraper knows in-space versus landed and already reacts to some launch/landing lines, but those signals are not yet normalized under `metadata.logistics` for the Trader executor.

### Missing automatic phase driver

The reducer and typed action boundary exist, but the controller still needs to:

- Select the configured ship template.
- Reconcile the current planet before starting or resuming.
- Issue entry/exit/refuel actions in sequence.
- Wait for authoritative responses before dispatching the next reducer action.
- Issue buy/sell only after cargo and location reconciliation.
- Build each next hyperspace plot from the route leg's destination coordinates.
- Engage the existing hyperspace controller.
- Pause when the active hyperlane graph no longer supports the next leg.

### Missing route coordinate integration

The route calculator currently retains planet names and hyperlane paths. Market telemetry already includes coordinates, but route objects still need destination coordinate data so the executor can call the existing hyperspace plotting workflow without re-querying blindly.

### Demo limitations

Ship and pad edit/delete workflows and named saved routes are implemented. Route estimates use the selected ship's total capacity rather than actual free cargo space or available credits. Saved route prices must be refreshed before use, and execution history is still outstanding.

## Next Steps

### Step 1: Normalize access and landed-location events

Add Lua logistics fields such as:

```ts
interface LogisticsAccess {
  shipName?: string;
  landedPlanet?: string;
  aboard?: boolean;
  piloting?: boolean;
  hatchOpen?: boolean;
  observedAt?: number;
}
```

Populate them from confirmed game output and the existing launch/landing triggers. Add parser and scraper fixtures from the live log.

### Step 2: Add transaction correlation

Every logistics action should carry an intent ID and operation ID. When a buy, sell, or refuel response arrives, publish the matching completion event rather than only appending an unassociated transaction history item.

Timeouts must trigger `listcargo` and credit/cargo reconciliation before any retry.

### Step 3: Attach coordinates to route legs

Extend market/planet route data with coordinates and build a typed per-leg destination payload for the existing hyperspace controller.

### Step 4: Drive the reducer automatically

Implement controller effects for:

- Current-stop reconciliation.
- Defensive refueling on exit and entry.
- Ship path execution.
- Commerce operations.
- Transit-stop advancement.
- Hyperspace plot and engage.
- Arrival confirmation.
- Hyperlane refresh and replan after collapse.

### Step 5: Complete resume behavior

On resume:

```text
detect current planet
  -> detect ship/access state
  -> listcargo <ship>
  -> refresh hyperlanes and relevant markets
  -> reconcile expected buy/sell action
  -> refuel on exit and entry
  -> recalculate the next viable leg
  -> continue or block for user input
```

The route index must never be trusted by itself.

### Step 6: Finish the demo workspace

Add:

- Execution history (ship/pad editing, saved-route naming, and route details are implemented).
- Selected ship template for an armed route.
- A clearly visible blocked reason and recovery action.

### Step 7: Live validation

Use a real Mudlet session to validate:

- One buy, one hyperspace leg, one sell.
- A transit-only middle planet.
- Refuel on both sides of a stop.
- Hyperlane collapse and route re-planning.
- Pause during transit.
- Pause after landing before commerce.
- Resume with cargo present and with cargo absent.
- Unexpected planet or ship state.

## Definition Of Done

The feature is complete when a user can:

1. Add a ship template and preferred pads.
2. Open Trader and refresh all current markets.
3. Generate a loop ranked by profit per hour.
4. See every transit-only planet and both loop legs.
5. Arm the route with an explicit user action.
6. Have Holocron3D enter, refuel, buy, launch, travel, land, exit, refuel, sell, and repeat using typed intents.
7. Pause at any safe checkpoint.
8. Resume after a reload or manual intervention by reconciling actual planet, ship access, cargo, and route state.
9. Stop safely when hyperlanes, markets, or telemetry invalidate the plan.
10. Inspect why a route was skipped or blocked.
