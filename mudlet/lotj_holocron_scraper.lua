-- LotJ Holocron 3D - live Mudlet command/output collector
-- Installs temporary aliases and triggers; nothing persists in the profile.

local Scraper = {
  CAPTURE_TIMEOUT_SECONDS = 8,
  MAX_CAPTURE_LINES = 300,
  MAX_CAPTURE_BYTES = 256 * 1024,
  POLL_COMMANDS = {"status", "info", "radar", "prox", "prox velocity", "fleetradar"},
  POLL_COMMAND_GAP_SECONDS = 1,
  POLL_CYCLE_DELAY_SECONDS = 5,
  eventHandlerIds = {},
  stateTriggerIds = {},
  active = nil,
  proxy = nil,
  state = nil,
  lastCapture = nil,
  polling = {enabled = false, index = 1, timerId = nil, dispatching = false},
}

local scheduleNextPoll

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function diagnostic(level, message)
  if Scraper.proxy and type(Scraper.proxy.onDiagnostic) == "function" then
    local ok = pcall(Scraper.proxy.onDiagnostic, level, message)
    if ok then return end
  end
  if type(debugc) == "function" then
    debugc("[Holocron3D/scraper/" .. level .. "] " .. message)
  end
end

local function safeKill(functionName, id)
  if not id then return end
  local fn = _G[functionName]
  if type(fn) == "function" then
    pcall(fn, id)
  end
end

local function copyTable(value)
  local result = {}
  for key, child in pairs(value or {}) do
    if type(child) == "table" then
      result[key] = copyTable(child)
    else
      result[key] = child
    end
  end
  return result
end

local function mergeMissing(target, source)
  for key, value in pairs(source or {}) do
    if target[key] == nil then
      target[key] = type(value) == "table" and copyTable(value) or value
    end
  end
end

local function freshState()
  return {
    observer = {id = "player-ship", kind = "ship", name = "Player Ship"},
    entities = {},
    metadata = {sources = {}, inSpace = nil},
  }
end

local function entityKey(entity)
  return tostring(entity.id or entity.name or "unknown"):lower()
end

local function findEntity(entity)
  local wantedId = entity.id and tostring(entity.id):lower() or nil
  local wantedName = entity.name and tostring(entity.name):lower() or nil
  for key, current in pairs(Scraper.state.entities) do
    if (wantedId and tostring(current.id or ""):lower() == wantedId)
        or (wantedName and tostring(current.name or ""):lower() == wantedName) then
      return current, key
    end
  end
  return nil
end

local function mergeEntity(entity, preserveIdentity)
  local current, currentKey = findEntity(entity)
  if current then
    for key, value in pairs(entity) do
      local identityField = key == "id" or key == "name" or key == "class" or key == "kind"
      if not preserveIdentity or not identityField or current[key] == nil then
        current[key] = type(value) == "table" and copyTable(value) or value
      end
    end
    return current
  end

  local stored = copyTable(entity)
  Scraper.state.entities[entityKey(stored)] = stored
  return stored
end

local function replaceRadarEntities(entities)
  local previous = Scraper.state.entities
  local replacement = {}
  Scraper.state.entities = previous

  for _, entity in ipairs(entities) do
    local old = findEntity(entity)
    local stored = copyTable(entity)
    if old then mergeMissing(stored, old) end
    replacement[entityKey(stored)] = stored
  end

  Scraper.state.entities = replacement
end

local function arrayOfEntities()
  local entities = {}
  for _, entity in pairs(Scraper.state.entities) do
    table.insert(entities, copyTable(entity))
  end
  table.sort(entities, function(left, right)
    return tostring(left.id or left.name) < tostring(right.id or right.name)
  end)
  return entities
end

local function applyStatus(result, sentCommand)
  local isObserver = trim(sentCommand):lower() == "status"
  local destination
  if isObserver then
    destination = Scraper.state.observer
  else
    destination = mergeEntity({
      id = result.id,
      name = result.name or trim(sentCommand):match("^%S+%s+(.+)$"),
      kind = "ship",
    })
  end

  for key, value in pairs(result) do
    if key ~= "source" and key ~= "recognizedLines" and key ~= "id" then
      destination[key] = type(value) == "table" and copyTable(value) or value
    end
  end
  if result.id and not isObserver then destination.id = result.id end
  if result.coordinates then
    destination.x = result.coordinates.x
    destination.y = result.coordinates.y
    destination.z = result.coordinates.z
  end
end

function Scraper.applyResult(result, sentCommand)
  if type(result) ~= "table" or type(result.source) ~= "string" then
    return nil, "parsed result must include a source"
  end

  Scraper.state = Scraper.state or freshState()
  local source = result.source
  Scraper.state.metadata.sources[source] = os.time()

  if source == "radar" then
    if result.system then Scraper.state.metadata.system = result.system end
    if result.observer then
      Scraper.state.observer.x = result.observer.x
      Scraper.state.observer.y = result.observer.y
      Scraper.state.observer.z = result.observer.z
    end
    replaceRadarEntities(result.entities or {})
  elseif source == "status" then
    applyStatus(result, sentCommand)
  elseif source == "info" then
    Scraper.state.observer.sensorArray = result.sensorArray
    Scraper.state.observer.radarRange = result.radarRange
  else
    if result.observer then
      Scraper.state.observer.x = result.observer.x
      Scraper.state.observer.y = result.observer.y
      Scraper.state.observer.z = result.observer.z
    end
    for _, entity in ipairs(result.entities or {}) do
      local isObserver = entity.name and Scraper.state.observer.name
        and entity.name:lower() == Scraper.state.observer.name:lower()
      if source == "fleetradar" and isObserver then
        for key, value in pairs(entity) do
          if key ~= "id" and key ~= "name" and key ~= "class" and key ~= "kind"
              and value ~= nil then
            Scraper.state.observer[key] = type(value) == "table" and copyTable(value) or value
          end
        end
      elseif source == "fleetradar"
          and Scraper.state.metadata.sources.radar
          and not findEntity(entity) then
        -- Radar owns the system contact list. Once it has run, fleetradar only
        -- enriches known contacts; this also prevents the player's own ship
        -- from becoming a second entity before status has identified it.
      else
        mergeEntity(entity, source == "prox" or source == "prox_velocity")
      end
    end
  end

  Scraper.state.metadata.lastSource = source
  Scraper.state.metadata.lastObservedAt = os.time()
  return true
end

function Scraper.publish()
  if not Scraper.proxy or type(Scraper.proxy.publishSnapshot) ~= "function" then
    return nil, "scraper has no proxy"
  end
  return Scraper.proxy.publishSnapshot(
    copyTable(Scraper.state.observer),
    arrayOfEntities(),
    copyTable(Scraper.state.metadata)
  )
end

local function clearCaptureHandles(capture)
  safeKill("killTrigger", capture.lineTriggerId)
  safeKill("killTrigger", capture.promptTriggerId)
  safeKill("killTimer", capture.timeoutTimerId)
  capture.lineTriggerId = nil
  capture.promptTriggerId = nil
  capture.timeoutTimerId = nil
end

local function captureRecordLines(capture)
  if capture.parserCommand == "info" then
    return {"[info output redacted; only Sensor Array is retained]"}
  end
  return copyTable(capture.lines)
end

local function abandonCapture(reason)
  local capture = Scraper.active
  if not capture then return end
  Scraper.active = nil
  clearCaptureHandles(capture)
  Scraper.lastCapture = {
    command = capture.sentCommand,
    parserCommand = capture.parserCommand,
    lines = captureRecordLines(capture),
    reason = reason,
  }
  if capture.polled and scheduleNextPoll then
    scheduleNextPoll(capture.pollDelay)
  end
end

local function cancelPollTimer()
  if Scraper.polling.timerId then
    safeKill("killTimer", Scraper.polling.timerId)
    Scraper.polling.timerId = nil
  end
end

function Scraper.setInSpace(inSpace, reason)
  Scraper.state = Scraper.state or freshState()
  inSpace = inSpace == true
  local changed = Scraper.state.metadata.inSpace ~= inSpace
  Scraper.state.metadata.inSpace = inSpace
  Scraper.state.metadata.spaceStateReason = reason
  Scraper.state.metadata.spaceStateChangedAt = os.time()

  if not inSpace then
    abandonCapture(reason or "not in space")
    cancelPollTimer()
    Scraper.state.entities = {}
  elseif Scraper.polling.enabled and scheduleNextPoll then
    scheduleNextPoll(0.25)
  end

  if not changed then return true end

  if Scraper.proxy and type(Scraper.proxy.publishSpaceState) == "function" then
    local sent, sendError = Scraper.proxy.publishSpaceState(inSpace, reason)
    if not sent then
      diagnostic("warn", "could not notify the bridge about space state: "
        .. tostring(sendError))
    end
  end

  if not inSpace and Scraper.proxy and type(Scraper.proxy.publishSnapshot) == "function" then
    local sent, sendError = Scraper.publish()
    if not sent then
      diagnostic("warn", "could not clear the bridge snapshot after landing: "
        .. tostring(sendError))
    end
  end

  diagnostic("info", inSpace
    and ("space scraping enabled: " .. tostring(reason or "ship launched"))
    or ("space scraping disabled: " .. tostring(reason or "ship is landed")))
  return true
end

function Scraper.finishCapture(reason)
  local capture = Scraper.active
  if not capture then return nil, "no capture is active" end
  Scraper.active = nil
  clearCaptureHandles(capture)
  if capture.polled and scheduleNextPoll then
    scheduleNextPoll(capture.pollDelay)
  end

  Scraper.lastCapture = {
    command = capture.sentCommand,
    parserCommand = capture.parserCommand,
    lines = captureRecordLines(capture),
    reason = reason or "completed",
  }

  local parsed, parseError = Scraper.proxy.parseGameOutput(
    capture.parserCommand,
    capture.lines
  )
  if not parsed then
    diagnostic("warn", "could not parse " .. capture.sentCommand .. " output: "
      .. tostring(parseError) .. "; run lotjHolocron3D.scraper.showLastCapture()")
    return nil, parseError
  end


  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    Scraper.setInSpace(true, capture.sentCommand .. " returned space data")
  end

  local applied, applyError = Scraper.applyResult(parsed, capture.sentCommand)
  if not applied then
    diagnostic("error", "could not merge " .. capture.sentCommand .. " output: "
      .. tostring(applyError))
    return nil, applyError
  end
  Scraper.state.metadata.lastCapturePolled = capture.polled == true

  local published, publishError = Scraper.publish()
  if not published then
    diagnostic("warn", "parsed " .. capture.sentCommand
      .. " but could not publish its snapshot: " .. tostring(publishError))
    return parsed, publishError
  end

  if not capture.polled then
    diagnostic("info", "parsed " .. capture.sentCommand .. " ("
      .. tostring(parsed.recognizedLines or 0) .. " data lines)")
  end
  return parsed
end

function Scraper.captureLine(value)
  local capture = Scraper.active
  if not capture then return end

  value = tostring(value or ""):gsub("\r", "")
  if capture.polled and type(deleteLine) == "function" then
    pcall(deleteLine)
  end
  capture.bytes = capture.bytes + #value + 1
  if #capture.lines >= Scraper.MAX_CAPTURE_LINES
      or capture.bytes > Scraper.MAX_CAPTURE_BYTES then
    diagnostic("error", "aborted oversized " .. capture.sentCommand .. " capture")
    Scraper.active = nil
    clearCaptureHandles(capture)
    return
  end
  table.insert(capture.lines, value)

  -- Radar has an unambiguous terminator, so publish without waiting for a
  -- prompt. The prompt remains the common boundary for all other commands.
  if capture.parserCommand == "radar"
      and value:lower():match("^%s*your%s+coordinates%s*:") then
    Scraper.finishCapture("radar terminator")
  end
end

function Scraper.startCapture(parserCommand, sentCommand, options)
  if Scraper.state and Scraper.state.metadata.inSpace == false then
    return nil, "space scraping is disabled while landed"
  end
  if Scraper.active then
    Scraper.finishCapture("superseded by " .. sentCommand)
  end

  local capture = {
    parserCommand = parserCommand,
    sentCommand = trim(sentCommand),
    lines = {},
    bytes = 0,
    polled = options and options.polled == true,
    pollDelay = options and options.pollDelay or nil,
  }
  Scraper.active = capture

  capture.lineTriggerId = tempRegexTrigger("^.*$", function()
    Scraper.captureLine(line or "")
  end)
  capture.promptTriggerId = tempPromptTrigger(function()
    if Scraper.active == capture then
      Scraper.finishCapture("prompt")
    end
  end, 1)
  capture.timeoutTimerId = tempTimer(Scraper.CAPTURE_TIMEOUT_SECONDS, function()
    if Scraper.active == capture then
      Scraper.finishCapture("timeout")
    end
  end)

  return true
end

local function parserForCommand(command)
  local normalized = trim(command):lower():gsub("%s+", " ")
  if normalized == "radar" then return "radar" end
  if normalized == "info" then return "info" end
  if normalized == "status" or normalized:match("^status .+") then return "status" end
  if normalized == "fleetradar" or normalized == "fleetradar targets" then
    return "fleetradar"
  end

  local first, rest = normalized:match("^(%S+)%s*(.-)$")
  if first == "prox" or first == "proximity" then
    local mode
    for word in rest:gmatch("%S+") do
      if word == "velocity" or word == "speed" then
        mode = "velocity"
      elseif word ~= "ships" and word ~= "projectiles"
          and not word:match("^%d+$") then
        return nil
      end
    end
    return mode and "prox velocity" or "prox"
  end
  return nil
end

local function updatePollingMetadata(command)
  Scraper.state = Scraper.state or freshState()
  Scraper.state.metadata.polling = {
    enabled = Scraper.polling.enabled,
    command = command,
    commandGapSeconds = Scraper.polling.commandGapSeconds,
    cycleDelaySeconds = Scraper.polling.cycleDelaySeconds,
  }
end

local function pollOnce()
  Scraper.polling.timerId = nil
  if not Scraper.polling.enabled then return end
  if Scraper.state and Scraper.state.metadata.inSpace == false then return end
  if Scraper.active then
    scheduleNextPoll(0.5)
    return
  end

  local command = Scraper.POLL_COMMANDS[Scraper.polling.index]
  Scraper.polling.index = Scraper.polling.index + 1
  local completedCycle = Scraper.polling.index > #Scraper.POLL_COMMANDS
  if completedCycle then Scraper.polling.index = 1 end
  local delay = completedCycle
    and Scraper.polling.cycleDelaySeconds
    or Scraper.polling.commandGapSeconds

  local parserCommand = parserForCommand(command)
  local started, startError = Scraper.startCapture(parserCommand, command, {
    polled = true,
    pollDelay = delay,
  })
  if not started then
    diagnostic("warn", "telemetry poll could not capture " .. command .. ": "
      .. tostring(startError))
    scheduleNextPoll(delay)
    return
  end

  updatePollingMetadata(command)
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("poll send failed")
    diagnostic("warn", "telemetry poll could not send " .. command .. ": "
      .. tostring(sent and sendError or sendResult))
  end
end

scheduleNextPoll = function(delay)
  cancelPollTimer()
  if not Scraper.polling.enabled then return end
  if Scraper.state and Scraper.state.metadata.inSpace == false then return end
  Scraper.polling.timerId = tempTimer(tonumber(delay) or 0.25, pollOnce)
end

function Scraper.startPolling(options)
  if type(send) ~= "function" then
    return nil, "Mudlet send() is unavailable"
  end
  options = type(options) == "table" and options or {}
  Scraper.polling.enabled = true
  Scraper.polling.index = 1
  Scraper.polling.commandGapSeconds = math.max(0.5,
    tonumber(options.commandGapSeconds) or Scraper.POLL_COMMAND_GAP_SECONDS)
  Scraper.polling.cycleDelaySeconds = math.max(1,
    tonumber(options.cycleDelaySeconds) or Scraper.POLL_CYCLE_DELAY_SECONDS)
  updatePollingMetadata(nil)
  scheduleNextPoll(tonumber(options.initialDelaySeconds) or 0.5)
  diagnostic("info", "telemetry polling enabled")
  return true
end

function Scraper.stopPolling()
  cancelPollTimer()
  Scraper.polling.enabled = false
  Scraper.polling.dispatching = false
  if Scraper.state then updatePollingMetadata(nil) end
  return true
end

function Scraper.getPollingState()
  return copyTable(Scraper.polling)
end

function Scraper.handleOutgoingCommand(eventName, command)
  if Scraper.polling.dispatching then return end
  local parserCommand = parserForCommand(command)
  if not parserCommand then return end
  if Scraper.state and Scraper.state.metadata.inSpace == false then return end
  Scraper.startCapture(parserCommand, command)
end

function Scraper.showLastCapture()
  if not Scraper.lastCapture then
    if type(cecho) == "function" then cecho("<yellow>[Holocron3D] No capture recorded yet.\n") end
    return
  end

  if type(cecho) == "function" then
    cecho("<cyan>[Holocron3D] Last capture: " .. Scraper.lastCapture.command
      .. " (" .. Scraper.lastCapture.reason .. ")\n")
    for index, capturedLine in ipairs(Scraper.lastCapture.lines) do
      cecho(string.format("<dim_grey>%03d <reset>%s\n", index, capturedLine))
    end
  end
  return copyTable(Scraper.lastCapture)
end

function Scraper.getSnapshot()
  if not Scraper.state then return nil end
  return {
    observer = copyTable(Scraper.state.observer),
    entities = arrayOfEntities(),
    metadata = copyTable(Scraper.state.metadata),
  }
end

function Scraper.setup(proxy, options)
  if type(proxy) ~= "table" or type(proxy.parseGameOutput) ~= "function" then
    return nil, "proxy must provide parseGameOutput"
  end
  for _, required in ipairs({"registerAnonymousEventHandler", "tempRegexTrigger",
      "tempPromptTrigger", "tempTrigger", "tempTimer"}) do
    if type(_G[required]) ~= "function" then
      return nil, "Mudlet function is unavailable: " .. required
    end
  end

  Scraper.teardown()
  Scraper.proxy = proxy
  Scraper.state = freshState()
  Scraper.eventHandlerIds = {
    registerAnonymousEventHandler("sysDataSendRequest", Scraper.handleOutgoingCommand),
  }
  Scraper.stateTriggerIds = {
    tempTrigger("Wait until after you launch!", function()
      Scraper.setInSpace(false, "LotJ reports that the ship has not launched")
    end),
    tempTrigger("You feel a slight thud as the ship sets down on the ground.", function()
      Scraper.setInSpace(false, "landing sequence complete")
    end),
    tempTrigger("The ship leaves the platform far behind as it flies into space", function()
      Scraper.setInSpace(true, "launch sequence complete")
    end),
  }
  proxy.scraper = Scraper
  diagnostic("info", "live scraping enabled for info, radar, prox, status, and fleetradar")
  if not options or options.polling ~= false then
    local pollingOptions = options and options.polling or nil
    local pollingReady, pollingError = Scraper.startPolling(pollingOptions)
    if not pollingReady then
      diagnostic("warn", "telemetry polling could not start: " .. tostring(pollingError))
    end
  end
  return true
end

function Scraper.teardown()
  Scraper.stopPolling()
  if Scraper.active then
    clearCaptureHandles(Scraper.active)
    Scraper.active = nil
  end
  for _, id in ipairs(Scraper.eventHandlerIds or {}) do
    safeKill("killAnonymousEventHandler", id)
  end
  for _, id in ipairs(Scraper.stateTriggerIds or {}) do
    safeKill("killTrigger", id)
  end
  Scraper.eventHandlerIds = {}
  Scraper.stateTriggerIds = {}
  if Scraper.proxy and Scraper.proxy.scraper == Scraper then
    Scraper.proxy.scraper = nil
  end
  Scraper.proxy = nil
  return true
end

return Scraper
