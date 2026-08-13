local source = debug.getinfo(1, "S").source
local testPath = (source:sub(1, 1) == "@" and source:sub(2) or source):gsub("\\", "/")
local repoRoot = testPath:match("^(.*)/tests/scraper%.test%.lua$")
  or testPath:match("^tests/scraper%.test%.lua$") and "."
assert(repoRoot, "could not locate repository root from " .. testPath)
package.path = package.path .. ";" .. repoRoot .. "/mudlet/?.lua"

local nextId = 0
local eventHandlers = {}
local killedEventHandlers = {}
local stateTriggers = {}
local timers = {}
local sentCommands = {}
local deletedLines = 0
local deniedSends = 0

local function id(prefix)
  nextId = nextId + 1
  return prefix .. nextId
end

function registerAnonymousEventHandler(eventName, callback)
  local handlerId = id("event-")
  eventHandlers[handlerId] = {eventName = eventName, callback = callback}
  return handlerId
end

function tempRegexTrigger(pattern, callback)
  return id("line-")
end

function tempPromptTrigger(callback, expireAfter)
  return id("prompt-")
end

function tempTimer(seconds, callback)
  local timerId = id("timer-")
  timers[timerId] = {seconds = seconds, callback = callback}
  return timerId
end

function tempTrigger(pattern, callback)
  local triggerId = id("state-")
  stateTriggers[triggerId] = {pattern = pattern, callback = callback}
  return triggerId
end

function killAnonymousEventHandler(handlerId)
  killedEventHandlers[handlerId] = true
  eventHandlers[handlerId] = nil
  return true
end

function killTrigger(triggerId) return true end
function killTimer(timerId)
  timers[timerId] = nil
  return true
end

function send(command, echo)
  table.insert(sentCommands, {command = command, echo = echo})
  return true
end

function deleteLine()
  deletedLines = deletedLines + 1
end

local parsers = require("lotj_holocron_parsers")
local scraper = require("lotj_holocron_scraper")
local snapshots = {}
local spaceStates = {}
local diagnostics = {}
local intentHandlers = {}
local intentAcks = {}
local proxy = {
  parseGameOutput = function(_, _) end,
  publishSnapshot = function(observer, entities, metadata)
    table.insert(snapshots, {observer = observer, entities = entities, metadata = metadata})
    return true
  end,
  publishSpaceState = function(inSpace, reason)
    table.insert(spaceStates, {inSpace = inSpace, reason = reason})
    return true
  end,
  onDiagnostic = function(level, message)
    table.insert(diagnostics, {level = level, message = message})
  end,
  registerIntentHandler = function(action, handler)
    intentHandlers[action] = handler
    return true
  end,
  publishIntentAck = function(intentId, status, reason)
    table.insert(intentAcks, {id = intentId, status = status, reason = reason})
    return true
  end,
}
proxy.parseGameOutput = function(command, output)
  return parsers.parse(command, output)
end

assert(scraper.setup(proxy))
assert(#scraper.eventHandlerIds == 1, "expected one outgoing-command listener")
assert(#scraper.stateTriggerIds == 15,
  "expected space, maneuver, targeting, and autotrack response triggers")
assert(scraper.getPollingState().enabled == true, "polling should start with the scraper")
assert(scraper.getPollingState().timerId == nil,
  "polling must remain dormant until space activity is positively confirmed")
assert(#sentCommands == 0, "setup must not send commands over a login screen")

assert(type(intentHandlers.probe_space) == "function", "startup space probe intent should be registered")
local probed, probeError = intentHandlers.probe_space({}, {id = "startup-probe-1"})
assert(probed, probeError)
assert(scraper.active and scraper.active.spaceProbe,
  "startup space probe should begin a distinct radar capture")
assert(sentCommands[#sentCommands].command == "radar" and sentCommands[#sentCommands].echo == false,
  "startup space probe should issue one hidden radar command")
scraper.captureLine("Corellian System")
scraper.captureLine("Planet 'Corellia'  5000 -200 30")
scraper.captureLine("YT-1300 'Wayfarer'  800 -250 40")
scraper.captureLine("Your Coordinates:  10 20 -5")
assert(scraper.active == nil, "radar terminator should finish capture")
assert(#snapshots == 1)
assert(snapshots[1].observer.z == -5)
assert(#snapshots[1].entities == 2)
assert(snapshots[1].metadata.system == "Corellian System")
assert(spaceStates[1].inSpace == true, "successful space data should establish in-space state")
assert(scraper.getPollingState().timerId,
  "successful manual space output should activate dormant polling")
local startupHydration = scraper.getPollingState().hydrationQueue
assert(#startupHydration == 2 and startupHydration[1] == "status"
    and startupHydration[2] == "info",
  "a successful reconnect radar should prioritize missing observer status and info")

scraper.handleOutgoingCommand("sysDataSendRequest", "prox")
scraper.captureLine("Wayfarer  375")
scraper.captureLine("Corellia  5000")
scraper.captureLine("Your Coordinates: 12 22 -3")
assert(scraper.finishCapture("test prompt"))
assert(#snapshots == 2)
local wayfarer
for _, entity in ipairs(snapshots[2].entities) do
  if entity.name == "Wayfarer" then wayfarer = entity end
end
assert(wayfarer and wayfarer.distance == 375)
assert(wayfarer.x == 800, "proximity should enrich rather than replace radar data")
for _, entity in ipairs(snapshots[2].entities) do
  if entity.name == "Corellia" then
    assert(entity.kind == "planet", "proximity must preserve radar classification")
  end
end
assert(snapshots[2].observer.x == 12, "proximity coordinates belong to the observer")
for _, entity in ipairs(snapshots[2].entities) do
  assert(entity.name ~= "Your Coordinates", "observer must not be duplicated as an entity")
end

scraper.handleOutgoingCommand("sysDataSendRequest", "status")
scraper.captureLine("Forrestal:")
scraper.captureLine("Current Coordinates: 10 20 -5")
scraper.captureLine("Current Speed: 120/300")
assert(scraper.finishCapture("test prompt"))
assert(snapshots[3].observer.name == "Forrestal")
assert(snapshots[3].observer.x == 10)
assert(snapshots[3].observer.speed.maximum == 300)

scraper.handleOutgoingCommand("sysDataSendRequest", "info")
scraper.captureLine("Hatchway: 94599        Hangar Bays: 47894      Docking: 62351")
scraper.captureLine("Sensor Array: 7       Shield Boosters: 0       Communications: 0")
assert(scraper.finishCapture("test prompt"))
assert(snapshots[4].observer.sensorArray == 7)
assert(snapshots[4].observer.radarRange == 570)
assert(snapshots[4].observer.hatchway == nil, "access codes must not enter snapshots")
assert(scraper.lastCapture.lines[1]:find("redacted", 1, true), "info diagnostics must be redacted")
assert(#scraper.getPollingState().hydrationQueue == 0,
  "manual observer telemetry should satisfy the reconnect hydration queue")

scraper.handleOutgoingCommand("sysDataSendRequest", "fleetradar")
scraper.captureLine("Ship                     Squadron Leader          Position")
scraper.captureLine("Wayfarer                 Resolute                 Screen")
scraper.captureLine("Rojan-class Patrol Craft 'Forrestal' |  | (Ctr) 10 20 -5")
scraper.captureLine("Unknown-class Ship 'Not On Radar' |  | (Out) 100 200 300")
assert(scraper.finishCapture("test prompt"))
local fleetWayfarer
for _, entity in ipairs(snapshots[5].entities) do
  if entity.name == "Wayfarer" then fleetWayfarer = entity end
end
assert(fleetWayfarer and fleetWayfarer.leader == "Resolute")
assert(fleetWayfarer.position == "Screen")
assert(snapshots[5].observer.position == "Ctr")
for _, entity in ipairs(snapshots[5].entities) do
  assert(entity.name ~= "Forrestal", "observer must not be duplicated by fleetradar")
  assert(entity.name ~= "Not On Radar", "fleetradar must not expand a radar-owned contact list")
end

scraper.handleOutgoingCommand("sysDataSendRequest", "status")
scraper.captureLine("Wait until after you launch!")
assert(scraper.setInSpace(false, "LotJ reports that the ship has not launched"))
assert(scraper.active == nil, "landed state should abandon an active capture")
assert(spaceStates[2].inSpace == false)
assert(#snapshots[6].entities == 0, "landing should clear stale space entities")
scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
assert(scraper.active == nil, "landed state should suppress new captures")

local failedProbe, failedProbeError = intentHandlers.probe_space({}, {id = "startup-probe-2"})
assert(failedProbe, failedProbeError)
assert(scraper.active and scraper.active.spaceProbe,
  "startup probe must be allowed to re-check a previously landed state")
scraper.captureLine("You must be aboard a ship to use radar.")
assert(scraper.finishCapture("test prompt") == nil,
  "a startup radar response without telemetry should fail the probe")
assert(scraper.state.metadata.inSpace == false,
  "failed startup probe must keep all ship scraping disabled")
assert(scraper.getPollingState().timerId == nil,
  "failed startup probe must not schedule ship polling")

assert(scraper.setInSpace(true, "launch sequence complete"))
assert(spaceStates[3].inSpace == true)
scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
assert(scraper.active, "launch should re-enable capture")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("Your Coordinates:  20 30 40")

local polling = scraper.getPollingState()
assert(polling.timerId and timers[polling.timerId], "launch should resume polling")
timers[polling.timerId].callback()
assert(scraper.active and scraper.active.polled, "poll timer should begin a hidden capture")
assert(sentCommands[#sentCommands].command == "status Wayfarer",
  "a newly in-range ship without status telemetry should be scanned immediately")
scraper.captureLine("Readout for YT-1300 'Wayfarer':")
scraper.captureLine("Hull: 90/100  Shields: 40/50")
assert(scraper.finishCapture("test prompt"))

local discoveryInfoTimer = scraper.getPollingState().timerId
timers[discoveryInfoTimer].callback()
assert(sentCommands[#sentCommands].command == "info Wayfarer",
  "a newly in-range ship without info telemetry should receive both discovery scans")
scraper.captureLine("[Class: Transport] : YT-1300 'Wayfarer'")
scraper.captureLine("Sensor Array: 10")
assert(scraper.finishCapture("test prompt"))

local observerPollTimer = scraper.getPollingState().timerId
timers[observerPollTimer].callback()
assert(sentCommands[#sentCommands].command == "status")
assert(sentCommands[#sentCommands].echo == false, "poll commands should not echo input")
scraper.captureLine("Forrestal:")
scraper.captureLine("Current Coordinates: 20 30 40")
scraper.captureLine("Current Speed: 50/200")
assert(scraper.finishCapture("test prompt"))
assert(deletedLines == 3, "polled command output should be hidden")
assert(snapshots[#snapshots].observer.speed.current == 50)
assert(scraper.getPollingState().timerId, "successful poll should schedule the next command")

assert(scraper.setDisposition("Wayfarer", "enemy"))
local dispositionWayfarer
for _, entity in ipairs(snapshots[#snapshots].entities) do
  if entity.name == "Wayfarer" then dispositionWayfarer = entity end
end

function denyCurrentSend()
  deniedSends = deniedSends + 1
end
assert(dispositionWayfarer and dispositionWayfarer.disposition == "enemy")
local scanTimer = scraper.getPollingState().timerId
timers[scanTimer].callback()
assert(sentCommands[#sentCommands].command == "status Wayfarer",
  "in-range enemies should continue through the periodic targeted scan queue")
assert(scraper.active and scraper.active.parserCommand == "status")
scraper.captureLine("Readout for YT-1300 'Wayfarer':")
scraper.captureLine("Hull: 90/100  Shields: 40/50")
assert(scraper.finishCapture("test prompt"))

assert(type(intentHandlers.target_ship) == "function", "ship target intent should be registered")
local targeted, targetError = intentHandlers.target_ship({targetId = "wayfarer"}, {id = "target-test-1"})
assert(targeted, targetError)
assert(sentCommands[#sentCommands].command == "target Wayfarer",
  "target intent should issue LotJ's target command for the selected ship")
assert(scraper.getPollingState().timerId == nil,
  "polling must remain suspended throughout target-lock concentration")
local commandsWhileTargeting = #sentCommands
local blockedScan, blockedScanError = intentHandlers.scan_ship({
  targetId = "wayfarer", source = "info",
}, {id = "blocked-during-target"})
assert(not blockedScan and blockedScanError:find("target lock", 1, true),
  "other Holocron commands should be rejected while target concentration is active")
assert(#sentCommands == commandsWhileTargeting,
  "no command may be emitted while target concentration is active")
scraper.handleOutgoingCommand("sysDataSendRequest", "look")
assert(deniedSends == 1,
  "manually typed commands should be suppressed while target concentration is active")
for _, trigger in pairs(stateTriggers) do
  if trigger.pattern == "Target Locked." then trigger.callback() end
end
assert(sentCommands[#sentCommands].command == "autotrack"
    and sentCommands[#sentCommands].echo == false,
  "default combat autotrack should wait until LotJ confirms Target Locked")
assert(intentAcks[#intentAcks].id == "target-test-1"
    and intentAcks[#intentAcks].status == "completed",
  "Target Locked should complete the target intent")
assert(scraper.handleAutotrackResponse("Autotracking on.") == true)
assert(snapshots[#snapshots].observer.autotrack == true,
  "confirmed autotrack state should be published with the observer")
local targetedWayfarer
for _, entity in ipairs(snapshots[#snapshots].entities) do
  if entity.name == "Wayfarer" then targetedWayfarer = entity end
end
assert(targetedWayfarer and targetedWayfarer.disposition == "enemy",
  "targeting a ship should immediately classify it as an enemy")

local failedTarget, failedTargetError = intentHandlers.target_ship(
  {targetId = "wayfarer"}, {id = "target-test-2"})
assert(failedTarget, failedTargetError)
for _, trigger in pairs(stateTriggers) do
  if trigger.pattern == "Your concentration is broken. You fail to lock on to your target." then
    trigger.callback()
  end
end
assert(intentAcks[#intentAcks].id == "target-test-2"
    and intentAcks[#intentAcks].status == "rejected",
  "concentration failure should reject and release the target intent")
assert(scraper.getPollingState().timerId,
  "polling should resume after targeting definitively fails")

local incomingTargetSnapshots = #snapshots
assert(scraper.handleIncomingTargeting(
  "You are being targeted by Mark-I Assault Frigate 'Wayfarer'."))
local incomingTargetWayfarer
for _, entity in ipairs(snapshots[#snapshots].entities) do
  if entity.name == "Wayfarer" then incomingTargetWayfarer = entity end
end
assert(#snapshots == incomingTargetSnapshots + 1,
  "an incoming targeting event should immediately publish a new snapshot")
assert(incomingTargetWayfarer and incomingTargetWayfarer.disposition == "enemy",
  "a ship targeting the observer should immediately become an enemy")
assert(scraper.pendingCommandKind == nil,
  "an incoming targeting event must not affect the outgoing target-lock gate")

assert(type(intentHandlers.fire_weapon) == "function", "weapon firing intent should be registered")
scraper.state.observer.weapons = {
  autoblasters = 5, laserCannons = 1, turbolasers = 0, ionCannons = 2,
  maximumMissiles = 10, maximumTorpedoes = 0, maximumRockets = 0,
  maximumPulses = 0, missileTubes = 2,
}
scraper.state.observer.hasWeapons = true
local commandsBeforeSalvo = #sentCommands
local firedAll, fireAllError = intentHandlers.fire_weapon({weapon = "all"}, {id = "fire-all-1"})
assert(firedAll, fireAllError)
assert(#sentCommands == commandsBeforeSalvo + 4,
  "fire all should issue only the four installed weapon commands")
assert(sentCommands[#sentCommands - 3].command == "fire autoblaster")
assert(sentCommands[#sentCommands - 2].command == "fire laser")
assert(sentCommands[#sentCommands - 1].command == "fire ion")
assert(sentCommands[#sentCommands].command == "fire missile")

local combatSnapshots = #snapshots
assert(scraper.handleCombatLine("1 ion cannons fired..."))
assert(snapshots[#snapshots].metadata.combatEvent.type == "launch")
assert(snapshots[#snapshots].metadata.combatEvent.weapon == "ion")
assert(snapshots[#snapshots].metadata.combatEvent.targetName == "Wayfarer")
assert(scraper.handleCombatLine(
  "Your ship's ion cannons fire at Mark-I Assault Frigate 'Wayfarer' but miss."))
assert(snapshots[#snapshots].metadata.combatEvent.outcome == "miss")
local queuedCombatEvents = snapshots[#snapshots].metadata.combatEvents
assert(queuedCombatEvents[#queuedCombatEvents - 1].type == "launch"
    and queuedCombatEvents[#queuedCombatEvents].type == "impact",
  "combat telemetry must retain launch events when impact output follows immediately")
assert(scraper.handleCombatLine("Ion cannons fully charged."))
assert(snapshots[#snapshots].metadata.combatEvent.type == "charged")
assert(#snapshots == combatSnapshots + 3,
  "launch, impact, and recharge messages should each publish combat telemetry")

assert(scraper.handleCombatLine("You fail to lock on to your target!"))
assert(snapshots[#snapshots].metadata.combatEvent.type == "failure")
assert(snapshots[#snapshots].metadata.combatEvent.weapon == "missile")
local forwardArcCases = {
  {"The autoblaster cannons can only fire forwards. You'll need to turn your ship!", "autoblaster"},
  {"The main laser can only fire forwards. You'll need to turn your ship!", "laser"},
  {"The ion cannons can only fire forwards. You'll need to turn your ship!", "ion"},
  {"Missiles can only fire forwards. You'll need to turn your ship!", "missile"},
}
for _, forwardArcCase in ipairs(forwardArcCases) do
  assert(scraper.handleCombatLine(forwardArcCase[1]))
  local blockedEvent = snapshots[#snapshots].metadata.combatEvent
  assert(blockedEvent.type == "failure" and blockedEvent.weapon == forwardArcCase[2])
  assert(blockedEvent.reason == "Forward arc blocked // turn ship")
end
assert(scraper.handleCombatLine("Missile launcher(s) reloaded."))
assert(snapshots[#snapshots].metadata.combatEvent.type == "charged")
assert(scraper.handleCombatLine("Missile launched."))
local immediateMissileEventId = snapshots[#snapshots].metadata.combatEvent.id
assert(snapshots[#snapshots].metadata.combatEvent.type == "launch"
    and snapshots[#snapshots].metadata.combatEvent.weapon == "missile",
  "the immediate launcher confirmation should start the missile animation")
assert(scraper.handleCombatLine(
  "A missile is launched toward Mark-I Assault Frigate 'Wayfarer' by your ship."))
assert(snapshots[#snapshots].metadata.combatEvent.type == "launch")
assert(snapshots[#snapshots].metadata.combatEvent.targetName == "Wayfarer")
assert(snapshots[#snapshots].metadata.combatEvent.id == immediateMissileEventId,
  "the detailed missile line must not duplicate the immediate launch animation")
assert(scraper.handleCombatLine(
  "Your ship's missile hits Mark-I Assault Frigate 'Wayfarer' dead on!"))
assert(snapshots[#snapshots].metadata.combatEvent.outcome == "hit")

local commandsBeforeProjectileRadar = #sentCommands
assert(scraper.handleProjectileSummary("1 projectiles, 0 incoming (See radar projectiles)"))
assert(#sentCommands == commandsBeforeProjectileRadar + 1)
assert(sentCommands[#sentCommands].command == "radar projectiles")
assert(scraper.active and scraper.active.sentCommand == "radar projectiles")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("A Concussion Missile  110 25 20")
scraper.captureLine("Your Coordinates:  20 30 40")
local trackedProjectile
for _, entity in ipairs(snapshots[#snapshots].entities) do
  if entity.kind == "projectile" then trackedProjectile = entity end
end
assert(trackedProjectile and trackedProjectile.name == "A Concussion Missile",
  "radar projectiles should add live ordnance to the tactical snapshot")

scraper.combat.lastRadarAt = 0
local combatRadarTimer = scraper.getPollingState().timerId
assert(combatRadarTimer and timers[combatRadarTimer])
timers[combatRadarTimer].callback()
assert(sentCommands[#sentCommands].command == "radar projectiles",
  "combat should prioritize the projectile-inclusive radar command")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("A Concussion Missile  90 22 18")
scraper.captureLine("Your Coordinates:  20 30 40")

assert(type(intentHandlers.scan_ship) == "function", "manual ship scan intent should be registered")
local inspected, inspectError = intentHandlers.scan_ship({
  targetId = "wayfarer", source = "info",
}, {id = "scan-info-test-1"})
assert(inspected, inspectError)
assert(sentCommands[#sentCommands].command == "info Wayfarer")
assert(sentCommands[#sentCommands].echo == false, "manual scans should stay hidden in Mudlet")
assert(scraper.active and scraper.active.intentId == "scan-info-test-1")
scraper.captureLine("[Class: Transport] : YT-1300 'Wayfarer'")
scraper.captureLine("Sensor Array: 10")
assert(scraper.finishCapture("test prompt"))

local staleScan, staleScanError = intentHandlers.scan_ship({
  targetId = "wayfarer", source = "status",
}, {id = "scan-range-test-1"})
assert(staleScan, staleScanError)
scraper.captureLine("That target is too far away to scan.")
local staleResult, staleError = scraper.finishCapture("test prompt")
assert(not staleResult and staleError:find("outside sensor range", 1, true))
assert(intentAcks[#intentAcks].id == "scan-range-test-1"
  and intentAcks[#intentAcks].status == "rejected")

assert(type(intentHandlers.navigate_ship) == "function", "navigation intent should be registered")
local navigated, navigationError = intentHandlers.navigate_ship({
  mode = "relative", vector = {x = 125, y = -20, z = 80},
}, {id = "nav-test-1"})
assert(navigated, navigationError)
assert(sentCommands[#sentCommands].command == "course relative 125 -20 80")
local departure, departureError = intentHandlers.navigate_ship({
  mode = "relative", vector = {x = 40, y = 0, z = -60}, departureSpeed = 100,
}, {id = "departure-test-1"})
assert(departure, departureError)
assert(sentCommands[#sentCommands - 1].command == "speed 100",
  "a staged departure speed should be sent before its course command")
assert(sentCommands[#sentCommands].command == "course relative 40 0 -60")
local invalidDeparture, invalidDepartureError = intentHandlers.navigate_ship({
  mode = "relative", vector = {x = 40, y = 0, z = -60}, departureSpeed = 500,
})
assert(not invalidDeparture and invalidDepartureError:find("departure speed", 1, true))
local away, awayError = intentHandlers.navigate_ship({mode = "away", targetId = "wayfarer"}, {id = "away-test-1"})
assert(away, awayError)
assert(sentCommands[#sentCommands].command == "course away Wayfarer")
local planetCourse, planetCourseError = intentHandlers.navigate_ship({
  mode = "target", targetId = "corellia",
}, {id = "planet-course-test-1"})
assert(planetCourse, planetCourseError)
assert(sentCommands[#sentCommands].command == "course Corellia",
  "planet contacts should support direct course orders")
local planetAway, planetAwayError = intentHandlers.navigate_ship({
  mode = "away", targetId = "corellia",
}, {id = "planet-away-test-1"})
assert(planetAway, planetAwayError)
assert(sentCommands[#sentCommands].command == "course away Corellia",
  "planet contacts should support course-away orders")
local invalid, invalidError = intentHandlers.navigate_ship({mode = "relative", vector = {x = 0, y = 0, z = 0}})
assert(not invalid and invalidError:find("cannot be zero", 1, true))
local maneuverTrigger
local maneuverCompleteTrigger
for _, trigger in pairs(stateTriggers) do
  if trigger.pattern:find("finished its current maneuver", 1, true) then maneuverTrigger = trigger end
  if trigger.pattern:find("Maneuver complete", 1, true) then maneuverCompleteTrigger = trigger end
end
assert(maneuverTrigger, "maneuver rejection trigger should be installed")
assert(maneuverCompleteTrigger, "maneuver completion trigger should be installed")
maneuverTrigger.callback()
assert(intentAcks[#intentAcks].id == "away-test-1" and intentAcks[#intentAcks].status == "rejected")
local completing, completingError = intentHandlers.navigate_ship({
  mode = "relative", vector = {x = 20, y = 0, z = 10},
}, {id = "nav-complete-test-1"})
assert(completing, completingError)
maneuverCompleteTrigger.callback()
assert(intentAcks[#intentAcks].id == "nav-complete-test-1"
  and intentAcks[#intentAcks].status == "completed")
local changedSpeed, speedError = intentHandlers.set_ship_speed({speed = 75}, {id = "speed-test-1"})
assert(changedSpeed, speedError)
assert(sentCommands[#sentCommands].command == "speed 75")

assert(type(intentHandlers.set_autotrack) == "function", "autotrack intent should be registered")
local disabledTracking, disabledTrackingError = intentHandlers.set_autotrack({enabled = false}, {
  id = "autotrack-off-test-1",
})
assert(disabledTracking, disabledTrackingError)
assert(sentCommands[#sentCommands].command == "autotrack")
assert(scraper.handleAutotrackResponse("Autotracking on.") == true,
  "the first response may reveal that the toggle moved in the wrong direction")
assert(sentCommands[#sentCommands].command == "autotrack",
  "an opposite response should automatically reissue the toggle once")
assert(scraper.handleAutotrackResponse("Autotracking off.") == false)
assert(snapshots[#snapshots].observer.autotrack == false)
assert(snapshots[#snapshots].metadata.autotrackDesired == false)
assert(intentAcks[#intentAcks].id == "autotrack-off-test-1"
    and intentAcks[#intentAcks].status == "completed",
  "the desired autotrack state should complete only after LotJ confirms it")

assert(type(intentHandlers.recharge_shields) == "function",
  "manual shield recharge intent should be registered")
assert(type(intentHandlers.set_auto_recharge) == "function",
  "automatic shield recharge toggle should be registered")
scraper.pendingCommandKind = nil
scraper.state.observer.shields = {current = 40, maximum = 100}
local recharging, rechargeError = intentHandlers.recharge_shields({}, {id = "recharge-test-1"})
assert(recharging, rechargeError)
assert(sentCommands[#sentCommands].command == "recharge")
for attempt = 1, 9 do
  assert(scraper.handleRechargeResponse("Recharging shields.."))
  local timerId = scraper.shields.actionTimerId
  assert(timerId and timers[timerId])
  timers[timerId].callback()
  assert(sentCommands[#sentCommands].command == "recharge")
end
assert(scraper.handleRechargeResponse("Recharging shields.."))
assert(scraper.shields.statusPending == true,
  "ten successful recharge attempts should force an authoritative status check")
assert(sentCommands[#sentCommands].command == "status")
scraper.captureLine("Readout for Rojan-class Patrol Craft 'Forrestal':")
scraper.captureLine("Shields: 100/100 [100%]")
assert(scraper.finishCapture("shield safety check"))
assert(scraper.shields.recharging == false)
assert(intentAcks[#intentAcks].id == "recharge-test-1"
    and intentAcks[#intentAcks].status == "completed")

scraper.state.observer.shields = {current = 50, maximum = 100}
assert(scraper.handleShipHit(
  "You are hit by lasers from Assassin-Class Corvette 'Calculated'!", false))
local damageTimerId = scraper.shields.damageTimerId
assert(damageTimerId and timers[damageTimerId])
timers[damageTimerId].callback()
assert(sentCommands[#sentCommands].command == "status",
  "a damage burst should schedule one consolidated shield status check")

scraper.state.observer.hasWeapons = false
local unarmedTarget, unarmedTargetError = intentHandlers.target_ship({targetId = "wayfarer"})
assert(not unarmedTarget and unarmedTargetError == "this ship has no weapons",
  "Mudlet must reject target commands when info confirms the player ship is unarmed")

assert(scraper.teardown())
assert(proxy.scraper == nil)
assert(scraper.getPollingState().enabled == false)
assert(next(killedEventHandlers) ~= nil)

print("scraper tests passed")
