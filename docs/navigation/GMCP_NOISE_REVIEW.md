# GMCP and command-noise review — 2026-09-08

Reviewed the working tree and the Mudlet HTML log `2026-09-08#19-23-56.html` from profile `Legends of the Jedi1`. The supplied path had an extra space in the profile name. Findings and line references below preserve that review baseline.

## Implementation follow-up — 2026-09-09

Replay-backed follow-up implemented: stationary noncombat GMCP gets a bounded
60-second quiet window; automatic self-status retries back off from 15 to 120
seconds (five-second minimum in combat), resetting on complete telemetry.
Cockpit exit clears telemetry access and suspends background cockpit commands
while preserving aboard through observed interior transitions. Session-scoped
room-vnum knowledge supports recognition of revisited interiors without claiming
ship identity from room names. Disconnect/reload/observer changes clear that knowledge.
Reports lacking spatial fields clear position eligibility and renderer motion
history without inferring landed versus hyperspace. Fresh GMCP or validated
own-ship radar/status restores spatial eligibility. Regression tests cover these
behaviors; live validation of this follow-up build remains outstanding.

Implemented single-string GMCP negotiation and a matching test fixture; complete-vital-report freshness for self-status suppression; string/numeric piloting normalization; empty-packet and disconnect invalidation; timestamped room/access observations; fresh-event confirmation of the active take-controls step; and fresh, corroborated GMCP planet observations for location-only route queries. Ship-on-pad and trade confirmations remain required.

Polling excludes observer duplicates from named scans, keeps first-contact discovery immediate, slows subsequent peaceful non-target status scans to at least 60 seconds, defaults peaceful fleet radar to 15 seconds, and backs off failed automatic named scans from 30 seconds to a maximum of five minutes. Known non-fighter squadron rejection suppresses routine repeat probes until room/ship context changes. Explicit scans remain available.

Presence handling is conservative: empty ship data clears stale own-ship readings and preserves aboard only when supported by observed room context; a planetary room establishes outside and suppresses a radar access probe. A missing planet alone does not establish aboard. Flight phase still uses existing authoritative events/radar rather than the piloting flag.

The opt-in bounded GMCP trace in [Mudlet setup](../../mudlet/SETUP.md#gmcp-transition-validation) supports remaining live validation. Arbitrary cockpit-path recovery, unknown `COMMANDSTACK` packet mapping, money update semantics, and replacement of flight-phase events still require live evidence; they are not inferred from the old help-variable list.

## Observed noise

### Follow-up log: 2026-09-09 19:23:36–19:41:22

This run cannot yet validate the GMCP transition sequence or provide a like-for-like noise comparison:

- Four early trace-start attempts failed because the scraper was absent. The package explicitly reported waiting for `h3d start` at 19:24:04.
- Landing completed at 19:26:21; controls were released at 19:26:32. Boarding, taking controls, and launch occurred at 19:39:21, 19:39:25, and 19:39:57, before successful trace start.
- `h3d start` ran at 19:40:20. Trace start at 19:40:26 had no logged Lua error. At 19:40:34, status still reported waiting for the desktop and polling disabled.
- `h3d launch` ran at 19:40:41. After an initial connection, **86 disconnect/reconnect diagnostic lines** appeared between 19:40:42.756 and 19:40:43.027. Connection was reported again at 19:40:43.038. These are log-message counts, not proof of 86 independent socket failures.
- Only about 39 seconds of subsequent connected observation are available. One self-status response is visible at 19:40:51, alongside other ships' discovery scans. That is insufficient to establish steady-state polling reduction or GMCP feed health.
- No `stopGmcpTrace()` call or printed trace is present. Stopping Mudlet HTML logging does not export the in-memory trace. If the collector is still loaded, print `lua display(lotjHolocron3D.scraper.stopGmcpTrace())` into a newly started log before reloading it. This can recover recent packets, but cannot recover transitions that preceded trace start.

The desktop reconnect burst is a separate concrete noise issue to investigate before another full flight test. The trace is still needed to establish packet cadence and presence semantics.

### Exported trace: 2026-09-09 19:41:22–19:43:56 log

The first `stopGmcpTrace()` at 19:43:05 successfully printed **59 Ship.Info events**, observed from 19:40:28 to 19:43:00. Later calls returned `{}` because the first call stopped and cleared the trace. There are no Room.Info events in this export, so it does not establish boarding/disembarking semantics.

- All events report boolean `piloting = true`. Moving realspace reports contain the expected numeric vitals, maxima, speed, and position, usually about two seconds apart (one-second timestamp resolution).
- Eight reports omit speed, position, and heading. Their times align with three text-confirmed hyperspace intervals. Vitals and piloting continue to arrive. Missing spatial fields must not be interpreted as leaving the ship or as a verified current realspace fix.
- All 51 reports that include heading report `0,0,0`, even while coordinates change. GMCP heading alone cannot establish orientation in this sample.
- A **19-second event gap** occurs from 19:42:27 to 19:42:46 after speed becomes zero. Self-status responses at 19:42:41 and 19:42:45 fall within that gap. This supports revising the ten-second fallback rule: silence while stationary is not sufficient evidence of a broken feed. It does not prove a universal maximum update interval.
- This log contains three full self-status reports, plus three own-ship navstat readouts and other ships' scans. The older 26-report baseline is not directly comparable because flight phases and durations differ.

Next implementation targets: distinguish stationary quiet periods from a lost feed, back off repeated fallback status requests, and invalidate spatial eligibility during partial hyperspace reports while retaining valid vitals. Keep heading fallback and obtain a separate short room-transition trace. The earlier desktop reconnect burst remains a separate transport issue.

### Raw replay: 2026-09-09#19-44-10.dat

Decoded all 275,915 bytes as 815 length-delimited recording frames, reassembled the recorded stream, and extracted GMCP telnet subnegotiations without playing the recording into Mudlet. The frame delays sum to 2,067.418 seconds. The replay contains **204 Ship.Info, 25 Room.Info, and 34 Ship.System messages**.

The final landed sequence supplies the missing evidence (elapsed seconds within this replay):

| Elapsed  | Observation                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------ |
| 2020.043 | Outside: Room.Info vnum 170001, Gate 92, planet `Nal Hutta`, ground coordinates and exits.             |
| 2052.825 | Boarding: hatchway vnum 70080; no planet field, no Ship.Info yet.                                      |
| 2053.943 | Cabin vnum 70081; still no Ship.Info.                                                                  |
| 2054.935 | Cockpit vnum 70086; Ship.Info returns with `piloting=false` and vitals, but no speed/position/heading. |
| 2059.049 | Taking controls: Ship.Info reports `piloting=true`.                                                    |
| 2060.291 | Releasing controls: Ship.Info remains nonempty, reports `piloting=false`.                              |
| 2062.917 | Moving to cabin: Room.Info changes and Ship.Info becomes `{}` while still aboard.                      |
| 2063.903 | Hatchway: Room.Info changes; no ship statistics.                                                       |
| 2065.722 | Leaving ship: Room.Info returns to vnum 170001 with `planet="Nal Hutta"`.                              |

An earlier cockpit-to-cabin transition at 93.477 seconds also clears both Ship.Info and Ship.System. Re-entering the cockpit at 1555.486 seconds restores ship data before controls are taken. Cabin movement during hyperspace repeats the same clearing behavior. Room vnums distinguish two hatchways with identical names during ship-to-ship movement; room names alone are not a ship identity contract.

**Correction to the previous trace interpretation:** missing spatial fields occur in both hyperspace and landed cockpit reports. They indicate unavailable spatial telemetry, not a unique hyperspace phase. This replay shows Ship.System empty on landing and named in realspace; during galactic transit it carries moving x/y without a name. Treat those as corroborating observations and retain explicit flight completion events.

Implementation implications: treat nonempty Ship.Info as ship telemetry access, not general aboard coverage; use observed room transitions to retain aboard knowledge through known interiors; keep piloting independent. Any learned interior/ship mapping must be scoped to verified identity and session. Invalidate spatial freshness when fields disappear without labeling the phase from that absence alone. The raw replay is sufficient for these regression cases; another recording is not required for the observed sequence.

### Original log baseline counts: 2026-09-08

The session spans 19:23:56–19:30:37 (6 minutes 41 seconds). Stripping HTML produces 1,897 lines, including blank lines and log wrappers.

- **26 full self-status responses**, identified by the self-lifeform-scan message. There are 28 own-ship readout headers total; two are navigation reports, not status reports. The repeated status blocks account for roughly 675 lines.
- Two status responses for the refueling station and one station information description.
- Four failed named scans: two suggesting bare `status`, two suggesting bare `info`.
- Seven `[System Map] Radar data collected.` messages, plus repeated short system/ship listings consistent with `fleetradar`.
- A squadron capability rejection at 19:29:43 while using a JumpMaster.
- Repeated prompts amplify the cost of every background command.

The log contains user commands and output from the official LotJ UI as well as Holocron. It does not contain raw GMCP packets or consistently identify the issuer of hidden commands. Response counts establish the noise; they do not prove which package issued every command or whether GMCP was arriving. Cosmetic gagging also cannot be evaluated conclusively from this HTML alone.

## Existing GMCP coverage

| Information                      | Current consumer                                                 | Opportunity                                                                                             |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Speed and maximum                | `Ship.Info.speed/maxSpeed`                                       | Already used; restore/verify feed health before adding another parser.                                  |
| Energy, hull, shields and maxima | `Ship.Info.energy/maxEnergy`, `hull/maxHull`, `shield/maxShield` | Already used, including shield-recharge completion.                                                     |
| Sublight coordinates             | `Ship.Info.posX/posY/posZ`                                       | Already used; retain radar for surrounding contacts.                                                    |
| Heading                          | `Ship.Info.headX/headY/headZ`                                    | Already used; verify semantics with live payloads before changing vector interpretation.                |
| Piloting                         | `Ship.Info.piloting`                                             | Stored in observer telemetry but not used to reconcile route access.                                    |
| System and galactic coordinates  | `Ship.System.name/x/y`                                           | Already relayed to the galaxy map; consolidate timestamped location state for other consumers.          |
| Room and planet                  | `Room.Info`                                                      | No scraper subscription; add fresh room observations for movement/location/access reconciliation.       |
| Upcoming command stack           | Not consumed                                                     | Discover actual packet path/type first; potentially useful for queue pressure, not transaction success. |

The in-log `HELP MSDPVARS GMCP` uses uppercase variable names. These are not proof of literal GMCP JSON paths. The official client's source confirms the nested `Ship.Info` fields above and `Room.Info.vnum/name/exits/planet`. Do not add speculative uppercase aliases without seeing those payloads.

## Prioritized findings

### 1. Correct and verify GMCP negotiation

`mudlet/lotj_holocron_scraper.lua:8524` calls `pcall(sendGMCP, "Core.Supports.Add", '["Ship 1"]')`, with the JSON in a second argument. Mudlet documents a single combined command string. Use `sendGMCP('Core.Supports.Add ["Ship 1", "Galaxy 1"]')` (inside the appropriate error handling).

The fixture at `tests/lua/support/mudlet_fixture.lua:109` accepts a separate payload too, so it does not expose this API mismatch. Validate the actual outgoing command string in a regression test. A successful `pcall` is not evidence that the server accepted the subscription; track received events and age separately.

This is a concrete API mismatch and a plausible contributor to fallback polling. It is not a proven explanation for this session: the server may publish these modules by default or another package may subscribe. The official LotJ UI currently contains the same two-argument pattern, so copying its negotiation does not resolve the issue.

### 2. Make self-status fallback exceptional

`handleShipGmcp` at line 6629 already updates the ship readings. Routine bare `status` is skipped at line 5983 when any accepted `Ship.Info` event is within ten seconds.

Audit all self-status producers, including initialization/hydration, explicit scans, and accidental self-entities in the named-scan queue. The named-scan branch returns before the bare-status suppression and `scanCommandDue` has no explicit observer identity exclusion. This is a possible bypass worth regression coverage, not proof it happened in this log.

Track freshness of the fields required by a consumer. Currently any nonempty table marks the whole feed healthy and clears status hydration, even if it only contains a heading or piloting update. Conversely, silence must not automatically mean the player left the ship. Verify the server's periodic versus change-only behavior before choosing timeouts.

Keep full `status` available for missing capabilities and explicit inspection: the listed GMCP values do not include all weapon readiness, cargo, hangar, target, condition, and equipment details shown in these reports. Acquire those on demand or at a slower interval rather than fetching an entire report for speed/fuel.

### 3. Separate aboard, controls, and flight state

`handleShipGmcp` currently returns immediately for missing/empty `Ship.Info`, preserving old observer values. The official UI instead handles emptiness as a visibility transition. Add event-aware presence handling, with reconnect/session invalidation and fresh room context.

Recommended separate observations:

- `aboard`: true, false, or unknown, with source/time and ship identity when available.
- `piloting`: true, false, or unknown; normalize booleans, numeric 0/1, and string 0/1. Current code incorrectly treats string `"1"` as false.
- Room identity and planet: fresh `Room.Info` observations.
- Flight phase: landed, launching, realspace, hyperspace, landing, or unknown.

A fresh true piloting flag supports being aboard and at controls. False does not establish that the player is outside. A landed pilot can still hold the controls. An old cached ship object proves none of these current states.

The official mapper uses `Room.Info.planet` presence for planetary rooms and absence for ships. This is useful supporting evidence, but absence alone needs validation in stations, unmapped rooms, and partial updates. The official overlay uses nonempty `Ship.Info` for ship presence; verify exactly when this clears (cockpit exit versus ship exit) before adopting it as an aboard contract.

Use these observations in `lotj_holocron_navigation.lua`, where taking controls currently waits for the exact text `You grip the controls.` A fresh piloting transition can confirm that step and handle already-at-controls recovery once identity and operation timing are checked. Room vnum changes can confirm movement steps. GMCP must not advance an unrelated operation from stale state.

Radar should discover contacts and refresh the tactical scene. It should not be the primary aboard test. Retain launch/landing/hyperspace event parsing until equivalent authoritative phase telemetry is verified.

### 4. Reduce contact polling separately

Own-ship GMCP does not supply other ships' telemetry. Current defaults include fleet radar every six seconds, neutral contact status every ten seconds, and inactive formation probes every minute.

For travel, prioritize selected/threatening contacts and reduce neutral station scans. Exclude the observer from contact scans; back off repeated failed lookups until new contact evidence or a deliberate refresh. Cache unsupported formation commands by current ship context, invalidating on ship changes. Keep higher tactical refresh rates where contact/combat state requires them.

Static `info` caching already exists; preserve it and investigate repeated failures rather than replacing all `info` with GMCP.

### 5. Expand location and queue telemetry carefully

Fresh `Room.Info.planet` can reduce bare `showplanet` calls used only to identify location, once its semantics and naming are checked. Named `showplanet` remains necessary for markets, resources, and landing destinations. Room vnum/exits can support configured cockpit paths without scraping full descriptions.

Discover the actual `COMMANDSTACK` payload before designing a consumer. It could delay optional background polls while game commands are queued. An empty stack does not prove a jump, landing, purchase, or sale succeeded.

The help file also lists money fields but explicitly limits when they update. Treat those as timestamped observations; do not remove transaction confirmations or assume every trade pushes a new balance.

## Validation before migration

Capture only relevant GMCP event names, payloads, timestamps, and Holocron command reasons during: outside → board → cockpit → pilot → launch → hyperspace → arrival → land → release controls → cabin → leave, plus reconnect and switching ships. Include a station and a passenger case. This resolves presence/empty-packet semantics and packet cadence without collecting unrelated character data.

Add targeted regressions for correct subscription serialization, string/numeric piloting values, partial/stale/empty packets, reconnect invalidation, self-scan exclusion, and operation-bound confirmations. Verify that healthy own-ship GMCP eliminates routine self-status requests while contacts, failures, and flight transitions remain visible and correct. Compare a repeat run's command counts and log volume with this baseline.

## External sources checked

- [Mudlet sendGMCP API](https://wiki.mudlet.org/w/Manual:Networking_Functions#sendGMCP): single combined command string.
- [Official LotJ info panel](https://github.com/LotJ/lotj-mudlet-ui/blob/main/src/scripts/info-panel/info-panel.lua): ship fields and empty/nonempty overlay behavior.
- [Official LotJ mapper](https://github.com/LotJ/lotj-mudlet-ui/blob/main/src/scripts/mapper/mapper.lua): `Room.Info` fields and planet-based room classification.
- [Official LotJ setup](https://github.com/LotJ/lotj-mudlet-ui/blob/main/src/scripts/setup/setup.lua): subscriptions and initialization.

External source was read on 2026-09-08. Client conventions are evidence of intended behavior, not a substitute for the live server transition capture.
