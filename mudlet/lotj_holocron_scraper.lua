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
  COMBAT_RADAR_INTERVAL_SECONDS = 2,
  USER_IDLE_POLL_DELAY_SECONDS = 2.5,
  SHIP_GMCP_STALE_SECONDS = 10,
  eventHandlerIds = {},
  stateTriggerIds = {},
  active = nil,
  proxy = nil,
  state = nil,
  lastCapture = nil,
  polling = {enabled = false, index = 1, timerId = nil, dispatching = false,
    hydrationQueue = {}},
  scanState = {},
  pendingCommandIntentId = nil,
  pendingCommandTimerId = nil,
  pendingCommandKind = nil,
  combat = {targetName = nil, pendingTargetName = nil, nextEventId = 0,
    lastFireWeapon = nil, projectileRadarRequestedAt = 0, lastRadarAt = 0,
    lastActivityAt = 0, lastLaunchWeapon = nil, lastLaunchTarget = nil,
    lastLaunchAt = 0},
  shields = {auto = true, recharging = false, awaiting = false, attempts = 0,
    damageTimerId = nil, actionTimerId = nil, statusPending = false,
    manualIntentId = nil, activationPending = false},
  autotrack = {
    desired = true,
    observed = nil,
    pending = false,
    intentId = nil,
    retryCount = 0,
    timeoutTimerId = nil,
  },
  shipGmcp = {lastAt = 0, sequence = 0, damageSequence = nil},
}

local scheduleNextPoll
local requestAutotrack
local ensureShieldsOn
local handleShieldStatus
local queueObserverHydration
local clearObserverHydration
local queueObserverInfo

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function radarSystemName(value)
  value = trim(value)
  local explicit = value:match("^[Ss]tarsystem:%s*(.-)%s*$")
  if explicit and explicit ~= "" then return explicit end
  if value:find(":", 1, true) or not value:match("^[%w][%w%s'%-]+$") then return nil end
  local lower = value:lower()
  if lower:match("%ssector$") or lower:match("%ssystem$") then return value end
  return nil
end

local function isCommunicationLine(value)
  value = trim(value)
  local parenthesizedChannel = value:match("^%(([%u]+)%)%s")
  local knownParenthesizedChannel = parenthesizedChannel == "OOC"
    or parenthesizedChannel == "IMM" or parenthesizedChannel == "RPC"
    or parenthesizedChannel == "NEWBIE" or parenthesizedChannel == "OSAY"
  local lower = value:lower()
  return knownParenthesizedChannel
    or value:match("^CommNet%s+%d+%s+%[") ~= nil
    or value:match("^ImmNet%[") ~= nil
    or value:match("^CouncilNet%[") ~= nil
    or value:match("^%([^)]*R|P|C[^)]*%)%s") ~= nil
    or value:match("^%[[^%]]+%]%b{}%b<>%[[^%]]+%].-:%s") ~= nil
    or value:find("[Incoming Transmission from", 1, true) ~= nil
    or value:find("[Outgoing Transmission to", 1, true) ~= nil
    or value:match("^Broadcasting Network%s+%[") ~= nil
    or value:match("^'.-'%s+you%s+[%a]+") ~= nil
    or value:match("^You%s+[%a]+.-'.-'$") ~= nil
    or lower:match("^.-%s+says%s") ~= nil
    or lower:match("^.-%s+whispers%s") ~= nil
    or lower:match("^.-%s+exclaims%s") ~= nil
    or lower:match("^.-%s+asks%s") ~= nil
    or lower:match("^.-%s+yells%s") ~= nil
    or lower:match("^.-%s+radios%s") ~= nil
end

local function isCoordinateRow(value)
  return value:match("^.-%s+[+-]?[%d,]+%.?%d*%s+[+-]?[%d,]+%.?%d*%s+[+-]?[%d,]+%.?%d*%s*$") ~= nil
end

local function isKnownCaptureFailure(value)
  local lower = value:lower()
  return lower:find("wait until after you launch", 1, true) ~= nil
    or lower:find("must be aboard a ship to use radar", 1, true) ~= nil
    or lower:find("too far away to scan", 1, true) ~= nil
    or lower:find("finished its current maneuver", 1, true) ~= nil
end

local function isAsynchronousVisibleLine(value)
  value = trim(value)
  if isCommunicationLine(value) then return true end
  local lower = value:lower()
  return lower:match("^you are hit by ") ~= nil
    or lower:match("^.- fire from .- at you") ~= nil
    or lower:match("^you are being targeted by ") ~= nil
    or lower:match("^%[warning%]:") ~= nil
    or lower:match("^proximity alert:") ~= nil
    or lower == "target locked."
    or lower == "maneuver complete."
    or lower == "your concentration is broken. you fail to lock on to your target."
end

local function markResponseStarted(capture)
  capture.responseStarted = true
  return true
end

local STATUS_MARKERS = {
  "current coordinates:", "current heading:", "current speed:",
  "lifeforms detected:", "hull:", "shields:", "energy(fuel):",
  "ship condition:", "autopilot status:", "cloaking device:",
  "security program:", "comm system:", "autolaunch status:",
  "selfdestruct status:", "autorecharge status:", "tractor beam condition:",
  "primary target:", "blasters ready:", "lasers ready:",
  "turbolasers ready:", "ion cannons ready:", "laser condition:",
  "ion condition:", "launcher condition:", "missiles:", "total turrets:",
  "escape pods:", "hangar ",
}

local INFO_MARKERS = {
  "quota:", "owner:", "crew:", "kill markers:", "autoblasters:",
  "laser cannons:", "turbolasers:", "ion cannons:", "maximum missiles:",
  "maximum torpedoes:", "maximum rockets:", "maximum pulses:",
  "maximum chaff:", "missile tubes:", "tractorbeams:", "escape pods:",
  "max hull:", "max shields:", "max energy(fuel):", "maximum speed:",
  "hyperspeed:", "maneuver:", "sensor array:", "shield boosters:",
  "communications:", "cloaking device:", "hatchway:", "hangar bays:",
  "docking:", "selfdestruct:",
}

local function containsMarker(lower, markers)
  for _, marker in ipairs(markers) do
    if lower:find(marker, 1, true) then return true end
  end
  return false
end

local function captureOwnsLine(capture, value)
  value = trim(value)
  if isAsynchronousVisibleLine(value) then return false end
  -- Hidden commands commonly begin and end with blank lines. Those blanks are
  -- part of the private response even before its first recognizable heading.
  if value == "" then return capture.polled == true end
  if isKnownCaptureFailure(value) then return markResponseStarted(capture) end

  local lower = value:lower()
  local command = trim(capture.sentCommand):lower():gsub("%s+", " ")
  if lower == command then return markResponseStarted(capture) end

  if capture.parserCommand == "radar" then
    if isCoordinateRow(value) or radarSystemName(value) ~= nil then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "prox" or capture.parserCommand == "prox_velocity" then
    if lower:match("^your%s+coordinates%s*:") then return markResponseStarted(capture) end
    if lower:match("^proximity") or lower:match("^object%s+")
        or lower:match("^name%s+") or radarSystemName(value:gsub(":$", "")) then
      return markResponseStarted(capture)
    end
    local owned = value:match("^.-%s+[Pp][Rr][Oo][Xx]%s*:%s*[+-]?[%d,]+%.?%d*%s*$") ~= nil
      or value:match("^.-%s%s+[+-]?[%d,]+%.?%d*%s*$") ~= nil
      or value:match("^.-%s+is%s+now%s+[%d,]+%.?%d*%s+units?%s+away%.?$") ~= nil
    if owned then return markResponseStarted(capture) end
  end

  if capture.parserCommand == "status" then
    if lower:match("^readout%s+for%s+.-:$") then
      capture.seenTelemetry = true
      return markResponseStarted(capture)
    end
    if lower:find("need ", 1, true) and lower:find(" sensors to scan for lifeforms", 1, true) then
      capture.seenTelemetry = true
      return markResponseStarted(capture)
    end
    if lower == "you cannot scan your own ship for lifeforms." then
      return markResponseStarted(capture)
    end
    if containsMarker(lower, STATUS_MARKERS) then
      capture.seenTelemetry = true
      return markResponseStarted(capture)
    end
    if capture.seenTelemetry and value:match("^%-%-[%w]+%-+") then
      return markResponseStarted(capture)
    end
    if not capture.seenTelemetry and value:match("^[%w][%w%s'%-]+:$") then
      capture.seenTelemetry = true
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "info" then
    if value:match("^%[Class:%s*[^%]]+%]%s*:") then
      capture.seenTelemetry = true
      return markResponseStarted(capture)
    end
    if containsMarker(lower, INFO_MARKERS) then
      capture.seenTelemetry = true
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "fleetradar" then
    if lower:find("ship", 1, true) and lower:find("position", 1, true) then
      capture.fleetHeaderSeen = true
      return markResponseStarted(capture)
    end
    if lower:match("^fleet%s*radar") then return markResponseStarted(capture) end
    if value:find("|", 1, true) then return markResponseStarted(capture) end
    if capture.fleetHeaderSeen == true and value:match("%s%s+") then
      return markResponseStarted(capture)
    end
  end

  -- Once a hidden response has positively begun, its prose, decorations,
  -- storage notes, and prompt HUD belong to that response too. Known chat and
  -- asynchronous combat lines returned above and remain visible in Mudlet.
  return capture.polled == true and capture.responseStarted == true
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
  local hasLotjUi = type(_G.lotj) == "table"
    and type(_G.lotj.chat) == "table"
    and type(_G.lotj.systemMap) == "table"
  return {
    observer = {id = "player-ship", kind = "ship", name = "Player Ship"},
    entities = {},
    metadata = {
      sources = {},
      inSpace = nil,
      autotrackDesired = Scraper.autotrack.desired ~= false,
      autotrackPending = false,
      autoRechargeEnabled = Scraper.shields.auto ~= false,
      shieldRecharging = false,
      shieldRechargeAttempts = 0,
      shieldStatusPending = false,
      mudletCompatibility = {lotjUiDetected = hasLotjUi},
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
  if isObserver and result.target then
    local target = trim(result.target)
    Scraper.combat.targetName = target:lower() == "none" and nil or target
    Scraper.state.metadata.combatTarget = Scraper.combat.targetName
  end
  if isObserver and clearObserverHydration then clearObserverHydration("status") end
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
  if isObserver and clearObserverHydration then clearObserverHydration("info") end
end

function Scraper.applyResult(result, sentCommand)
  if type(result) ~= "table" or type(result.source) ~= "string" then
    return nil, "parsed result must include a source"
  end

  Scraper.state = Scraper.state or freshState()
  local source = result.source
  Scraper.state.metadata.sources[source] = os.time()

  if source == "radar" then
    Scraper.combat.lastRadarAt = os.time()
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

clearObserverHydration = function(source)
  local queue = Scraper.polling.hydrationQueue or {}
  for index = #queue, 1, -1 do
    if queue[index] == source then table.remove(queue, index) end
  end
  Scraper.polling.hydrationQueue = queue
  if Scraper.state and Scraper.state.metadata.polling then
    Scraper.state.metadata.polling.hydratingObserver = #queue > 0
  end
end

queueObserverHydration = function()
  local observer = Scraper.state and Scraper.state.observer or {}
  local queue = {}
  local hasStatus = observer.speed ~= nil
    and (observer.hull ~= nil or observer.shields ~= nil or observer.condition ~= nil)
  local hasInfo = type(observer.weapons) == "table"
    and observer.hasWeapons ~= nil and observer.shipCategory ~= nil
  if not hasStatus then table.insert(queue, "status") end
  if not hasInfo then table.insert(queue, "info") end
  Scraper.polling.hydrationQueue = queue
end

queueObserverInfo = function()
  local queue = Scraper.polling.hydrationQueue or {}
  for index = #queue, 1, -1 do
    if queue[index] == "info" then table.remove(queue, index) end
  end
  table.insert(queue, 1, "info")
  Scraper.polling.hydrationQueue = queue
  if Scraper.state and Scraper.state.metadata.polling then
    Scraper.state.metadata.polling.hydratingObserver = true
  end
  if Scraper.polling.enabled and Scraper.state
      and Scraper.state.metadata.inSpace == true and scheduleNextPoll then
    scheduleNextPoll(0.1)
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
    Scraper.polling.hydrationQueue = {}
    safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
    Scraper.autotrack.timeoutTimerId = nil
    Scraper.autotrack.observed = nil
    Scraper.autotrack.pending = false
    Scraper.autotrack.intentId = nil
    Scraper.autotrack.retryCount = 0
    Scraper.state.observer.autotrack = nil
    Scraper.state.metadata.autotrackPending = false
    Scraper.state.observer.target = nil
    Scraper.state.metadata.combatTarget = nil
    Scraper.state.metadata.combatEvent = nil
    Scraper.state.metadata.combatEvents = nil
    Scraper.combat.targetName = nil
    Scraper.combat.pendingTargetName = nil
    Scraper.combat.lastActivityAt = 0
    Scraper.combat.lastRadarAt = 0
    Scraper.combat.lastLaunchWeapon = nil
    Scraper.combat.lastLaunchTarget = nil
    Scraper.combat.lastLaunchAt = 0
    safeKill("killTimer", Scraper.shields.damageTimerId)
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.damageTimerId = nil
    Scraper.shields.actionTimerId = nil
    Scraper.shields.recharging = false
    Scraper.shields.awaiting = false
    Scraper.shields.attempts = 0
    Scraper.shields.statusPending = false
    Scraper.shields.manualIntentId = nil
    Scraper.shields.activationPending = false
    Scraper.state.metadata.shieldRecharging = false
    Scraper.state.metadata.shieldStatusPending = false
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
  if inSpace and changed and ensureShieldsOn then
    tempTimer(0.1, ensureShieldsOn)
  end
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
  if capture.spaceProbe and queueObserverHydration then
    queueObserverHydration()
  end
  Scraper.state.metadata.lastCapturePolled = capture.polled == true
  if parsed.source == "status" and trim(capture.sentCommand):lower() == "status"
      and handleShieldStatus then
    handleShieldStatus(parsed)
  end

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
  if not capture then return false end

  value = tostring(value or ""):gsub("\r", "")
  if not captureOwnsLine(capture, value) then return false end
  if capture.polled and type(deleteLine) == "function" then
    pcall(deleteLine)
  end
  capture.bytes = capture.bytes + #value + 1
  if #capture.lines >= Scraper.MAX_CAPTURE_LINES
      or capture.bytes > Scraper.MAX_CAPTURE_BYTES then
    diagnostic("error", "aborted oversized " .. capture.sentCommand .. " capture")
    Scraper.active = nil
    clearCaptureHandles(capture)
    return false
  end
  table.insert(capture.lines, value)

  -- Visible radar commands can publish at their unambiguous terminator. Hidden
  -- radar polls remain active until the prompt so their trailing System Map and
  -- character-HUD lines are suppressed with the rest of the response envelope.
  if capture.parserCommand == "radar"
      and not capture.polled
      and value:lower():match("^%s*your%s+coordinates%s*:") then
    Scraper.finishCapture("radar terminator")
  end
  return true
end

local function refreshLotjUiCompatibility()
  if not Scraper.state or not Scraper.state.metadata then return false end
  local detected = type(_G.lotj) == "table"
    and type(_G.lotj.chat) == "table"
    and type(_G.lotj.systemMap) == "table"
  local compatibility = Scraper.state.metadata.mudletCompatibility or {}
  local newlyDetected = detected and compatibility.lotjUiDetected ~= true
  compatibility.lotjUiDetected = detected or compatibility.lotjUiDetected == true
  Scraper.state.metadata.mudletCompatibility = compatibility
  if newlyDetected then
    diagnostic("info", "official LotJ Mudlet UI detected; shared chat and radar compatibility enabled")
  end
  return compatibility.lotjUiDetected == true
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
  if normalized == "radar" or normalized == "radar projectiles" then return "radar" end
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

local function normalizeWeapon(value)
  local lower = trim(value):lower()
  if lower:find("autoblaster", 1, true) then return "autoblaster" end
  if lower:find("turbolaser", 1, true) then return "turbolaser" end
  if lower:find("laser", 1, true) then return "laser" end
  if lower:find("ion", 1, true) then return "ion" end
  if lower:find("missile", 1, true) then return "missile" end
  if lower:find("torpedo", 1, true) then return "torpedo" end
  if lower:find("rocket", 1, true) then return "rocket" end
  if lower:find("burst", 1, true) or lower:find("pulse", 1, true) then return "burst" end
  return nil
end

local function publishCombatEvent(event)
  Scraper.combat.lastActivityAt = os.time()
  Scraper.combat.nextEventId = Scraper.combat.nextEventId + 1
  event.id = Scraper.combat.nextEventId
  event.observedAt = os.time()
  event.targetName = event.targetName or Scraper.combat.targetName
  Scraper.state.metadata.combatTarget = Scraper.combat.targetName
  Scraper.state.metadata.combatEvent = event
  Scraper.state.metadata.combatEvents = Scraper.state.metadata.combatEvents or {}
  table.insert(Scraper.state.metadata.combatEvents, copyTable(event))
  while #Scraper.state.metadata.combatEvents > 32 do
    table.remove(Scraper.state.metadata.combatEvents, 1)
  end
  return Scraper.publish()
end

local function publishLaunchEvent(weapon, count, targetName)
  local resolvedTarget = targetName or Scraper.combat.targetName
  local now = os.time()
  if Scraper.combat.lastLaunchWeapon == weapon
      and Scraper.combat.lastLaunchTarget == resolvedTarget
      and now - (Scraper.combat.lastLaunchAt or 0) <= 2 then
    return true
  end
  Scraper.combat.lastLaunchWeapon = weapon
  Scraper.combat.lastLaunchTarget = resolvedTarget
  Scraper.combat.lastLaunchAt = now
  return publishCombatEvent({type = "launch", weapon = weapon, count = count,
    targetName = resolvedTarget})
end

function Scraper.handleCombatLine(text)
  local value = trim(text)
  local displayedTarget = value:match("^Target:%s+.-'([^']+)'")
  if displayedTarget then
    if Scraper.combat.targetName ~= displayedTarget then
      Scraper.combat.targetName = displayedTarget
      Scraper.combat.lastActivityAt = os.time()
      Scraper.state.observer.target = displayedTarget
      Scraper.state.metadata.combatTarget = displayedTarget
      Scraper.publish()
    end
    return true
  end
  if value == "You fail to lock on to your target!" then
    publishCombatEvent({type = "failure", weapon = Scraper.combat.lastFireWeapon or "best",
      reason = "Failed to lock on to target"})
    return true
  end

  local forwardOnlyWeapon = value:match(
    "^The%s+(.+)%s+can%s+only%s+fire%s+forwards%.%s+You'll%s+need%s+to%s+turn%s+your%s+ship!$")
    or value:match(
      "^(.+)%s+can%s+only%s+fire%s+forwards%.%s+You'll%s+need%s+to%s+turn%s+your%s+ship!$")
  if forwardOnlyWeapon then
    local weapon = normalizeWeapon(forwardOnlyWeapon)
    if weapon then
      publishCombatEvent({type = "failure", weapon = weapon,
        reason = "Forward arc blocked // turn ship"})
      return true
    end
  end


  local simplyLaunchedWeapon = value:match("^(.+)%s+launched%.$")
  if simplyLaunchedWeapon then
    local weapon = normalizeWeapon(simplyLaunchedWeapon)
    if weapon and (weapon == "missile" or weapon == "torpedo" or weapon == "rocket") then
      publishLaunchEvent(weapon, 1)
      return true
    end
  end

  local launchedWeapon, launchedTarget = value:match(
    "^A%s+(.+)%s+is%s+launched%s+toward%s+.-'([^']+)'%s+by%s+your%s+ship%.$")
  if launchedWeapon and launchedTarget then
    local weapon = normalizeWeapon(launchedWeapon)
    if weapon then
      publishLaunchEvent(weapon, 1, launchedTarget)
      return true
    end
  end
  local count, firedWeapon = value:match("^(%d+)%s+(.+)%s+fired%.%.%.$")
  if count and firedWeapon then
    local weapon = normalizeWeapon(firedWeapon)
    if weapon then
      publishLaunchEvent(weapon, tonumber(count))
      return true
    end
  end

  local directHitWeapon, directHitTarget = value:match(
    "^Your ship's%s+(.+)%s+hits%s+.-'([^']+)'.-!$")
  if directHitWeapon and directHitTarget then
    local weapon = normalizeWeapon(directHitWeapon)
    if weapon then
      publishCombatEvent({type = "impact", weapon = weapon,
        targetName = directHitTarget, outcome = "hit"})
      return true
    end
  end

  local hitWeapon, hitTarget = value:match("^Your ship's%s+(.+)%s+hit%s+.-'([^']+)'!$")
  if hitWeapon and hitTarget then
    local weapon = normalizeWeapon(hitWeapon)
    if weapon then
      publishCombatEvent({type = "impact", weapon = weapon, targetName = hitTarget, outcome = "hit"})
      return true
    end
  end

  local missedWeapon, missedTarget = value:match(
    "^Your ship's%s+(.+)%s+fire%s+at%s+.-'([^']+)'%s+but%s+miss%.$")
  if missedWeapon and missedTarget then
    local weapon = normalizeWeapon(missedWeapon)
    if weapon then
      publishCombatEvent({type = "impact", weapon = weapon, targetName = missedTarget, outcome = "miss"})
      return true
    end
  end

  local chargedWeapon = value:match("^(.+)%s+fully%s+charged%.$")
  if chargedWeapon then
    local weapon = normalizeWeapon(chargedWeapon)
    if weapon then
      publishCombatEvent({type = "charged", weapon = weapon})
      return true
    end
  end
  local reloadedWeapon = value:match("^(.+)%s+launcher%(s%)%s+reloaded%.$")
    or value:match("^(.+)%s+launchers?%s+reloaded%.$")
  if reloadedWeapon then
    local weapon = normalizeWeapon(reloadedWeapon)
    if weapon then
      publishCombatEvent({type = "charged", weapon = weapon})
      return true
    end
  end
  return false
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
    combatRadarIntervalSeconds = Scraper.polling.combatRadarIntervalSeconds,
    hydratingObserver = #(Scraper.polling.hydrationQueue or {}) > 0,
  }
end

local function shipGmcpIsFresh(now)
  local lastAt = tonumber(Scraper.shipGmcp and Scraper.shipGmcp.lastAt) or 0
  return lastAt > 0 and (tonumber(now) or os.time()) - lastAt
    <= Scraper.SHIP_GMCP_STALE_SECONDS
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

  local now = os.time()
  local recentlyActive = now - (Scraper.combat.lastActivityAt or 0) <= 30
  local combatActive = Scraper.combat.targetName ~= nil or recentlyActive
  local combatRadarDue = combatActive
    and now - (Scraper.combat.lastRadarAt or 0)
      >= (Scraper.polling.combatRadarIntervalSeconds or Scraper.COMBAT_RADAR_INTERVAL_SECONDS)
  local hydrationCommand = (Scraper.polling.hydrationQueue or {})[1]
  local scanCandidate = not hydrationCommand and not combatRadarDue and scanCommandDue() or nil
  local dueScan = scanCandidate and (scanCandidate.discovery
    or Scraper.polling.scansSinceCore < 2) and scanCandidate or nil
  local command
  if hydrationCommand then
    command = hydrationCommand
    Scraper.polling.scansSinceCore = 0
  elseif combatRadarDue then
    command = "radar projectiles"
    Scraper.polling.scansSinceCore = 0
  elseif dueScan then
    command = dueScan.command
    Scraper.polling.scansSinceCore = Scraper.polling.scansSinceCore + 1
    Scraper.scanState[dueScan.key][dueScan.source .. "At"] = os.time()
  else
    command = Scraper.POLL_COMMANDS[Scraper.polling.index]
    if combatActive and command == "radar" then command = "radar projectiles" end
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
  local completedCycle = false
  if not hydrationCommand and not combatRadarDue then
    Scraper.polling.index = Scraper.polling.index + 1
    completedCycle = Scraper.polling.index > #Scraper.POLL_COMMANDS
    if completedCycle then Scraper.polling.index = 1 end
  end
  local delay = combatRadarDue and 0.5 or completedCycle
    and Scraper.polling.cycleDelaySeconds or Scraper.polling.commandGapSeconds

  -- Ship.Info supplies live observer status. Keep the command as a fallback
  -- when GMCP has not arrived recently instead of polling it every cycle.
  if command == "status" and shipGmcpIsFresh(now) then
    updatePollingMetadata("gmcp.Ship.Info")
    scheduleNextPoll(0.1)
    return
  end

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

function Scraper.handleProjectileSummary(text)
  local total, incoming = trim(text):match("^(%d+)%s+projectiles?,%s+(%d+)%s+incoming")
  if not total then return false end
  total, incoming = tonumber(total) or 0, tonumber(incoming) or 0
  if total > 0 or incoming > 0 then Scraper.combat.lastActivityAt = os.time() end
  Scraper.state.metadata.projectileCount = total
  Scraper.state.metadata.incomingProjectileCount = incoming
  Scraper.publish()
  if total <= 0 or Scraper.state.metadata.inSpace ~= true then return true end
  if os.time() - (Scraper.combat.projectileRadarRequestedAt or 0) <= 2 then return true end
  if Scraper.pendingCommandKind or Scraper.active then return false end

  cancelPollTimer()
  local started, startError = Scraper.startCapture("radar", "radar projectiles", {
    polled = true,
    pollDelay = Scraper.polling.commandGapSeconds or Scraper.POLL_COMMAND_GAP_SECONDS,
  })
  if not started then
    scheduleNextPoll(0.5)
    diagnostic("warn", "projectile radar could not start: " .. tostring(startError))
    return false
  end
  Scraper.combat.projectileRadarRequestedAt = os.time()
  updatePollingMetadata("radar projectiles")
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "radar projectiles", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("projectile radar send failed")
    diagnostic("warn", "projectile radar could not send: "
      .. tostring(sent and sendError or sendResult))
    return false
  end
  return true
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
  Scraper.polling.combatRadarIntervalSeconds = math.max(1,
    tonumber(options.combatRadarIntervalSeconds) or Scraper.COMBAT_RADAR_INTERVAL_SECONDS)
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

local sendRechargeAttempt
local requestShieldStatus

local function publishShieldState()
  if not Scraper.state then return end
  Scraper.state.metadata.autoRechargeEnabled = Scraper.shields.auto ~= false
  Scraper.state.metadata.shieldRecharging = Scraper.shields.recharging == true
  Scraper.state.metadata.shieldRechargeAttempts = Scraper.shields.attempts or 0
  Scraper.state.metadata.shieldStatusPending = Scraper.shields.statusPending == true
  Scraper.publish()
end

local function finishShieldRecharge(status, reason)
  local intentId = Scraper.shields.manualIntentId
  Scraper.shields.manualIntentId = nil
  Scraper.shields.recharging = false
  Scraper.shields.awaiting = false
  Scraper.shields.attempts = 0
  Scraper.shields.statusPending = false
  Scraper.shields.checkForRecharge = false
  safeKill("killTimer", Scraper.shields.actionTimerId)
  Scraper.shields.actionTimerId = nil
  publishShieldState()
  if intentId and Scraper.proxy and type(Scraper.proxy.publishIntentAck) == "function" then
    Scraper.proxy.publishIntentAck(intentId, status, reason)
  end
  scheduleNextPoll(0.25)
end

requestShieldStatus = function(checkForRecharge)
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then return false end
  if Scraper.pendingCommandKind == "target" or Scraper.active then
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.actionTimerId = tempTimer(0.35, function()
      Scraper.shields.actionTimerId = nil
      requestShieldStatus(checkForRecharge)
    end)
    return false
  end
  cancelPollTimer()
  local started, startError = Scraper.startCapture("status", "status", {
    polled = true,
    pollDelay = 0.25,
  })
  if not started then
    diagnostic("warn", "shield status check could not start: " .. tostring(startError))
    scheduleNextPoll(0.5)
    return false
  end
  Scraper.shields.statusPending = true
  Scraper.shields.checkForRecharge = checkForRecharge == true
  publishShieldState()
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "status", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("shield status send failed")
    Scraper.shields.statusPending = false
    publishShieldState()
    diagnostic("warn", "shield status check could not send: "
      .. tostring(sent and sendError or sendResult))
    return false
  end
  return true
end

local function beginShieldRecharge(intentId)
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "shield recharge is unavailable while landed"
  end
  if Scraper.pendingCommandKind == "target" then
    return false, "target lock is still concentrating; wait for Target Locked."
  end
  local shields = Scraper.state.observer.shields
  if type(shields) == "table" and tonumber(shields.maximum)
      and tonumber(shields.current) and tonumber(shields.current) >= tonumber(shields.maximum) then
    return false, "shields are already at peak power"
  end
  if Scraper.shields.recharging then return false, "shield recharge is already running" end
  Scraper.shields.recharging = true
  Scraper.shields.awaiting = false
  Scraper.shields.attempts = 0
  Scraper.shields.manualIntentId = intentId
  publishShieldState()
  sendRechargeAttempt()
  return true
end

sendRechargeAttempt = function()
  if not Scraper.shields.recharging or Scraper.shields.awaiting then return end
  if Scraper.pendingCommandKind == "target" or Scraper.shields.statusPending then
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.actionTimerId = tempTimer(0.25, function()
      Scraper.shields.actionTimerId = nil
      sendRechargeAttempt()
    end)
    return
  end
  cancelPollTimer()
  if Scraper.active then abandonCapture("superseded by shield recharge") end
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "recharge", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    finishShieldRecharge("rejected", tostring(sent and sendError or sendResult))
    return
  end
  Scraper.shields.awaiting = true
  publishShieldState()
  safeKill("killTimer", Scraper.shields.actionTimerId)
  Scraper.shields.actionTimerId = tempTimer(4, function()
    Scraper.shields.actionTimerId = nil
    if Scraper.shields.awaiting then
      finishShieldRecharge("rejected", "LotJ did not confirm the shield recharge.")
    end
  end)
end

handleShieldStatus = function(result)
  local wasCheck = Scraper.shields.checkForRecharge == true
  Scraper.shields.statusPending = false
  Scraper.shields.checkForRecharge = false
  local shields = result and result.shields
  local current = type(shields) == "table" and tonumber(shields.current) or nil
  local maximum = type(shields) == "table" and tonumber(shields.maximum) or nil
  if current and maximum and current >= maximum then
    if Scraper.shields.recharging then
      finishShieldRecharge("completed", "Shields confirmed at peak power.")
    else
      publishShieldState()
    end
  elseif Scraper.shields.recharging then
    Scraper.shields.attempts = 0
    publishShieldState()
    sendRechargeAttempt()
  elseif wasCheck and Scraper.shields.auto and current and maximum and current < maximum then
    beginShieldRecharge(nil)
  else
    publishShieldState()
  end
end

function Scraper.handleRechargeResponse(text)
  local response = trim(text)
  if response == "Recharging shields.." then
    if not Scraper.shields.recharging then return false end
    Scraper.shields.awaiting = false
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.actionTimerId = nil
    Scraper.shields.attempts = Scraper.shields.attempts + 1
    publishShieldState()
    if Scraper.shields.attempts >= 10 then
      requestShieldStatus(true)
    else
      Scraper.shields.actionTimerId = tempTimer(0.25, function()
        Scraper.shields.actionTimerId = nil
        sendRechargeAttempt()
      end)
    end
    return true
  end
  if response == "The shields are already at peak power." then
    if type(Scraper.state.observer.shields) == "table"
        and Scraper.state.observer.shields.maximum then
      Scraper.state.observer.shields.current = Scraper.state.observer.shields.maximum
    end
    finishShieldRecharge("completed", response)
    return true
  end
  return false
end

function Scraper.handleShipHit(text, critical)
  if not critical and not trim(text):match("^You are hit by .+ from .-'[^']+'!") then
    return false
  end
  Scraper.combat.lastActivityAt = os.time()
  if not Scraper.shields.auto then return true end
  safeKill("killTimer", Scraper.shields.damageTimerId)
  Scraper.shields.damageTimerId = nil
  if critical then
    if not Scraper.shields.recharging then
      local started = beginShieldRecharge(nil)
      if not started and Scraper.pendingCommandKind == "target" then
        Scraper.shields.damageTimerId = tempTimer(0.35, function()
          Scraper.shields.damageTimerId = nil
          Scraper.handleShipHit(text, true)
        end)
      end
    end
  else
    Scraper.shipGmcp.damageSequence = Scraper.shipGmcp.sequence or 0
    Scraper.shields.damageTimerId = tempTimer(3, function()
      Scraper.shields.damageTimerId = nil
      if Scraper.shipGmcp.damageSequence ~= nil
          and (Scraper.shipGmcp.sequence or 0) <= Scraper.shipGmcp.damageSequence then
        Scraper.shipGmcp.damageSequence = nil
        requestShieldStatus(true)
      end
    end)
  end
  return true
end

local function gmcpNumber(info, key)
  if type(info) ~= "table" or info[key] == nil then return nil end
  return tonumber(info[key])
end

function Scraper.handleShipGmcp()
  local info = _G.gmcp and _G.gmcp.Ship and _G.gmcp.Ship.Info or nil
  if type(info) ~= "table" or next(info) == nil then return false end

  Scraper.state = Scraper.state or freshState()
  local observer = Scraper.state.observer
  local speed, maxSpeed = gmcpNumber(info, "speed"), gmcpNumber(info, "maxSpeed")
  local energy, maxEnergy = gmcpNumber(info, "energy"), gmcpNumber(info, "maxEnergy")
  local hull, maxHull = gmcpNumber(info, "hull"), gmcpNumber(info, "maxHull")
  local shield, maxShield = gmcpNumber(info, "shield"), gmcpNumber(info, "maxShield")
  local posX, posY, posZ = gmcpNumber(info, "posX"), gmcpNumber(info, "posY"),
    gmcpNumber(info, "posZ")
  local headX, headY, headZ = gmcpNumber(info, "headX"), gmcpNumber(info, "headY"),
    gmcpNumber(info, "headZ")

  if speed ~= nil or maxSpeed ~= nil then
    observer.speed = observer.speed or {}
    if speed ~= nil then observer.speed.current = speed end
    if maxSpeed ~= nil then observer.speed.maximum = maxSpeed end
  end
  if energy ~= nil or maxEnergy ~= nil then
    observer.energy = observer.energy or {}
    if energy ~= nil then observer.energy.current = energy end
    if maxEnergy ~= nil then observer.energy.maximum = maxEnergy end
  end
  if hull ~= nil or maxHull ~= nil then
    observer.hull = observer.hull or {}
    if hull ~= nil then observer.hull.current = hull end
    if maxHull ~= nil then observer.hull.maximum = maxHull end
  end
  if shield ~= nil or maxShield ~= nil then
    observer.shields = observer.shields or {}
    if shield ~= nil then observer.shields.current = shield end
    if maxShield ~= nil then observer.shields.maximum = maxShield end
  end
  if posX ~= nil then observer.x = posX end
  if posY ~= nil then observer.y = posY end
  if posZ ~= nil then observer.z = posZ end
  if headX ~= nil and headY ~= nil and headZ ~= nil
      and (headX ~= 0 or headY ~= 0 or headZ ~= 0) then
    observer.heading = {x = headX, y = headY, z = headZ}
  end
  if info.piloting ~= nil then
    observer.piloting = info.piloting == true or info.piloting == 1
      or tostring(info.piloting):lower() == "true"
  end

  Scraper.shipGmcp.sequence = (Scraper.shipGmcp.sequence or 0) + 1
  Scraper.shipGmcp.lastAt = os.time()
  Scraper.state.metadata.sources.ship_gmcp = Scraper.shipGmcp.lastAt
  Scraper.state.metadata.lastSource = "ship_gmcp"
  Scraper.state.metadata.lastObservedAt = Scraper.shipGmcp.lastAt
  Scraper.state.metadata.shipGmcpHealthy = true
  clearObserverHydration("status")

  if Scraper.shipGmcp.damageSequence ~= nil
      and Scraper.shipGmcp.sequence > Scraper.shipGmcp.damageSequence then
    Scraper.shipGmcp.damageSequence = nil
    safeKill("killTimer", Scraper.shields.damageTimerId)
    Scraper.shields.damageTimerId = nil
    if Scraper.shields.auto and shield and maxShield and shield < maxShield
        and not Scraper.shields.recharging then
      beginShieldRecharge(nil)
    end
  end
  if Scraper.shields.recharging and shield and maxShield and shield >= maxShield then
    finishShieldRecharge("completed", "Shields confirmed at peak power by GMCP.")
  else
    Scraper.publish()
  end
  return true
end

ensureShieldsOn = function()
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then return false end
  if Scraper.pendingCommandKind == "target" then
    tempTimer(0.5, ensureShieldsOn)
    return false
  end
  Scraper.polling.dispatching = true
  local sent, sendResult = pcall(send, "shields on", false)
  Scraper.polling.dispatching = false
  Scraper.shields.activationPending = sent and sendResult ~= false
  return Scraper.shields.activationPending
end

function Scraper.handleShieldPowerResponse(text)
  local response = trim(text)
  if response == "Shields ON. Autorecharge ON." then
    Scraper.shields.activationPending = false
    Scraper.state.observer.shieldsActive = true
  elseif response == "Autorecharge OFF. Shields IDLING." then
    Scraper.shields.activationPending = false
    Scraper.state.observer.shieldsActive = false
  else
    return false
  end
  publishShieldState()
  return true
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
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "autotrack", false)
  Scraper.polling.dispatching = false
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
  Scraper.combat.pendingTargetName = name
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "target " .. name)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    Scraper.combat.pendingTargetName = nil
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
  if status == "completed" then
    Scraper.combat.targetName = Scraper.combat.pendingTargetName
    Scraper.combat.lastActivityAt = os.time()
    Scraper.state.observer.target = Scraper.combat.targetName
    Scraper.state.metadata.combatTarget = Scraper.combat.targetName
  end
  Scraper.combat.pendingTargetName = nil
  resolvePendingCommand(status, reason, 0.25)
  if status == "completed" then Scraper.publish() end
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

function Scraper.handleIncomingTargeting(text)
  local shipName = trim(text):match("^You are being targeted by .-'([^']+)'%.?$")
  if not shipName then return false end
  Scraper.combat.lastActivityAt = os.time()
  local marked, markError = Scraper.setDisposition(shipName, "enemy")
  if not marked then
    diagnostic("warn", "could not mark targeting ship " .. shipName .. " as enemy: "
      .. tostring(markError))
    return false
  end
  diagnostic("info", shipName .. " targeted the observer and was marked enemy")
  return true
end

local FIRE_COMMANDS = {
  autoblaster = {command = "fire autoblaster", field = "autoblasters"},
  laser = {command = "fire laser", field = "laserCannons"},
  turbolaser = {command = "fire turbolaser", field = "turbolasers"},
  ion = {command = "fire ion", field = "ionCannons"},
  missile = {command = "fire missile", field = "maximumMissiles", launcher = true, ammo = "missiles"},
  torpedo = {command = "fire torpedo", field = "maximumTorpedoes", launcher = true, ammo = "torpedoes"},
  rocket = {command = "fire rocket", field = "maximumRockets", launcher = true, ammo = "rockets"},
  burst = {command = "fire burst", field = "maximumPulses", launcher = true},
}
local FIRE_ORDER = {"autoblaster", "laser", "turbolaser", "ion",
  "missile", "torpedo", "rocket", "burst"}

local function installedFireCommands(requested)
  if requested == "best" then return {{weapon = "best", command = "fire"}} end
  local weapons = Scraper.state.observer.weapons or {}
  local function installed(weapon)
    local definition = FIRE_COMMANDS[weapon]
    local ammunition = definition and definition.ammo and Scraper.state.observer[definition.ammo] or nil
    local depleted = type(ammunition) == "table" and tonumber(ammunition.current) == 0
    return definition and not depleted and tonumber(weapons[definition.field] or 0) > 0
      and (not definition.launcher or tonumber(weapons.missileTubes or 0) > 0)
  end
  local commands = {}
  if requested == "all" then
    for _, weapon in ipairs(FIRE_ORDER) do
      if installed(weapon) then
        table.insert(commands, {weapon = weapon, command = FIRE_COMMANDS[weapon].command})
      end
    end
  elseif installed(requested) then
    table.insert(commands, {weapon = requested, command = FIRE_COMMANDS[requested].command})
  end
  return commands
end

local function dispatchFireWeapon(payload)
  local gateError = commandGateError()
  if gateError then return false, gateError end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "weapons are unavailable while landed"
  end
  if Scraper.state.observer.hasWeapons == false then return false, "this ship has no weapons" end
  if not Scraper.combat.targetName then return false, "no combat target is locked" end
  local requested = trim(payload.weapon):lower()
  if requested ~= "all" and requested ~= "best" and not FIRE_COMMANDS[requested] then
    return false, "unsupported weapon type"
  end
  local commands = installedFireCommands(requested)
  if #commands == 0 then return false, "requested weapon is not installed" end

  cancelPollTimer()
  local interruptedShieldCheck = Scraper.shields.statusPending == true
  if Scraper.active then abandonCapture("superseded by weapons command") end
  if interruptedShieldCheck then
    Scraper.shields.statusPending = false
    Scraper.shields.checkForRecharge = true
  end
  Scraper.polling.dispatching = true
  for _, fire in ipairs(commands) do
    Scraper.combat.lastFireWeapon = fire.weapon
    local sent, sendResult, sendError = pcall(send, fire.command, false)
    if not sent or sendResult == false then
      Scraper.polling.dispatching = false
      scheduleNextPoll(2)
      return false, tostring(sent and sendError or sendResult)
    end
  end
  Scraper.polling.dispatching = false
  if interruptedShieldCheck then
    Scraper.shields.actionTimerId = tempTimer(0.35, function()
      Scraper.shields.actionTimerId = nil
      requestShieldStatus(true)
    end)
  else
    scheduleNextPoll(2)
  end
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

  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "radar", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("startup radar probe could not be sent")
    Scraper.setInSpace(false, "startup radar could not be sent")
    return false, tostring(sent and sendError or sendResult)
  end
  return true
end

function Scraper.handleOutgoingCommand(eventName, command)
  if Scraper.polling.dispatching then return end
  refreshLotjUiCompatibility()
  if Scraper.pendingCommandKind == "target" then
    if type(denyCurrentSend) == "function" then denyCurrentSend() end
    if type(cecho) == "function" then
      cecho("<yellow>[Holocron3D] Command held until target lock completes.\n")
    end
    return
  end

  -- Mudlet is the primary interactive client. Any command originating outside
  -- Holocron3D preempts a hidden capture and gives the user a quiet window
  -- before telemetry polling resumes. This also adopts radar commands issued
  -- by the official LotJ UI instead of immediately sending a duplicate.
  cancelPollTimer()
  if Scraper.active then
    abandonCapture("interrupted by external Mudlet command")
    cancelPollTimer()
  end
  if Scraper.polling.enabled and Scraper.state
      and Scraper.state.metadata.inSpace == true then
    scheduleNextPoll(Scraper.USER_IDLE_POLL_DELAY_SECONDS)
  end

  local parserCommand = parserForCommand(command)
  if not parserCommand then return end
  if Scraper.state and Scraper.state.metadata.inSpace == false then return end
  Scraper.startCapture(parserCommand, command, {external = true})
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

function Scraper.requestShipGmcpSupport(eventName, protocol)
  if protocol and tostring(protocol):upper() ~= "GMCP" then return false end
  if type(sendGMCP) ~= "function" then return false end
  local ok = pcall(sendGMCP, "Core.Supports.Add", '["Ship 1"]')
  return ok
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
  Scraper.combat = {targetName = nil, pendingTargetName = nil, nextEventId = 0,
    lastFireWeapon = nil, projectileRadarRequestedAt = 0, lastRadarAt = 0,
    lastActivityAt = 0, lastLaunchWeapon = nil, lastLaunchTarget = nil,
    lastLaunchAt = 0}
  Scraper.shipGmcp = {lastAt = 0, sequence = 0, damageSequence = nil}
  safeKill("killTimer", Scraper.shields.damageTimerId)
  safeKill("killTimer", Scraper.shields.actionTimerId)
  Scraper.shields = {auto = true, recharging = false, awaiting = false, attempts = 0,
    damageTimerId = nil, actionTimerId = nil, statusPending = false,
    manualIntentId = nil, activationPending = false}
  Scraper.shields = {auto = true, recharging = false, awaiting = false, attempts = 0,
    damageTimerId = nil, actionTimerId = nil, statusPending = false,
    manualIntentId = nil, activationPending = false}
  Scraper.state = freshState()
  if Scraper.state.metadata.mudletCompatibility.lotjUiDetected then
    diagnostic("info", "official LotJ Mudlet UI detected; shared chat and radar compatibility enabled")
  else
    refreshLotjUiCompatibility()
  end
  Scraper.scanState = {}
  Scraper.polling.hydrationQueue = {}
  Scraper.eventHandlerIds = {
    registerAnonymousEventHandler("sysDataSendRequest", Scraper.handleOutgoingCommand),
    registerAnonymousEventHandler("gmcp.Ship.Info", Scraper.handleShipGmcp),
    registerAnonymousEventHandler("sysProtocolEnabled", Scraper.requestShipGmcpSupport),
  }
  Scraper.requestShipGmcpSupport()
  Scraper.stateTriggerIds = {
    tempTrigger("Wait until after you launch!", function()
      Scraper.setInSpace(false, "LotJ reports that the ship has not launched")
    end),
    tempTrigger("You feel a slight thud as the ship sets down on the ground.", function()
      Scraper.setInSpace(false, "landing sequence complete")
    end),
    tempTrigger("The ship leaves the platform far behind as it flies into space", function()
      Scraper.setInSpace(true, "launch sequence complete")
      queueObserverInfo()
    end),
    tempTrigger("You grip the controls.", function()
      queueObserverInfo()
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
    tempRegexTrigger("^\\s*You are being targeted by .+'[^']+'\\.?\\s*$", function()
      Scraper.handleIncomingTargeting(line or "")
    end),
    tempRegexTrigger("^\\s*You are hit by .+ from .+'[^']+'!.*$", function()
      Scraper.handleShipHit(line or "", false)
    end),
    tempTrigger("[WARNING]: Critical power overload... Shields down!", function()
      Scraper.handleShipHit(line or "", true)
    end),
    tempRegexTrigger("^\\s*(?:Recharging shields\\.\\.|The shields are already at peak power\\.)\\s*$", function()
      Scraper.handleRechargeResponse(line or "")
    end),
    tempRegexTrigger("^\\s*(?:Shields ON\\. Autorecharge ON\\.|Autorecharge OFF\\. Shields IDLING\\.)\\s*$", function()
      Scraper.handleShieldPowerResponse(line or "")
    end),
    tempRegexTrigger("^\\s*(?:Target:\\s+.+|You fail to lock on to your target!|(?:The\\s+)?.+\\s+can\\s+only\\s+fire\\s+forwards\\.\\s+You'll\\s+need\\s+to\\s+turn\\s+your\\s+ship!|(?:Missile|Torpedo|Rocket)\\s+launched\\.|A\\s+.+\\s+is\\s+launched\\s+toward\\s+.+\\s+by\\s+your\\s+ship\\.|\\d+\\s+.+\\s+fired\\.\\.\\.|Your ship's\\s+.+|.+\\s+fully charged\\.|.+\\s+launcher(?:\\(s\\)|s)?\\s+reloaded\\.)\\s*$", function()
      Scraper.handleCombatLine(line or "")
    end),
    tempRegexTrigger("^\\s*\\d+\\s+projectiles?,\\s+\\d+\\s+incoming.*$", function()
      Scraper.handleProjectileSummary(line or "")
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
    proxy.registerIntentHandler("fire_weapon", dispatchFireWeapon)
    proxy.registerIntentHandler("recharge_shields", function(_, message)
      return beginShieldRecharge(message and message.id or nil)
    end)
    proxy.registerIntentHandler("set_auto_recharge", function(payload)
      if type(payload.enabled) ~= "boolean" then
        return false, "auto recharge enabled must be a boolean"
      end
      Scraper.shields.auto = payload.enabled
      publishShieldState()
      return true
    end)
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

      Scraper.polling.dispatching = true
      local sent, sendError = pcall(function()
        if departureSpeed then send("speed " .. tostring(departureSpeed)) end
        send(command)
      end)
      Scraper.polling.dispatching = false
      if not sent then return false, tostring(sendError) end
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
      Scraper.polling.dispatching = true
      local sent, sendError = pcall(function()
        send("speed " .. tostring(math.floor(requestedSpeed + 0.5)))
      end)
      Scraper.polling.dispatching = false
      if not sent then return false, tostring(sendError) end
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
  Scraper.combat = {targetName = nil, pendingTargetName = nil, nextEventId = 0,
    lastFireWeapon = nil, projectileRadarRequestedAt = 0, lastRadarAt = 0,
    lastActivityAt = 0}
  Scraper.shipGmcp = {lastAt = 0, sequence = 0, damageSequence = nil}
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
