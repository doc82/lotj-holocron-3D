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
}
proxy.parseGameOutput = function(command, output)
  return parsers.parse(command, output)
end

assert(scraper.setup(proxy))
assert(#scraper.eventHandlerIds == 1, "expected one outgoing-command listener")
assert(#scraper.stateTriggerIds == 3, "expected landed and launched state triggers")
assert(scraper.getPollingState().enabled == true, "polling should start with the scraper")

scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
assert(scraper.active, "outgoing radar should begin capture")
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

scraper.handleOutgoingCommand("sysDataSendRequest", "fleetradar")
scraper.captureLine("Ship                     Squadron Leader          Position")
scraper.captureLine("Wayfarer                 Resolute                 Screen")
scraper.captureLine("Rojan-class Patrol Craft 'Forrestal' |  | (Ctr) 10 20 -5")
scraper.captureLine("Unknown-class Ship 'Not On Radar' |  | (Out) 100 200 300")
assert(scraper.finishCapture("test prompt"))
local fleetWayfarer
for _, entity in ipairs(snapshots[4].entities) do
  if entity.name == "Wayfarer" then fleetWayfarer = entity end
end
assert(fleetWayfarer and fleetWayfarer.leader == "Resolute")
assert(fleetWayfarer.position == "Screen")
assert(snapshots[4].observer.position == "Ctr")
for _, entity in ipairs(snapshots[4].entities) do
  assert(entity.name ~= "Forrestal", "observer must not be duplicated by fleetradar")
  assert(entity.name ~= "Not On Radar", "fleetradar must not expand a radar-owned contact list")
end

scraper.handleOutgoingCommand("sysDataSendRequest", "status")
scraper.captureLine("Wait until after you launch!")
assert(scraper.setInSpace(false, "LotJ reports that the ship has not launched"))
assert(scraper.active == nil, "landed state should abandon an active capture")
assert(spaceStates[2].inSpace == false)
assert(#snapshots[5].entities == 0, "landing should clear stale space entities")
scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
assert(scraper.active == nil, "landed state should suppress new captures")

assert(scraper.setInSpace(true, "launch sequence complete"))
assert(spaceStates[3].inSpace == true)
scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
assert(scraper.active, "launch should re-enable capture")
scraper.captureLine("Corellian System")
scraper.captureLine("YT-1300 'Wayfarer'  800 -250 40")
scraper.captureLine("Your Coordinates:  20 30 40")

local polling = scraper.getPollingState()
assert(polling.timerId and timers[polling.timerId], "launch should resume polling")
timers[polling.timerId].callback()
assert(scraper.active and scraper.active.polled, "poll timer should begin a hidden capture")
assert(sentCommands[#sentCommands].command == "status")
assert(sentCommands[#sentCommands].echo == false, "poll commands should not echo input")
scraper.captureLine("Forrestal:")
scraper.captureLine("Current Coordinates: 20 30 40")
scraper.captureLine("Current Speed: 50/200")
assert(scraper.finishCapture("test prompt"))
assert(deletedLines == 3, "polled command output should be hidden")
assert(snapshots[#snapshots].observer.speed.current == 50)
assert(scraper.getPollingState().timerId, "successful poll should schedule the next command")

assert(scraper.teardown())
assert(proxy.scraper == nil)
assert(scraper.getPollingState().enabled == false)
assert(next(killedEventHandlers) ~= nil)

print("scraper tests passed")
