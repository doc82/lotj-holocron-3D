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
assert(#scraper.stateTriggerIds == 8,
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

scraper.state.observer.hasWeapons = false
local unarmedTarget, unarmedTargetError = intentHandlers.target_ship({targetId = "wayfarer"})
assert(not unarmedTarget and unarmedTargetError == "this ship has no weapons",
  "Mudlet must reject target commands when info confirms the player ship is unarmed")

assert(scraper.teardown())
assert(proxy.scraper == nil)
assert(scraper.getPollingState().enabled == false)
assert(next(killedEventHandlers) ~= nil)

print("scraper tests passed")
