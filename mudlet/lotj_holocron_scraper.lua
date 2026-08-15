-- LotJ Holocron 3D - live Mudlet command/output collector
-- Installs temporary aliases and triggers; nothing persists in the profile.

local Scraper = {
  CAPTURE_TIMEOUT_SECONDS = 8,
  MAX_CAPTURE_LINES = 300,
  MAX_CAPTURE_BYTES = 256 * 1024,
  -- Radar and observer coordinates are sufficient to derive proximity. Keep
  -- prox parsers for visible/manual commands, but do not spend two captures
  -- per cycle asking LotJ to calculate data we already have.
  POLL_COMMANDS = {"status", "info"},
  POLL_COMMAND_GAP_SECONDS = 1,
  POLL_CYCLE_DELAY_SECONDS = 5,
  HOSTILE_SCAN_INTERVAL_SECONDS = 4,
  STANDARD_SCAN_INTERVAL_SECONDS = 10,
  COMBAT_RADAR_INTERVAL_SECONDS = 2,
  FLEETRADAR_INTERVAL_SECONDS = 6,
  COMBAT_FLEETRADAR_INTERVAL_SECONDS = 12,
  FLEET_STATUS_INTERVAL_SECONDS = 10,
  COMBAT_FLEET_STATUS_INTERVAL_SECONDS = 4,
  INACTIVE_FORMATION_PROBE_INTERVAL_SECONDS = 60,
  RADAR_RECONCILE_INTERVAL_SECONDS = 60,
  MIN_HYPERSPACE_CLEARANCE = 500,
  HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS = 15,
  COMBAT_ACTIVITY_WINDOW_SECONDS = 10,
  USER_IDLE_POLL_DELAY_SECONDS = 2.5,
  SHIP_GMCP_STALE_SECONDS = 10,
  eventHandlerIds = {},
  stateTriggerIds = {},
  active = nil,
  proxy = nil,
  state = nil,
  lastCapture = nil,
  polling = {enabled = false, index = 1, timerId = nil, dispatching = false,
    hydrationQueue = {}, lastFleetRadarAt = 0, lastBattlegroupAt = 0,
    lastSquadronAt = 0},
  scanState = {},
  pendingCommandIntentId = nil,
  pendingCommandTimerId = nil,
  pendingCommandKind = nil,
  combat = {targetName = nil, pendingTargetName = nil, nextEventId = 0,
    lastFireWeapon = nil, projectileRadarRequestedAt = 0, lastRadarAt = 0,
    lastActivityAt = 0, lastLaunchWeapon = nil, lastLaunchTarget = nil,
    lastLaunchSource = nil, lastLaunchAt = 0, lastImpactWeapon = nil, lastImpactTarget = nil,
    lastImpactSource = nil, lastImpactAt = 0, projectileReconcileTimerId = nil},
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
  hyperspace = {phase = "idle", initiatedByHolocron = false, acknowledgedFuelRisk = false,
    activeIntentId = nil, statusTimerId = nil},
  fleetCommand = {nextOrderId = 0, currentMemberName = nil,
    verificationTimerId = nil, holdUntil = 0},
  projectileTracking = {nextId = 0, tracks = {}},
  profiler = {enabled = false},
}

local scheduleNextPoll
local requestAutotrack
local ensureShieldsOn
local handleShieldStatus
local queueObserverHydration
local clearObserverHydration
local queueObserverInfo
local dispatchSpaceProbe
local recountFleetOrder
local requestProjectileRadarReconciliation

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function profileObjectCounts()
  if type(getProfileStats) ~= "function" then return nil end
  local ok, stats = pcall(getProfileStats)
  if not ok or type(stats) ~= "table" then return nil end
  local function active(group, child)
    local value = stats[group]
    if type(value) ~= "table" then return nil end
    if child then value = value[child] end
    if type(value) == "table" then value = value.active end
    return tonumber(value)
  end
  return {
    triggers = active("triggers"),
    patterns = active("triggers", "patterns") or active("patterns"),
    timers = active("timers"),
    aliases = active("aliases"),
    scripts = active("scripts"),
  }
end

local function profileCount(name, amount)
  local profiler = Scraper.profiler
  if not profiler.enabled then return end
  profiler.counts[name] = (profiler.counts[name] or 0) + (amount or 1)
end

local function profileCommand(command)
  local profiler = Scraper.profiler
  if not profiler.enabled then return end
  local normalized = trim(command):lower():gsub("%s+", " ")
  profiler.commands[normalized] = (profiler.commands[normalized] or 0) + 1
end

local function profileTiming(name, startedAt)
  local profiler = Scraper.profiler
  if not profiler.enabled or not startedAt then return end
  local elapsed = math.max(0, os.clock() - startedAt)
  local timing = profiler.timings[name] or {count = 0, totalSeconds = 0, maxSeconds = 0}
  timing.count = timing.count + 1
  timing.totalSeconds = timing.totalSeconds + elapsed
  timing.maxSeconds = math.max(timing.maxSeconds, elapsed)
  profiler.timings[name] = timing
end

local function profileCopy(value)
  if type(value) ~= "table" then return value end
  local result = {}
  for key, child in pairs(value) do result[key] = profileCopy(child) end
  return result
end

function Scraper.startProfiler()
  Scraper.profiler = {
    enabled = true,
    startedAt = os.time(),
    counts = {},
    commands = {},
    timings = {},
    objectCountsAtStart = profileObjectCounts(),
  }
  return true
end

function Scraper.getProfilerReport()
  local profiler = Scraper.profiler or {enabled = false}
  if not profiler.startedAt then return nil, "the profiler has not been started" end
  local report = {
    enabled = profiler.enabled == true,
    elapsedSeconds = math.max(0, os.time() - profiler.startedAt),
    counts = profileCopy(profiler.counts or {}),
    commands = profileCopy(profiler.commands or {}),
    timings = profileCopy(profiler.timings or {}),
    objectCountsAtStart = profileCopy(profiler.objectCountsAtStart),
    objectCounts = profileObjectCounts(),
  }
  return report
end

function Scraper.stopProfiler()
  local report, reportError = Scraper.getProfilerReport()
  if not report then return nil, reportError end
  Scraper.profiler.enabled = false
  report.enabled = false
  return report
end

local function radarSystemName(value)
  value = trim(value)
  local explicit = value:match("^[Ss]tarsystem:%s*(.-)%s*$")
  if explicit and explicit ~= "" then return explicit end
  if value:find(":", 1, true) or not value:match("^[%w][%w%s'%-]+$") then return nil end
  local lower = value:lower()
  if lower == "uncharted space" or lower == "unknown space" then return value end
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
    or lower:match("^you see a large explosion as ") ~= nil
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
    if radarSystemName(value) ~= nil or isCoordinateRow(value)
        or lower:match("battlegroup:%s*$") then
      return markResponseStarted(capture)
    end
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

  if capture.parserCommand == "battlegroup" then
    if value:match("^%[%s*[^%]]-%s*%].-:<*.-[Pp]os:")
        or (capture.responseStarted and (lower:match("^energy:")
          or lower:find("battlegroup", 1, true)))
        or (lower:find("battlegroup", 1, true) and (lower:find("not ", 1, true)
          or lower:find("no ", 1, true) or lower:find("aren't", 1, true))) then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "squadron status" then
    if lower:match("^lead:%s+.-'.-'$")
        or lower:match("^squadron%s+fire%s+assist:")
        or (capture.responseStarted and (lower:match("^energy:")
          or value:match("^.-%s+'.-'$")))
        or (lower:find("squadron", 1, true) and (lower:find("not ", 1, true)
          or lower:find("no ", 1, true) or lower:find("aren't", 1, true))) then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "navstat" then
    if lower:match("^readout%s+for%s+.-:$")
        or lower:match("^current%s+coordinates:")
        or lower:match("^current%s+system:")
        or lower:match("^current%s+system%s+x/y:")
        or lower:match("^jump%s+")
        or lower:find("standard sectors", 1, true) then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "calculate" then
    if lower == "possible destinations:"
        or lower:match("^starsystem%s+parsecs")
        or lower:match("^calculating%s+hyperspace%s+trajectory:") then
      return markResponseStarted(capture)
    end
    if capture.responseStarted and value:match("%s%s+") then return true end
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
      hyperspace = {phase = "idle"},
      formations = {},
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
        or (not wantedId and wantedName
          and tostring(current.name or ""):lower() == wantedName) then
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

local function projectileTrackKey(entity)
  return (tostring(entity.class or "") .. " " .. tostring(entity.name or ""))
    :lower():gsub("^%s+", ""):gsub("%s+$", ""):gsub("%s+", " ")
end

local function assignProjectileTrackIds(entities)
  local tracking = Scraper.projectileTracking or {nextId = 0, tracks = {}}
  local previous = tracking.tracks or {}
  local incoming = {}
  for _, entity in ipairs(entities or {}) do
    if entity.kind == "projectile" then table.insert(incoming, entity) end
  end

  -- LotJ exposes projectile type and coordinates, but no durable identifier.
  -- Match the complete set globally against each track's predicted next
  -- position so the remaining rows do not get renumbered when one explodes.
  local edges = {}
  for incomingIndex, entity in ipairs(incoming) do
    local key = projectileTrackKey(entity)
    for trackId, track in pairs(previous) do
      if track.key == key then
        local predictedX = (tonumber(track.x) or 0) + (tonumber(track.vx) or 0)
        local predictedY = (tonumber(track.y) or 0) + (tonumber(track.vy) or 0)
        local predictedZ = (tonumber(track.z) or 0) + (tonumber(track.vz) or 0)
        local dx = (tonumber(entity.x) or 0) - predictedX
        local dy = (tonumber(entity.y) or 0) - predictedY
        local dz = (tonumber(entity.z) or 0) - predictedZ
        table.insert(edges, {
          incomingIndex = incomingIndex,
          trackId = trackId,
          distanceSquared = dx * dx + dy * dy + dz * dz,
        })
      end
    end
  end
  table.sort(edges, function(left, right)
    if left.distanceSquared == right.distanceSquared then
      return tostring(left.trackId) < tostring(right.trackId)
    end
    return left.distanceSquared < right.distanceSquared
  end)

  local incomingMatches, trackMatches = {}, {}
  for _, edge in ipairs(edges) do
    if not incomingMatches[edge.incomingIndex] and not trackMatches[edge.trackId] then
      incomingMatches[edge.incomingIndex] = edge.trackId
      trackMatches[edge.trackId] = true
    end
  end

  local nextTracks = {}
  for incomingIndex, entity in ipairs(incoming) do
    local trackId = incomingMatches[incomingIndex]
    local old = trackId and previous[trackId] or nil
    if not trackId then
      tracking.nextId = (tonumber(tracking.nextId) or 0) + 1
      trackId = "projectile-track-" .. tostring(tracking.nextId)
    end
    local x, y, z = tonumber(entity.x) or 0, tonumber(entity.y) or 0, tonumber(entity.z) or 0
    entity.id = trackId
    nextTracks[trackId] = {
      key = projectileTrackKey(entity),
      x = x, y = y, z = z,
      vx = old and x - (tonumber(old.x) or x) or 0,
      vy = old and y - (tonumber(old.y) or y) or 0,
      vz = old and z - (tonumber(old.z) or z) or 0,
    }
  end
  tracking.tracks = nextTracks
  Scraper.projectileTracking = tracking
end

local function replaceRadarEntities(entities)
  assignProjectileTrackIds(entities)
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

local function refreshDerivedDistances()
  if not Scraper.state then return end
  local observer = Scraper.state.observer or {}
  local ox, oy, oz = tonumber(observer.x), tonumber(observer.y), tonumber(observer.z)
  if not ox or not oy or not oz then return end
  for _, entity in pairs(Scraper.state.entities or {}) do
    local x, y, z = tonumber(entity.x), tonumber(entity.y), tonumber(entity.z)
    if x and y and z then
      entity.distance = math.floor(math.sqrt(
        (x - ox) ^ 2 + (y - oy) ^ 2 + (z - oz) ^ 2
      ) + 0.5)
    end
  end
end

local function checkHyperspaceClearance()
  if not Scraper.state then return false, "fresh radar clearance is required" end
  local observer = Scraper.state.observer or {}
  local ox, oy, oz = tonumber(observer.x), tonumber(observer.y), tonumber(observer.z)
  if not ox or not oy or not oz then return false, "observer coordinates are unavailable" end
  local sources = Scraper.state.metadata and Scraper.state.metadata.sources or {}
  local spatialAt = math.max(tonumber(sources.radar) or 0, tonumber(sources.fleetradar) or 0)
  if spatialAt <= 0 or os.time() - spatialAt > Scraper.HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS then
    return false, "fresh radar clearance is required"
  end

  local nearest, nearestName
  for _, entity in pairs(Scraper.state.entities or {}) do
    if entity.kind == "ship" or entity.kind == "planet"
        or entity.kind == "celestial" or entity.kind == "star" then
      local x, y, z = tonumber(entity.x), tonumber(entity.y), tonumber(entity.z)
      if x and y and z and entity.id ~= "player-ship" then
        local distance = math.sqrt((x - ox) ^ 2 + (y - oy) ^ 2 + (z - oz) ^ 2)
        if not nearest or distance < nearest then
          nearest, nearestName = distance, entity.name or entity.id
        end
      end
    end
  end
  if nearest and nearest < Scraper.MIN_HYPERSPACE_CLEARANCE then
    return false, string.format("%s is only %d units away; 500 units are required",
      tostring(nearestName or "an object"), math.floor(nearest + 0.5))
  end
  return true
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
  if result.autopilot ~= nil then
    destination.autopilot = result.autopilot == true
    local memberName = trim(result.name or destination.name):lower()
    local metadata = Scraper.state.metadata or {}
    local function updateFleet(fleet)
      for _, member in ipairs(type(fleet) == "table" and fleet.members or {}) do
        if trim(member.name):lower() == memberName then
          member.autopilot = result.autopilot == true
          member.autopilotStatus = result.autopilotStatus
        end
      end
    end
    updateFleet(metadata.fleet)
    for _, fleet in pairs(metadata.formations or {}) do updateFleet(fleet) end
    local order = metadata.fleetOrder
    if type(order) == "table" and order.order == "autopilot"
        and type(order.results) == "table" then
      for name, memberResult in pairs(order.results) do
        if trim(name):lower() == memberName then
          memberResult.status = "accepted"
          memberResult.autopilot = result.autopilot == true
          memberResult.reason = "Verified by ship status."
          memberResult.observedAt = os.time()
        end
      end
      if recountFleetOrder then recountFleetOrder(order) end
    end
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
  elseif source == "navstat" then
    if result.coordinates then
      Scraper.state.observer.x, Scraper.state.observer.y, Scraper.state.observer.z =
        result.coordinates.x, result.coordinates.y, result.coordinates.z
    end
    if result.heading then Scraper.state.observer.heading = copyTable(result.heading) end
    if result.speed then Scraper.state.observer.speed = copyTable(result.speed) end
    if result.system then Scraper.state.metadata.system = result.system end
    Scraper.state.metadata.navigation = Scraper.state.metadata.navigation or {}
    if Scraper.state.metadata.hyperspace
        and Scraper.state.metadata.hyperspace.phase == "arrived" then
      Scraper.state.metadata.navigation.arrivalRefreshedAt = os.time()
    end
    for _, key in ipairs({"galaxy", "jumpSystem", "jumpDistanceParsecs", "jumpTime",
        "jumpTimeSeconds", "standardSectorsAvailable"}) do
      if result[key] ~= nil then Scraper.state.metadata.navigation[key] = copyTable(result[key]) end
    end
  elseif source == "calculate" then
    Scraper.state.metadata.navigation = Scraper.state.metadata.navigation or {}
    if result.mode == "destinations" then
      Scraper.state.metadata.navigation.destinations = copyTable(result.destinations or {})
      Scraper.state.metadata.navigation.destinationsObservedAt = os.time()
    elseif result.mode == "status" then
      Scraper.state.metadata.hyperspace = Scraper.state.metadata.hyperspace or {}
      Scraper.state.metadata.hyperspace.phase = "calculating"
      Scraper.state.metadata.hyperspace.remainingSeconds = result.remainingSeconds
    end
  elseif source == "battlegroup" or source == "squadron" then
    Scraper.state.metadata.formations = Scraper.state.metadata.formations or {}
    local fleet = copyTable(result.fleet or {kind = source, active = false, members = {}})
    local previous = Scraper.state.metadata.formations[source]
    for _, member in ipairs(fleet.members or {}) do
      for _, oldMember in ipairs(type(previous) == "table" and previous.members or {}) do
        if trim(oldMember.name):lower() == trim(member.name):lower() then
          if member.autopilot == nil then member.autopilot = oldMember.autopilot end
          if member.autopilotStatus == nil then member.autopilotStatus = oldMember.autopilotStatus end
          break
        end
      end
      local entity = findEntity({name = member.name})
      if entity and member.autopilot == nil then
        member.autopilot = entity.autopilot
        member.autopilotStatus = entity.autopilotStatus
      end
    end
    local observerName = trim(Scraper.state.observer and Scraper.state.observer.name):lower()
    for _, member in ipairs(fleet.members or {}) do
      if trim(member.name):lower() == observerName then
        if source == "battlegroup" then
          fleet.role = member.leader == true and "commander" or "member"
        else
          fleet.role = member.leader == true and "lead" or "wing"
        end
      end
    end
    fleet.observedAt = os.time()
    Scraper.state.metadata.formations[source] = fleet
    local other = source == "battlegroup" and "squadron" or "battlegroup"
    local otherFleet = Scraper.state.metadata.formations[other]
    if fleet.active == true then
      Scraper.state.metadata.fleet = fleet
    elseif Scraper.state.metadata.fleet
        and Scraper.state.metadata.fleet.kind == source then
      Scraper.state.metadata.fleet = otherFleet and otherFleet.active == true
        and copyTable(otherFleet) or nil
    end
  else
    if source == "fleetradar" then
      Scraper.polling.lastFleetRadarAt = os.time()
      if result.system then Scraper.state.metadata.system = result.system end
    end
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
      else
        mergeEntity(entity, source == "prox" or source == "prox_velocity")
      end
    end
  end

  refreshDerivedDistances()
  Scraper.state.metadata.lastSource = source
  Scraper.state.metadata.lastObservedAt = os.time()
  return true
end

function Scraper.publish()
  local profiling = Scraper.profiler.enabled == true
  local profileStarted = profiling and os.clock() or nil
  if profiling then profileCount("snapshotPublishes") end
  if not Scraper.proxy or type(Scraper.proxy.publishSnapshot) ~= "function" then
    if profiling then
      profileCount("snapshotFailures")
      profileTiming("publish", profileStarted)
    end
    return nil, "scraper has no proxy"
  end
  local published, publishError = Scraper.proxy.publishSnapshot(
    copyTable(Scraper.state.observer),
    arrayOfEntities(),
    copyTable(Scraper.state.metadata)
  )
  if profiling then
    if not published then profileCount("snapshotFailures") end
    profileTiming("publish", profileStarted)
  end
  return published, publishError
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
  profileCount("capturesAbandoned")
  profileCount("captureReason:" .. tostring(reason or "abandoned"))
  profileTiming("capture", capture.profileStarted)
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
    Scraper.polling.lastFleetRadarAt = 0
    Scraper.polling.lastBattlegroupAt = 0
    Scraper.polling.lastSquadronAt = 0
    Scraper.state.metadata.formations = {}
    Scraper.state.metadata.fleet = nil
    Scraper.combat.lastLaunchWeapon = nil
    Scraper.combat.lastLaunchTarget = nil
    Scraper.combat.lastLaunchSource = nil
    Scraper.combat.lastLaunchAt = 0
    Scraper.combat.lastImpactWeapon = nil
    Scraper.combat.lastImpactTarget = nil
    Scraper.combat.lastImpactSource = nil
    Scraper.combat.lastImpactAt = 0
    safeKill("killTimer", Scraper.combat.projectileReconcileTimerId)
    Scraper.combat.projectileReconcileTimerId = nil
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
  profileCount("capturesFinished")
  profileCount("captureReason:" .. tostring(reason or "completed"))
  profileTiming("capture", capture.profileStarted)
  if capture.polled and scheduleNextPoll then
    scheduleNextPoll(capture.pollDelay)
  end

  Scraper.lastCapture = {
    command = capture.sentCommand,
    parserCommand = capture.parserCommand,
    lines = captureRecordLines(capture),
    reason = reason or "completed",
  }
  clearObserverHydration(capture.sentCommand)

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

  local parseStarted = Scraper.profiler.enabled and os.clock() or nil
  local parsed, parseError = Scraper.proxy.parseGameOutput(
    capture.parserCommand,
    capture.lines
  )
  profileTiming("parse", parseStarted)
  if not parsed then
    profileCount("parseFailures")
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
    local emptyProjectilePoll = capture.polled == true
      and trim(capture.sentCommand):lower() == "radar projectiles"
    if emptyProjectilePoll then
      Scraper.state.metadata.lastEmptyProjectileRadarAt = os.time()
    else
      diagnostic("warn", "could not parse " .. capture.sentCommand .. " output: "
        .. tostring(parseError) .. "; run lotjHolocron3D.scraper.showLastCapture()")
    end
    return nil, parseError
  end


  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    Scraper.setInSpace(true, capture.sentCommand .. " returned space data")
  end

  local applyStarted = Scraper.profiler.enabled and os.clock() or nil
  local applied, applyError = Scraper.applyResult(parsed, capture.sentCommand)
  profileTiming("apply", applyStarted)
  if not applied then
    profileCount("applyFailures")
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

  -- Arrival navigation must be committed before radar is requested. Starting
  -- both captures together lets radar supersede navstat and leaves the client
  -- displaying the system from before the jump.
  if capture.followupRadar and dispatchSpaceProbe then
    tempTimer(0.05, function()
      dispatchSpaceProbe({}, nil)
    end)
  end

  if not capture.polled then
    diagnostic("info", "parsed " .. capture.sentCommand .. " ("
      .. tostring(parsed.recognizedLines or 0) .. " data lines)")
  end
  return parsed
end

function Scraper.captureLine(value)
  local profiling = Scraper.profiler.enabled == true
  local profileStarted = profiling and os.clock() or nil
  if profiling then profileCount("lineChecks") end
  local capture = Scraper.active
  if not capture then
    if profiling then profileTiming("line", profileStarted) end
    return false
  end

  value = tostring(value or ""):gsub("\r", "")
  if not captureOwnsLine(capture, value) then
    if profiling then profileTiming("line", profileStarted) end
    return false
  end
  if profiling then
    profileCount("capturedLines")
    profileCount("capturedBytes", #value + 1)
  end
  if capture.polled and type(deleteLine) == "function" then
    pcall(deleteLine)
    if profiling then profileCount("deletedLines") end
  end
  capture.bytes = capture.bytes + #value + 1
  if #capture.lines >= Scraper.MAX_CAPTURE_LINES
      or capture.bytes > Scraper.MAX_CAPTURE_BYTES then
    diagnostic("error", "aborted oversized " .. capture.sentCommand .. " capture")
    Scraper.active = nil
    clearCaptureHandles(capture)
    if profiling then
      profileCount("oversizedCaptures")
      profileTiming("line", profileStarted)
    end
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
  if profiling then profileTiming("line", profileStarted) end
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
    followupRadar = options and options.followupRadar == true,
    profileStarted = Scraper.profiler.enabled and os.clock() or nil,
  }
  Scraper.active = capture
  profileCount("capturesStarted")
  if capture.polled then profileCount("polledCaptures") else profileCount("manualCaptures") end
  profileCommand(capture.sentCommand)

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
  if normalized == "battlegroup" or normalized == "bg" then return "battlegroup" end
  if normalized == "squadron status" then return "squadron status" end
  if normalized == "navstat" then return "navstat" end
  if normalized == "calc" or normalized == "calculate" then return "calculate" end

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

local function hyperspaceMetadata()
  Scraper.state = Scraper.state or freshState()
  Scraper.state.metadata.hyperspace = Scraper.state.metadata.hyperspace or {phase = "idle"}
  return Scraper.state.metadata.hyperspace
end

local function publishHyperspace(phase, extra)
  local metadata = hyperspaceMetadata()
  metadata.phase = phase
  metadata.observedAt = os.time()
  for key, value in pairs(extra or {}) do metadata[key] = value end
  Scraper.hyperspace.phase = phase
  return Scraper.publish()
end

function Scraper.disarmAutomation(reason)
  Scraper.stopPolling()
  safeKill("killTimer", Scraper.shields.damageTimerId)
  safeKill("killTimer", Scraper.shields.actionTimerId)
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  Scraper.shields.recharging = false
  Scraper.shields.awaiting = false
  Scraper.shields.statusPending = false
  Scraper.shields.manualIntentId = nil
  Scraper.autotrack.pending = false
  Scraper.autotrack.intentId = nil
  Scraper.hyperspace.activeIntentId = nil
  Scraper.hyperspace.initiatedByHolocron = false
  if Scraper.active and Scraper.active.polled then abandonCapture(reason or "automation disarmed") end
  if Scraper.state then
    Scraper.state.metadata.automationArmed = false
    Scraper.state.metadata.automationDisarmedReason = reason or "Electron disconnected"
    Scraper.publish()
  end
  return true
end

function Scraper.refreshAutomationLease(seconds)
  safeKill("killTimer", Scraper.automationLeaseTimerId)
  if Scraper.state then Scraper.state.metadata.automationArmed = true end
  Scraper.automationLeaseTimerId = tempTimer(math.max(2, tonumber(seconds) or 6), function()
    Scraper.automationLeaseTimerId = nil
    Scraper.disarmAutomation("Electron automation lease expired")
  end)
  return true
end

local function finishHyperspaceIntent(status, reason)
  local intentId = Scraper.hyperspace.activeIntentId
  Scraper.hyperspace.activeIntentId = nil
  if intentId and Scraper.proxy and type(Scraper.proxy.publishIntentAck) == "function" then
    Scraper.proxy.publishIntentAck(intentId, status, reason)
  end
end

function Scraper.handleHyperspaceLine(text)
  local value = trim(text)
  local lower = value:lower()
  if value == "Hyperspace course locked. Running final jump checks..." then
    publishHyperspace("calculating", {error = nil})
  elseif lower:match("^jump requires [%d,]+ units of fuel")
      and lower:find("it will consume", 1, true) then
    local required = value:match("[Jj]ump requires%s+([%d,]+)%s+units")
    local percent = value:match("consume%s+([%d,]+)%%")
    publishHyperspace("calculating", {
      fuelRequired = required and tonumber((required:gsub(",", ""))) or nil,
      fuelPercent = percent and tonumber((percent:gsub(",", ""))) or nil,
    })
  elseif value == "Warning - Not enough fuel to complete the jump!" then
    publishHyperspace("fuel_warning", {insufficientFuel = true})
  elseif lower:match("^jump requires [%d,]+ units of fuel%. you only have [%d,]+") then
    local required, available = value:match(
      "[Jj]ump requires%s+([%d,]+)%s+units%s+of%s+fuel%.%s+[Yy]ou%s+only%s+have%s+([%d,]+)")
    local extra = {insufficientFuel = true}
    if required then extra.fuelRequired = tonumber((required:gsub(",", ""))) end
    if available then extra.fuelAvailable = tonumber((available:gsub(",", ""))) end
    publishHyperspace("fuel_warning", extra)
    if Scraper.hyperspace.initiatedByHolocron and not Scraper.hyperspace.acknowledgedFuelRisk then
      Scraper.polling.dispatching = true
      pcall(send, "calc stop", false)
      Scraper.polling.dispatching = false
      extra.autoAborted = true
      publishHyperspace("fuel_warning", extra)
    end
  elseif value == "[Status]: Hyperspace calculations have been completed." then
    publishHyperspace("ready", {remainingSeconds = 0, insufficientFuel = nil})
    finishHyperspaceIntent("completed", value)
  elseif value == "[ALERT]: Aborting Hyperspace calculation. Terminal reset." then
    local phase = hyperspaceMetadata().insufficientFuel and "fuel_warning" or "idle"
    publishHyperspace(phase, {remainingSeconds = nil, aborted = true})
    Scraper.hyperspace.initiatedByHolocron = false
    finishHyperspaceIntent("completed", value)
  elseif lower:find("jump coordinates too close to stellar object", 1, true) then
    publishHyperspace("failed", {error = value})
    finishHyperspaceIntent("rejected", value)
  elseif lower:match("^you are too close to .+ to make the jump to lightspeed!$") then
    publishHyperspace("ready", {error = value})
    finishHyperspaceIntent("rejected", value)
  elseif value == "You push forward the hyperspeed lever." then
    publishHyperspace("engaging", {error = nil})
  elseif value == "The stars become streaks of light as you enter hyperspace." then
    publishHyperspace("hyperspace")
    finishHyperspaceIntent("completed", value)
  elseif value == "Destination reached. Initiating realspace reentry..." then
    publishHyperspace("reentry")
  elseif value == "Hyperjump complete." then
    publishHyperspace("arrived", {arrivedAt = os.time()})
    Scraper.hyperspace.initiatedByHolocron = false
  else
    local seconds = value:match("^[Cc]alculating%s+[Hh]yperspace%s+[Tt]rajectory:%s*(%d+)%s+seconds%s+remaining")
    if not seconds then return false end
    publishHyperspace("calculating", {remainingSeconds = tonumber(seconds)})
  end
  return true
end

function Scraper.publishGalaxyCatalog()
  if not Scraper.proxy or type(Scraper.proxy.sendMessage) ~= "function" then return false end
  local systems = _G.gmcp and _G.gmcp.Galaxy and _G.gmcp.Galaxy.Systems or {}
  if type(systems) ~= "table" then systems = {} end
  if next(systems) == nil and type(_G.lotj) == "table"
      and type(_G.lotj.galaxyMap) == "table"
      and type(_G.lotj.galaxyMap.systems) == "table" then
    systems = _G.lotj.galaxyMap.systems
  end
  local shipSystem = _G.gmcp and _G.gmcp.Ship and _G.gmcp.Ship.System or nil
  local custom = type(_G.lotj) == "table" and type(_G.lotj.galaxyMap) == "table"
    and _G.lotj.galaxyMap.recorded or {}
  local sent = Scraper.proxy.sendMessage({
    type = "galaxy_catalog", observedAt = os.time(), systems = copyTable(systems),
    customSystems = copyTable(custom), shipSystem = copyTable(shipSystem),
  })
  return sent == true
end

local function validateSystemCoordinate(value)
  value = tonumber(value)
  if not value or value ~= value or value < -50000 or value > 50000 then return nil end
  return value >= 0 and math.floor(value + 0.5) or math.ceil(value - 0.5)
end

local function dispatchHyperspacePlot(payload, message)
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "hyperspace navigation is unavailable while landed"
  end
  if Scraper.hyperspace.phase == "calculating" then
    return false, "a hyperspace calculation is already running"
  end
  local destination = type(payload.destination) == "table" and payload.destination or {}
  local x, y, z = validateSystemCoordinate(destination.x),
    validateSystemCoordinate(destination.y), validateSystemCoordinate(destination.z)
  if not x or not y or not z then
    return false, "system coordinates must be within -50,000 and 50,000"
  end
  local mode = trim(payload.mode):lower()
  local command
  if mode == "local" then
    command = string.format("calculate local %d %d %d", x, y, z)
  elseif mode == "galactic" then
    local galaxy = type(payload.galaxy) == "table" and payload.galaxy or {}
    local gx, gy = tonumber(galaxy.x), tonumber(galaxy.y)
    if not gx or not gy or gx ~= gx or gy ~= gy or math.abs(gx) > 100000 then
      return false, "galaxy coordinates are invalid"
    end
    command = string.format("calculate '%d %d' %d %d %d",
      math.floor(gx + 0.5), math.floor(gy + 0.5), x, y, z)
  else
    return false, "hyperspace mode must be local or galactic"
  end
  Scraper.hyperspace.initiatedByHolocron = true
  Scraper.hyperspace.acknowledgedFuelRisk = payload.acknowledgeFuelRisk == true
  Scraper.hyperspace.activeIntentId = message and message.id or nil
  local metadata = hyperspaceMetadata()
  metadata.route = copyTable(payload)
  metadata.insufficientFuel = nil
  metadata.aborted = nil
  metadata.error = nil
  publishHyperspace("calculating")
  Scraper.polling.dispatching = true
  local ok, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not ok then return false, tostring(sendError) end
  return true
end

local function dispatchNavigationRefresh(payload, message)
  if Scraper.active then
    if not Scraper.active.polled then
      return false, "a manual telemetry capture is active"
    end
    abandonCapture("preempted by navigation refresh")
    cancelPollTimer()
  end
  local command = trim(payload.command):lower()
  if command ~= "calc" and command ~= "navstat" then command = "navstat" end
  local parser = command == "calc" and "calculate" or "navstat"
  local started, err = Scraper.startCapture(parser, command, {
    polled = true, pollDelay = 0.25, intentId = message and message.id or nil,
    followupRadar = payload.followupRadar == true,
  })
  if not started then return false, err end
  Scraper.polling.dispatching = true
  local ok, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not ok then abandonCapture("navigation refresh send failed"); return false, tostring(sendError) end
  return true
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
  local sourceName = Scraper.fleetCommand.currentMemberName
    or trim(Scraper.state.observer and Scraper.state.observer.name)
  local now = os.time()
  if Scraper.combat.lastLaunchWeapon == weapon
      and Scraper.combat.lastLaunchTarget == resolvedTarget
      and Scraper.combat.lastLaunchSource == sourceName
      and now - (Scraper.combat.lastLaunchAt or 0) <= 2 then
    return true
  end
  Scraper.combat.lastLaunchWeapon = weapon
  Scraper.combat.lastLaunchTarget = resolvedTarget
  Scraper.combat.lastLaunchSource = sourceName
  Scraper.combat.lastLaunchAt = now
  local fleetOrder = Scraper.state.metadata.fleetOrder
  if Scraper.fleetCommand.currentMemberName and type(fleetOrder) == "table"
      and fleetOrder.order == "fire" and type(fleetOrder.results) == "table" then
    local result = fleetOrder.results[Scraper.fleetCommand.currentMemberName]
    if type(result) == "table" then
      result.status = "accepted"
      result.reason = nil
      result.observedAt = os.time()
      if recountFleetOrder then recountFleetOrder(fleetOrder) end
    end
  end
  local published = publishCombatEvent({type = "launch", weapon = weapon, count = count,
    targetName = resolvedTarget, sourceName = sourceName})
  if Scraper.fleetCommand.currentMemberName then
    Scraper.fleetCommand.currentMemberName = nil
    Scraper.fleetCommand.holdUntil = os.time() + 2
  end
  return published
end

local function publishImpactEvent(weapon, targetName, outcome, sourceName, count)
  local now = os.time()
  local resolvedTarget = targetName or Scraper.combat.targetName
  Scraper.combat.lastImpactWeapon = weapon
  Scraper.combat.lastImpactTarget = resolvedTarget
  Scraper.combat.lastImpactSource = sourceName
  Scraper.combat.lastImpactAt = now
  local published = publishCombatEvent({type = "impact", weapon = weapon,
    targetName = resolvedTarget, sourceName = sourceName,
    count = math.max(1, tonumber(count) or 1), outcome = outcome})
  if weapon == "missile" or weapon == "torpedo" or weapon == "rocket"
      or weapon == "burst" then
    Scraper.combat.lastRadarAt = 0
    Scraper.combat.projectileRadarRequestedAt = 0
    safeKill("killTimer", Scraper.combat.projectileReconcileTimerId)
    Scraper.combat.projectileReconcileTimerId = tempTimer(0.05, function()
      Scraper.combat.projectileReconcileTimerId = nil
      if requestProjectileRadarReconciliation then
        requestProjectileRadarReconciliation(true)
      end
    end)
  end
  return published
end

function Scraper.handleCombatLine(text)
  local raw = trim(text)
  local repeated = tonumber(raw:match("%[x(%d+)%]%s*$")) or 1
  local value = raw:gsub("%s+%[x%d+%]%s*$", "")
  local displayedTarget = value:match("^Target:%s+.-'([^']+)'")
  if displayedTarget then
    if Scraper.combat.targetName ~= displayedTarget then
      Scraper.combat.targetName = displayedTarget
      Scraper.state.observer.target = displayedTarget
      Scraper.state.metadata.combatTarget = displayedTarget
      Scraper.publish()
    end
    return true
  end
  if value == "You fail to lock on to your target!" then
    local fleetOrder = Scraper.state.metadata.fleetOrder
    local requested = type(fleetOrder) == "table" and fleetOrder.order == "fire"
      and trim(fleetOrder.weapon):lower() or ""
    local failedWeapon = normalizeWeapon(requested)
      or Scraper.combat.lastFireWeapon or "best"
    local sourceName = Scraper.fleetCommand.currentMemberName
      or trim(Scraper.state.observer and Scraper.state.observer.name)
    publishCombatEvent({type = "failure", weapon = failedWeapon,
      sourceName = sourceName, reason = "Failed to lock on to target"})
    if Scraper.fleetCommand.currentMemberName and type(fleetOrder) == "table"
        and type(fleetOrder.results) == "table" then
      local result = fleetOrder.results[Scraper.fleetCommand.currentMemberName]
      if type(result) == "table" then
        result.status = "rejected"
        result.reason = "Failed to lock on to target."
        result.observedAt = os.time()
        if recountFleetOrder then recountFleetOrder(fleetOrder) end
        Scraper.publish()
      end
    end
    Scraper.fleetCommand.currentMemberName = nil
    Scraper.fleetCommand.holdUntil = os.time() + 2
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
      publishImpactEvent(weapon, directHitTarget, "hit",
        trim(Scraper.state.observer and Scraper.state.observer.name), repeated)
      return true
    end
  end

  local remoteHitWeapon, remoteHitSource, remoteHitTarget = value:match(
    "^An%s+(.+)%s+from%s+.-'([^']+)'%s+hits%s+.-'([^']+)'.*$")
  if not remoteHitWeapon then
    remoteHitWeapon, remoteHitSource, remoteHitTarget = value:match(
      "^A%s+(.+)%s+from%s+.-'([^']+)'%s+hits%s+.-'([^']+)'.*$")
  end
  if remoteHitWeapon and remoteHitTarget then
    local weapon = normalizeWeapon(remoteHitWeapon)
    if weapon then
      publishImpactEvent(weapon, remoteHitTarget, "hit", remoteHitSource, repeated)
      return true
    end
  end

  local remoteMissWeapon, remoteMissSource, remoteMissTarget = value:match(
    "^An%s+(.+)%s+from%s+.-'([^']+)'%s+barely%s+misses%s+.-'([^']+)'.*$")
  if not remoteMissWeapon then
    remoteMissWeapon, remoteMissSource, remoteMissTarget = value:match(
      "^A%s+(.+)%s+from%s+.-'([^']+)'%s+barely%s+misses%s+.-'([^']+)'.*$")
  end
  if remoteMissWeapon and remoteMissTarget then
    local weapon = normalizeWeapon(remoteMissWeapon)
    if weapon then
      publishImpactEvent(weapon, remoteMissTarget, "miss", remoteMissSource, repeated)
      return true
    end
  end

  local explosionTarget, explosionWeapon = value:match(
    "^You see a large explosion as%s+.-'([^']+)'%s+is%s+hit%s+by%s+an?%s+(.+)%.$")
  if explosionTarget and explosionWeapon then
    local weapon = normalizeWeapon(explosionWeapon)
    if weapon then
      if Scraper.combat.lastImpactWeapon == weapon
          and Scraper.combat.lastImpactTarget == explosionTarget
          and os.time() - (Scraper.combat.lastImpactAt or 0) <= 2 then
        return true
      end
      publishImpactEvent(weapon, explosionTarget, "hit", nil, repeated)
      return true
    end
  end

  local hitWeapon, hitTarget = value:match("^Your ship's%s+(.+)%s+hit%s+.-'([^']+)'!$")
  if hitWeapon and hitTarget then
    local weapon = normalizeWeapon(hitWeapon)
    if weapon then
      publishImpactEvent(weapon, hitTarget, "hit",
        trim(Scraper.state.observer and Scraper.state.observer.name), repeated)
      return true
    end
  end

  local missedWeapon, missedTarget = value:match(
    "^Your ship's%s+(.+)%s+fire%s+at%s+.-'([^']+)'%s+but%s+miss%.$")
  if missedWeapon and missedTarget then
    local weapon = normalizeWeapon(missedWeapon)
    if weapon then
      publishImpactEvent(weapon, missedTarget, "miss",
        trim(Scraper.state.observer and Scraper.state.observer.name), repeated)
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
    fleetRadarIntervalSeconds = Scraper.polling.fleetRadarIntervalSeconds,
    combatFleetRadarIntervalSeconds = Scraper.polling.combatFleetRadarIntervalSeconds,
    radarReconcileIntervalSeconds = Scraper.polling.radarReconcileIntervalSeconds,
    combatActivityWindowSeconds = Scraper.polling.combatActivityWindowSeconds,
    hydratingObserver = #(Scraper.polling.hydrationQueue or {}) > 0,
  }
end

local function shipGmcpIsFresh(now)
  local lastAt = tonumber(Scraper.shipGmcp and Scraper.shipGmcp.lastAt) or 0
  return lastAt > 0 and (tonumber(now) or os.time()) - lastAt
    <= Scraper.SHIP_GMCP_STALE_SECONDS
end

function Scraper.isCombatPollingActive(now)
  now = tonumber(now) or os.time()
  local lastActivityAt = tonumber(Scraper.combat.lastActivityAt) or 0
  local activityWindow = tonumber(Scraper.polling.combatActivityWindowSeconds)
    or Scraper.COMBAT_ACTIVITY_WINDOW_SECONDS
  local recentlyActive = lastActivityAt > 0 and now - lastActivityAt <= activityWindow
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local liveProjectiles = (tonumber(metadata.projectileCount) or 0) > 0
    or (tonumber(metadata.incomingProjectileCount) or 0) > 0
  return recentlyActive or liveProjectiles
end

local function fleetStatusCommandDue(now, combatActive)
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local activeKind = metadata.fleet and metadata.fleet.active == true
    and metadata.fleet.kind or nil
  local formations = metadata.formations or {}
  local bothKnownInactive = formations.battlegroup
    and formations.battlegroup.active == false
    and formations.squadron and formations.squadron.active == false
  local activeInterval = combatActive
    and (Scraper.polling.combatFleetStatusIntervalSeconds
      or Scraper.COMBAT_FLEET_STATUS_INTERVAL_SECONDS)
    or (Scraper.polling.fleetStatusIntervalSeconds
      or Scraper.FLEET_STATUS_INTERVAL_SECONDS)
  local inactiveInterval = Scraper.polling.inactiveFormationProbeIntervalSeconds
    or Scraper.INACTIVE_FORMATION_PROBE_INTERVAL_SECONDS
  local allCandidates = {
    {kind = "battlegroup", command = "battlegroup",
      lastAt = Scraper.polling.lastBattlegroupAt or 0},
    {kind = "squadron", command = "squadron status",
      lastAt = Scraper.polling.lastSquadronAt or 0},
  }
  -- A craft cannot simultaneously be a capital-ship battlegroup member and a
  -- fighter squadron member. Once one formation is positively active, poll
  -- only that status command. Its next inactive response will reopen both
  -- probes, without repeatedly leaking LotJ's incompatible-command warning.
  local candidates = {}
  for _, candidate in ipairs(allCandidates) do
    if activeKind == nil or candidate.kind == activeKind then
      table.insert(candidates, candidate)
    end
  end
  for _, candidate in ipairs(candidates) do
    candidate.interval = activeKind == candidate.kind and activeInterval
      or (activeKind ~= nil or bothKnownInactive) and inactiveInterval
      or activeInterval
    candidate.overdue = now - candidate.lastAt - candidate.interval
  end
  table.sort(candidates, function(left, right)
    if left.lastAt == right.lastAt then return left.kind < right.kind end
    return left.lastAt < right.lastAt
  end)
  for _, candidate in ipairs(candidates) do
    if candidate.lastAt == 0 or candidate.overdue >= 0 then return candidate end
  end
  return nil
end

local function pollOnce()
  Scraper.polling.timerId = nil
  if not Scraper.polling.enabled then return end
  if Scraper.pendingCommandKind then return end
  if os.time() < tonumber(Scraper.fleetCommand.holdUntil or 0) then
    scheduleNextPoll(1)
    return
  end
  -- Never issue hidden commands while Mudlet is connecting or showing the
  -- login screen. A launch event or a successful manual space command must
  -- positively establish the in-space state before automatic polling begins.
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then return end
  if Scraper.active then
    scheduleNextPoll(0.5)
    return
  end

  local now = os.time()
  local combatActive = Scraper.isCombatPollingActive(now)
  local combatRadarDue = combatActive
    and now - (Scraper.combat.lastRadarAt or 0)
      >= (Scraper.polling.combatRadarIntervalSeconds or Scraper.COMBAT_RADAR_INTERVAL_SECONDS)
  local radarReconcileDue = not combatActive
    and now - (Scraper.combat.lastRadarAt or 0)
      >= (Scraper.polling.radarReconcileIntervalSeconds or Scraper.RADAR_RECONCILE_INTERVAL_SECONDS)
  local fleetRadarInterval = combatActive
    and (Scraper.polling.combatFleetRadarIntervalSeconds
      or Scraper.COMBAT_FLEETRADAR_INTERVAL_SECONDS)
    or (Scraper.polling.fleetRadarIntervalSeconds or Scraper.FLEETRADAR_INTERVAL_SECONDS)
  local fleetRadarDue = now - (Scraper.polling.lastFleetRadarAt or 0) >= fleetRadarInterval
  local fleetStatusDue = fleetStatusCommandDue(now, combatActive)
  local hydrationCommand = (Scraper.polling.hydrationQueue or {})[1]
  local scanCandidate = not hydrationCommand and not combatRadarDue
    and not radarReconcileDue and not fleetRadarDue and scanCommandDue() or nil
  local dueScan = scanCandidate and (scanCandidate.discovery
    or Scraper.polling.scansSinceCore < 2) and scanCandidate or nil
  local command
  if hydrationCommand then
    command = hydrationCommand
    Scraper.polling.scansSinceCore = 0
  elseif combatRadarDue then
    command = "radar projectiles"
    Scraper.polling.scansSinceCore = 0
  elseif radarReconcileDue then
    command = "radar"
    Scraper.polling.scansSinceCore = 0
  elseif dueScan and dueScan.discovery then
    command = dueScan.command
    Scraper.polling.scansSinceCore = Scraper.polling.scansSinceCore + 1
    Scraper.scanState[dueScan.key][dueScan.source .. "At"] = os.time()
  elseif fleetStatusDue then
    command = fleetStatusDue.command
    if fleetStatusDue.kind == "battlegroup" then
      Scraper.polling.lastBattlegroupAt = now
    else
      Scraper.polling.lastSquadronAt = now
    end
    Scraper.polling.scansSinceCore = 0
  elseif fleetRadarDue then
    command = "fleetradar"
    Scraper.polling.scansSinceCore = 0
  elseif dueScan then
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
  local completedCycle = false
  if not hydrationCommand and not combatRadarDue and not radarReconcileDue
      and not fleetStatusDue and not fleetRadarDue then
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

requestProjectileRadarReconciliation = function(force)
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then return false end
  if not force and os.time() - (Scraper.combat.projectileRadarRequestedAt or 0) <= 2 then
    return true
  end
  if Scraper.pendingCommandKind or Scraper.active then
    Scraper.combat.lastRadarAt = 0
    scheduleNextPoll(0.1)
    return false
  end
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

function Scraper.handleProjectileSummary(text)
  local total, incoming = trim(text):match("^(%d+)%s+projectiles?,%s+(%d+)%s+incoming")
  if not total then return false end
  total, incoming = tonumber(total) or 0, tonumber(incoming) or 0
  if total > 0 or incoming > 0 then Scraper.combat.lastActivityAt = os.time() end
  Scraper.state.metadata.projectileCount = total
  Scraper.state.metadata.incomingProjectileCount = incoming
  Scraper.publish()
  if total <= 0 then return true end
  return requestProjectileRadarReconciliation(false)
end

function Scraper.startPolling(options)
  if type(send) ~= "function" then
    return nil, "Mudlet send() is unavailable"
  end
  options = type(options) == "table" and options or {}
  Scraper.polling.enabled = true
  Scraper.polling.index = 1
  Scraper.polling.lastFleetRadarAt = 0
  Scraper.polling.lastBattlegroupAt = 0
  Scraper.polling.lastSquadronAt = 0
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
  Scraper.polling.fleetRadarIntervalSeconds = math.max(3,
    tonumber(options.fleetRadarIntervalSeconds) or Scraper.FLEETRADAR_INTERVAL_SECONDS)
  Scraper.polling.combatFleetRadarIntervalSeconds = math.max(5,
    tonumber(options.combatFleetRadarIntervalSeconds)
      or Scraper.COMBAT_FLEETRADAR_INTERVAL_SECONDS)
  Scraper.polling.fleetStatusIntervalSeconds = math.max(5,
    tonumber(options.fleetStatusIntervalSeconds) or Scraper.FLEET_STATUS_INTERVAL_SECONDS)
  Scraper.polling.combatFleetStatusIntervalSeconds = math.max(3,
    tonumber(options.combatFleetStatusIntervalSeconds)
      or Scraper.COMBAT_FLEET_STATUS_INTERVAL_SECONDS)
  Scraper.polling.inactiveFormationProbeIntervalSeconds = math.max(30,
    tonumber(options.inactiveFormationProbeIntervalSeconds)
      or Scraper.INACTIVE_FORMATION_PROBE_INTERVAL_SECONDS)
  Scraper.polling.radarReconcileIntervalSeconds = math.max(30,
    tonumber(options.radarReconcileIntervalSeconds) or Scraper.RADAR_RECONCILE_INTERVAL_SECONDS)
  Scraper.polling.combatActivityWindowSeconds = math.max(5,
    tonumber(options.combatActivityWindowSeconds) or Scraper.COMBAT_ACTIVITY_WINDOW_SECONDS)
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
  local profiling = Scraper.profiler.enabled == true
  local profileStarted = profiling and os.clock() or nil
  if profiling then profileCount("shipGmcpEvents") end
  local info = _G.gmcp and _G.gmcp.Ship and _G.gmcp.Ship.Info or nil
  if type(info) ~= "table" or next(info) == nil then
    if profiling then
      profileCount("emptyShipGmcpEvents")
      profileTiming("ship_gmcp", profileStarted)
    end
    return false
  end

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
  refreshDerivedDistances()

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
  if profiling then profileTiming("ship_gmcp", profileStarted) end
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

local FLEET_WEAPONS = {
  best = "fire", all = "fire", autoblaster = "fire autoblaster",
  laser = "fire laser", turbolaser = "fire turbolaser", ion = "fire ion",
  missile = "fire missile", torpedo = "fire torpedo", rocket = "fire rocket",
  burst = "fire burst",
}
local FLEET_WEAPON_FIELDS = {
  {weapon = "autoblaster", field = "autoblasters"},
  {weapon = "laser", field = "laserCannons"},
  {weapon = "turbolaser", field = "turbolasers"},
  {weapon = "ion", field = "ionCannons"},
  {weapon = "missile", field = "maximumMissiles", launcher = true},
  {weapon = "torpedo", field = "maximumTorpedoes", launcher = true},
  {weapon = "rocket", field = "maximumRockets", launcher = true},
  {weapon = "burst", field = "maximumPulses", launcher = true},
}

local function knownFleetMemberFireCommands(member)
  local entity = findEntity({name = member.name})
  local weapons = entity and entity.weapons or nil
  if type(weapons) ~= "table" then return {"fire"} end
  local commands = {}
  for _, definition in ipairs(FLEET_WEAPON_FIELDS) do
    local installed = tonumber(weapons[definition.field] or 0) > 0
      and (not definition.launcher or tonumber(weapons.missileTubes or 0) > 0)
    if installed then table.insert(commands, FLEET_WEAPONS[definition.weapon]) end
  end
  if #commands == 0 then table.insert(commands, "fire") end
  return commands
end

local function knownWholeFleetFireCommands(fleet)
  local commands, seen = {}, {}
  local function add(command)
    if command ~= "fire" and not seen[command] then
      seen[command] = true
      table.insert(commands, command)
    end
  end
  for _, fire in ipairs(installedFireCommands("all")) do add(fire.command) end
  for _, member in ipairs(fleet.members or {}) do
    if not member.leader then
      for _, command in ipairs(knownFleetMemberFireCommands(member)) do add(command) end
    end
  end
  if #commands == 0 then table.insert(commands, "fire") end
  return commands
end

local function currentFleet()
  local fleet = Scraper.state and Scraper.state.metadata
    and Scraper.state.metadata.fleet or nil
  if type(fleet) ~= "table" or fleet.active ~= true then return nil end
  return fleet
end

local function fleetRole(fleet)
  local observerName = trim(Scraper.state and Scraper.state.observer
    and Scraper.state.observer.name):lower()
  for _, member in ipairs(fleet.members or {}) do
    if trim(member.name):lower() == observerName then
      if member.leader == true or member.role == "leader" then return "commander" end
      return member.role or "member"
    end
  end
  return fleet.role
end

local function roundedVector(payload)
  local vectorValue = type(payload.vector) == "table" and payload.vector or {}
  local values = {tonumber(vectorValue.x), tonumber(vectorValue.y), tonumber(vectorValue.z)}
  for _, value in ipairs(values) do
    if not value or value ~= value or math.abs(value) > 10000000 then
      return nil, "course vector must contain finite coordinates within 10,000,000 units"
    end
  end
  if values[1] == 0 and values[2] == 0 and values[3] == 0 then
    return nil, "course vector cannot be zero"
  end
  local function round(value)
    return value >= 0 and math.floor(value + 0.5) or math.ceil(value - 0.5)
  end
  return string.format("course relative %d %d %d",
    round(values[1]), round(values[2]), round(values[3]))
end

local function fleetNavigationCommand(payload)
  local mode = trim(payload.mode):lower()
  if mode == "relative" then return roundedVector(payload) end
  if mode ~= "target" and mode ~= "away" then return nil, "unsupported fleet navigation mode" end
  local target = findEntity({id = trim(payload.targetId)})
  local name = target and trim(target.name) or ""
  if name == "" or name:find("[%c\r\n]") then
    return nil, "navigation target is not present in the current snapshot"
  end
  return mode == "away" and ("course away " .. name) or ("course " .. name)
end

recountFleetOrder = function(order)
  local accepted, rejected, awaiting = 0, 0, 0
  for _, result in pairs(order.results or {}) do
    if result.status == "accepted" then accepted = accepted + 1
    elseif result.status == "rejected" then rejected = rejected + 1
    else awaiting = awaiting + 1 end
  end
  order.acceptedCount = accepted
  order.rejectedCount = rejected
  order.pendingCount = awaiting
  if rejected > 0 then order.status = "partial"
  elseif awaiting > 0 then order.status = "awaiting"
  elseif accepted > 0 then order.status = "accepted"
  else order.status = "transmitted" end
end

local function setFleetAutopilotState(name, enabled, statusText)
  local wanted = trim(name):lower()
  if wanted == "" then return end
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local observer = Scraper.state and Scraper.state.observer or {}
  if trim(observer.name):lower() == wanted then
    observer.autopilot = enabled
    observer.autopilotStatus = statusText
  end
  local entity = findEntity({name = name})
  if entity then
    entity.autopilot = enabled
    entity.autopilotStatus = statusText
  end
  local function updateFleet(fleet)
    for _, member in ipairs(type(fleet) == "table" and fleet.members or {}) do
      if trim(member.name):lower() == wanted then
        member.autopilot = enabled
        member.autopilotStatus = statusText
      end
    end
  end
  updateFleet(metadata.fleet)
  for _, fleet in pairs(metadata.formations or {}) do updateFleet(fleet) end
end

local function queueAutopilotVerification(orderId)
  safeKill("killTimer", Scraper.fleetCommand.verificationTimerId)
  Scraper.fleetCommand.verificationTimerId = tempTimer(3, function()
    Scraper.fleetCommand.verificationTimerId = nil
    local order = Scraper.state and Scraper.state.metadata
      and Scraper.state.metadata.fleetOrder or nil
    if type(order) ~= "table" or order.id ~= orderId or order.order ~= "autopilot" then return end
    local queue = Scraper.polling.hydrationQueue or {}
    local queued = {}
    for _, command in ipairs(queue) do queued[command:lower()] = true end
    local observerName = trim(Scraper.state.observer and Scraper.state.observer.name):lower()
    for name, result in pairs(order.results or {}) do
      if result.status == "awaiting" then
        local command = trim(name):lower() == observerName and "status" or ("status " .. name)
        if not queued[command:lower()] then
          table.insert(queue, command)
          queued[command:lower()] = true
        end
      end
    end
    Scraper.polling.hydrationQueue = queue
    if #queue > 0 then scheduleNextPoll(0.1) end
  end)
end

function Scraper.handleFleetCommandLine(text)
  local message = trim(text)
  local order = Scraper.state and Scraper.state.metadata
    and Scraper.state.metadata.fleetOrder or nil
  if type(order) ~= "table" or os.time() - tonumber(order.observedAt or 0) > 30 then
    Scraper.fleetCommand.currentMemberName = nil
    return false
  end

  local memberName = message:match("^Sending command to .-'([^']+)'%.%.%.$")
  if memberName then
    Scraper.fleetCommand.currentMemberName = memberName
    order.results = order.results or {}
    order.results[memberName] = {
      name = memberName, status = "awaiting", observedAt = os.time(),
    }
    recountFleetOrder(order)
    Scraper.publish()
    return true
  end

  memberName = Scraper.fleetCommand.currentMemberName
  local autopilotState = message:match("^Autopilot%s+(ON)%.$")
    or message:match("^Autopilot%s+(OFF)%.$")
  if autopilotState and not memberName and order.order == "autopilot" then
    memberName = trim(Scraper.state.observer and Scraper.state.observer.name)
  end
  if not memberName or type(order.results) ~= "table" then return false end
  local result = order.results[memberName]
  if type(result) ~= "table" then
    result = {name = memberName, status = "awaiting", observedAt = os.time()}
    order.results[memberName] = result
  end

  if autopilotState then
    local enabled = autopilotState == "ON"
    result.status = "accepted"
    result.autopilot = enabled
    result.reason = nil
    result.observedAt = os.time()
    setFleetAutopilotState(memberName, enabled, "Autopilot " .. autopilotState)
    Scraper.fleetCommand.currentMemberName = nil
    recountFleetOrder(order)
    Scraper.publish()
    return true
  end

  local rejected = message == "You'll have to disengage the ship's autopilot first."
    or message == "Please wait until the ship has finished its current maneuver."
  local accepted = message:match("^New course set, approaching .+%.$") ~= nil
    or message == "The ship begins to turn."
  if not rejected and not accepted then return false end

  result.status = rejected and "rejected" or "accepted"
  result.reason = rejected and message or nil
  result.observedAt = os.time()
  Scraper.fleetCommand.currentMemberName = nil
  recountFleetOrder(order)
  Scraper.publish()
  return true
end

local function sendFleetCommands(commands, order, scope, context)
  cancelPollTimer()
  if Scraper.active then abandonCapture("superseded by fleet " .. order .. " order") end
  Scraper.fleetCommand.nextOrderId = (Scraper.fleetCommand.nextOrderId or 0) + 1
  Scraper.fleetCommand.currentMemberName = nil
  Scraper.fleetCommand.holdUntil = os.time() + 4
  local fleetOrder = {
    id = Scraper.fleetCommand.nextOrderId,
    order = order, scope = scope, status = "transmitted", observedAt = os.time(),
    commandCount = #commands, acceptedCount = 0, rejectedCount = 0, pendingCount = 0,
    results = {},
  }
  if type(context) == "table" then
    for key, value in pairs(context) do
      fleetOrder[key] = type(value) == "table" and copyTable(value) or value
    end
  end
  if order == "autopilot" then
    local fleet = currentFleet()
    local observerName = trim(Scraper.state.observer and Scraper.state.observer.name)
    for _, member in ipairs(fleet and fleet.members or {}) do
      local included = scope == "all" or scope == "wings" and not member.leader
        or scope == "local" and trim(member.name):lower() == observerName:lower()
      if included then
        fleetOrder.results[member.name] = {
          name = member.name, status = "awaiting", observedAt = os.time(),
        }
      end
    end
    if scope == "local" and next(fleetOrder.results) == nil and observerName ~= "" then
      fleetOrder.results[observerName] = {
        name = observerName, status = "awaiting", observedAt = os.time(),
      }
    end
    recountFleetOrder(fleetOrder)
  end
  Scraper.state.metadata.fleetOrder = fleetOrder
  Scraper.publish()
  Scraper.polling.dispatching = true
  for _, command in ipairs(commands) do
    local sent, sendResult, sendError = pcall(send, command, false)
    if not sent or sendResult == false then
      Scraper.polling.dispatching = false
      Scraper.state.metadata.fleetOrder.status = "rejected"
      Scraper.state.metadata.fleetOrder.reason = tostring(sent and sendError or sendResult)
      Scraper.publish()
      scheduleNextPoll(1)
      return false, tostring(sent and sendError or sendResult)
    end
  end
  Scraper.polling.dispatching = false
  if order == "autopilot" then queueAutopilotVerification(fleetOrder.id) end
  scheduleNextPoll(2)
  return true
end

local function dispatchFleetOrder(payload, message)
  local gateError = commandGateError()
  if gateError then return false, gateError end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "fleet commands are unavailable while landed"
  end
  local fleet = currentFleet()
  if not fleet then return false, "no active battlegroup or squadron was detected" end
  local scope = trim(payload.scope):lower()
  if scope ~= "local" and scope ~= "all" and scope ~= "wings"
      and scope ~= "selected" then
    return false, "fleet scope must be local, all, wings, or selected"
  end
  local selectedMember
  if scope == "selected" then
    local wantedId = trim(payload.memberId):lower()
    local wantedName = trim(payload.memberName):lower()
    for _, member in ipairs(fleet.members or {}) do
      if (wantedId ~= "" and trim(member.id):lower() == wantedId)
          or (wantedName ~= "" and trim(member.name):lower() == wantedName) then
        selectedMember = member
        break
      end
    end
    if not selectedMember then
      return false, "the selected formation member is no longer available"
    end
  end
  local order = trim(payload.order):lower()
  local target
  if order == "target" then
    target = findEntity({id = trim(payload.targetId)})
    if not target or target.kind ~= "ship" or trim(target.name) == ""
        or trim(target.name):find("[%c\r\n]") then
      return false, "target ship is not present in the current snapshot"
    end
    target.disposition = "enemy"
  end

  if fleet.kind == "battlegroup" then
    if scope ~= "local" and fleetRole(fleet) ~= "commander" then
      return false, "only the battlegroup flagship can command wing ships"
    end
    local localCommand
    if order == "navigate" then
      localCommand, gateError = fleetNavigationCommand(payload)
      if not localCommand then return false, gateError end
    elseif order == "speed" then
      local speed = tonumber(payload.speed)
      if not speed or speed ~= speed or speed < 0 or speed > 10000000 then
        return false, "fleet speed is outside supported limits"
      end
      localCommand = "speed " .. tostring(math.floor(speed + 0.5))
    elseif order == "fire" then
      local weapon = trim(payload.weapon):lower()
      localCommand = FLEET_WEAPONS[weapon]
      if not localCommand then return false, "unsupported fleet weapon" end
    elseif order == "recharge" then localCommand = "recharge"
    elseif order == "shields_on" then localCommand = "shields on"
    elseif order == "chaff" then localCommand = "chaff"
    elseif order == "autopilot" then localCommand = "autopilot"
    elseif order ~= "target" then return false, "unsupported battlegroup order" end

    local commands = {}
    local fireAll = order == "fire" and trim(payload.weapon):lower() == "all"
    local observerName = trim(Scraper.state.observer and Scraper.state.observer.name)
    if observerName == "" then return false, "the battlegroup flagship name is unavailable" end
    local departureSpeed
    if order == "navigate" and payload.departureSpeed ~= nil then
      departureSpeed = tonumber(payload.departureSpeed)
      if not departureSpeed or departureSpeed ~= departureSpeed or departureSpeed <= 0
          or departureSpeed > 10000000 then
        return false, "fleet departure speed is outside supported limits"
      end
      departureSpeed = math.floor(departureSpeed + 0.5)
    end
    local recipients = {}
    if scope == "all" then
      table.insert(recipients, {selector = "all"})
    elseif scope == "local" then
      table.insert(recipients, {selector = observerName, localShip = true})
    elseif scope == "selected" then
      table.insert(recipients, {
        selector = trim(selectedMember.name), member = selectedMember,
        localShip = trim(selectedMember.name):lower() == observerName:lower(),
      })
    else
      for _, member in ipairs(fleet.members or {}) do
        if not member.leader and tonumber(member.slot) then
          table.insert(recipients, {selector = tostring(member.slot), member = member})
        end
      end
    end
    if #recipients == 0 then return false, "no ships are available in the selected fleet scope" end

    if order == "target" then
      if scope == "local" and Scraper.state.observer.hasWeapons == false then
        return false, "this ship has no weapons"
      end
      for _, recipient in ipairs(recipients) do
        table.insert(commands, "battlegroup target " .. recipient.selector
          .. " " .. trim(target.name))
      end
      Scraper.combat.targetName = trim(target.name)
      Scraper.state.metadata.combatTarget = Scraper.combat.targetName
    else
      if order == "fire" and scope == "local"
          and Scraper.state.observer.hasWeapons == false then
        return false, "this ship has no weapons"
      end
      for _, recipient in ipairs(recipients) do
        if departureSpeed then
          table.insert(commands, "battlegroup nav " .. recipient.selector
            .. " speed " .. tostring(departureSpeed))
        end
        if fireAll then
          local fireCommands
          if scope == "all" then
            fireCommands = knownWholeFleetFireCommands(fleet)
          elseif recipient.localShip then
            fireCommands = {}
            for _, fire in ipairs(installedFireCommands("all")) do
              table.insert(fireCommands, fire.command)
            end
            if #fireCommands == 0 then table.insert(fireCommands, "fire") end
          else
            fireCommands = knownFleetMemberFireCommands(recipient.member)
          end
          for _, fireCommand in ipairs(fireCommands) do
            table.insert(commands, "battlegroup nav " .. recipient.selector
              .. " " .. fireCommand)
          end
        else
          table.insert(commands, "battlegroup nav " .. recipient.selector
            .. " " .. localCommand)
        end
      end
    end
    return sendFleetCommands(commands, order, scope, order == "fire"
      and {weapon = trim(payload.weapon):lower()} or nil)
  end

  if fleet.kind ~= "squadron" then return false, "unsupported formation type" end
  -- Squadron wings cannot receive individual nav/fire commands. Selecting a
  -- wing intentionally operates the lead; Fire Assist mirrors that order to
  -- the squadron according to LotJ's native formation behavior.
  local squadronScope = scope == "selected" and "local" or scope
  local commands = {}
  if order == "roll" or order == "chaff" then
    if squadronScope == "all" or squadronScope == "local" then table.insert(commands, order) end
    if squadronScope == "all" or squadronScope == "wings" then table.insert(commands, "squadron " .. order) end
  elseif order == "assist" then
    table.insert(commands, "squadron assist")
  elseif order == "aim" then
    local system = trim(payload.system):lower()
    local allowed = {none = true, launcher = true, laser = true, ion = true,
      turret = true, tractor = true}
    if not allowed[system] then return false, "unsupported squadron aim system" end
    table.insert(commands, "squadron aim " .. system)
  elseif order == "target" then
    if squadronScope == "wings" then return false, "squadron wings inherit the lead ship's target" end
    return dispatchTargetShip({targetId = target.id}, message)
  elseif order == "fire" then
    if squadronScope == "wings" then return false, "squadron wings fire through Fire Assist" end
    return dispatchFireWeapon({weapon = trim(payload.weapon):lower()})
  elseif order == "navigate" then
    if squadronScope == "wings" then return false, "squadron wings follow the lead ship automatically" end
    local command, commandError = fleetNavigationCommand(payload)
    if not command then return false, commandError end
    if payload.departureSpeed ~= nil then
      local departureSpeed = tonumber(payload.departureSpeed)
      if not departureSpeed or departureSpeed ~= departureSpeed or departureSpeed <= 0
          or departureSpeed > 10000000 then
        return false, "squadron departure speed is outside supported limits"
      end
      table.insert(commands, "speed " .. tostring(math.floor(departureSpeed + 0.5)))
    end
    table.insert(commands, command)
  elseif order == "speed" then
    if squadronScope == "wings" then return false, "squadron wings follow the lead ship automatically" end
    local speed = tonumber(payload.speed)
    if not speed or speed ~= speed or speed < 0 or speed > 10000000 then
      return false, "squadron speed is outside supported limits"
    end
    table.insert(commands, "speed " .. tostring(math.floor(speed + 0.5)))
  else
    return false, "unsupported squadron order"
  end
  return sendFleetCommands(commands, order, scope)
end

dispatchSpaceProbe = function(_, message)
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
  local normalizedOutgoing = trim(command):lower():gsub("%s+", " ")
  if normalizedOutgoing == "calc" or normalizedOutgoing == "calculate"
      or normalizedOutgoing:match("^calc .+") or normalizedOutgoing:match("^calculate .+") then
    Scraper.hyperspace.initiatedByHolocron = false
    Scraper.hyperspace.acknowledgedFuelRisk = false
  end
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
  local shipOk = pcall(sendGMCP, "Core.Supports.Add", '["Ship 1"]')
  local galaxyOk = pcall(sendGMCP, "Core.Supports.Add", '["Galaxy 1"]')
  return shipOk and galaxyOk
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
  Scraper.fleetCommand = {nextOrderId = 0, currentMemberName = nil,
    verificationTimerId = nil, holdUntil = 0}
  Scraper.projectileTracking = {nextId = 0, tracks = {}}
  Scraper.combat = {targetName = nil, pendingTargetName = nil, nextEventId = 0,
    lastFireWeapon = nil, projectileRadarRequestedAt = 0, lastRadarAt = 0,
    lastActivityAt = 0, lastLaunchWeapon = nil, lastLaunchTarget = nil,
    lastLaunchSource = nil, lastLaunchAt = 0, lastImpactWeapon = nil, lastImpactTarget = nil,
    lastImpactSource = nil, lastImpactAt = 0, projectileReconcileTimerId = nil}
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
    registerAnonymousEventHandler("gmcp.Galaxy.Systems", Scraper.publishGalaxyCatalog),
    registerAnonymousEventHandler("gmcp.Ship.System", Scraper.publishGalaxyCatalog),
    registerAnonymousEventHandler("sysProtocolEnabled", Scraper.requestShipGmcpSupport),
  }
  Scraper.requestShipGmcpSupport()
  Scraper.publishGalaxyCatalog()
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
    tempRegexTrigger("^\\s*(?:Target:\\s+.+|You fail to lock on to your target!|(?:The\\s+)?.+\\s+can\\s+only\\s+fire\\s+forwards\\.\\s+You'll\\s+need\\s+to\\s+turn\\s+your\\s+ship!|(?:Missile|Torpedo|Rocket)\\s+launched\\.|A\\s+.+\\s+is\\s+launched\\s+toward\\s+.+\\s+by\\s+your\\s+ship\\.|\\d+\\s+.+\\s+fired\\.\\.\\.|An?\\s+.+\\s+from\\s+.+'.+'\\s+(?:hits|barely\\s+misses)\\s+.+'.+'.*|Your ship's\\s+.+|You see a large explosion as\\s+.+|.+\\s+fully charged\\.|.+\\s+launcher(?:\\(s\\)|s)?\\s+reloaded\\.)\\s*$", function()
      Scraper.handleCombatLine(line or "")
    end),
    tempRegexTrigger("^\\s*\\d+\\s+projectiles?,\\s+\\d+\\s+incoming.*$", function()
      Scraper.handleProjectileSummary(line or "")
    end),
    tempRegexTrigger("(?i)^.*auto.*track.*$", function()
      Scraper.handleAutotrackResponse(line or "")
    end),
    tempRegexTrigger("^\\s*(?:Hyperspace course locked\\. Running final jump checks\\.\\.\\.|Warning - Not enough fuel to complete the jump!|Jump requires .+|\\[Status\\]: Hyperspace calculations have been completed\\.|\\[ALERT\\]: Aborting Hyperspace calculation\\. Terminal reset\\.|\\[Alert\\]: Jump coordinates too close to stellar object\\. Jump not set\\.|Calculating Hyperspace Trajectory: \\d+ seconds remaining\\.|You are too close to .+ to make the jump to lightspeed!|You push forward the hyperspeed lever\\.|The stars become streaks of light as you enter hyperspace\\.|Destination reached\\. Initiating realspace reentry\\.\\.\\.|Hyperjump complete\\.)\\s*$", function()
      Scraper.handleHyperspaceLine(line or "")
    end),
    tempRegexTrigger("^\\s*(?:Sending command to .+|New course set, approaching .+\\.|The ship begins to turn\\.|Autopilot (?:ON|OFF)\\.|You'll have to disengage the ship's autopilot first\\.|Please wait until the ship has finished its current maneuver\\.)\\s*$", function()
      Scraper.handleFleetCommandLine(line or "")
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
    proxy.registerIntentHandler("fleet_order", dispatchFleetOrder)
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
    proxy.registerIntentHandler("plot_hyperspace", dispatchHyperspacePlot)
    proxy.registerIntentHandler("refresh_navigation", dispatchNavigationRefresh)
    proxy.registerIntentHandler("refresh_galaxy_catalog", function()
      Scraper.requestShipGmcpSupport()
      Scraper.publishGalaxyCatalog()
      local systems = _G.gmcp and _G.gmcp.Galaxy and _G.gmcp.Galaxy.Systems
      if type(systems) ~= "table" or next(systems) == nil then
        local now = os.time()
        if not Scraper.galaxyCatalogRequestAt or now - Scraper.galaxyCatalogRequestAt >= 5 then
          Scraper.galaxyCatalogRequestAt = now
          pcall(send, "planets", false)
        end
      end
      return true
    end)
    proxy.registerIntentHandler("stop_hyperspace", function(_, message)
      if Scraper.hyperspace.phase ~= "calculating" then
        return false, "no hyperspace calculation is running"
      end
      Scraper.hyperspace.activeIntentId = message and message.id or nil
      Scraper.polling.dispatching = true
      local ok, err = pcall(send, "calc stop", false)
      Scraper.polling.dispatching = false
      return ok or false, ok and nil or tostring(err)
    end)
    proxy.registerIntentHandler("engage_hyperdrive", function(_, message)
      if Scraper.hyperspace.phase ~= "ready" then
        return false, "hyperspace calculations are not ready"
      end
      local clear, clearanceError = checkHyperspaceClearance()
      if not clear then return false, clearanceError end
      Scraper.hyperspace.activeIntentId = message and message.id or nil
      Scraper.polling.dispatching = true
      local ok, err = pcall(send, "hyper", false)
      Scraper.polling.dispatching = false
      return ok or false, ok and nil or tostring(err)
    end)
    proxy.registerIntentHandler("escape_hyperspace", function()
      if Scraper.hyperspace.phase ~= "hyperspace" then
        return false, "the ship is not currently traveling through hyperspace"
      end
      Scraper.polling.dispatching = true
      local sent, sendResult, sendError = pcall(send, "hyper off", false)
      Scraper.polling.dispatching = false
      if not sent or sendResult == false then
        return false, tostring(sent and sendError or sendResult)
      end
      local metadata = hyperspaceMetadata()
      metadata.escapeRequestedAt = os.time()
      Scraper.publish()
      return true
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
  diagnostic("info", "live scraping enabled for info, radar, status, and fleetradar; proximity is derived from coordinates")
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
  safeKill("killTimer", Scraper.combat and Scraper.combat.projectileReconcileTimerId)
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
    lastActivityAt = 0, lastLaunchWeapon = nil, lastLaunchTarget = nil,
    lastLaunchSource = nil, lastLaunchAt = 0, lastImpactWeapon = nil, lastImpactTarget = nil,
    lastImpactSource = nil, lastImpactAt = 0, projectileReconcileTimerId = nil}
  Scraper.shipGmcp = {lastAt = 0, sequence = 0, damageSequence = nil}
  safeKill("killTimer", Scraper.pendingCommandTimerId)
  Scraper.pendingCommandTimerId = nil
  safeKill("killTimer", Scraper.automationLeaseTimerId)
  Scraper.automationLeaseTimerId = nil
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  Scraper.autotrack.timeoutTimerId = nil
  Scraper.autotrack.pending = false
  Scraper.autotrack.intentId = nil
  Scraper.autotrack.retryCount = 0
  safeKill("killTimer", Scraper.fleetCommand and Scraper.fleetCommand.verificationTimerId)
  Scraper.fleetCommand = {nextOrderId = 0, currentMemberName = nil,
    verificationTimerId = nil, holdUntil = 0}
  return true
end

return Scraper
