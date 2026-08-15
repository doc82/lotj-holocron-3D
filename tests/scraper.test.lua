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
local gmcpRequests = {}

lotj = {chat = {}, systemMap = {}}

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

function sendGMCP(command, payload)
  table.insert(gmcpRequests, {command = command, payload = payload})
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
assert(scraper.startProfiler(), "profiler should start on demand")
assert(#scraper.eventHandlerIds == 5,
  "expected outgoing-command, ship, galaxy, and GMCP protocol listeners")
assert(#scraper.stateTriggerIds == 18,
  "expected space, piloting, maneuver, targeting, autotrack, and hyperspace triggers")
assert(gmcpRequests[1].command == "Core.Supports.Add"
    and gmcpRequests[1].payload == '["Ship 1"]',
  "Holocron3D should add Ship.Info support without replacing other GMCP supports")
assert(gmcpRequests[2].command == "Core.Supports.Add"
    and gmcpRequests[2].payload == '["Galaxy 1"]',
  "Holocron3D should add Galaxy support without replacing other GMCP supports")
assert(scraper.getPollingState().enabled == true, "polling should start with the scraper")
assert(scraper.getPollingState().timerId == nil,
  "polling must remain dormant until space activity is positively confirmed")
assert(#sentCommands == 0, "setup must not send commands over a login screen")
assert(scraper.state.metadata.mudletCompatibility.lotjUiDetected == true,
  "the official LotJ UI should be detected without becoming a hard dependency")

assert(type(intentHandlers.probe_space) == "function", "startup space probe intent should be registered")
local probed, probeError = intentHandlers.probe_space({}, {id = "startup-probe-1"})
assert(probed, probeError)
assert(scraper.active and scraper.active.spaceProbe,
  "startup space probe should begin a distinct radar capture")
assert(sentCommands[#sentCommands].command == "radar" and sentCommands[#sentCommands].echo == false,
  "startup space probe should issue one hidden radar command")
local deletedBeforeCommunication = deletedLines
for _, communication in ipairs({
  "(OOC) @Bando [NEW]: My apologies, Paragod.",
  "[Red Team]{The Grand Council}<New Meat>[A Human male]: are you en route?",
  "CommNet 0 [Malakilli]: Testing",
  "'hello' you say.",
  "(OSAY) You say 'hello'",
}) do
  assert(scraper.captureLine(communication) == false,
    "communication must not belong to a telemetry response: " .. communication)
end
assert(deletedLines == deletedBeforeCommunication,
  "communication must remain available to Mudlet chat triggers")
scraper.captureLine("Corellian System")
scraper.captureLine("Planet 'Corellia'  5000 -200 30")
scraper.captureLine("YT-1300 'Wayfarer'  800 -250 40")
scraper.captureLine("Your Coordinates:  10 20 -5")
scraper.captureLine("[System Map] Radar data collected.")
scraper.captureLine("{Tone: none } {Time: night } {Ambience: quiet }")
assert(scraper.active, "hidden radar should retain its trailing response envelope")
assert(scraper.finishCapture("test prompt"))
assert(scraper.active == nil, "the prompt should finish a hidden radar capture")
assert(#snapshots == 1)
assert(snapshots[1].observer.z == -5)
assert(#snapshots[1].entities == 2)
assert(snapshots[1].metadata.system == "Corellian System")
local radarWayfarer
for _, entity in ipairs(snapshots[1].entities) do
  if entity.name == "Wayfarer" then radarWayfarer = entity end
end
assert(radarWayfarer and radarWayfarer.distance == 836,
  "radar coordinates should derive contact proximity without a prox poll")
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
assert(wayfarer and wayfarer.distance == 835,
  "snapshot distance should remain coordinate-derived after a manual prox refresh")
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
local statusSnapshot = snapshots[#snapshots]
assert(statusSnapshot.observer.name == "Forrestal")
assert(statusSnapshot.observer.x == 10)
assert(statusSnapshot.observer.speed.maximum == 300)

scraper.handleOutgoingCommand("sysDataSendRequest", "info")
scraper.captureLine("Hatchway: 94599        Hangar Bays: 47894      Docking: 62351")
scraper.captureLine("Sensor Array: 7       Shield Boosters: 0       Communications: 0")
assert(scraper.finishCapture("test prompt"))
local infoSnapshot = snapshots[#snapshots]
assert(infoSnapshot.observer.sensorArray == 7)
assert(infoSnapshot.observer.radarRange == 570)
assert(infoSnapshot.observer.hatchway == nil, "access codes must not enter snapshots")
assert(scraper.lastCapture.lines[1]:find("redacted", 1, true), "info diagnostics must be redacted")
assert(#scraper.getPollingState().hydrationQueue == 0,
  "manual observer telemetry should satisfy the reconnect hydration queue")

scraper.handleOutgoingCommand("sysDataSendRequest", "fleetradar")
scraper.captureLine("Corellian System")
scraper.captureLine("Ship                     Squadron Leader          Position")
scraper.captureLine("Wayfarer                 Resolute                 Screen")
scraper.captureLine("Rojan-class Patrol Craft 'Forrestal' |  | (Ctr) 10 20 -5")
scraper.captureLine("Unknown-class Ship 'Not On Radar' |  | (Out) 100 200 300")
assert(scraper.finishCapture("test prompt"))
local fleetSnapshot = snapshots[#snapshots]
local fleetWayfarer
for _, entity in ipairs(fleetSnapshot.entities) do
  if entity.name == "Wayfarer" then fleetWayfarer = entity end
end
assert(fleetWayfarer and fleetWayfarer.leader == "Resolute")
assert(fleetWayfarer.position == "Screen")
assert(fleetSnapshot.observer.position == "Ctr")
assert(fleetSnapshot.metadata.system == "Corellian System",
  "fleetradar should keep the current system fresh without a full radar poll")
local discoveredFleetContact
for _, entity in ipairs(fleetSnapshot.entities) do
  assert(entity.name ~= "Forrestal", "observer must not be duplicated by fleetradar")
  if entity.name == "Not On Radar" then discoveredFleetContact = entity end
end
assert(discoveredFleetContact and discoveredFleetContact.position == "Out",
  "fleetradar should discover new moving ship contacts between radar reconciliations")

scraper.handleOutgoingCommand("sysDataSendRequest", "status")
scraper.captureLine("Wait until after you launch!")
assert(scraper.setInSpace(false, "LotJ reports that the ship has not launched"))
assert(scraper.active == nil, "landed state should abandon an active capture")
assert(spaceStates[2].inSpace == false)
assert(#snapshots[#snapshots].entities == 0, "landing should clear stale space entities")
assert(scraper.getPollingState().enabled == false,
  "landing should fully disable polling rather than leave it armed")
assert(scraper.getPollingState().resumeWhenInSpace == true,
  "landing should remember that polling must resume after launch")
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
assert(scraper.getPollingState().enabled == true,
  "launch should re-enable polling for the new space session")
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
local deletedBeforeInfoEnvelope = deletedLines
scraper.captureLine("The Victory-class Star Destroyer, also known simply as the")
scraper.captureLine("Victory-class Destroyer, is a direct predecessor to the feared 'Imperial'")
scraper.captureLine("---------------------------------------------------------")
scraper.captureLine("(This ship is not equipped with cargo containers)")
scraper.captureLine("{Tone: none } {Time: night } {Ambience: quiet }")
scraper.captureLine("{Health: 3610/3610} {OOC:||||||} [ ] {Movement: 3460/3460} []")
scraper.captureLine("")
assert(scraper.captureLine("(OOC) @Bando: chat during info") == false,
  "chat interleaved with a hidden response must remain visible")
assert(scraper.captureLine(
  "You are hit by lasers from Assassin-Class Corvette 'Calculated'!") == false,
  "asynchronous combat output must remain visible during hidden scans")
scraper.captureLine("Sensor Array: 10")
assert(scraper.finishCapture("test prompt"))
assert(deletedLines == deletedBeforeInfoEnvelope + 8,
  "the complete hidden info envelope should be suppressed without hiding chat or combat")

-- This section exercises the observer fallback cycle, so keep independent
-- formation refreshes from legitimately occupying the next poll slot.
scraper.polling.lastBattlegroupAt = os.time()
scraper.polling.lastSquadronAt = os.time()
scraper.polling.lastFleetRadarAt = os.time()
local observerPollTimer = scraper.getPollingState().timerId
timers[observerPollTimer].callback()
assert(sentCommands[#sentCommands].command == "status")
assert(sentCommands[#sentCommands].echo == false, "poll commands should not echo input")
local deletedBeforeObserverPoll = deletedLines
scraper.captureLine("Forrestal:")
scraper.captureLine("Current Coordinates: 20 30 40")
scraper.captureLine("Current Speed: 50/200")
assert(scraper.finishCapture("test prompt"))
assert(deletedLines == deletedBeforeObserverPoll + 3,
  "only recognized lines owned by a polled command should be hidden")
assert(snapshots[#snapshots].observer.speed.current == 50)
assert(scraper.getPollingState().timerId, "successful poll should schedule the next command")

assert(scraper.startCapture("radar", "radar", {polled = true, pollDelay = 0.25}))
scraper.captureLine("YT-1300 'Incomplete'  1 2 3")
scraper.handleOutgoingCommand("sysDataSendRequest", "ooc Manual chat wins")
assert(scraper.active == nil, "manual Mudlet input should preempt a background capture")
local userIdleTimer = scraper.getPollingState().timerId
assert(userIdleTimer and timers[userIdleTimer].seconds == scraper.USER_IDLE_POLL_DELAY_SECONDS,
  "background polling should debounce after manual Mudlet activity")

local deletedBeforeExternalRadar = deletedLines
scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
assert(scraper.active and scraper.active.polled == false,
  "radar issued by Mudlet or another package should be adopted as visible telemetry")
assert(scraper.captureLine("(OOC) @Wireguided: chat during radar") == false)
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("Your Coordinates:  20 30 40")
assert(deletedLines == deletedBeforeExternalRadar,
  "an externally issued radar response must remain visible")

assert(scraper.setDisposition("Wayfarer", "enemy"))
local dispositionWayfarer
for _, entity in ipairs(snapshots[#snapshots].entities) do
  if entity.name == "Wayfarer" then dispositionWayfarer = entity end
end

function denyCurrentSend()
  deniedSends = deniedSends + 1
end
assert(dispositionWayfarer and dispositionWayfarer.disposition == "enemy")
scraper.scanState.wayfarer.statusAt = os.time()
  - scraper.polling.hostileScanIntervalSeconds
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
scraper.combat.lastActivityAt = 0
scraper.state.metadata.projectileCount = 0
scraper.state.metadata.incomingProjectileCount = 0
assert(scraper.combat.targetName == "Wayfarer")
assert(scraper.isCombatPollingActive(os.time()) == false,
  "a selected or locked target alone must not enable fast projectile polling")
scraper.combat.lastActivityAt = os.time()
assert(scraper.isCombatPollingActive(os.time()) == true,
  "actual recent combat activity should enable fast projectile polling")
scraper.combat.lastActivityAt = 0
scraper.state.metadata.projectileCount = 1
assert(scraper.isCombatPollingActive(os.time()) == true,
  "known live projectiles should keep projectile polling active")
scraper.state.metadata.projectileCount = 0

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
scraper.combat.lastLaunchAt = 0
scraper.fleetCommand.currentMemberName = "TeeHee"
assert(scraper.handleCombatLine("Rocket launched."))
local teeHeeLaunch = snapshots[#snapshots].metadata.combatEvent
assert(teeHeeLaunch.sourceName == "TeeHee")
scraper.fleetCommand.currentMemberName = "ReeHeeHee"
assert(scraper.handleCombatLine("Rocket launched."))
local reeHeeLaunch = snapshots[#snapshots].metadata.combatEvent
assert(reeHeeLaunch.id > teeHeeLaunch.id and reeHeeLaunch.sourceName == "ReeHeeHee",
  "identical fleet weapons launched by different ships need distinct source flashes")
scraper.state.metadata.fleetOrder = {
  id = 99, order = "fire", weapon = "torpedo", status = "awaiting",
  observedAt = os.time(), pendingCount = 1, results = {
    ReeHeeHee = {name = "ReeHeeHee", status = "awaiting"},
  },
}
scraper.fleetCommand.currentMemberName = "ReeHeeHee"
assert(scraper.handleCombatLine("You fail to lock on to your target!"))
local failedFleetShot = snapshots[#snapshots].metadata.combatEvent
assert(failedFleetShot.type == "failure" and failedFleetShot.weapon == "torpedo"
    and failedFleetShot.sourceName == "ReeHeeHee",
  "failed fleet launcher locks must retain their ship and projectile type")
assert(scraper.state.metadata.fleetOrder.results.ReeHeeHee.status == "rejected"
    and scraper.state.metadata.fleetOrder.rejectedCount == 1,
  "a failed lock must reject only that ship's fire order")
assert(scraper.handleCombatLine(
  "Your ship's missile hits Mark-I Assault Frigate 'Wayfarer' dead on! [x2]"))
assert(snapshots[#snapshots].metadata.combatEvent.outcome == "hit")
assert(snapshots[#snapshots].metadata.combatEvent.count == 2,
  "Mudlet repeat counts must produce one confirmed impact pulse per hit")
local missileImpactId = snapshots[#snapshots].metadata.combatEvent.id
assert(scraper.handleCombatLine(
  "You see a large explosion as Mark-I Assault Frigate 'Wayfarer' is hit by a missile."))
assert(snapshots[#snapshots].metadata.combatEvent.id == missileImpactId,
  "the descriptive explosion line must not duplicate the projectile impact")
assert(scraper.handleCombatLine(
  "An ion blast from Victory-II Class Star Destroyer 'ReeHeeHee' hits Mark-I Assault Frigate 'Wayfarer'. [x5]"))
local wingImpact = snapshots[#snapshots].metadata.combatEvent
assert(wingImpact.type == "impact" and wingImpact.weapon == "ion"
    and wingImpact.sourceName == "ReeHeeHee" and wingImpact.targetName == "Wayfarer"
    and wingImpact.count == 5 and wingImpact.outcome == "hit",
  "explicit wing-ship hit confirmations must retain source and repeated hit count")
assert(scraper.handleCombatLine(
  "An ion blast from Victory-II Class Star Destroyer 'ReeHeeHee' barely misses Mark-I Assault Frigate 'Wayfarer'."))
assert(snapshots[#snapshots].metadata.combatEvent.outcome == "miss",
  "explicit wing-ship misses must not be rendered as hits")
local reconcileTimer = scraper.combat.projectileReconcileTimerId
assert(reconcileTimer and timers[reconcileTimer],
  "projectile impacts should schedule an immediate radar reconciliation")
local commandsBeforeImpactRadar = #sentCommands
timers[reconcileTimer].callback()
assert(#sentCommands == commandsBeforeImpactRadar + 1
    and sentCommands[#sentCommands].command == "radar projectiles",
  "impact reconciliation should immediately request radar projectiles")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("Your Coordinates:  20 30 40")
assert(scraper.finishCapture("impact projectile reconciliation"))
for _, entity in ipairs(snapshots[#snapshots].entities) do
  assert(entity.kind ~= "projectile",
    "projectiles missing after an impact reconciliation must leave the snapshot")
end

scraper.combat.projectileRadarRequestedAt = 0
local commandsBeforeProjectileRadar = #sentCommands
assert(scraper.handleProjectileSummary("1 projectiles, 0 incoming (See radar projectiles)"))
assert(#sentCommands == commandsBeforeProjectileRadar + 1)
assert(sentCommands[#sentCommands].command == "radar projectiles")
assert(scraper.active and scraper.active.sentCommand == "radar projectiles")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("A Concussion Missile  110 25 20")
scraper.captureLine("Your Coordinates:  20 30 40")
assert(scraper.finishCapture("test prompt"))
local trackedProjectile
for _, entity in ipairs(snapshots[#snapshots].entities) do
  if entity.kind == "projectile" then trackedProjectile = entity end
end
assert(trackedProjectile and trackedProjectile.name == "A Concussion Missile",
  "radar projectiles should add live ordnance to the tactical snapshot")

-- The preceding fleet-fire failure intentionally installs a short command
-- hold. This section independently exercises combat radar prioritization.
scraper.fleetCommand.holdUntil = 0
scraper.combat.lastRadarAt = 0
local combatRadarTimer = scraper.getPollingState().timerId
assert(combatRadarTimer and timers[combatRadarTimer])
timers[combatRadarTimer].callback()
assert(sentCommands[#sentCommands].command == "radar projectiles",
  "combat should prioritize the projectile-inclusive radar command")
assert(scraper.active and scraper.active.sentCommand == "radar projectiles",
  "combat radar polling should start a new capture")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  200 30 40")
scraper.captureLine("A Concussion Missile  90 22 18")
scraper.captureLine("Your Coordinates:  20 30 40")
assert(scraper.finishCapture("test prompt"))

local function projectileIdsByX()
  local ids = {}
  for _, entity in pairs(scraper.state.entities) do
    if entity.kind == "projectile" then ids[entity.x] = entity.id end
  end
  return ids
end

assert(scraper.applyResult(assert(parsers.parse("radar projectiles", [[
Corellian System
A Heavy Rocket  100 0 0
A Heavy Rocket  200 0 0
Your Coordinates: 0 0 0
]])), "radar projectiles"))
local initialRocketIds = projectileIdsByX()
assert(initialRocketIds[100] and initialRocketIds[200]
    and initialRocketIds[100] ~= initialRocketIds[200],
  "identical projectiles must receive distinct tracking identities")
assert(scraper.applyResult(assert(parsers.parse("radar projectiles", [[
Corellian System
A Heavy Rocket  80 0 0
A Heavy Rocket  180 0 0
Your Coordinates: 0 0 0
]])), "radar projectiles"))
local movingRocketIds = projectileIdsByX()
assert(movingRocketIds[80] == initialRocketIds[100]
    and movingRocketIds[180] == initialRocketIds[200],
  "projectile identities must follow their motion rather than radar row order")
assert(scraper.applyResult(assert(parsers.parse("radar projectiles", [[
Corellian System
A Heavy Rocket  160 0 0
Your Coordinates: 0 0 0
]])), "radar projectiles"))
local survivingRocketIds = projectileIdsByX()
assert(survivingRocketIds[160] == initialRocketIds[200],
  "a surviving projectile must not inherit an exploded projectile's identity")

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

local navigationDiagnostics = #diagnostics
local deletedBeforeNavigationFailure = deletedLines
local refreshed, refreshError = intentHandlers.refresh_navigation({command = "calc"}, {
  id = "navigation-computer-test-1",
})
assert(refreshed, refreshError)
assert(sentCommands[#sentCommands].command == "calc")
scraper.captureLine("You must be at a nav computer to calculate jumps.")
local refreshResult, navigationComputerError = scraper.finishCapture("test prompt")
assert(not refreshResult and navigationComputerError:find("navigation computer", 1, true))
assert(deletedLines == deletedBeforeNavigationFailure + 1,
  "expected hidden navigation failures to be removed from the Mudlet console")
assert(#diagnostics == navigationDiagnostics,
  "expected navigation availability failures not to emit parser diagnostics")
assert(intentAcks[#intentAcks].id == "navigation-computer-test-1"
    and intentAcks[#intentAcks].status == "rejected",
  "expected one authoritative navigation rejection")

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

assert(type(intentHandlers.escape_hyperspace) == "function",
  "hyperspace transit should expose an emergency cutoff intent")
scraper.hyperspace.phase = "idle"
local invalidEscape, invalidEscapeError = intentHandlers.escape_hyperspace({})
assert(not invalidEscape and invalidEscapeError:find("not currently", 1, true),
  "the emergency cutoff must be rejected outside hyperspace")
scraper.hyperspace.phase = "hyperspace"
local escaped, escapeError = intentHandlers.escape_hyperspace({})
assert(escaped, escapeError)
assert(sentCommands[#sentCommands].command == "hyper off"
    and sentCommands[#sentCommands].echo == false,
  "the emergency cutoff should issue the explicit hyper off command")
assert(scraper.state.metadata.hyperspace.escapeRequestedAt ~= nil)
scraper.hyperspace.phase = "idle"

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
assert(type(intentHandlers.fleet_order) == "function",
  "fleet command orchestration intent should be registered")
scraper.state.observer.name = "Previous Carrier"
local launchedSquadron = {
  kind = "squadron", active = true, members = {
    {id = "heehee", name = "HeeHee", leader = true, role = "lead"},
    {id = "hhee2", name = "Hhee2", leader = false, role = "wing"},
  },
}
assert(scraper.applyResult({source = "squadron", fleet = launchedSquadron}, "squadron status"))
assert(scraper.state.metadata.fleet.role == nil,
  "a squadron observed before launch status should not guess the local role")
assert(scraper.applyResult({source = "status", name = "HeeHee"}, "status"))
assert(scraper.state.metadata.fleet.role == "lead",
  "observer hydration after launch should enable lead squadron commands")
scraper.state.metadata.fleetOrder = {
  id = 1, order = "navigate", scope = "wings", status = "transmitted",
  observedAt = os.time(), results = {},
}
assert(scraper.handleFleetCommandLine(
  "Sending command to Imperial-II Class Star Destroyer 'TeeHee'..."))
assert(scraper.handleFleetCommandLine("New course set, approaching 0 0 0."))
assert(scraper.state.metadata.fleetOrder.results.TeeHee.status == "accepted")
assert(scraper.handleFleetCommandLine(
  "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."))
assert(scraper.handleFleetCommandLine(
  "You'll have to disengage the ship's autopilot first."))
assert(scraper.state.metadata.fleetOrder.results.ReeHeeHee.status == "rejected")
assert(scraper.state.metadata.fleetOrder.status == "partial"
    and scraper.state.metadata.fleetOrder.acceptedCount == 1
    and scraper.state.metadata.fleetOrder.rejectedCount == 1,
  "fleet movement should expose per-ship partial failures")
scraper.state.observer.name = "TeeHee"
scraper.state.metadata.fleet = {
  kind = "battlegroup", active = true, role = "commander", members = {
    {id = "teehee", name = "TeeHee", leader = true, role = "leader"},
    {id = "reeheehee", name = "ReeHeeHee", leader = false, role = "wing", slot = 1},
  },
}
scraper.state.metadata.formations.battlegroup = scraper.state.metadata.fleet
scraper.state.observer.hasWeapons = true
scraper.state.observer.weapons = {turbolasers = 7, ionCannons = 2}
local fleetTargeted, fleetTargetError = intentHandlers.fleet_order({
  order = "target", scope = "all", targetId = "wayfarer",
})
assert(fleetTargeted, fleetTargetError)
assert(sentCommands[#sentCommands].command == "battlegroup target all Wayfarer",
  "all-fleet targeting must use only the battlegroup target channel")
assert(scraper.state.metadata.combatTarget == "Wayfarer")

local fireStart = #sentCommands
local fleetFired, fleetFireError = intentHandlers.fleet_order({
  order = "fire", scope = "all", weapon = "all",
})
assert(fleetFired, fleetFireError)
local sawFleetTurbolaser, sawFleetIon = false, false
for index = fireStart + 1, #sentCommands do
  local command = sentCommands[index].command
  assert(command:find("battlegroup nav all ", 1, true) == 1,
    "fire-all must never fall through to a direct cockpit fire command")
  if command == "battlegroup nav all fire turbolaser" then sawFleetTurbolaser = true end
  if command == "battlegroup nav all fire ion" then sawFleetIon = true end
end
assert(sawFleetTurbolaser and sawFleetIon,
  "fire-all should preserve every known installed flagship weapon")

scraper.state.metadata.fleetOrder = {
  id = 90, order = "fire", weapon = "ion", scope = "all", status = "transmitted",
  observedAt = os.time(), results = {},
}
assert(scraper.handleFleetCommandLine(
  "Sending command to Imperial-II Class Star Destroyer 'TeeHee'..."))
assert(scraper.handleCombatLine("2 ion cannons fired..."))
assert(scraper.handleFleetCommandLine(
  "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."))
assert(scraper.handleCombatLine("2 ion cannons fired..."))
local fleetIonEvents = scraper.state.metadata.combatEvents
assert(fleetIonEvents[#fleetIonEvents - 1].sourceName == "TeeHee"
    and fleetIonEvents[#fleetIonEvents].sourceName == "ReeHeeHee",
  "each battlegroup energy volley must retain its own firing ship")

local localFired, localFireError = intentHandlers.fleet_order({
  order = "fire", scope = "local", weapon = "best",
})
assert(localFired, localFireError)
assert(sentCommands[#sentCommands].command == "battlegroup nav TeeHee fire",
  "local flagship fire should still travel through battlegroup nav")

local selectedWingFired, selectedWingFireError = intentHandlers.fleet_order({
  order = "fire", scope = "selected", weapon = "ion",
  memberId = "reeheehee", memberName = "ReeHeeHee",
})
assert(selectedWingFired, selectedWingFireError)
assert(sentCommands[#sentCommands].command == "battlegroup nav ReeHeeHee fire ion",
  "a selected battlegroup member must receive its specific weapon order directly")

scraper.state.metadata.fleet = {
  kind = "squadron", active = true, role = "lead", assist = true,
  aimSystem = "Laser", members = {
    {id = "teehee", name = "TeeHee", leader = true, role = "lead"},
    {id = "wing-one", name = "Wing One", leader = false, role = "wing"},
  },
}
scraper.state.metadata.formations.squadron = scraper.state.metadata.fleet

local squadronFireStart = #sentCommands
local squadronLocalFired, squadronLocalFireError = intentHandlers.fire_weapon({weapon = "ion"})
assert(squadronLocalFired, squadronLocalFireError)
assert(#sentCommands == squadronFireStart + 1
    and sentCommands[#sentCommands].command == "fire ion",
  "local-mode squadron fire must use the lead ship's normal fire command exactly once")

local squadronRolled, squadronRollError = intentHandlers.fleet_order({
  order = "roll", scope = "all",
})
assert(squadronRolled, squadronRollError)
assert(sentCommands[#sentCommands].command == "squadron roll"
    and sentCommands[#sentCommands - 1].command ~= "roll",
  "the squadron roll control must issue only the native squadron command")

local squadronChaffed, squadronChaffError = intentHandlers.fleet_order({
  order = "chaff", scope = "all",
})
assert(squadronChaffed, squadronChaffError)
assert(sentCommands[#sentCommands].command == "squadron chaff"
    and sentCommands[#sentCommands - 1].command ~= "chaff",
  "the squadron chaff control must issue only the native squadron command")

local squadronAssisted, squadronAssistError = intentHandlers.fleet_order({
  order = "assist", scope = "all",
})
assert(squadronAssisted, squadronAssistError)
assert(sentCommands[#sentCommands].command == "squadron assist")

local squadronAimCleared, squadronAimClearError = intentHandlers.fleet_order({
  order = "aim", scope = "all", system = "none",
})
assert(squadronAimCleared, squadronAimClearError)
assert(sentCommands[#sentCommands].command == "squadron aim none")

scraper.state.metadata.fleet = scraper.state.metadata.formations.battlegroup

local toggledFleet, toggleFleetError = intentHandlers.fleet_order({
  order = "autopilot", scope = "all",
})
assert(toggledFleet, toggleFleetError)
assert(sentCommands[#sentCommands].command == "battlegroup nav all autopilot",
  "all-fleet autopilot must not also toggle the local flagship a second time")
assert(sentCommands[#sentCommands - 1].command ~= "autopilot",
  "all-fleet orders already include the flagship")
assert(scraper.handleFleetCommandLine(
  "Sending command to Imperial-II Class Star Destroyer 'TeeHee'..."))
assert(scraper.handleFleetCommandLine("Autopilot ON."))
assert(scraper.handleFleetCommandLine(
  "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."))
assert(scraper.handleFleetCommandLine("Autopilot OFF."))
assert(scraper.state.metadata.fleet.members[1].autopilot == true)
assert(scraper.state.metadata.fleet.members[2].autopilot == false)
assert(scraper.state.metadata.fleetOrder.status == "accepted"
    and scraper.state.metadata.fleetOrder.pendingCount == 0,
  "explicit ON/OFF responses should complete every fleet tile")

local toggledWing, toggleWingError = intentHandlers.fleet_order({
  order = "autopilot", scope = "wings",
})
assert(toggledWing, toggleWingError)
assert(sentCommands[#sentCommands].command == "battlegroup nav 1 autopilot",
  "wing-only toggles must not include the flagship")
local verificationTimer = scraper.fleetCommand.verificationTimerId
assert(verificationTimer and timers[verificationTimer])
timers[verificationTimer].callback()
assert(scraper.polling.hydrationQueue[1] == "status ReeHeeHee",
  "a missed toggle response should queue an authoritative targeted status")
scraper.polling.hydrationQueue = {}

scraper.state.metadata.hyperspace.phase = "idle"
scraper.hyperspace.phase = "idle"
scraper.handleOutgoingCommand("sysDataSendRequest", "battlegroup nav 1 hyp")
assert(scraper.handleHyperspaceLine("You push forward the hyperspeed lever."))
assert(scraper.state.metadata.hyperspace.phase == "idle",
  "a wing hyperspace response must not engage the player transit view")
assert(scraper.handleHyperspaceLine(
  "The stars become streaks of light as you enter hyperspace."))
local jumpEvents = snapshots[#snapshots].metadata.shipJumpEvents
assert(jumpEvents and jumpEvents[#jumpEvents].shipName == "ReeHeeHee",
  "a wing hyperspace response should publish a ship-specific tactical event")
assert(scraper.state.metadata.hyperspace.phase == "idle",
  "a wing departure must leave player hyperspace idle")

scraper.handleOutgoingCommand("sysDataSendRequest", "hyper")
assert(scraper.handleHyperspaceLine(
  "The stars become streaks of light as you enter hyperspace."))
assert(scraper.state.metadata.hyperspace.phase == "hyperspace",
  "a direct local hyper command should engage the player transit view")
scraper.state.metadata.hyperspace.phase = "idle"
scraper.hyperspace.phase = "idle"
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

gmcp = {Ship = {Info = {
  energy = 2773, maxEnergy = 4500,
  hull = 115, maxHull = 115,
  shield = 60, maxShield = 60,
  speed = 50, maxSpeed = 170,
  posX = 101, posY = -22, posZ = 303,
  headX = 1, headY = 0, headZ = -1,
  piloting = false,
}}}
assert(scraper.handleShipGmcp())
local gmcpObserver = snapshots[#snapshots].observer
assert(gmcpObserver.speed.current == 50 and gmcpObserver.speed.maximum == 170)
assert(gmcpObserver.x == 101 and gmcpObserver.y == -22 and gmcpObserver.z == 303)
assert(gmcpObserver.hull.current == 115 and gmcpObserver.shields.maximum == 60)
assert(gmcpObserver.heading.x == 1 and gmcpObserver.heading.z == -1)
assert(gmcpObserver.piloting == false,
  "piloting false describes control-seat state and must not change in-space state")
assert(scraper.state.metadata.inSpace == true)
assert(scraper.state.metadata.sources.ship_gmcp ~= nil)

gmcp.Ship.Info.headX, gmcp.Ship.Info.headY, gmcp.Ship.Info.headZ = 0, 0, 0
assert(scraper.handleShipGmcp())
assert(snapshots[#snapshots].observer.heading.x == 1,
  "an ambiguous zero GMCP heading should preserve the last useful heading")

local gripTrigger
for _, trigger in pairs(stateTriggers) do
  if trigger.pattern == "You grip the controls." then gripTrigger = trigger end
end
assert(gripTrigger, "gripping the controls should have an info hydration trigger")
gripTrigger.callback()
assert(scraper.getPollingState().hydrationQueue[1] == "info",
  "gripping the controls should prioritize fresh ship info")

scraper.state.observer.hasWeapons = false
local unarmedTarget, unarmedTargetError = intentHandlers.target_ship({targetId = "wayfarer"})
assert(not unarmedTarget and unarmedTargetError == "this ship has no weapons",
  "Mudlet must reject target commands when info confirms the player ship is unarmed")

local profileReport = assert(scraper.getProfilerReport())
assert(profileReport.enabled == true)
assert((profileReport.counts.capturesStarted or 0) > 0,
  "profiler should count capture activity")
assert((profileReport.counts.capturedLines or 0) > 0,
  "profiler should count owned output lines")
assert((profileReport.counts.snapshotPublishes or 0) > 0,
  "profiler should count full snapshot publications")
assert((profileReport.counts.shipGmcpEvents or 0) == 2,
  "profiler should count Ship.Info events")
assert(type(profileReport.timings.publish) == "table"
    and profileReport.timings.publish.count > 0,
  "profiler should time snapshot publication")
local stoppedProfile = assert(scraper.stopProfiler())
assert(stoppedProfile.enabled == false and scraper.profiler.enabled == false,
  "stopping the profiler should retain its final report and disable collection")

assert(scraper.teardown())
assert(proxy.scraper == nil)
assert(scraper.getPollingState().enabled == false)
assert(next(killedEventHandlers) ~= nil)

print("scraper tests passed")
