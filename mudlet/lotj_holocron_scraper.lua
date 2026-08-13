-- LotJ Holocron 3D - live Mudlet command/output collector
-- Installs temporary aliases and triggers; nothing persists in the profile.

local Scraper = {
  CAPTURE_TIMEOUT_SECONDS = 8,
  MAX_CAPTURE_LINES = 300,
  MAX_CAPTURE_BYTES = 256 * 1024,
  POLL_COMMANDS = {"status", "info", "radar", "prox", "prox velocity", "fleetradar"},
  POLL_COMMAND_GAP_SECONDS = 1,
  POLL_CYCLE_DELAY_SECONDS = 5,
  HOSTILE_SCAN_INTERVAL_SECONDS = 4,
  STANDARD_SCAN_INTERVAL_SECONDS = 10,
  eventHandlerIds = {},
  stateTriggerIds = {},
  active = nil,
  proxy = nil,
  state = nil,
  lastCapture = nil,
  polling = {enabled = false, index = 1, timerId = nil, dispatching = false},
  scanState = {},
  pendingCommandIntentId = nil,
  pendingCommandTimerId = nil,
  pendingCommandKind = nil,
  autotrack = {
    desired = true,
    observed = nil,
    pending = false,
    intentId = nil,
    retryCount = 0,
    timeoutTimerId = nil,
  },
}

local scheduleNextPoll
local requestAutotrack

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
    metadata = {
      sources = {},
      inSpace = nil,
      autotrackDesired = Scraper.autotrack.desired ~= false,
      autotrackPending = false,
    },
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
    if not old then
      -- A contact that has newly appeared (or re-entered after disappearing)
      -- must not inherit stale scan timestamps from an earlier radar pass.
      Scraper.scanState[entityKey(stored)] = nil
    end
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

local function applyInfo(result, sentCommand)
  local isObserver = trim(sentCommand):lower() == "info"
  local destination = isObserver and Scraper.state.observer or findEntity({name = result.name
    or trim(sentCommand):match("^%S+%s+(.+)$")})
  if not destination then return end
  if result.name then destination.name = result.name end
  if result.class then destination.class = result.class end
  if result.shipCategory then destination.shipCategory = result.shipCategory end
  if result.maximumSpeed then destination.maximumSpeed = result.maximumSpeed end
  if result.weapons then destination.weapons = copyTable(result.weapons) end
  if result.hasWeapons ~= nil then destination.hasWeapons = result.hasWeapons end
  if isObserver then
    destination.sensorArray = result.sensorArray
    destination.radarRange = result.radarRange
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
    applyInfo(result, sentCommand)
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
            if key == "speed" and type(Scraper.state.observer.speed) == "table"
                and type(value) == "number" then
              Scraper.state.observer.speed.current = value
            else
              Scraper.state.observer[key] = type(value) == "table" and copyTable(value) or value
            end
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
    return {"[info output redacted; only safe ship capabilities are retained]"}
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
    Scraper.scanState = {}
    safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
    Scraper.autotrack.timeoutTimerId = nil
    Scraper.autotrack.observed = nil
    Scraper.autotrack.pending = false
    Scraper.autotrack.intentId = nil
    Scraper.autotrack.retryCount = 0
    Scraper.state.observer.autotrack = nil
    Scraper.state.metadata.autotrackPending = false
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

  local commandFailure
  for _, capturedLine in ipairs(capture.lines) do
    local lower = capturedLine:lower()
    if lower:find("too far away to scan", 1, true) then
      commandFailure = "Target is outside sensor range."
      break
    elseif lower:find("finished its current maneuver", 1, true) then
      commandFailure = "Please wait until the ship has finished its current maneuver."
      break
    end
  end
  if commandFailure then
    if capture.intentId and Scraper.proxy
        and type(Scraper.proxy.publishIntentAck) == "function" then
      Scraper.proxy.publishIntentAck(capture.intentId, "rejected", commandFailure)
    end
    return nil, commandFailure
  end

  local parsed, parseError = Scraper.proxy.parseGameOutput(
    capture.parserCommand,
    capture.lines
  )
  if not parsed then
    if capture.spaceProbe then
      Scraper.setInSpace(false, "startup radar did not return space data")
    end
    if capture.intentId and Scraper.proxy
        and type(Scraper.proxy.publishIntentAck) == "function" then
      Scraper.proxy.publishIntentAck(capture.intentId, "rejected",
        capture.spaceProbe
          and "Radar did not confirm that the player is in space."
          or "The ship scan returned no usable telemetry.")
    end
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
  if Scraper.state and Scraper.state.metadata.inSpace == false
      and not (options and options.spaceProbe == true) then
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
    intentId = options and options.intentId or nil,
    spaceProbe = options and options.spaceProbe == true,
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
  if normalized == "info" or normalized:match("^info .+") then return "info" end
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

local function scanKey(entity)
  return tostring(entity.id or entity.name):lower()
end

local function scanCommandDue()
  if not Scraper.state then return nil end
  local observer = Scraper.state.observer or {}
  local range = tonumber(observer.radarRange) or (500 + math.max(0, tonumber(observer.sensorArray) or 0) * 10)
  local now = os.time()
  local best, bestOverdue, bestIsDiscovery
  for _, entity in pairs(Scraper.state.entities) do
    if entity.kind == "ship" and entity.name and entity.x and entity.y and entity.z then
      local distance = math.sqrt((entity.x - (observer.x or 0)) ^ 2
        + (entity.y - (observer.y or 0)) ^ 2 + (entity.z - (observer.z or 0)) ^ 2)
      if distance <= range then
        local state = Scraper.scanState[scanKey(entity)] or {statusAt = 0, infoAt = 0}
        Scraper.scanState[scanKey(entity)] = state
        for _, source in ipairs({"status", "info"}) do
          local interval = source == "status" and entity.disposition == "enemy"
            and Scraper.polling.hostileScanIntervalSeconds
            or Scraper.polling.standardScanIntervalSeconds
          local lastAttempt = state[source .. "At"] or 0
          local missingTelemetry = source == "status"
            and entity.hull == nil and entity.shields == nil and entity.condition == nil
            or source == "info" and entity.shipCategory == nil
          local discovery = missingTelemetry and lastAttempt == 0
          local overdue = now - lastAttempt - interval
          if overdue >= 0 and (best == nil
              or discovery and not bestIsDiscovery
              or discovery == bestIsDiscovery and overdue > bestOverdue) then
            best = {
              command = source .. " " .. entity.name,
              source = source,
              key = scanKey(entity),
              discovery = discovery,
            }
            bestOverdue = overdue
            bestIsDiscovery = discovery
          end
        end
      end
    end
  end
  return best
end

local function updatePollingMetadata(command)
  Scraper.state = Scraper.state or freshState()
  Scraper.state.metadata.polling = {
    enabled = Scraper.polling.enabled,
    active = Scraper.polling.enabled and Scraper.state.metadata.inSpace == true,
    command = command,
    commandGapSeconds = Scraper.polling.commandGapSeconds,
    cycleDelaySeconds = Scraper.polling.cycleDelaySeconds,
    hostileScanIntervalSeconds = Scraper.polling.hostileScanIntervalSeconds,
    standardScanIntervalSeconds = Scraper.polling.standardScanIntervalSeconds,
  }
end

local function pollOnce()
  Scraper.polling.timerId = nil
  if not Scraper.polling.enabled then return end
  if Scraper.pendingCommandKind then return end
  -- Never issue hidden commands while Mudlet is connecting or showing the
  -- login screen. A launch event or a successful manual space command must
  -- positively establish the in-space state before automatic polling begins.
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then return end
  if Scraper.active then
    scheduleNextPoll(0.5)
    return
  end

  local scanCandidate = scanCommandDue()
  local dueScan = scanCandidate and (scanCandidate.discovery
    or Scraper.polling.scansSinceCore < 2) and scanCandidate or nil
  local command
  if dueScan then
    command = dueScan.command
    Scraper.polling.scansSinceCore = Scraper.polling.scansSinceCore + 1
    Scraper.scanState[dueScan.key][dueScan.source .. "At"] = os.time()
  else
    command = Scraper.POLL_COMMANDS[Scraper.polling.index]
    Scraper.polling.scansSinceCore = 0
  end
  if dueScan then
    local parserCommand = parserForCommand(command)
    local started, startError = Scraper.startCapture(parserCommand, command, {polled = true,
      pollDelay = Scraper.polling.commandGapSeconds})
    if not started then scheduleNextPoll(0.5); return end
    updatePollingMetadata(command)
    Scraper.polling.dispatching = true
    local sent = pcall(send, command, false)
    Scraper.polling.dispatching = false
    if not sent then abandonCapture("scan send failed") end
    return
  end
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
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then return end
  if Scraper.pendingCommandKind then return end
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
  Scraper.polling.hostileScanIntervalSeconds = math.max(3,
    tonumber(options.hostileScanIntervalSeconds) or Scraper.HOSTILE_SCAN_INTERVAL_SECONDS)
  Scraper.polling.standardScanIntervalSeconds = math.max(5,
    tonumber(options.standardScanIntervalSeconds) or Scraper.STANDARD_SCAN_INTERVAL_SECONDS)
  Scraper.polling.scansSinceCore = 2
  updatePollingMetadata(nil)
  scheduleNextPoll(tonumber(options.initialDelaySeconds) or 0.5)
  diagnostic("info", Scraper.state and Scraper.state.metadata.inSpace == true
    and "telemetry polling enabled"
    or "telemetry polling armed; waiting for confirmed space activity")
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
  local state = copyTable(Scraper.polling)
  state.active = state.enabled and Scraper.state
    and Scraper.state.metadata.inSpace == true or false
  return state
end

local function resolvePendingCommand(status, reason, pollDelay)
  local intentId = Scraper.pendingCommandIntentId
  Scraper.pendingCommandIntentId = nil
  Scraper.pendingCommandKind = nil
  safeKill("killTimer", Scraper.pendingCommandTimerId)
  Scraper.pendingCommandTimerId = nil
  if intentId and Scraper.proxy and type(Scraper.proxy.publishIntentAck) == "function" then
    Scraper.proxy.publishIntentAck(intentId, status, reason)
  end
  scheduleNextPoll(pollDelay or 0.25)
end

local function holdPollingForCommand(intentId, seconds, timeoutReason, kind)
  cancelPollTimer()
  safeKill("killTimer", Scraper.pendingCommandTimerId)
  Scraper.pendingCommandIntentId = intentId
  Scraper.pendingCommandKind = kind or "command"
  Scraper.pendingCommandTimerId = tempTimer(tonumber(seconds) or 2, function()
    Scraper.pendingCommandTimerId = nil
    local expiredIntentId = Scraper.pendingCommandIntentId
    Scraper.pendingCommandIntentId = nil
    Scraper.pendingCommandKind = nil
    if expiredIntentId and timeoutReason and Scraper.proxy
        and type(Scraper.proxy.publishIntentAck) == "function" then
      Scraper.proxy.publishIntentAck(expiredIntentId, "rejected", timeoutReason)
    end
    scheduleNextPoll(0.25)
  end)
end

local function commandGateError()
  if Scraper.pendingCommandKind == "target" then
    return "target lock is still concentrating; wait for Target Locked."
  end
  if Scraper.pendingCommandKind then
    return "another ship command is awaiting completion"
  end
  return nil
end

local function dispatchManualShipScan(payload, message)
  local gateError = commandGateError()
  if gateError then return false, gateError end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "ship scanning is unavailable while landed"
  end
  local source = trim(payload.source):lower()
  if source ~= "status" and source ~= "info" then
    return false, "scan source must be status or info"
  end
  local target = findEntity({id = trim(payload.targetId)})
  local name = target and trim(target.name) or ""
  if not target or target.kind ~= "ship" or name == "" or name:find("[%c\r\n]") then
    return false, "scan target is not present in the current snapshot"
  end

  local observer = Scraper.state.observer or {}
  if target.x == nil or target.y == nil or target.z == nil then
    return false, "scan target has no known coordinates"
  end
  local range = tonumber(observer.radarRange)
    or (500 + math.max(0, tonumber(observer.sensorArray) or 0) * 10)
  local distance = math.sqrt((target.x - (observer.x or 0)) ^ 2
    + (target.y - (observer.y or 0)) ^ 2 + (target.z - (observer.z or 0)) ^ 2)
  if distance > range then
    return false, string.format("target is %.0f units away; sensor range is %.0f", distance, range)
  end

  if Scraper.active and not Scraper.active.polled then
    return false, "another manual telemetry capture is already active"
  end
  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by manual " .. source .. " scan")
    cancelPollTimer()
  end

  local command = source .. " " .. name
  local started, startError = Scraper.startCapture(source, command, {
    polled = true,
    pollDelay = 0.25,
    intentId = message and message.id or nil,
  })
  if not started then
    scheduleNextPoll(0.25)
    return false, startError
  end
  updatePollingMetadata(command)
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("manual scan send failed")
    return false, tostring(sent and sendError or sendResult)
  end

  local key = scanKey(target)
  Scraper.scanState[key] = Scraper.scanState[key] or {statusAt = 0, infoAt = 0}
  Scraper.scanState[key][source .. "At"] = os.time()
  return true
end

local function publishAutotrackState()
  if not Scraper.state then return end
  Scraper.state.observer.autotrack = Scraper.autotrack.observed
  Scraper.state.metadata.autotrackDesired = Scraper.autotrack.desired
  Scraper.state.metadata.autotrackPending = Scraper.autotrack.pending
  Scraper.publish()
end

local function completeAutotrack(status, reason)
  local intentId = Scraper.autotrack.intentId
  Scraper.autotrack.intentId = nil
  Scraper.autotrack.pending = false
  Scraper.autotrack.retryCount = 0
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  Scraper.autotrack.timeoutTimerId = nil
  publishAutotrackState()
  if intentId and Scraper.proxy and type(Scraper.proxy.publishIntentAck) == "function" then
    Scraper.proxy.publishIntentAck(intentId, status, reason)
  end
  scheduleNextPoll(0.25)
end

local function armAutotrackTimeout()
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  Scraper.autotrack.timeoutTimerId = tempTimer(5, function()
    Scraper.autotrack.timeoutTimerId = nil
    if not Scraper.autotrack.pending then return end
    completeAutotrack("rejected", "LotJ did not confirm the autotrack state.")
  end)
end

local function sendAutotrackToggle()
  local sent, sendResult, sendError = pcall(send, "autotrack", false)
  if not sent or sendResult == false then
    return false, tostring(sent and sendError or sendResult)
  end
  Scraper.autotrack.pending = true
  Scraper.state.metadata.autotrackPending = true
  armAutotrackTimeout()
  return true
end

requestAutotrack = function(desired, intentId)
  local gateError = commandGateError()
  if gateError then return false, gateError end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "autotrack is unavailable while landed"
  end
  if Scraper.autotrack.pending then
    return false, "an autotrack change is already awaiting confirmation"
  end
  if Scraper.active and not Scraper.active.polled then
    return false, "another manual telemetry capture is already active"
  end

  Scraper.autotrack.desired = desired == true
  Scraper.autotrack.intentId = intentId
  Scraper.autotrack.retryCount = 0
  Scraper.state.metadata.autotrackDesired = Scraper.autotrack.desired
  if Scraper.autotrack.observed == Scraper.autotrack.desired then
    publishAutotrackState()
    return true
  end

  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by autotrack command")
    cancelPollTimer()
  end
  local sent, sendError = sendAutotrackToggle()
  if not sent then
    Scraper.autotrack.intentId = nil
    scheduleNextPoll(0.25)
    return false, sendError
  end
  publishAutotrackState()
  return true
end

function Scraper.handleAutotrackResponse(value)
  local response = trim(value)
  local lower = response:lower()
  if not (lower:find("auto", 1, true) and lower:find("track", 1, true)) then
    return nil, "output does not describe autotrack"
  end

  local observed
  if lower:match("^autotracking%s+off%.?$") then
    observed = false
  elseif lower:match("^autotracking%s+on%.?$") then
    observed = true
  elseif lower:find("disabled", 1, true) or lower:find("disengaged", 1, true)
      or lower:find("deactivated", 1, true) or lower:find("turned off", 1, true)
      or lower:match("%f[%a]off%f[%A]") or lower:find("no longer", 1, true) then
    observed = false
  elseif lower:find("enabled", 1, true) or lower:find("engaged", 1, true)
      or lower:find("activated", 1, true) or lower:find("turned on", 1, true)
      or lower:match("%f[%a]on%f[%A]") then
    observed = true
  else
    return nil, "autotrack response did not contain an enabled or disabled state"
  end

  Scraper.autotrack.observed = observed
  Scraper.state.metadata.autotrackObservedAt = os.time()
  Scraper.state.metadata.autotrackResponse = response
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  Scraper.autotrack.timeoutTimerId = nil

  if observed ~= Scraper.autotrack.desired and Scraper.autotrack.retryCount < 1 then
    Scraper.autotrack.retryCount = Scraper.autotrack.retryCount + 1
    local sent, sendError = sendAutotrackToggle()
    publishAutotrackState()
    if sent then return observed end
    completeAutotrack("rejected", "Could not correct autotrack: " .. tostring(sendError))
    return nil, sendError
  end

  if observed == Scraper.autotrack.desired then
    completeAutotrack("completed", observed and "Autotrack enabled." or "Autotrack disabled.")
  else
    completeAutotrack("rejected", "LotJ reported the opposite autotrack state twice.")
  end
  return observed
end

local function dispatchTargetShip(payload, message)
  local gateError = commandGateError()
  if gateError then return false, gateError end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "ship targeting is unavailable while landed"
  end
  local target = findEntity({id = trim(payload.targetId)})
  local name = target and trim(target.name) or ""
  if not target or target.kind ~= "ship" or name == "" or name:find("[%c\r\n]") then
    return false, "target ship is not present in the current snapshot"
  end
  if Scraper.state.observer and Scraper.state.observer.hasWeapons == false then
    return false, "this ship has no weapons"
  end
  if Scraper.active and not Scraper.active.polled then
    return false, "another manual telemetry capture is already active"
  end

  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by target command")
    cancelPollTimer()
  end
  holdPollingForCommand(message and message.id or nil, 45,
    "Target lock timed out before LotJ confirmed Target Locked.", "target")
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "target " .. name)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    resolvePendingCommand("rejected", tostring(sent and sendError or sendResult), 0.25)
    return false, tostring(sent and sendError or sendResult)
  end

  target.disposition = "enemy"
  local published, publishError = Scraper.publish()
  if not published then
    diagnostic("warn", "targeted " .. name .. " but could not publish enemy disposition: "
      .. tostring(publishError))
  end
  return true
end

local function completeTargetLock(status, reason)
  if Scraper.pendingCommandKind ~= "target" then return false end
  resolvePendingCommand(status, reason, 0.25)
  if status == "completed" and Scraper.autotrack.desired
      and Scraper.autotrack.observed ~= true and not Scraper.autotrack.pending then
    local tracking, trackingError = requestAutotrack(true)
    if not tracking then
      diagnostic("warn", "target locked but autotrack could not be enabled: "
        .. tostring(trackingError))
    end
  end
  return true
end

function Scraper.setDisposition(name, disposition)
  if disposition ~= "neutral" and disposition ~= "ally" and disposition ~= "enemy" then
    return nil, "disposition must be neutral, ally, or enemy"
  end
  local entity = findEntity({name = name})
  if not entity or entity.kind ~= "ship" then return nil, "ship is not currently known" end
  entity.disposition = disposition
  Scraper.publish()
  return true
end

local function dispatchSpaceProbe(_, message)
  local gateError = commandGateError()
  if gateError then return false, gateError end
  if Scraper.active and not Scraper.active.polled then
    return false, "another manual telemetry capture is already active"
  end

  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by startup radar probe")
  end

  local started, startError = Scraper.startCapture("radar", "radar", {
    polled = true,
    pollDelay = 0.25,
    intentId = message and message.id or nil,
    spaceProbe = true,
  })
  if not started then return false, startError end

  local sent, sendResult, sendError = pcall(send, "radar", false)
  if not sent or sendResult == false then
    abandonCapture("startup radar probe could not be sent")
    Scraper.setInSpace(false, "startup radar could not be sent")
    return false, tostring(sent and sendError or sendResult)
  end
  return true
end

function Scraper.handleOutgoingCommand(eventName, command)
  if Scraper.polling.dispatching then return end
  if Scraper.pendingCommandKind == "target" then
    if type(denyCurrentSend) == "function" then denyCurrentSend() end
    if type(cecho) == "function" then
      cecho("<yellow>[Holocron3D] Command held until target lock completes.\n")
    end
    return
  end
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
  Scraper.autotrack.desired = true
  Scraper.autotrack.observed = nil
  Scraper.autotrack.pending = false
  Scraper.autotrack.intentId = nil
  Scraper.autotrack.retryCount = 0
  Scraper.autotrack.timeoutTimerId = nil
  Scraper.state = freshState()
  Scraper.scanState = {}
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
    tempTrigger("Please wait until the ship has finished its current maneuver.", function()
      if Scraper.pendingCommandKind ~= "target" then
        resolvePendingCommand("rejected",
          "Please wait until the ship has finished its current maneuver.", 1)
      end
    end),
    tempTrigger("Maneuver complete.", function()
      if Scraper.pendingCommandKind ~= "target" then
        resolvePendingCommand("completed", "Maneuver complete.", 0.25)
      end
    end),
    tempTrigger("Target Locked.", function()
      completeTargetLock("completed", "Target Locked.")
    end),
    tempTrigger("Your concentration is broken. You fail to lock on to your target.", function()
      completeTargetLock("rejected",
        "Your concentration is broken. You fail to lock on to your target.")
    end),
    tempRegexTrigger("(?i)^.*auto.*track.*$", function()
      Scraper.handleAutotrackResponse(line or "")
    end),
  }
  proxy.scraper = Scraper
  if type(proxy.registerIntentHandler) == "function" then
    proxy.registerIntentHandler("probe_space", dispatchSpaceProbe)
    proxy.registerIntentHandler("set_ship_disposition", function(payload)
      return Scraper.setDisposition(trim(payload.name), trim(payload.disposition):lower())
    end)
    proxy.registerIntentHandler("scan_ship", dispatchManualShipScan)
    proxy.registerIntentHandler("target_ship", dispatchTargetShip)
    proxy.registerIntentHandler("set_autotrack", function(payload, message)
      if type(payload.enabled) ~= "boolean" then
        return false, "autotrack enabled must be a boolean"
      end
      return requestAutotrack(payload.enabled, message and message.id or nil)
    end)
    proxy.registerIntentHandler("navigate_ship", function(payload, message)
      local gateError = commandGateError()
      if gateError then return false, gateError end
      if Scraper.state.metadata.inSpace ~= true then
        return false, "ship navigation is unavailable while landed"
      end
      local mode = trim(payload.mode):lower()
      local command
      local function round(value)
        return value >= 0 and math.floor(value + 0.5) or math.ceil(value - 0.5)
      end
      if mode == "relative" then
        local vector = type(payload.vector) == "table" and payload.vector or {}
        local values = {tonumber(vector.x), tonumber(vector.y), tonumber(vector.z)}
        for _, value in ipairs(values) do
          if not value or value ~= value or math.abs(value) > 10000000 then
            return false, "course vector must contain finite coordinates within 10,000,000 units"
          end
        end
        if values[1] == 0 and values[2] == 0 and values[3] == 0 then
          return false, "course vector cannot be zero"
        end
        command = string.format("course relative %d %d %d",
          round(values[1]), round(values[2]), round(values[3]))
      elseif mode == "target" or mode == "away" then
        local target = findEntity({id = trim(payload.targetId)})
        local name = target and trim(target.name) or ""
        if name == "" or name:find("[%c\r\n]") then
          return false, "navigation target is not present in the current snapshot"
        end
        command = mode == "away" and ("course away " .. name) or ("course " .. name)
      else
        return false, "unsupported navigation mode"
      end

      local departureSpeed
      if payload.departureSpeed ~= nil then
        departureSpeed = tonumber(payload.departureSpeed)
        local speedReading = Scraper.state.observer.speed
        local maximum = type(speedReading) == "table" and tonumber(speedReading.maximum) or nil
        if not departureSpeed or departureSpeed ~= departureSpeed or departureSpeed <= 0
            or departureSpeed > 10000000 or (maximum and departureSpeed > maximum) then
          return false, "departure speed is outside the ship's known limits"
        end
        departureSpeed = round(departureSpeed)
      end

      if departureSpeed then send("speed " .. tostring(departureSpeed)) end
      send(command)
      holdPollingForCommand(message and message.id or nil, 45,
        "Maneuver completion was not observed; course controls released.")
      return true
    end)
    proxy.registerIntentHandler("set_ship_speed", function(payload, message)
      local gateError = commandGateError()
      if gateError then return false, gateError end
      if Scraper.state.metadata.inSpace ~= true then
        return false, "ship speed is unavailable while landed"
      end
      local requestedSpeed = tonumber(payload.speed)
      local speedReading = Scraper.state.observer.speed
      local maximum = type(speedReading) == "table" and tonumber(speedReading.maximum) or nil
      if not requestedSpeed or requestedSpeed ~= requestedSpeed or requestedSpeed < 0
          or (maximum and requestedSpeed > maximum) then
        return false, "requested speed is outside the ship's known limits"
      end
      send("speed " .. tostring(math.floor(requestedSpeed + 0.5)))
      holdPollingForCommand(message and message.id or nil, 1.5)
      return true
    end)
  end
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
  Scraper.pendingCommandIntentId = nil
  Scraper.pendingCommandKind = nil
  safeKill("killTimer", Scraper.pendingCommandTimerId)
  Scraper.pendingCommandTimerId = nil
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  Scraper.autotrack.timeoutTimerId = nil
  Scraper.autotrack.pending = false
  Scraper.autotrack.intentId = nil
  Scraper.autotrack.retryCount = 0
  return true
end

return Scraper
