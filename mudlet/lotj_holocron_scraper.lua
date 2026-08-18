-- LotJ Holocron 3D - live Mudlet command/output collector
-- Installs temporary aliases and triggers; nothing persists in the profile.

local Scraper = {
  CAPTURE_TIMEOUT_SECONDS = 8,
  MAX_CAPTURE_LINES = 300,
  MAX_CAPTURE_BYTES = 256 * 1024,
  -- Radar and observer coordinates are sufficient to derive proximity. Keep
  -- prox parsers for visible/manual commands, but do not spend two captures
  -- per cycle asking LotJ to calculate data we already have.
  POLL_COMMANDS = { "status", "info" },
  POLL_COMMAND_GAP_SECONDS = 1,
  POLL_CYCLE_DELAY_SECONDS = 5,
  HOSTILE_SCAN_INTERVAL_SECONDS = 4,
  STANDARD_SCAN_INTERVAL_SECONDS = 10,
  AUTOMATIC_COMMAND_DEDUP_SECONDS = 3,
  COMBAT_RADAR_INTERVAL_SECONDS = 3,
  FLEETRADAR_INTERVAL_SECONDS = 6,
  COMBAT_FLEETRADAR_INTERVAL_SECONDS = 12,
  FLEET_STATUS_INTERVAL_SECONDS = 10,
  COMBAT_FLEET_STATUS_INTERVAL_SECONDS = 4,
  INACTIVE_FORMATION_PROBE_INTERVAL_SECONDS = 60,
  RADAR_RECONCILE_INTERVAL_SECONDS = 60,
  MIN_HYPERSPACE_CLEARANCE = 500,
  HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS = 15,
  REMOTE_LOCAL_HYPERSPACE_CALC_SECONDS = 2,
  REMOTE_GALACTIC_HYPERSPACE_CALC_SECONDS = 6,
  COMBAT_ACTIVITY_WINDOW_SECONDS = 10,
  COMBAT_FRAGMENT_TIMEOUT_SECONDS = 1.5,
  DESTRUCTION_TOMBSTONE_SECONDS = 10,
  USER_IDLE_POLL_DELAY_SECONDS = 2.5,
  SHIP_GMCP_STALE_SECONDS = 10,
  SENSOR_TICK_FALLBACK_SECONDS = 4,
  TARGET_RECONCILE_SECONDS = 20,
  eventHandlerIds = {},
  stateTriggerIds = {},
  active = nil,
  proxy = nil,
  state = nil,
  lastCapture = nil,
  polling = {
    enabled = false,
    paused = false,
    pausedAt = nil,
    pauseReason = nil,
    resumeWhenInSpace = false,
    index = 1,
    timerId = nil,
    dispatching = false,
    hydrationQueue = {},
    initializationQueue = {},
    initializationReason = nil,
    initializationSpaceProbe = false,
    lastFleetRadarAt = 0,
    lastBattlegroupAt = 0,
    lastSquadronAt = 0,
    lastAutomaticCommandAt = {},
    radarRefreshPending = false,
    radarRefreshReason = nil,
    radarRefreshGeneration = 0,
    radarRefreshIssuedGeneration = 0,
    fleetRadarRefreshPending = false,
    fleetRadarRefreshIssuedGeneration = 0,
    sensorPollPending = false,
    sensorPollPendingCommand = nil,
    sensorPollPendingSince = nil,
    sensorTickTimerId = nil,
    sensorTickGranted = false,
    sensorTickSource = nil,
    sensorTickSequence = nil,
    lastSensorPollAt = 0,
    lastSensorPollCommand = nil,
    lastSensorTickSource = nil,
    lastSensorTickSequence = nil,
    lastSensorSyncWaitSeconds = nil,
    sensorTickFallbackCount = 0,
    sensorTickBypassPending = false,
  },
  scanState = {},
  pendingCommandIntentId = nil,
  pendingCommandTimerId = nil,
  pendingCommandKind = nil,
  combat = {
    targetName = nil,
    pendingTargetName = nil,
    pendingTargetContext = nil,
    pendingTargetPreviousName = nil,
    targetReconcileTimerId = nil,
    nextEventId = 0,
    lastFireWeapon = nil,
    projectileRadarRequestedAt = 0,
    projectileRadarPending = false,
    lastRadarAt = 0,
    lastActivityAt = 0,
    lastLaunchWeapon = nil,
    lastLaunchTarget = nil,
    lastLaunchSource = nil,
    lastLaunchAt = 0,
    lastImpactWeapon = nil,
    lastImpactTarget = nil,
    lastImpactSource = nil,
    lastImpactAt = 0,
    projectileReconcileTimerId = nil,
    pendingLine = nil,
    pendingLineTimerId = nil,
  },
  destruction = { nextEventId = 0, destroyedNames = {} },
  shields = {
    auto = true,
    recharging = false,
    awaiting = false,
    attempts = 0,
    damageTimerId = nil,
    actionTimerId = nil,
    statusPending = false,
    manualIntentId = nil,
    activationPending = false,
  },
  autotrack = {
    desired = true,
    observed = nil,
    pending = false,
    intentId = nil,
    retryCount = 0,
    timeoutTimerId = nil,
  },
  shipGmcp = { lastAt = 0, sequence = 0, damageSequence = nil },
  hyperspace = {
    phase = "idle",
    initiatedByHolocron = false,
    routeUsesLocalCommand = nil,
    acknowledgedFuelRisk = false,
    activeIntentId = nil,
    statusTimerId = nil,
    pendingLocalJumpUntil = 0,
    fleetJumpQueue = {},
    nextJumpEventId = 0,
    awaitingReentrySystem = false,
    reentryRefreshTimerId = nil,
    sampleSequence = 0,
    activeSample = nil,
    pendingArrivalSample = nil,
    hyperjumpCompleteObserved = false,
    realspaceLurchObserved = false,
    awaitingArrivalRadar = false,
    reentrySystemName = nil,
  },
  fleetCommand = {
    nextOrderId = 0,
    currentMemberName = nil,
    verificationTimerId = nil,
    holdUntil = 0,
  },
  projectileTracking = { nextId = 0, tracks = {} },
  profiler = { enabled = false },
}

local scheduleNextPoll
local releasePendingSensorPoll
local completeOwnHyperspaceArrival
local requestAutotrack
local ensureShieldsOn
local handleShieldStatus
local queueObserverHydration
local clearObserverHydration
local queueObserverInfo
local dispatchSpaceProbe
local recountFleetOrder
local requestProjectileRadarReconciliation
local completeTargetLock
local reconcileTargetFromStatus

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function normalizedCommand(command)
  return trim(command):lower():gsub("%s+", " ")
end

local function responseNameMatchesRequest(requestedName, parsedName)
  local requested = trim(requestedName):lower()
  local parsed = trim(parsedName):lower()
  if requested == "" or parsed == "" then
    return false
  end
  return parsed == requested or parsed:sub(1, #requested) == requested
end

local function automaticCommandRepeatDelay(command, now)
  local key = normalizedCommand(command)
  local sentAt = tonumber((Scraper.polling.lastAutomaticCommandAt or {})[key]) or 0
  local minimum = Scraper.AUTOMATIC_COMMAND_DEDUP_SECONDS
  local elapsed = (tonumber(now) or os.time()) - sentAt
  return sentAt > 0 and elapsed < minimum and minimum - elapsed or 0
end

local function markAutomaticCommandSent(command, now)
  now = tonumber(now) or os.time()
  local recent = Scraper.polling.lastAutomaticCommandAt or {}
  for key, sentAt in pairs(recent) do
    if now - (tonumber(sentAt) or 0) >= Scraper.AUTOMATIC_COMMAND_DEDUP_SECONDS then
      recent[key] = nil
    end
  end
  recent[normalizedCommand(command)] = now
  Scraper.polling.lastAutomaticCommandAt = recent
end

local function profileObjectCounts()
  if type(getProfileStats) ~= "function" then
    return nil
  end
  local ok, stats = pcall(getProfileStats)
  if not ok or type(stats) ~= "table" then
    return nil
  end
  local function active(group, child)
    local value = stats[group]
    if type(value) ~= "table" then
      return nil
    end
    if child then
      value = value[child]
    end
    if type(value) == "table" then
      value = value.active
    end
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
  if not profiler.enabled then
    return
  end
  profiler.counts[name] = (profiler.counts[name] or 0) + (amount or 1)
end

local function profileCommand(command)
  local profiler = Scraper.profiler
  if not profiler.enabled then
    return
  end
  local normalized = trim(command):lower():gsub("%s+", " ")
  profiler.commands[normalized] = (profiler.commands[normalized] or 0) + 1
end

local function profileTiming(name, startedAt)
  local profiler = Scraper.profiler
  if not profiler.enabled or not startedAt then
    return
  end
  local elapsed = math.max(0, os.clock() - startedAt)
  local timing = profiler.timings[name] or { count = 0, totalSeconds = 0, maxSeconds = 0 }
  timing.count = timing.count + 1
  timing.totalSeconds = timing.totalSeconds + elapsed
  timing.maxSeconds = math.max(timing.maxSeconds, elapsed)
  profiler.timings[name] = timing
end

local function profileCopy(value)
  if type(value) ~= "table" then
    return value
  end
  local result = {}
  for key, child in pairs(value) do
    result[key] = profileCopy(child)
  end
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
  local profiler = Scraper.profiler or { enabled = false }
  if not profiler.startedAt then
    return nil, "the profiler has not been started"
  end
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
  if not report then
    return nil, reportError
  end
  Scraper.profiler.enabled = false
  report.enabled = false
  return report
end

local function radarSystemName(value)
  value = trim(value)
  local explicit = value:match("^[Ss]tarsystem:%s*(.-)%s*$")
  if explicit and explicit ~= "" then
    return explicit
  end
  if value:find(":", 1, true) or not value:match("^[%w][%w%s'%-]+$") then
    return nil
  end
  local lower = value:lower()
  if lower == "uncharted space" or lower == "unknown space" then
    return value
  end
  if lower:match("%ssector$") or lower:match("%ssystem$") then
    return value
  end
  return nil
end

local function isCommunicationLine(value)
  value = trim(value)
  local parenthesizedChannel = value:match("^%(([%u]+)%)%s")
  local knownParenthesizedChannel = parenthesizedChannel == "OOC"
    or parenthesizedChannel == "IMM"
    or parenthesizedChannel == "RPC"
    or parenthesizedChannel == "NEWBIE"
    or parenthesizedChannel == "OSAY"
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
    or lower:find("must be at a nav computer", 1, true) ~= nil
    or lower:find("finished its current maneuver", 1, true) ~= nil
end

local function isAsynchronousVisibleLine(value)
  value = trim(value)
  if isCommunicationLine(value) then
    return true
  end
  local lower = value:lower()
  return lower:match("^you are hit by ") ~= nil
    or lower:match("^.- fire from .- at you") ~= nil
    or lower:match("^.- fire from .-'[^']+' hits ") ~= nil
    or lower:match("^an? .- from .-'[^']+' hits ") ~= nil
    or lower:match("^.- fire from .-'[^']+' barely misses ") ~= nil
    or lower:match("^an? .- from .-'[^']+' barely misses ") ~= nil
    or lower:match("^.-'[^']+' fires an? .- towards? ") ~= nil
    or lower:find(" explodes in a", 1, true) ~= nil
    or (Scraper.combat and Scraper.combat.pendingLine ~= nil and (lower == "blinding flash of light!" or lower == "flash of light!" or lower == "of light!" or lower == "light!"))
    or (Scraper.combat and Scraper.combat.pendingLine ~= nil and (value:match("'[^']+'%.%s*$") ~= nil or value:match(
      "'[^']+'%.%s*%[x%d+%]%s*$"
    ) ~= nil))
    or lower:match("^you are being targeted by ") ~= nil
    -- Sector-arrival announcements can wrap immediately before a coordinate
    -- token. Never let that prose become a radar row or contact identity.
    or lower:find(" enters the starsystem, coming out of its hyperjump at", 1, true) ~= nil
    or lower:match("^you see a large explosion as ") ~= nil
    or lower:match("^%[warning%]:") ~= nil
    or lower:match("^proximity alert:") ~= nil
    or lower == "target locked."
    or lower == "maneuver complete."
    or lower == "that ship is currently being protected by other ships."
    or lower == "your concentration is broken. you fail to lock on to your target."
end

local function markResponseStarted(capture)
  capture.responseStarted = true
  return true
end

local STATUS_MARKERS = {
  "current coordinates:",
  "current heading:",
  "current speed:",
  "lifeforms detected:",
  "hull:",
  "shields:",
  "energy(fuel):",
  "ship condition:",
  "autopilot status:",
  "cloaking device:",
  "security program:",
  "comm system:",
  "autolaunch status:",
  "selfdestruct status:",
  "autorecharge status:",
  "tractor beam condition:",
  "primary target:",
  "blasters ready:",
  "lasers ready:",
  "turbolasers ready:",
  "ion cannons ready:",
  "laser condition:",
  "ion condition:",
  "launcher condition:",
  "missiles:",
  "total turrets:",
  "escape pods:",
  "hangar ",
}

local INFO_MARKERS = {
  "quota:",
  "owner:",
  "crew:",
  "kill markers:",
  "autoblasters:",
  "laser cannons:",
  "turbolasers:",
  "ion cannons:",
  "maximum missiles:",
  "maximum torpedoes:",
  "maximum rockets:",
  "maximum pulses:",
  "maximum chaff:",
  "missile tubes:",
  "tractorbeams:",
  "escape pods:",
  "max hull:",
  "max shields:",
  "max energy(fuel):",
  "maximum speed:",
  "hyperspeed:",
  "maneuver:",
  "sensor array:",
  "shield boosters:",
  "communications:",
  "cloaking device:",
  "hatchway:",
  "hangar bays:",
  "docking:",
  "selfdestruct:",
}

local function containsMarker(lower, markers)
  for _, marker in ipairs(markers) do
    if lower:find(marker, 1, true) then
      return true
    end
  end
  return false
end

local function captureOwnsLine(capture, value)
  value = trim(value)
  if isAsynchronousVisibleLine(value) then
    return false
  end
  -- Hidden commands commonly begin and end with blank lines. Those blanks are
  -- part of the private response even before its first recognizable heading.
  if value == "" then
    return capture.polled == true
  end
  if isKnownCaptureFailure(value) then
    return markResponseStarted(capture)
  end

  local lower = value:lower()
  local command = trim(capture.sentCommand):lower():gsub("%s+", " ")
  if lower == command then
    return markResponseStarted(capture)
  end

  if capture.parserCommand == "radar" then
    if isCoordinateRow(value) or radarSystemName(value) ~= nil then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "prox" or capture.parserCommand == "prox_velocity" then
    if lower:match("^your%s+coordinates%s*:") then
      return markResponseStarted(capture)
    end
    if
      lower:match("^proximity")
      or lower:match("^object%s+")
      or lower:match("^name%s+")
      or radarSystemName(value:gsub(":$", ""))
    then
      return markResponseStarted(capture)
    end
    local owned = value:match("^.-%s+[Pp][Rr][Oo][Xx]%s*:%s*[+-]?[%d,]+%.?%d*%s*$") ~= nil
      or value:match("^.-%s%s+[+-]?[%d,]+%.?%d*%s*$") ~= nil
      or value:match("^.-%s+is%s+now%s+[%d,]+%.?%d*%s+units?%s+away%.?$") ~= nil
    if owned then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "status" then
    if value:match("^%[Class:%s*[^%]]+%]%s*:") then
      -- A background info response may already be in flight when player input
      -- preempts it with `status`. Quarantine the remainder of that response;
      -- otherwise `Kill Markers:` is indistinguishable from a legacy status
      -- header and can rename the observer.
      capture.foreignResponse = "ship information"
      return false
    end
    if capture.foreignResponse then
      return false
    end
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
    if
      radarSystemName(value) ~= nil
      or isCoordinateRow(value)
      or lower:match("battlegroup:%s*$")
    then
      return markResponseStarted(capture)
    end
    if lower:find("ship", 1, true) and lower:find("position", 1, true) then
      capture.fleetHeaderSeen = true
      return markResponseStarted(capture)
    end
    if lower:match("^fleet%s*radar") then
      return markResponseStarted(capture)
    end
    if value:find("|", 1, true) then
      return markResponseStarted(capture)
    end
    if capture.fleetHeaderSeen == true and value:match("%s%s+") then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "battlegroup" then
    if
      value:match("^%[%s*[^%]]-%s*%].-:<*.-[Pp]os:")
      or (capture.responseStarted and (lower:match("^energy:") or lower:find("battlegroup", 1, true)))
      or (
        lower:find("battlegroup", 1, true)
        and (
          lower:find("not ", 1, true)
          or lower:find("no ", 1, true)
          or lower:find("aren't", 1, true)
        )
      )
    then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "squadron status" then
    if
      lower:match("^lead:%s+.-'.-'$")
      or lower:match("^squadron%s+fire%s+assist:")
      or (capture.responseStarted and (lower:match("^energy:") or value:match("^.-%s+'.-'$")))
      or (
        lower:find("squadron", 1, true)
        and (
          lower:find("not ", 1, true)
          or lower:find("no ", 1, true)
          or lower:find("aren't", 1, true)
        )
      )
    then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "navstat" then
    if
      lower:match("^readout%s+for%s+.-:$")
      or lower:match("^current%s+coordinates:")
      or lower:match("^current%s+system:")
      or lower:match("^current%s+system%s+x/y:")
      or lower:match("^jump%s+")
      or lower:find("standard sectors", 1, true)
    then
      return markResponseStarted(capture)
    end
  end

  if capture.parserCommand == "calculate" then
    if
      lower == "possible destinations:"
      or lower:match("^starsystem%s+parsecs")
      or lower:match("^calculating%s+hyperspace%s+trajectory:")
    then
      return markResponseStarted(capture)
    end
    if capture.responseStarted and value:match("%s%s+") then
      return true
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
    if ok then
      return
    end
  end
  if type(debugc) == "function" then
    debugc("\n[Holocron3D/scraper/" .. level .. "] " .. message .. "\n")
  end
end

local function safeKill(functionName, id)
  if not id then
    return
  end
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
    observer = { id = "player-ship", kind = "ship", name = "Player Ship" },
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
      mudletCompatibility = { lotjUiDetected = hasLotjUi },
      hyperspace = { phase = "idle" },
      formations = {},
      tacticalViews = {},
      combatTargets = {},
    },
  }
end

local function epochMilliseconds()
  if type(getEpoch) == "function" then
    local ok, value = pcall(getEpoch)
    local numeric = ok and tonumber(value) or nil
    if numeric and numeric > 0 then
      if numeric < 100000000000 then
        numeric = numeric * 1000
      end
      return math.floor(numeric + 0.5)
    end
  end
  return os.time() * 1000
end

local function sampleNumber(value)
  local numeric = tonumber(value)
  if not numeric or numeric ~= numeric or numeric == math.huge or numeric == -math.huge then
    return nil
  end
  if numeric == math.floor(numeric) then
    return tostring(math.floor(numeric))
  end
  return string.format("%.3f", numeric):gsub("0+$", ""):gsub("%.$", "")
end

local function samplePosition(entity)
  if type(entity) ~= "table" then
    return nil
  end
  local x, y, z = sampleNumber(entity.x), sampleNumber(entity.y), sampleNumber(entity.z)
  return x and y and z and (x .. "," .. y .. "," .. z) or nil
end

local function sampleDistance(left, right)
  if type(left) ~= "table" or type(right) ~= "table" then
    return nil
  end
  local lx, ly, lz = tonumber(left.x), tonumber(left.y), tonumber(left.z)
  local rx, ry, rz = tonumber(right.x), tonumber(right.y), tonumber(right.z)
  if not lx or not ly or not lz or not rx or not ry or not rz then
    return nil
  end
  return math.sqrt((rx - lx) ^ 2 + (ry - ly) ^ 2 + (rz - lz) ^ 2)
end

local function emitHyperspaceSample(event, sample, extra)
  if type(sample) ~= "table" then
    return false
  end
  local atMs = epochMilliseconds()
  local fields = {
    "event=" .. tostring(event),
    "sample=" .. tostring(sample.id),
    "at_ms=" .. tostring(atMs),
    "mode=local",
    "scope=" .. tostring(sample.scope or "local"),
  }
  local function field(name, value)
    if value ~= nil and tostring(value) ~= "" then
      table.insert(fields, name .. "=" .. tostring(value))
    end
  end
  field("origin", samplePosition(sample.departureOrigin or sample.plotOrigin))
  field("plot_origin", samplePosition(sample.plotOrigin))
  field("destination", samplePosition(sample.destination))
  field("distance_units", sampleNumber(sample.departureDistance or sample.plotDistance))
  field("hyperspeed", sampleNumber(sample.hyperspeed))
  field("navigator", sample.navigatorApplied and "true" or "false")
  field("estimate_seconds", sampleNumber(sample.estimatedTravelSeconds))
  field("model", sample.predictionModel)
  field("reported_parsecs", sampleNumber(sample.reportedDistanceParsecs))
  field("reported_seconds", sampleNumber(sample.reportedTravelSeconds))
  if sample.readyAtMs and sample.plottedAtMs then
    field("calculation_ms", sample.readyAtMs - sample.plottedAtMs)
  end
  if sample.departedAtMs and sample.readyAtMs then
    field("departure_delay_ms", sample.departedAtMs - sample.readyAtMs)
  end
  if sample.destinationReachedAtMs and sample.departedAtMs then
    field("transit_ms", sample.destinationReachedAtMs - sample.departedAtMs)
  end
  if sample.completedAtMs and sample.destinationReachedAtMs then
    field("reentry_ms", sample.completedAtMs - sample.destinationReachedAtMs)
  end
  if sample.completedAtMs and sample.departedAtMs then
    field("total_ms", sample.completedAtMs - sample.departedAtMs)
  end
  for name, value in pairs(extra or {}) do
    field(name, value)
  end
  local line = "[Holocron3D][HyperspaceSample] " .. table.concat(fields, " ")
  if type(echo) == "function" then
    -- Mudlet can leave prompts and server messages on an unterminated line.
    -- Bound both sides so diagnostics never merge with game output or the
    -- next line received from the server.
    local ok = pcall(echo, "\n" .. line .. "\n")
    if ok then
      return true
    end
  end
  diagnostic("info", line)
  return true
end

local function finishActiveHyperspaceSample(event, reason)
  local sample = Scraper.hyperspace.activeSample
  if not sample then
    return false
  end
  emitHyperspaceSample(event, sample, reason and { reason = reason } or nil)
  Scraper.hyperspace.activeSample = nil
  return true
end

local function startHyperspaceSample(payload)
  if Scraper.hyperspace.activeSample then
    finishActiveHyperspaceSample("superseded", "new_plot")
  end
  Scraper.hyperspace.sampleSequence = (Scraper.hyperspace.sampleSequence or 0) + 1
  local destination = copyTable(payload.destination or {})
  local origin = copyTable(Scraper.state and Scraper.state.observer or {})
  local now = epochMilliseconds()
  local sample = {
    id = tostring(now) .. "-" .. tostring(Scraper.hyperspace.sampleSequence),
    scope = trim(payload.scope) ~= "" and trim(payload.scope) or "local",
    plottedAtMs = now,
    plotOrigin = origin,
    destination = destination,
    plotDistance = sampleDistance(origin, destination),
    hyperspeed = tonumber(origin.hyperspeed),
    navigatorApplied = false,
    predictionModel = trim(payload.predictionModel),
    estimatedTravelSeconds = tonumber(payload.estimatedTravelSeconds),
  }
  Scraper.hyperspace.activeSample = sample
  emitHyperspaceSample("plot", sample)
  return sample
end

local function markHyperspaceSample(event)
  local sample = Scraper.hyperspace.activeSample
  if not sample then
    return false
  end
  local now = epochMilliseconds()
  if event == "navigator" then
    sample.navigatorApplied = true
  elseif event == "ready" and not sample.readyAtMs then
    sample.readyAtMs = now
  elseif event == "departure" and not sample.departedAtMs then
    sample.departedAtMs = now
    sample.departureOrigin = copyTable(Scraper.state and Scraper.state.observer or {})
    sample.departureDistance = sampleDistance(sample.departureOrigin, sample.destination)
    sample.hyperspeed = tonumber(sample.departureOrigin.hyperspeed) or sample.hyperspeed
  elseif event == "destination_reached" and not sample.destinationReachedAtMs then
    sample.destinationReachedAtMs = now
  elseif event == "complete" and not sample.completedAtMs then
    sample.completedAtMs = now
    Scraper.hyperspace.pendingArrivalSample = sample
    Scraper.hyperspace.activeSample = nil
  end
  emitHyperspaceSample(event, sample)
  return true
end

local function completeHyperspaceArrivalSample(observer)
  local sample = Scraper.hyperspace.pendingArrivalSample
  if not sample then
    return false
  end
  local arrivalError = sampleDistance(observer, sample.destination)
  emitHyperspaceSample("arrival_fix", sample, {
    arrival = samplePosition(observer),
    arrival_error_units = sampleNumber(arrivalError),
  })
  Scraper.hyperspace.pendingArrivalSample = nil
  return true
end

local function captureHyperspaceNavigationReport(result)
  local sample = Scraper.hyperspace.activeSample or Scraper.hyperspace.pendingArrivalSample
  if not sample or type(result) ~= "table" then
    return false
  end
  local distance = tonumber(result.jumpDistanceParsecs)
  local seconds = tonumber(result.jumpTimeSeconds)
  if not distance and not seconds then
    return false
  end
  local changed = distance ~= sample.reportedDistanceParsecs
    or seconds ~= sample.reportedTravelSeconds
  sample.reportedDistanceParsecs = distance or sample.reportedDistanceParsecs
  sample.reportedTravelSeconds = seconds or sample.reportedTravelSeconds
  if changed then
    emitHyperspaceSample("navigation_report", sample)
  end
  return changed
end

local function rememberCombatTarget(key, targetName, details)
  if not Scraper.state or not Scraper.state.metadata then
    return
  end
  local targets = Scraper.state.metadata.combatTargets
  if type(targets) ~= "table" then
    targets = {}
    Scraper.state.metadata.combatTargets = targets
  end
  key = trim(key):lower()
  targetName = trim(targetName)
  if key == "" then
    return
  end
  if targetName == "" or targetName:lower() == "none" then
    targets[key] = nil
    return
  end
  local entry = {
    key = key,
    scope = "local",
    targetName = targetName,
    observedAt = os.time(),
  }
  for field, value in pairs(type(details) == "table" and details or {}) do
    entry[field] = value
  end
  targets[key] = entry
end

local function entityKey(entity)
  return tostring(entity.id or entity.name or "unknown"):lower()
end

local function validTelemetryEntity(entity)
  if type(entity) ~= "table" then
    return false
  end
  local name = trim(entity.name)
  if name == "" or #name > 160 or name:find("'", 1, true) then
    return false
  end
  local lower = name:lower()
  if
    lower:find(" enters the starsystem", 1, true)
    or lower:find("coming out of its hyperjump", 1, true)
  then
    return false
  end
  -- Ship identity is its player-assigned callsign, which is always one token.
  -- Other contact types legitimately have names such as "Dromund Kaas" and
  -- "A Concussion Missile", so whitespace is forbidden only for ships.
  if entity.kind == "ship" and (#name > 64 or name:find("%s")) then
    return false
  end
  entity.name = name
  return true
end

local function findEntity(entity)
  local wantedId = entity.id and tostring(entity.id):lower() or nil
  local wantedName = entity.name and tostring(entity.name):lower() or nil
  for key, current in pairs(Scraper.state.entities) do
    if
      (wantedId and tostring(current.id or ""):lower() == wantedId)
      or (not wantedId and wantedName and tostring(current.name or ""):lower() == wantedName)
    then
      return current, key
    end
  end
  return nil
end

local function findTacticalViewEntity(viewpointMemberKey, entity)
  local wantedView = trim(viewpointMemberKey):lower()
  if wantedView == "" then
    return nil
  end
  local views = Scraper.state and Scraper.state.metadata and Scraper.state.metadata.tacticalViews
    or {}
  local view = views[wantedView]
  if type(view) ~= "table" then
    local wantedName = wantedView:match("^name:(.+)$")
    for _, candidate in pairs(views) do
      if
        type(candidate) == "table"
        and (
          (wantedName and trim(candidate.memberName):lower() == wantedName)
          or trim(candidate.memberId):lower() == wantedView
        )
      then
        view = candidate
        break
      end
    end
  end
  if type(view) ~= "table" then
    return nil
  end
  local wantedId = entity.id and tostring(entity.id):lower() or nil
  local wantedName = entity.name and tostring(entity.name):lower() or nil
  for _, current in ipairs(view.entities or {}) do
    if
      (wantedId and tostring(current.id or ""):lower() == wantedId)
      or (not wantedId and wantedName and tostring(current.name or ""):lower() == wantedName)
    then
      return current
    end
  end
  return nil
end

local function findPayloadTarget(payload)
  local viewpointMemberKey = trim(payload.viewpointMemberKey)
  if viewpointMemberKey == "" then
    viewpointMemberKey = trim(payload.viewpointMemberId)
  end
  if viewpointMemberKey ~= "" then
    return findTacticalViewEntity(viewpointMemberKey, { id = trim(payload.targetId) })
  end
  return findEntity({ id = trim(payload.targetId) })
end

local function mergeEntity(entity, preserveIdentity)
  if not validTelemetryEntity(entity) then
    diagnostic("warn", "discarded telemetry entity with an invalid name")
    return nil
  end
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
    :lower()
    :gsub("^%s+", "")
    :gsub("%s+$", "")
    :gsub("%s+", " ")
end

local function assignProjectileTrackIds(entities)
  local tracking = Scraper.projectileTracking or { nextId = 0, tracks = {} }
  local previous = tracking.tracks or {}
  local incoming = {}
  for _, entity in ipairs(entities or {}) do
    if entity.kind == "projectile" then
      table.insert(incoming, entity)
    end
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
      x = x,
      y = y,
      z = z,
      vx = old and x - (tonumber(old.x) or x) or 0,
      vy = old and y - (tonumber(old.y) or y) or 0,
      vz = old and z - (tonumber(old.z) or z) or 0,
    }
  end
  tracking.tracks = nextTracks
  Scraper.projectileTracking = tracking
end

local function recentlyDestroyed(name)
  local key = trim(name):lower()
  if key == "" then
    return false
  end
  local destroyedAt = tonumber(Scraper.destruction.destroyedNames[key])
  if not destroyedAt then
    return false
  end
  if os.time() - destroyedAt <= Scraper.DESTRUCTION_TOMBSTONE_SECONDS then
    return true
  end
  Scraper.destruction.destroyedNames[key] = nil
  return false
end

local function replaceRadarEntities(entities)
  assignProjectileTrackIds(entities)
  local previous = Scraper.state.entities
  local replacement = {}
  Scraper.state.entities = previous

  for _, entity in ipairs(entities) do
    if validTelemetryEntity(entity) and not recentlyDestroyed(entity.name) then
      local old = findEntity(entity)
      local stored = copyTable(entity)
      if old then
        mergeMissing(stored, old)
      end
      if not old then
        -- A contact that has newly appeared (or re-entered after disappearing)
        -- must not inherit stale scan timestamps from an earlier radar pass.
        Scraper.scanState[entityKey(stored)] = nil
      end
      replacement[entityKey(stored)] = stored
    end
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
  if not Scraper.state then
    return
  end
  local observer = Scraper.state.observer or {}
  local ox, oy, oz = tonumber(observer.x), tonumber(observer.y), tonumber(observer.z)
  if not ox or not oy or not oz then
    return
  end
  for _, entity in pairs(Scraper.state.entities or {}) do
    local x, y, z = tonumber(entity.x), tonumber(entity.y), tonumber(entity.z)
    if x and y and z then
      entity.distance = math.floor(math.sqrt((x - ox) ^ 2 + (y - oy) ^ 2 + (z - oz) ^ 2) + 0.5)
    end
  end
end

local function checkHyperspaceClearance(payload)
  if not Scraper.state then
    return false, "fresh radar clearance is required"
  end
  local observer = Scraper.state.observer or {}
  local ox, oy, oz = tonumber(observer.x), tonumber(observer.y), tonumber(observer.z)
  if not ox or not oy or not oz then
    return false, "observer coordinates are unavailable"
  end
  local sources = Scraper.state.metadata and Scraper.state.metadata.sources or {}
  local spatialAt = math.max(tonumber(sources.radar) or 0, tonumber(sources.fleetradar) or 0)
  if spatialAt <= 0 or os.time() - spatialAt > Scraper.HYPERSPACE_SPATIAL_FIX_MAX_AGE_SECONDS then
    return false, "fresh radar clearance is required"
  end

  local exemptShipNames = {}
  local fleet = Scraper.state.metadata and Scraper.state.metadata.fleet or nil
  if type(fleet) == "table" and fleet.active == true and fleet.kind == "battlegroup" then
    for _, member in ipairs(fleet.members or {}) do
      local memberName = trim(member.name):lower()
      if memberName ~= "" then
        exemptShipNames[memberName] = true
      end
    end
  end

  local nearest, nearestName
  for _, entity in pairs(Scraper.state.entities or {}) do
    if
      entity.kind == "ship"
      or entity.kind == "planet"
      or entity.kind == "celestial"
      or entity.kind == "star"
    then
      local x, y, z = tonumber(entity.x), tonumber(entity.y), tonumber(entity.z)
      local exemptFleetShip = entity.kind == "ship"
        and exemptShipNames[trim(entity.name):lower()] == true
      if x and y and z and entity.id ~= "player-ship" and not exemptFleetShip then
        local distance = math.sqrt((x - ox) ^ 2 + (y - oy) ^ 2 + (z - oz) ^ 2)
        if not nearest or distance < nearest then
          nearest, nearestName = distance, entity.name or entity.id
        end
      end
    end
  end
  if nearest and nearest < Scraper.MIN_HYPERSPACE_CLEARANCE then
    return false,
      string.format(
        "%s is only %d units away; 500 units are required",
        tostring(nearestName or "an object"),
        math.floor(nearest + 0.5)
      )
  end
  return true
end

local function refreshFormationRoles()
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local observerName =
    trim(Scraper.state and Scraper.state.observer and Scraper.state.observer.name):lower()
  for kind, fleet in pairs(metadata.formations or {}) do
    if type(fleet) == "table" then
      fleet.role = nil
      for _, member in ipairs(fleet.members or {}) do
        if trim(member.name):lower() == observerName then
          if kind == "battlegroup" then
            fleet.role = (member.leader == true or member.role == "leader") and "commander"
              or "member"
          else
            fleet.role = (member.leader == true or member.role == "lead") and "lead" or "wing"
          end
          break
        end
      end
    end
  end
  local active = metadata.fleet
  local canonical = type(active) == "table"
    and metadata.formations
    and metadata.formations[active.kind]
  if canonical then
    metadata.fleet = canonical
  end
end

local function mergeFormationMemberTelemetry(name, result)
  local wanted = trim(name):lower()
  if wanted == "" then
    return
  end
  local visited = {}
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local function updateFleet(fleet)
    if type(fleet) ~= "table" or visited[fleet] then
      return
    end
    visited[fleet] = true
    for _, member in ipairs(fleet.members or {}) do
      if trim(member.name):lower() == wanted then
        for key, value in pairs(result or {}) do
          if key ~= "source" and key ~= "recognizedLines" and key ~= "id" and value ~= nil then
            member[key] = type(value) == "table" and copyTable(value) or value
          end
        end
      end
    end
  end
  updateFleet(metadata.fleet)
  for _, fleet in pairs(metadata.formations or {}) do
    updateFleet(fleet)
  end
end

local function applyStatus(result, sentCommand)
  local isObserver = trim(sentCommand):lower() == "status"
  local requestedName = trim(sentCommand):match("^%S+%s+(.+)$")
  local parsedName = trim(result.name)
  if
    not isObserver
    and requestedName
    and not responseNameMatchesRequest(requestedName, parsedName)
  then
    return false,
      "status response identity mismatch; expected "
        .. requestedName
        .. " but received "
        .. (parsedName ~= "" and parsedName or "an unnamed ship")
  end
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
  if result.id and not isObserver then
    destination.id = result.id
  end
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
    for _, fleet in pairs(metadata.formations or {}) do
      updateFleet(fleet)
    end
    local order = metadata.fleetOrder
    if type(order) == "table" and order.order == "autopilot" and type(order.results) == "table" then
      for name, memberResult in pairs(order.results) do
        if trim(name):lower() == memberName then
          memberResult.status = "accepted"
          memberResult.autopilot = result.autopilot == true
          memberResult.reason = "Verified by ship status."
          memberResult.observedAt = os.time()
        end
      end
      if recountFleetOrder then
        recountFleetOrder(order)
      end
    end
  end
  mergeFormationMemberTelemetry(result.name or destination.name, result)
  if isObserver and result.target then
    local target = trim(result.target)
    target = target:lower() == "none" and target or target:match("'([^']+)'") or target
    if target:lower() == "none" then
      Scraper.combat.targetName = nil
    else
      Scraper.combat.targetName = target
    end
    Scraper.state.metadata.combatTarget = Scraper.combat.targetName
    rememberCombatTarget("local", target, {
      scope = "local",
      ownerId = "player-ship",
      ownerName = trim(Scraper.state.observer and Scraper.state.observer.name),
      ownerLabel = "YOUR SHIP'S TARGET",
    })
  end
  if isObserver and result.name then
    refreshFormationRoles()
  end
  if isObserver and clearObserverHydration then
    clearObserverHydration("status")
  end
  return true
end

local function applyInfo(result, sentCommand)
  local isObserver = trim(sentCommand):lower() == "info"
  local requestedName = trim(sentCommand):match("^%S+%s+(.+)$")
  local parsedName = trim(result.name)
  local observerName = trim(Scraper.state.observer and Scraper.state.observer.name)
  if requestedName and not responseNameMatchesRequest(requestedName, parsedName) then
    return false,
      "info response identity mismatch; expected "
        .. requestedName
        .. " but received "
        .. (parsedName ~= "" and parsedName or "an unnamed ship")
  end
  if
    isObserver
    and observerName ~= ""
    and observerName:lower() ~= "player ship"
    and parsedName:lower() ~= observerName:lower()
  then
    return false,
      "info response identity mismatch; expected "
        .. observerName
        .. " but received "
        .. (parsedName ~= "" and parsedName or "an unnamed ship")
  end
  local scannedName = parsedName ~= "" and parsedName or requestedName
  local destination = isObserver and Scraper.state.observer or findEntity({ name = scannedName })
  if not destination and not isObserver then
    destination = mergeEntity({ id = result.id, name = scannedName, kind = "ship" })
  end
  if not destination then
    return false, "validated info response has no matching telemetry entity"
  end
  for key, value in pairs(result) do
    if key ~= "source" and key ~= "recognizedLines" and key ~= "id" and value ~= nil then
      destination[key] = type(value) == "table" and copyTable(value) or value
    end
  end
  mergeFormationMemberTelemetry(result.name or destination.name, result)
  if isObserver and clearObserverHydration then
    clearObserverHydration("info")
  end
  return true
end

function Scraper.applyResult(result, sentCommand, captureContext)
  if type(result) ~= "table" or type(result.source) ~= "string" then
    return nil, "parsed result must include a source"
  end

  Scraper.state = Scraper.state or freshState()
  local source = result.source
  local sensorTickSequence = captureContext and tonumber(captureContext.sensorTickSequence)
  local preserveNewerGmcpObserver = sensorTickSequence ~= nil
    and (tonumber(Scraper.shipGmcp.sequence) or 0) > sensorTickSequence
  local fullRadar = source == "radar" and normalizedCommand(sentCommand) == "radar"
  local radarRefreshSatisfied = false
  Scraper.state.metadata.sources[source] = os.time()

  if source == "radar" then
    Scraper.combat.lastRadarAt = os.time()
    radarRefreshSatisfied = fullRadar
      and Scraper.polling.radarRefreshPending == true
      and tonumber(Scraper.polling.radarRefreshIssuedGeneration or 0)
        >= tonumber(Scraper.polling.radarRefreshGeneration or 0)
    if radarRefreshSatisfied then
      Scraper.polling.radarRefreshPending = false
      Scraper.state.metadata.radarRefreshPending = false
      if Scraper.polling.fleetRadarRefreshPending ~= true then
        Scraper.polling.radarRefreshReason = nil
        Scraper.state.metadata.radarRefreshReason = nil
      end
    end
    if result.system then
      Scraper.state.metadata.system = result.system
    end
    if result.observer and not preserveNewerGmcpObserver then
      Scraper.state.observer.x = result.observer.x
      Scraper.state.observer.y = result.observer.y
      Scraper.state.observer.z = result.observer.z
    end
    replaceRadarEntities(result.entities or {})
    for _, entity in ipairs(result.entities or {}) do
      if validTelemetryEntity(entity) then
        mergeFormationMemberTelemetry(entity.name, entity)
      end
    end
  elseif source == "status" then
    local applied, applyError = applyStatus(result, sentCommand)
    if not applied then
      return nil, applyError
    end
  elseif source == "info" then
    local applied, applyError = applyInfo(result, sentCommand)
    if not applied then
      return nil, applyError
    end
  elseif source == "navstat" then
    if result.coordinates then
      Scraper.state.observer.x, Scraper.state.observer.y, Scraper.state.observer.z =
        result.coordinates.x, result.coordinates.y, result.coordinates.z
    end
    if result.heading then
      Scraper.state.observer.heading = copyTable(result.heading)
    end
    if result.speed then
      Scraper.state.observer.speed = copyTable(result.speed)
    end
    if result.system then
      Scraper.state.metadata.system = result.system
    end
    Scraper.state.metadata.navigation = Scraper.state.metadata.navigation or {}
    if
      Scraper.state.metadata.hyperspace
      and Scraper.state.metadata.hyperspace.phase == "arrived"
    then
      Scraper.state.metadata.navigation.arrivalRefreshedAt = os.time()
    end
    for _, key in ipairs({
      "galaxy",
      "jumpSystem",
      "jumpDistanceParsecs",
      "jumpTime",
      "jumpTimeSeconds",
      "standardSectorsAvailable",
    }) do
      if result[key] ~= nil then
        Scraper.state.metadata.navigation[key] = type(result[key]) == "table"
            and copyTable(result[key])
          or result[key]
      end
    end
    captureHyperspaceNavigationReport(result)
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
    local fleet = copyTable(result.fleet or { kind = source, active = false, members = {} })
    local previous = Scraper.state.metadata.formations[source]
    for _, member in ipairs(fleet.members or {}) do
      for _, oldMember in ipairs(type(previous) == "table" and previous.members or {}) do
        if trim(oldMember.name):lower() == trim(member.name):lower() then
          mergeMissing(member, oldMember)
          break
        end
      end
      local entity = findEntity({ name = member.name })
      if entity then
        mergeMissing(member, entity)
      end
    end
    fleet.observedAt = os.time()
    Scraper.state.metadata.formations[source] = fleet
    local other = source == "battlegroup" and "squadron" or "battlegroup"
    local otherFleet = Scraper.state.metadata.formations[other]
    if fleet.active == true then
      Scraper.state.metadata.fleet = fleet
    elseif Scraper.state.metadata.fleet and Scraper.state.metadata.fleet.kind == source then
      Scraper.state.metadata.fleet = otherFleet
          and otherFleet.active == true
          and copyTable(otherFleet)
        or nil
    end
    refreshFormationRoles()
  else
    if source == "fleetradar" then
      Scraper.polling.lastFleetRadarAt = os.time()
      local refreshSatisfied = normalizedCommand(sentCommand) == "fleetradar"
        and Scraper.polling.fleetRadarRefreshPending == true
        and tonumber(Scraper.polling.fleetRadarRefreshIssuedGeneration or 0)
          >= tonumber(Scraper.polling.radarRefreshGeneration or 0)
      if refreshSatisfied then
        Scraper.polling.fleetRadarRefreshPending = false
        Scraper.state.metadata.fleetRadarRefreshPending = false
        Scraper.state.metadata.fleetRadarRefreshReason = nil
        if Scraper.polling.radarRefreshPending ~= true then
          Scraper.polling.radarRefreshReason = nil
          Scraper.state.metadata.radarRefreshReason = nil
        end
      end
      if result.system then
        Scraper.state.metadata.system = result.system
      end
    end
    if result.observer and not preserveNewerGmcpObserver then
      Scraper.state.observer.x = result.observer.x
      Scraper.state.observer.y = result.observer.y
      Scraper.state.observer.z = result.observer.z
    end
    for _, entity in ipairs(result.entities or {}) do
      local isObserver = entity.name
        and Scraper.state.observer.name
        and entity.name:lower() == Scraper.state.observer.name:lower()
      if source == "fleetradar" and isObserver and not preserveNewerGmcpObserver then
        for key, value in pairs(entity) do
          if
            key ~= "id"
            and key ~= "name"
            and key ~= "class"
            and key ~= "kind"
            and value ~= nil
          then
            if
              key == "speed"
              and type(Scraper.state.observer.speed) == "table"
              and type(value) == "number"
            then
              Scraper.state.observer.speed.current = value
            else
              Scraper.state.observer[key] = type(value) == "table" and copyTable(value) or value
            end
          end
        end
      elseif validTelemetryEntity(entity) and not recentlyDestroyed(entity.name) then
        mergeEntity(entity, source == "prox" or source == "prox_velocity")
        if source == "fleetradar" then
          mergeFormationMemberTelemetry(entity.name, entity)
        end
      end
    end
  end

  refreshDerivedDistances()
  local successfulFullRadar = fullRadar and type(result.observer) == "table"
  local freshArrivalRadar = successfulFullRadar
    and (Scraper.hyperspace.realspaceLurchObserved ~= true or radarRefreshSatisfied)
  if freshArrivalRadar and completeOwnHyperspaceArrival then
    local completedArrival = completeOwnHyperspaceArrival("fresh radar")
    if completedArrival then
      completeHyperspaceArrivalSample(Scraper.state.observer)
    end
  end
  if
    Scraper.polling.radarRefreshPending ~= true
    and Scraper.polling.fleetRadarRefreshPending ~= true
  then
    Scraper.polling.sensorTickBypassPending = false
  end
  if captureContext and captureContext.sensorTickSource then
    Scraper.state.metadata.lastSensorCapture = {
      command = normalizedCommand(sentCommand),
      tickSource = captureContext.sensorTickSource,
      tickSequence = sensorTickSequence or 0,
      syncWaitSeconds = tonumber(captureContext.sensorSyncWaitSeconds) or 0,
      completedAt = os.time(),
      preservedNewerGmcpObserver = preserveNewerGmcpObserver == true,
    }
  end
  Scraper.state.metadata.lastSource = source
  Scraper.state.metadata.lastObservedAt = os.time()
  return true
end

local function applyRemoteRadarResult(result, capture)
  if type(result) ~= "table" or result.source ~= "radar" then
    return nil, "a remote tactical view requires radar telemetry"
  end
  local memberId = trim(capture.remoteViewMemberId):lower()
  local memberName = trim(capture.remoteViewMemberName)
  local memberKey = trim(capture.remoteViewMemberKey):lower()
  if memberKey == "" and memberName ~= "" then
    memberKey = "name:" .. memberName:lower()
  end
  if memberId == "" or memberName == "" or memberKey == "" then
    return nil, "remote tactical view capture is missing its formation member"
  end
  local responseName = trim(capture.remoteResponseMemberName)
  if responseName ~= "" and responseName:lower() ~= memberName:lower() then
    return nil, "remote radar response belonged to " .. responseName .. " instead of " .. memberName
  end
  if type(result.observer) ~= "table" then
    return nil, "remote radar did not report observer coordinates"
  end

  local metadata = Scraper.state.metadata or {}
  metadata.tacticalViews = metadata.tacticalViews or {}
  Scraper.state.metadata = metadata
  local previous = metadata.tacticalViews[memberKey] or metadata.tacticalViews[memberId]
  local observer = copyTable(capture.remoteViewMember or {})
  if type(previous) == "table" and type(previous.observer) == "table" then
    mergeMissing(observer, previous.observer)
  end
  observer.id = memberId
  observer.name = memberName
  observer.kind = "ship"
  observer.x = result.observer.x
  observer.y = result.observer.y
  observer.z = result.observer.z

  local previousEntities = {}
  for _, entity in ipairs(type(previous) == "table" and previous.entities or {}) do
    previousEntities[tostring(entity.id or entity.name or ""):lower()] = entity
  end
  local entities = {}
  for _, entity in ipairs(result.entities or {}) do
    if validTelemetryEntity(entity) and not recentlyDestroyed(entity.name) then
      local stored = copyTable(entity)
      local old = previousEntities[tostring(stored.id or stored.name or ""):lower()]
      if old then
        mergeMissing(stored, old)
      end
      table.insert(entities, stored)
    end
  end

  metadata.tacticalViews[memberKey] = {
    memberId = memberId,
    memberName = memberName,
    memberSlot = capture.remoteViewMemberSlot,
    system = result.system or observer.system,
    observedAt = os.time(),
    observer = observer,
    entities = entities,
    stale = false,
  }
  metadata.lastRemoteViewMemberId = memberId
  metadata.lastRemoteViewMemberKey = memberKey
  metadata.lastRemoteViewObservedAt = os.time()
  return true
end

function Scraper.publish()
  local profiling = Scraper.profiler.enabled == true
  local profileStarted = profiling and os.clock() or nil
  if profiling then
    profileCount("snapshotPublishes")
  end
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
    if not published then
      profileCount("snapshotFailures")
    end
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
    return { "[info output redacted from capture diagnostics; structured card telemetry retained]" }
  end
  return copyTable(capture.lines)
end

local function abandonCapture(reason)
  local capture = Scraper.active
  if not capture then
    return
  end
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
  if capture.polled and not capture.initializationSweep and scheduleNextPoll then
    scheduleNextPoll(capture.pollDelay)
  end
end

local function cancelPollTimer()
  if Scraper.polling.timerId then
    safeKill("killTimer", Scraper.polling.timerId)
    Scraper.polling.timerId = nil
  end
end

local function cancelSensorTickWait(clearPending)
  safeKill("killTimer", Scraper.polling.sensorTickTimerId)
  Scraper.polling.sensorTickTimerId = nil
  if clearPending then
    Scraper.polling.sensorPollPending = false
    Scraper.polling.sensorPollPendingCommand = nil
    Scraper.polling.sensorPollPendingSince = nil
    Scraper.polling.sensorTickGranted = false
    Scraper.polling.sensorTickSource = nil
    Scraper.polling.sensorTickSequence = nil
  end
end

clearObserverHydration = function(source)
  local queue = Scraper.polling.hydrationQueue or {}
  for index = #queue, 1, -1 do
    if queue[index] == source then
      table.remove(queue, index)
    end
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
    and observer.hasWeapons ~= nil
    and observer.shipCategory ~= nil
  if not hasStatus then
    table.insert(queue, "status")
  end
  if not hasInfo then
    table.insert(queue, "info")
  end
  Scraper.polling.hydrationQueue = queue
end

queueObserverInfo = function()
  local queue = Scraper.polling.hydrationQueue or {}
  for index = #queue, 1, -1 do
    if queue[index] == "info" then
      table.remove(queue, index)
    end
  end
  table.insert(queue, 1, "info")
  Scraper.polling.hydrationQueue = queue
  if Scraper.state and Scraper.state.metadata.polling then
    Scraper.state.metadata.polling.hydratingObserver = true
  end
  if
    Scraper.polling.enabled
    and Scraper.state
    and Scraper.state.metadata.inSpace == true
    and #(Scraper.polling.initializationQueue or {}) == 0
    and scheduleNextPoll
  then
    scheduleNextPoll(0.1)
  end
end

local function clearInitialStateSweep()
  Scraper.polling.initializationQueue = {}
  Scraper.polling.initializationReason = nil
  Scraper.polling.initializationSpaceProbe = false
  if Scraper.state and Scraper.state.metadata then
    Scraper.state.metadata.initializationPending = false
    Scraper.state.metadata.initializationReason = nil
  end
end

local function queueInitialStateSweep(reason, allowSpaceProbe)
  Scraper.state = Scraper.state or freshState()
  Scraper.polling.initializationQueue = {
    "radar",
    "fleetradar",
    "battlegroup",
    "squadron status",
  }
  Scraper.polling.initializationReason = reason or "initial space-state discovery"
  Scraper.polling.initializationSpaceProbe = allowSpaceProbe == true
    and Scraper.state.metadata.inSpace ~= true
  Scraper.polling.lastFleetRadarAt = 0
  Scraper.polling.lastBattlegroupAt = 0
  Scraper.polling.lastSquadronAt = 0
  Scraper.combat.lastRadarAt = 0
  Scraper.state.metadata.initializationPending = true
  Scraper.state.metadata.initializationReason = Scraper.polling.initializationReason
  if Scraper.polling.enabled and not Scraper.polling.paused and scheduleNextPoll then
    scheduleNextPoll(0)
  end
  return true
end

function Scraper.setInSpace(inSpace, reason)
  Scraper.state = Scraper.state or freshState()
  inSpace = inSpace == true
  local changed = Scraper.state.metadata.inSpace ~= inSpace
  Scraper.state.metadata.inSpace = inSpace
  Scraper.state.metadata.spaceStateReason = reason
  Scraper.state.metadata.spaceStateChangedAt = os.time()

  if not inSpace then
    if Scraper.polling.enabled then
      Scraper.polling.resumeWhenInSpace = true
    end
    Scraper.polling.enabled = false
    abandonCapture(reason or "not in space")
    cancelPollTimer()
    cancelSensorTickWait(true)
    Scraper.polling.sensorTickBypassPending = false
    Scraper.state.entities = {}
    Scraper.scanState = {}
    Scraper.polling.hydrationQueue = {}
    clearInitialStateSweep()
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
    Scraper.state.metadata.combatTargets = {}
    Scraper.state.metadata.combatEvent = nil
    Scraper.state.metadata.combatEvents = nil
    Scraper.state.metadata.shipDestructionEvents = nil
    Scraper.destruction = { nextEventId = 0, destroyedNames = {} }
    Scraper.combat.targetName = nil
    Scraper.combat.pendingTargetName = nil
    Scraper.combat.pendingTargetContext = nil
    Scraper.combat.pendingTargetPreviousName = nil
    safeKill("killTimer", Scraper.combat.targetReconcileTimerId)
    Scraper.combat.targetReconcileTimerId = nil
    Scraper.combat.lastActivityAt = 0
    Scraper.combat.lastRadarAt = 0
    Scraper.combat.projectileRadarPending = false
    Scraper.polling.lastFleetRadarAt = 0
    Scraper.polling.lastBattlegroupAt = 0
    Scraper.polling.lastSquadronAt = 0
    Scraper.polling.radarRefreshPending = false
    Scraper.polling.radarRefreshReason = nil
    Scraper.polling.radarRefreshGeneration = 0
    Scraper.polling.radarRefreshIssuedGeneration = 0
    Scraper.polling.fleetRadarRefreshPending = false
    Scraper.polling.fleetRadarRefreshIssuedGeneration = 0
    Scraper.state.metadata.radarRefreshPending = false
    Scraper.state.metadata.radarRefreshReason = nil
    Scraper.state.metadata.fleetRadarRefreshPending = false
    Scraper.state.metadata.fleetRadarRefreshReason = nil
    Scraper.state.metadata.formations = {}
    Scraper.state.metadata.fleet = nil
    Scraper.state.metadata.tacticalViews = {}
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
  else
    if Scraper.polling.resumeWhenInSpace then
      Scraper.polling.enabled = true
      Scraper.polling.resumeWhenInSpace = false
    end
    if Scraper.polling.enabled and scheduleNextPoll then
      scheduleNextPoll(0.25)
    end
  end

  if Scraper.state.metadata.polling then
    Scraper.state.metadata.polling.enabled = Scraper.polling.enabled
    Scraper.state.metadata.polling.active = Scraper.polling.enabled
      and not Scraper.polling.paused
      and inSpace
  end

  if not changed then
    return true
  end

  if Scraper.proxy and type(Scraper.proxy.publishSpaceState) == "function" then
    local sent, sendError = Scraper.proxy.publishSpaceState(inSpace, reason)
    if not sent then
      diagnostic("warn", "could not notify the bridge about space state: " .. tostring(sendError))
    end
  end

  if not inSpace and Scraper.proxy and type(Scraper.proxy.publishSnapshot) == "function" then
    local sent, sendError = Scraper.publish()
    if not sent then
      diagnostic(
        "warn",
        "could not clear the bridge snapshot after landing: " .. tostring(sendError)
      )
    end
  end

  diagnostic(
    "info",
    inSpace and ("space scraping enabled: " .. tostring(reason or "ship launched"))
      or ("space scraping disabled: " .. tostring(reason or "ship is landed"))
  )
  if inSpace and changed and ensureShieldsOn then
    tempTimer(0.1, ensureShieldsOn)
  end
  return true
end

function Scraper.finishCapture(reason)
  local capture = Scraper.active
  if not capture then
    return nil, "no capture is active"
  end
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

  if capture.foreignResponse then
    return nil,
      "ignored in-flight "
        .. tostring(capture.foreignResponse)
        .. " response while capturing "
        .. tostring(capture.parserCommand)
  end

  local commandFailure
  for _, capturedLine in ipairs(capture.lines) do
    local lower = capturedLine:lower()
    if lower:find("too far away to scan", 1, true) then
      commandFailure = "Target is outside sensor range."
      break
    elseif lower:find("must be at a nav computer", 1, true) then
      commandFailure = "You must be at a navigation computer to calculate jumps."
      break
    elseif lower:find("finished its current maneuver", 1, true) then
      commandFailure = "Please wait until the ship has finished its current maneuver."
      break
    end
  end
  if commandFailure then
    if capture.targetReconciliation and reconcileTargetFromStatus then
      reconcileTargetFromStatus(nil, commandFailure)
    end
    if
      capture.intentId
      and Scraper.proxy
      and type(Scraper.proxy.publishIntentAck) == "function"
    then
      Scraper.proxy.publishIntentAck(capture.intentId, "rejected", commandFailure)
    end
    return nil, commandFailure
  end

  local parseStarted = Scraper.profiler.enabled and os.clock() or nil
  local parsed, parseError = Scraper.proxy.parseGameOutput(capture.parserCommand, capture.lines)
  profileTiming("parse", parseStarted)
  if not parsed then
    profileCount("parseFailures")
    if capture.spaceProbe then
      Scraper.setInSpace(false, "startup radar did not return space data")
    elseif capture.initializationSweep then
      clearInitialStateSweep()
    end
    if
      capture.intentId
      and Scraper.proxy
      and type(Scraper.proxy.publishIntentAck) == "function"
    then
      Scraper.proxy.publishIntentAck(
        capture.intentId,
        "rejected",
        capture.spaceProbe and "Radar did not confirm that the player is in space."
          or "The ship scan returned no usable telemetry."
      )
    end
    local emptyProjectilePoll = capture.polled == true
      and trim(capture.sentCommand):lower() == "radar projectiles"
    if emptyProjectilePoll then
      Scraper.state.metadata.lastEmptyProjectileRadarAt = os.time()
    elseif not capture.polled then
      diagnostic(
        "warn",
        "could not parse "
          .. capture.sentCommand
          .. " output: "
          .. tostring(parseError)
          .. "; run lotjHolocron3D.scraper.showLastCapture()"
      )
    end
    if capture.targetReconciliation and reconcileTargetFromStatus then
      reconcileTargetFromStatus(nil, parseError)
    end
    return nil, parseError
  end

  if
    not capture.remoteViewMemberId
    and (not Scraper.state or Scraper.state.metadata.inSpace ~= true)
  then
    Scraper.setInSpace(true, capture.sentCommand .. " returned space data")
  end

  local applyStarted = Scraper.profiler.enabled and os.clock() or nil
  local applied, applyError
  if capture.remoteViewMemberId then
    applied, applyError = applyRemoteRadarResult(parsed, capture)
  else
    applied, applyError = Scraper.applyResult(parsed, capture.sentCommand, capture)
  end
  profileTiming("apply", applyStarted)
  if not applied then
    profileCount("applyFailures")
    if capture.initializationSweep then
      clearInitialStateSweep()
    end
    diagnostic(
      "error",
      "could not merge " .. capture.sentCommand .. " output: " .. tostring(applyError)
    )
    if
      capture.intentId
      and Scraper.proxy
      and type(Scraper.proxy.publishIntentAck) == "function"
    then
      Scraper.proxy.publishIntentAck(
        capture.intentId,
        "rejected",
        "Ship telemetry rejected: " .. tostring(applyError)
      )
    end
    if capture.targetReconciliation and reconcileTargetFromStatus then
      reconcileTargetFromStatus(nil, applyError)
    end
    return nil, applyError
  end
  if capture.targetReconciliation and reconcileTargetFromStatus then
    reconcileTargetFromStatus(parsed)
  end
  if capture.spaceProbe and queueObserverHydration then
    queueObserverHydration()
  end
  local continueInitialization = false
  if capture.initializationSweep then
    local queue = Scraper.polling.initializationQueue or {}
    if normalizedCommand(queue[1]) == normalizedCommand(capture.sentCommand) then
      table.remove(queue, 1)
    end
    Scraper.polling.initializationQueue = queue
    Scraper.polling.initializationSpaceProbe = false
    continueInitialization = #queue > 0
    Scraper.state.metadata.initializationPending = continueInitialization
    if not continueInitialization then
      Scraper.polling.initializationReason = nil
      Scraper.state.metadata.initializationReason = nil
    end
  end
  Scraper.state.metadata.lastCapturePolled = capture.polled == true
  if
    parsed.source == "status"
    and trim(capture.sentCommand):lower() == "status"
    and handleShieldStatus
  then
    handleShieldStatus(parsed)
  end
  if capture.initializationSweep and scheduleNextPoll then
    scheduleNextPoll(continueInitialization and 0 or Scraper.polling.commandGapSeconds)
  end

  local published, publishError = Scraper.publish()
  if not published then
    diagnostic(
      "warn",
      "parsed "
        .. capture.sentCommand
        .. " but could not publish its snapshot: "
        .. tostring(publishError)
    )
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

  if capture.intentId and Scraper.proxy and type(Scraper.proxy.publishIntentAck) == "function" then
    Scraper.proxy.publishIntentAck(
      capture.intentId,
      "completed",
      capture.sentCommand .. " telemetry updated"
    )
  end

  if not capture.polled then
    diagnostic(
      "info",
      "parsed "
        .. capture.sentCommand
        .. " ("
        .. tostring(parsed.recognizedLines or 0)
        .. " data lines)"
    )
  end
  return parsed
end

function Scraper.captureLine(value)
  local profiling = Scraper.profiler.enabled == true
  local profileStarted = profiling and os.clock() or nil
  if profiling then
    profileCount("lineChecks")
  end
  local capture = Scraper.active
  if not capture then
    if profiling then
      profileTiming("line", profileStarted)
    end
    return false
  end

  value = tostring(value or ""):gsub("\r", "")
  if not captureOwnsLine(capture, value) then
    if profiling then
      profileTiming("line", profileStarted)
    end
    return false
  end
  if profiling then
    profileCount("capturedLines")
    profileCount("capturedBytes", #value + 1)
  end
  if capture.polled and type(deleteLine) == "function" then
    pcall(deleteLine)
    if profiling then
      profileCount("deletedLines")
    end
  end
  capture.bytes = capture.bytes + #value + 1
  if #capture.lines >= Scraper.MAX_CAPTURE_LINES or capture.bytes > Scraper.MAX_CAPTURE_BYTES then
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
  if
    capture.parserCommand == "radar"
    and not capture.polled
    and value:lower():match("^%s*your%s+coordinates%s*:")
  then
    Scraper.finishCapture("radar terminator")
  end
  if profiling then
    profileTiming("line", profileStarted)
  end
  return true
end

local function refreshLotjUiCompatibility()
  if not Scraper.state or not Scraper.state.metadata then
    return false
  end
  local detected = type(_G.lotj) == "table"
    and type(_G.lotj.chat) == "table"
    and type(_G.lotj.systemMap) == "table"
  local compatibility = Scraper.state.metadata.mudletCompatibility or {}
  local newlyDetected = detected and compatibility.lotjUiDetected ~= true
  compatibility.lotjUiDetected = detected or compatibility.lotjUiDetected == true
  Scraper.state.metadata.mudletCompatibility = compatibility
  if newlyDetected then
    diagnostic(
      "info",
      "official LotJ Mudlet UI detected; shared chat and radar compatibility enabled"
    )
  end
  return compatibility.lotjUiDetected == true
end

function Scraper.startCapture(parserCommand, sentCommand, options)
  if
    Scraper.state
    and Scraper.state.metadata.inSpace == false
    and not (options and options.spaceProbe == true)
  then
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
    remoteViewMemberId = options and options.remoteViewMemberId or nil,
    remoteViewMemberName = options and options.remoteViewMemberName or nil,
    remoteViewMemberSlot = options and options.remoteViewMemberSlot or nil,
    remoteViewMember = options and copyTable(options.remoteViewMember) or nil,
    targetReconciliation = options and options.targetReconciliation == true,
    initializationSweep = options and options.initializationSweep == true,
    sensorTickSource = options and options.sensorTickSource or nil,
    sensorTickSequence = options and options.sensorTickSequence or nil,
    sensorSyncWaitSeconds = options and options.sensorSyncWaitSeconds or nil,
    profileStarted = Scraper.profiler.enabled and os.clock() or nil,
  }
  Scraper.active = capture
  if
    normalizedCommand(capture.sentCommand) == "radar"
    and Scraper.polling.radarRefreshPending == true
  then
    Scraper.polling.radarRefreshIssuedGeneration = tonumber(Scraper.polling.radarRefreshGeneration)
      or 0
  end
  if
    normalizedCommand(capture.sentCommand) == "fleetradar"
    and Scraper.polling.fleetRadarRefreshPending == true
  then
    Scraper.polling.fleetRadarRefreshIssuedGeneration = tonumber(
      Scraper.polling.radarRefreshGeneration
    ) or 0
  end
  profileCount("capturesStarted")
  if capture.polled then
    profileCount("polledCaptures")
  else
    profileCount("manualCaptures")
  end
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
  if normalized == "radar" or normalized == "radar projectiles" then
    return "radar"
  end
  if normalized == "info" or normalized:match("^info .+") then
    return "info"
  end
  if normalized == "status" or normalized:match("^status .+") then
    return "status"
  end
  if normalized == "fleetradar" or normalized == "fleetradar targets" then
    return "fleetradar"
  end
  if normalized == "battlegroup" or normalized == "bg" then
    return "battlegroup"
  end
  if normalized == "squadron status" then
    return "squadron status"
  end
  if normalized == "navstat" then
    return "navstat"
  end
  if normalized == "calc" or normalized == "calculate" then
    return "calculate"
  end

  local first, rest = normalized:match("^(%S+)%s*(.-)$")
  if first == "prox" or first == "proximity" then
    local mode
    for word in rest:gmatch("%S+") do
      if word == "velocity" or word == "speed" then
        mode = "velocity"
      elseif word ~= "ships" and word ~= "projectiles" and not word:match("^%d+$") then
        return nil
      end
    end
    return mode and "prox velocity" or "prox"
  end
  return nil
end

local function hyperspaceMetadata()
  Scraper.state = Scraper.state or freshState()
  Scraper.state.metadata.hyperspace = Scraper.state.metadata.hyperspace or { phase = "idle" }
  return Scraper.state.metadata.hyperspace
end

local function publishHyperspace(phase, extra)
  local metadata = hyperspaceMetadata()
  metadata.phase = phase
  metadata.observedAt = os.time()
  for key, value in pairs(extra or {}) do
    metadata[key] = value
  end
  Scraper.hyperspace.phase = phase
  return Scraper.publish()
end

local function hyperspaceTransitActive()
  local phase = Scraper.hyperspace and Scraper.hyperspace.phase
  return phase == "engaging"
    or phase == "hyperspace"
    or phase == "reentry" and Scraper.hyperspace.realspaceLurchObserved ~= true
end

local function publishShipJump(shipName)
  shipName = trim(shipName)
  if shipName == "" then
    return false
  end
  Scraper.hyperspace.nextJumpEventId = (Scraper.hyperspace.nextJumpEventId or 0) + 1
  local events = Scraper.state.metadata.shipJumpEvents or {}
  table.insert(events, {
    id = Scraper.hyperspace.nextJumpEventId,
    shipName = shipName,
    phase = "departure",
    observedAt = os.time(),
  })
  while #events > 16 do
    table.remove(events, 1)
  end
  Scraper.state.metadata.shipJumpEvents = events
  return Scraper.publish()
end

local function removeNamedEntityFromList(entities, shipName)
  local wanted = trim(shipName):lower()
  for index = #(entities or {}), 1, -1 do
    if trim(entities[index].name):lower() == wanted then
      table.remove(entities, index)
    end
  end
end

function Scraper.handleShipDestruction(text)
  local shipName =
    trim(text):match("^.-'([^']+)'%s+explodes%s+in%s+a%s+blinding%s+flash%s+of%s+light!$")
  if not shipName then
    return false
  end
  local destroyed, destroyedKey = findEntity({ name = shipName })
  local observer = Scraper.state and Scraper.state.observer or {}
  local isObserver = trim(observer.name):lower() == shipName:lower()
  Scraper.destruction.nextEventId = (Scraper.destruction.nextEventId or 0) + 1
  Scraper.destruction.destroyedNames[shipName:lower()] = os.time()
  local event = {
    id = Scraper.destruction.nextEventId,
    shipName = shipName,
    phase = "destroyed",
    x = destroyed and destroyed.x or isObserver and observer.x or nil,
    y = destroyed and destroyed.y or isObserver and observer.y or nil,
    z = destroyed and destroyed.z or isObserver and observer.z or nil,
    observedAt = os.time(),
  }
  local metadata = Scraper.state.metadata
  local events = metadata.shipDestructionEvents or {}
  table.insert(events, event)
  while #events > 16 do
    table.remove(events, 1)
  end
  metadata.shipDestructionEvents = events

  if destroyedKey then
    Scraper.state.entities[destroyedKey] = nil
  end
  for _, view in pairs(metadata.tacticalViews or {}) do
    if type(view) == "table" then
      removeNamedEntityFromList(view.entities, shipName)
    end
  end
  for key, target in pairs(metadata.combatTargets or {}) do
    if type(target) == "table" and trim(target.targetName):lower() == shipName:lower() then
      metadata.combatTargets[key] = nil
    end
  end
  if trim(metadata.combatTarget):lower() == shipName:lower() then
    metadata.combatTarget = nil
    Scraper.combat.targetName = nil
    observer.target = nil
  end
  return Scraper.publish()
end

local function observerName()
  return trim(Scraper.state and Scraper.state.observer and Scraper.state.observer.name)
end

local function localJumpExpected()
  return Scraper.hyperspace.initiatedByHolocron == true
      and Scraper.hyperspace.routeIncludesLocalShip ~= false
    or tonumber(Scraper.hyperspace.pendingLocalJumpUntil or 0) >= os.time()
end

local function currentFleetCommandTargetsRemoteShip()
  local memberName = trim(Scraper.fleetCommand and Scraper.fleetCommand.currentMemberName)
  local localName = observerName()
  return memberName ~= "" and localName ~= "" and memberName:lower() ~= localName:lower()
end

local function queueFleetJump(selector)
  local fleet = Scraper.state and Scraper.state.metadata and Scraper.state.metadata.fleet
  if type(fleet) ~= "table" then
    return
  end
  local wanted = trim(selector):lower()
  local localName = observerName()
  local queued = Scraper.hyperspace.fleetJumpQueue or {}
  for index = #queued, 1, -1 do
    if os.time() - tonumber(queued[index].queuedAt or 0) > 30 then
      table.remove(queued, index)
    end
  end
  for _, member in ipairs(fleet.members or {}) do
    local memberName = trim(member.name)
    local include = wanted == "all"
      or wanted == "wings" and not member.leader
      or tonumber(wanted) and tonumber(member.slot) == tonumber(wanted)
      or memberName:lower() == wanted
    if include and memberName ~= "" then
      local alreadyQueued = false
      for _, candidate in ipairs(queued) do
        if trim(candidate.name):lower() == memberName:lower() then
          candidate.queuedAt = os.time()
          alreadyQueued = true
          break
        end
      end
      if not alreadyQueued then
        table.insert(queued, { name = memberName, queuedAt = os.time() })
      end
      if memberName:lower() == localName:lower() then
        Scraper.hyperspace.pendingLocalJumpUntil = os.time() + 30
      end
    end
  end
  Scraper.hyperspace.fleetJumpQueue = queued
end

local function consumeFleetJump(memberName)
  local queue = Scraper.hyperspace.fleetJumpQueue or {}
  local wanted = trim(memberName):lower()
  for index = #queue, 1, -1 do
    if os.time() - tonumber(queue[index].queuedAt or 0) > 30 then
      table.remove(queue, index)
    end
  end
  if #queue == 0 then
    return nil
  end
  local index = 1
  if wanted ~= "" then
    for candidateIndex, candidate in ipairs(queue) do
      if trim(candidate.name):lower() == wanted then
        index = candidateIndex
        break
      end
    end
  end
  local candidate = table.remove(queue, index)
  Scraper.hyperspace.fleetJumpQueue = queue
  return candidate and candidate.name or nil
end

local function recordOutgoingHyperspaceCommand(command)
  local normalized = trim(command):lower():gsub("%s+", " ")
  if normalized == "hyper" or normalized == "hyp" then
    Scraper.hyperspace.pendingLocalJumpUntil = os.time() + 30
    return
  end
  local selector = normalized:match("^battlegroup nav (.-) hyp$")
    or normalized:match("^battlegroup nav (.-) hyper$")
  if selector then
    queueFleetJump(selector)
  end
end

function Scraper.disarmAutomation(reason)
  Scraper.stopPolling()
  safeKill("killTimer", Scraper.shields.damageTimerId)
  safeKill("killTimer", Scraper.shields.actionTimerId)
  safeKill("killTimer", Scraper.autotrack.timeoutTimerId)
  safeKill("killTimer", Scraper.hyperspace.statusTimerId)
  Scraper.hyperspace.statusTimerId = nil
  Scraper.shields.recharging = false
  Scraper.shields.awaiting = false
  Scraper.shields.statusPending = false
  Scraper.shields.manualIntentId = nil
  Scraper.autotrack.pending = false
  Scraper.autotrack.intentId = nil
  Scraper.hyperspace.activeIntentId = nil
  Scraper.hyperspace.initiatedByHolocron = false
  Scraper.hyperspace.routeIncludesLocalShip = nil
  Scraper.hyperspace.routeUsesLocalCommand = nil
  if Scraper.active and Scraper.active.polled then
    abandonCapture(reason or "automation disarmed")
  end
  if Scraper.state then
    Scraper.state.metadata.automationArmed = false
    Scraper.state.metadata.automationDisarmedReason = reason or "Electron disconnected"
    Scraper.publish()
  end
  return true
end

function Scraper.refreshAutomationLease(seconds)
  safeKill("killTimer", Scraper.automationLeaseTimerId)
  if Scraper.state then
    Scraper.state.metadata.automationArmed = true
  end
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

local function cancelHyperspaceCalculationEstimate()
  safeKill("killTimer", Scraper.hyperspace.statusTimerId)
  Scraper.hyperspace.statusTimerId = nil
end

local function scheduleHyperspaceCalculationEstimate(mode)
  cancelHyperspaceCalculationEstimate()
  local seconds = mode == "local" and Scraper.REMOTE_LOCAL_HYPERSPACE_CALC_SECONDS
    or Scraper.REMOTE_GALACTIC_HYPERSPACE_CALC_SECONDS
  local metadata = hyperspaceMetadata()
  metadata.calculationEstimated = true
  metadata.estimatedReadyAt = os.time() + seconds
  metadata.remainingSeconds = seconds
  publishHyperspace("calculating")
  Scraper.hyperspace.statusTimerId = tempTimer(seconds, function()
    Scraper.hyperspace.statusTimerId = nil
    if
      Scraper.hyperspace.phase ~= "calculating"
      or not Scraper.hyperspace.initiatedByHolocron
      or Scraper.hyperspace.routeUsesLocalCommand ~= false
    then
      return
    end
    publishHyperspace("ready", {
      calculationEstimated = true,
      estimatedReadyAt = os.time(),
      readyAt = os.time(),
      remainingSeconds = 0,
      insufficientFuel = nil,
      waitingForCalculation = false,
    })
    finishHyperspaceIntent("completed", "Remote hyperspace calculation estimate elapsed")
  end)
end

local function refreshRemoteHyperspaceCalculationEstimate()
  if
    Scraper.hyperspace.phase ~= "calculating"
    or not Scraper.hyperspace.initiatedByHolocron
    or Scraper.hyperspace.routeUsesLocalCommand ~= false
  then
    return false
  end
  local route = hyperspaceMetadata().route or {}
  scheduleHyperspaceCalculationEstimate(trim(route.mode):lower())
  return true
end

local function completeHyperspaceAbort(reason)
  cancelHyperspaceCalculationEstimate()
  local metadata = hyperspaceMetadata()
  metadata.remainingSeconds = nil
  metadata.route = nil
  metadata.insufficientFuel = nil
  metadata.error = nil
  metadata.aborted = true
  metadata.calculationEstimated = false
  metadata.estimatedReadyAt = nil
  Scraper.hyperspace.initiatedByHolocron = false
  Scraper.hyperspace.routeIncludesLocalShip = nil
  Scraper.hyperspace.routeUsesLocalCommand = nil
  Scraper.hyperspace.acknowledgedFuelRisk = false
  Scraper.hyperspace.pendingLocalJumpUntil = 0
  Scraper.hyperspace.hyperjumpCompleteObserved = false
  Scraper.hyperspace.realspaceLurchObserved = false
  Scraper.hyperspace.awaitingArrivalRadar = false
  Scraper.hyperspace.reentrySystemName = nil
  finishActiveHyperspaceSample("aborted", "calculation_stopped")
  publishHyperspace("idle")
  finishHyperspaceIntent("completed", reason or "Hyperspace calculation aborted")
end

local function queueImmediateWorldRefresh(reason, bypassSensorTick)
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false
  end
  local refreshReason = trim(reason)
  if refreshReason == "" then
    refreshReason = "hyperspace reentry"
  end
  Scraper.polling.radarRefreshGeneration = (tonumber(Scraper.polling.radarRefreshGeneration) or 0)
    + 1
  Scraper.polling.radarRefreshPending = true
  Scraper.polling.fleetRadarRefreshPending = true
  Scraper.polling.sensorTickBypassPending = bypassSensorTick == true
  Scraper.polling.radarRefreshReason = refreshReason
  Scraper.state.metadata.radarRefreshPending = true
  Scraper.state.metadata.radarRefreshReason = refreshReason
  Scraper.state.metadata.fleetRadarRefreshPending = true
  Scraper.state.metadata.fleetRadarRefreshReason = refreshReason
  Scraper.combat.lastRadarAt = 0
  Scraper.polling.lastFleetRadarAt = 0
  if Scraper.polling.enabled and scheduleNextPoll then
    scheduleNextPoll(0.1)
  end
  return true
end

completeOwnHyperspaceArrival = function(reason)
  if Scraper.hyperspace.phase ~= "reentry" then
    return false
  end
  markHyperspaceSample("complete")
  local metadata = hyperspaceMetadata()
  metadata.phase = "arrived"
  metadata.observedAt = os.time()
  metadata.arrivedAt = os.time()
  metadata.arrivalConfirmedBy = reason or "fresh radar"
  metadata.awaitingArrivalRadar = false
  Scraper.hyperspace.phase = "arrived"
  Scraper.hyperspace.initiatedByHolocron = false
  Scraper.hyperspace.routeIncludesLocalShip = nil
  Scraper.hyperspace.routeUsesLocalCommand = nil
  Scraper.hyperspace.pendingLocalJumpUntil = 0
  Scraper.hyperspace.hyperjumpCompleteObserved = false
  Scraper.hyperspace.realspaceLurchObserved = false
  Scraper.hyperspace.awaitingArrivalRadar = false
  Scraper.fleetCommand.currentMemberName = nil
  Scraper.hyperspace.awaitingReentrySystem = false
  safeKill("killTimer", Scraper.hyperspace.reentryRefreshTimerId)
  Scraper.hyperspace.reentryRefreshTimerId = nil
  return true
end

function Scraper.handleReentrySystemLine(text)
  if Scraper.hyperspace.phase ~= "reentry" then
    return false
  end
  local systemName = trim(text)
  local isSystemHeading = systemName:match("^[%w][%w%s'%-]+ [Ss]ector$")
    or systemName:match("^[%w][%w%s'%-]+ [Ss]ystem$")
  if not isSystemHeading then
    return false
  end
  Scraper.hyperspace.reentrySystemName = systemName
  local metadata = hyperspaceMetadata()
  metadata.reentrySystemName = systemName
  metadata.reentrySystemObservedAt = os.time()
  return Scraper.publish()
end

function Scraper.handleHyperspaceLine(text)
  local value = trim(text)
  local lower = value:lower()
  if value == "Hyperspace course locked. Running final jump checks..." then
    publishHyperspace("calculating", { error = nil, waitingForCalculation = false })
    refreshRemoteHyperspaceCalculationEstimate()
  elseif lower:find("using your skill with navigation", 1, true) then
    markHyperspaceSample("navigator")
    publishHyperspace("calculating", { navigatorApplied = true })
    refreshRemoteHyperspaceCalculationEstimate()
  elseif
    lower:match("^jump requires [%d,]+ units of fuel")
    and lower:find("it will consume", 1, true)
  then
    local required = value:match("[Jj]ump requires%s+([%d,]+)%s+units")
    local percent = value:match("consume%s+([%d,]+)%%")
    publishHyperspace("calculating", {
      fuelRequired = required and tonumber((required:gsub(",", ""))) or nil,
      fuelPercent = percent and tonumber((percent:gsub(",", ""))) or nil,
    })
    refreshRemoteHyperspaceCalculationEstimate()
  elseif value == "Checking hyperspace course integrity. Please wait." then
    refreshRemoteHyperspaceCalculationEstimate()
  elseif lower == "please wait. the navigation computer is calculating the route." then
    -- An estimated remote route can be offered before every recipient has
    -- finished calculating. Put the workflow back into its authoritative
    -- waiting state and keep the plotted route available for a later retry.
    emitHyperspaceSample("engage_rejected", Scraper.hyperspace.activeSample, {
      reason = "calculation_pending",
    })
    publishHyperspace("calculating", {
      error = nil,
      waitingForCalculation = true,
    })
    finishHyperspaceIntent("rejected", value)
    refreshRemoteHyperspaceCalculationEstimate()
  elseif value == "Warning - Not enough fuel to complete the jump!" then
    cancelHyperspaceCalculationEstimate()
    publishHyperspace("fuel_warning", { insufficientFuel = true })
  elseif lower:match("^jump requires [%d,]+ units of fuel%. you only have [%d,]+") then
    cancelHyperspaceCalculationEstimate()
    local required, available = value:match(
      "[Jj]ump requires%s+([%d,]+)%s+units%s+of%s+fuel%.%s+[Yy]ou%s+only%s+have%s+([%d,]+)"
    )
    local extra = { insufficientFuel = true }
    if required then
      extra.fuelRequired = tonumber((required:gsub(",", "")))
    end
    if available then
      extra.fuelAvailable = tonumber((available:gsub(",", "")))
    end
    publishHyperspace("fuel_warning", extra)
    if
      not Scraper.polling.paused
      and Scraper.hyperspace.initiatedByHolocron
      and not Scraper.hyperspace.acknowledgedFuelRisk
    then
      Scraper.polling.dispatching = true
      pcall(send, "calc stop", false)
      Scraper.polling.dispatching = false
      extra.autoAborted = true
      publishHyperspace("fuel_warning", extra)
    end
  elseif value == "[Status]: Hyperspace calculations have been completed." then
    cancelHyperspaceCalculationEstimate()
    local metadata = hyperspaceMetadata()
    metadata.calculationEstimated = false
    metadata.estimatedReadyAt = nil
    publishHyperspace("ready", {
      calculationEstimated = false,
      remainingSeconds = 0,
      insufficientFuel = nil,
      readyAt = os.time(),
      waitingForCalculation = false,
    })
    markHyperspaceSample("ready")
    finishHyperspaceIntent("completed", value)
  elseif value == "[ALERT]: Aborting Hyperspace calculation. Terminal reset." then
    if hyperspaceMetadata().insufficientFuel then
      -- Keep the fuel-warning route available for the explicit
      -- "calculate anyway" decision after the automatic safety abort.
      local metadata = hyperspaceMetadata()
      metadata.remainingSeconds = nil
      metadata.aborted = true
      publishHyperspace("fuel_warning")
      Scraper.hyperspace.initiatedByHolocron = false
      finishHyperspaceIntent("completed", value)
    else
      completeHyperspaceAbort(value)
    end
  elseif lower:find("jump coordinates too close to stellar object", 1, true) then
    cancelHyperspaceCalculationEstimate()
    finishActiveHyperspaceSample("failed", "stellar_clearance")
    publishHyperspace("failed", { error = value })
    finishHyperspaceIntent("rejected", value)
  elseif lower:match("^you are too close to .+ to make the jump to lightspeed!$") then
    cancelHyperspaceCalculationEstimate()
    publishHyperspace("ready", { error = value })
    finishHyperspaceIntent("rejected", value)
  elseif lower == "you must be at a nav computer to calculate jumps." then
    -- A local navigation refresh can produce this response while a remote
    -- battlegroup calculation is in flight. It does not invalidate routes
    -- issued through `battlegroup nav`, whose recipients own their computers.
    if Scraper.hyperspace.routeUsesLocalCommand ~= false then
      cancelHyperspaceCalculationEstimate()
      Scraper.hyperspace.initiatedByHolocron = false
      finishActiveHyperspaceSample("failed", "nav_computer_required")
      publishHyperspace("failed", { error = value })
      finishHyperspaceIntent("rejected", value)
    end
  elseif
    lower == "you aren't in the pilots seat." or lower == "you aren't in the pilot's seat."
  then
    -- Keep the calculated route available so the player can take the pilot's
    -- seat and retry, but terminate the current engage intent as a rejection.
    Scraper.hyperspace.pendingLocalJumpUntil = 0
    emitHyperspaceSample("engage_rejected", Scraper.hyperspace.activeSample, {
      reason = "pilot_seat_required",
    })
    publishHyperspace("ready", { error = value })
    finishHyperspaceIntent("rejected", value)
  elseif value == "You push forward the hyperspeed lever." then
    -- A battlegroup `hyper` command repeats this line once per ship. Once the
    -- observer is in hyperspace, a wing's later copy must not move the local
    -- state machine backwards from `hyperspace` to `engaging`.
    if
      localJumpExpected()
      and not currentFleetCommandTargetsRemoteShip()
      and Scraper.hyperspace.phase ~= "hyperspace"
      and Scraper.hyperspace.phase ~= "reentry"
    then
      publishHyperspace("engaging", { error = nil })
    end
  elseif value == "The stars become streaks of light as you enter hyperspace." then
    local memberName = Scraper.fleetCommand.currentMemberName
    local jumpingShip = consumeFleetJump(memberName)
    if jumpingShip and trim(jumpingShip):lower() ~= observerName():lower() then
      publishShipJump(jumpingShip)
    elseif localJumpExpected() then
      markHyperspaceSample("departure")
      publishHyperspace("hyperspace")
      -- Stop any timer left over from realspace. Captures that finish after
      -- departure also cannot schedule another poll while transit is active.
      cancelPollTimer()
      cancelSensorTickWait(true)
      Scraper.polling.sensorTickBypassPending = false
      Scraper.hyperspace.awaitingReentrySystem = false
      safeKill("killTimer", Scraper.hyperspace.reentryRefreshTimerId)
      Scraper.hyperspace.reentryRefreshTimerId = nil
      Scraper.hyperspace.pendingLocalJumpUntil = 0
      finishHyperspaceIntent("completed", value)
    end
    Scraper.fleetCommand.currentMemberName = nil
  elseif value == "Destination reached. Initiating realspace reentry..." then
    if
      Scraper.hyperspace.phase == "hyperspace"
      or Scraper.hyperspace.phase == "engaging" and localJumpExpected()
    then
      markHyperspaceSample("destination_reached")
      publishHyperspace("reentry")
      cancelPollTimer()
    end
  elseif value == "Hyperjump complete." then
    if
      Scraper.hyperspace.phase == "hyperspace"
      or Scraper.hyperspace.phase == "reentry"
      or Scraper.hyperspace.phase == "engaging" and localJumpExpected()
    then
      Scraper.hyperspace.hyperjumpCompleteObserved = true
      Scraper.hyperspace.awaitingArrivalRadar = true
      publishHyperspace("reentry", {
        hyperjumpCompleteObservedAt = os.time(),
        awaitingArrivalRadar = true,
      })
      cancelPollTimer()
      cancelSensorTickWait(true)
    end
  elseif value == "The ship lurches slightly as it comes out of hyperspace." then
    if
      Scraper.hyperspace.phase == "hyperspace"
      or Scraper.hyperspace.phase == "reentry"
      or Scraper.hyperspace.phase == "engaging" and localJumpExpected()
    then
      Scraper.hyperspace.realspaceLurchObserved = true
      Scraper.hyperspace.awaitingArrivalRadar = true
      markHyperspaceSample("complete")
      cancelPollTimer()
      cancelSensorTickWait(true)
      queueImmediateWorldRefresh("own ship realspace lurch", true)
      publishHyperspace("reentry", {
        realspaceLurchObservedAt = os.time(),
        awaitingArrivalRadar = true,
      })
    end
  else
    local seconds =
      value:match("^[Cc]alculating%s+[Hh]yperspace%s+[Tt]rajectory:%s*(%d+)%s+seconds%s+remaining")
    if not seconds then
      return false
    end
    publishHyperspace("calculating", { remainingSeconds = tonumber(seconds) })
  end
  return true
end

function Scraper.publishGalaxyCatalog()
  if not Scraper.proxy or type(Scraper.proxy.sendMessage) ~= "function" then
    return false
  end
  local systems = _G.gmcp and _G.gmcp.Galaxy and _G.gmcp.Galaxy.Systems or {}
  if type(systems) ~= "table" then
    systems = {}
  end
  if
    next(systems) == nil
    and type(_G.lotj) == "table"
    and type(_G.lotj.galaxyMap) == "table"
    and type(_G.lotj.galaxyMap.systems) == "table"
  then
    systems = _G.lotj.galaxyMap.systems
  end
  local shipSystem = _G.gmcp and _G.gmcp.Ship and _G.gmcp.Ship.System or nil
  local custom = type(_G.lotj) == "table"
      and type(_G.lotj.galaxyMap) == "table"
      and _G.lotj.galaxyMap.recorded
    or {}
  local sent = Scraper.proxy.sendMessage({
    type = "galaxy_catalog",
    observedAt = os.time(),
    systems = copyTable(systems),
    customSystems = copyTable(custom),
    shipSystem = copyTable(shipSystem),
  })
  return sent == true
end

local function validateSystemCoordinate(value)
  value = tonumber(value)
  if not value or value ~= value or value < -50000 or value > 50000 then
    return nil
  end
  return value >= 0 and math.floor(value + 0.5) or math.ceil(value - 0.5)
end

local function formationMemberKey(member)
  local name = trim(member and member.name):lower()
  if name ~= "" then
    return "name:" .. name
  end
  return "id:" .. trim(member and member.id):lower()
end

local function findFormationMember(fleet, wantedName, wantedSlot, wantedId)
  wantedName = trim(wantedName):lower()
  wantedId = trim(wantedId):lower()
  wantedSlot = tonumber(wantedSlot)
  if wantedName ~= "" then
    for _, member in ipairs(fleet.members or {}) do
      if trim(member.name):lower() == wantedName then
        return member
      end
    end
  end
  if wantedSlot then
    for _, member in ipairs(fleet.members or {}) do
      if tonumber(member.slot) == wantedSlot then
        return member
      end
    end
  end
  if wantedId ~= "" then
    for _, member in ipairs(fleet.members or {}) do
      if trim(member.id):lower() == wantedId then
        return member
      end
    end
  end
  return nil
end

local function selectedFormationMembers(payload, fleet)
  local selected, seen = {}, {}
  local requestedNames = type(payload.memberNames) == "table" and payload.memberNames or nil
  local requestedIds = type(payload.memberIds) == "table" and payload.memberIds or nil
  local requestedSlots = type(payload.memberSlots) == "table" and payload.memberSlots or nil
  local requestedCount = requestedNames and #requestedNames or 0
  if requestedCount == 0 then
    requestedCount = requestedIds and #requestedIds or 0
  end
  if requestedCount > 0 then
    if requestedCount > 64 then
      return nil, "too many formation members were selected"
    end
    for index = 1, requestedCount do
      local wantedName = requestedNames and requestedNames[index] or nil
      local wantedId = requestedIds and requestedIds[index] or nil
      local wantedSlot = requestedSlots and requestedSlots[index] or nil
      if requestedNames and trim(wantedName) == "" then
        return nil, "a selected formation member name is invalid"
      end
      if not requestedNames and trim(wantedId) == "" then
        return nil, "a selected formation member id is invalid"
      end
      local found = findFormationMember(fleet, wantedName, wantedSlot, wantedId)
      if not found then
        return nil, "a selected formation member is no longer available"
      end
      local key = formationMemberKey(found)
      if not seen[key] then
        seen[key] = true
        table.insert(selected, found)
      end
    end
  else
    local found =
      findFormationMember(fleet, payload.memberName, payload.memberSlot, payload.memberId)
    if found then
      table.insert(selected, found)
    end
  end
  if #selected == 0 then
    return nil, "the selected formation member is no longer available"
  end
  for _, member in ipairs(selected) do
    local memberName = trim(member.name)
    if memberName == "" or memberName:find("[%c\r\n]") then
      return nil, "a selected formation member name is invalid"
    end
  end
  return selected
end

local function scopedHyperspaceCommands(payload, localCommand)
  payload = type(payload) == "table" and payload or {}
  local scope = trim(payload.scope):lower()
  if scope == "" then
    scope = "local"
  end
  if scope ~= "local" and scope ~= "all" and scope ~= "wings" and scope ~= "selected" then
    return nil, nil, "hyperspace scope must be local, all, wings, or selected"
  end
  if scope == "local" then
    return { localCommand }, true, nil, true
  end

  local fleet = Scraper.state and Scraper.state.metadata and Scraper.state.metadata.fleet
  if type(fleet) ~= "table" or fleet.active ~= true then
    return nil, nil, "the selected formation is no longer active"
  end
  -- Squadron wingmen mirror their lead cockpit, so a squadron route is plotted
  -- and engaged locally while retaining the squadron recipient in telemetry.
  if fleet.kind == "squadron" then
    return { localCommand }, true, nil, true
  end
  if fleet.kind ~= "battlegroup" then
    return nil, nil, "unsupported formation type"
  end

  local localName = observerName()
  local commander = false
  for _, member in ipairs(fleet.members or {}) do
    if trim(member.name):lower() == localName:lower() then
      commander = member.leader == true or member.role == "leader"
      break
    end
  end
  if not commander then
    return nil, nil, "only the battlegroup flagship can route wing ships"
  end

  local recipients = {}
  local includesLocal = false
  local usesLocalCommand = false
  if scope == "all" then
    table.insert(recipients, { selector = "all" })
    includesLocal = true
  elseif scope == "wings" then
    for _, member in ipairs(fleet.members or {}) do
      if not member.leader and tonumber(member.slot) then
        table.insert(recipients, { selector = tostring(member.slot) })
      end
    end
  else
    local members, selectionError = selectedFormationMembers(payload, fleet)
    if not members then
      return nil, nil, selectionError
    end
    for _, member in ipairs(members) do
      local memberName = trim(member.name)
      local localShip = memberName:lower() == localName:lower()
      table.insert(recipients, {
        selector = tonumber(member.slot) and tostring(member.slot) or memberName,
        localShip = localShip,
      })
      if localShip then
        includesLocal = true
        usesLocalCommand = true
      end
    end
  end
  if #recipients == 0 then
    return nil, nil, "no ships are available in the selected hyperspace scope"
  end
  local commands = {}
  for _, recipient in ipairs(recipients) do
    if recipient.localShip then
      table.insert(commands, localCommand)
    else
      table.insert(commands, "battlegroup nav " .. recipient.selector .. " " .. localCommand)
    end
  end
  return commands, includesLocal, nil, usesLocalCommand
end

local function sendScopedHyperspaceCommands(commands)
  Scraper.polling.dispatching = true
  for _, command in ipairs(commands or {}) do
    local ok, result, sendError = pcall(send, command, false)
    if not ok or result == false then
      Scraper.polling.dispatching = false
      return false, tostring(ok and sendError or result)
    end
  end
  Scraper.polling.dispatching = false
  return true
end

local function dispatchHyperspacePlot(payload, message)
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "hyperspace navigation is unavailable while landed"
  end
  if Scraper.hyperspace.phase == "calculating" then
    return false, "a hyperspace calculation is already running"
  end
  local destination = type(payload.destination) == "table" and payload.destination or {}
  local x, y, z =
    validateSystemCoordinate(destination.x),
    validateSystemCoordinate(destination.y),
    validateSystemCoordinate(destination.z)
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
    command = string.format(
      "calculate '%d %d' %d %d %d",
      math.floor(gx + 0.5),
      math.floor(gy + 0.5),
      x,
      y,
      z
    )
  else
    return false, "hyperspace mode must be local or galactic"
  end
  local commands, includesLocal, scopeError, usesLocalCommand =
    scopedHyperspaceCommands(payload, command)
  if not commands then
    return false, scopeError
  end
  Scraper.hyperspace.initiatedByHolocron = true
  cancelHyperspaceCalculationEstimate()
  Scraper.hyperspace.routeIncludesLocalShip = includesLocal
  Scraper.hyperspace.routeUsesLocalCommand = usesLocalCommand
  Scraper.hyperspace.acknowledgedFuelRisk = payload.acknowledgeFuelRisk == true
  Scraper.hyperspace.activeIntentId = message and message.id or nil
  local metadata = hyperspaceMetadata()
  metadata.route = copyTable(payload)
  metadata.insufficientFuel = nil
  metadata.aborted = nil
  metadata.error = nil
  metadata.navigatorApplied = false
  metadata.calculationEstimated = false
  metadata.estimatedReadyAt = nil
  metadata.readyAt = nil
  metadata.waitingForCalculation = false
  metadata.awaitingArrivalRadar = false
  metadata.hyperjumpCompleteObservedAt = nil
  metadata.realspaceLurchObservedAt = nil
  metadata.reentrySystemName = nil
  Scraper.hyperspace.hyperjumpCompleteObserved = false
  Scraper.hyperspace.realspaceLurchObserved = false
  Scraper.hyperspace.awaitingArrivalRadar = false
  Scraper.hyperspace.reentrySystemName = nil
  if mode == "local" and includesLocal then
    startHyperspaceSample(payload)
  end
  publishHyperspace("calculating")
  local sent, sendError = sendScopedHyperspaceCommands(commands)
  if not sent then
    finishActiveHyperspaceSample("failed", "command_send_failed")
    return false, sendError
  end
  if not usesLocalCommand then
    scheduleHyperspaceCalculationEstimate(mode)
  end
  return true
end

local function dispatchNavigationRefresh(payload, message)
  if Scraper.polling.paused then
    return false, "automatic polling is paused"
  end
  if hyperspaceTransitActive() then
    return false, "navigation telemetry is unavailable during hyperspace transit"
  end
  if Scraper.active then
    return false,
      Scraper.active.polled and "another telemetry refresh is active"
        or "a manual telemetry capture is active"
  end
  cancelPollTimer()
  local command = trim(payload.command):lower()
  if command ~= "calc" and command ~= "navstat" then
    command = "navstat"
  end
  local parser = command == "calc" and "calculate" or "navstat"
  local started, err = Scraper.startCapture(parser, command, {
    polled = true,
    pollDelay = 0.25,
    intentId = message and message.id or nil,
    followupRadar = payload.followupRadar == true,
  })
  if not started then
    return false, err
  end
  Scraper.polling.dispatching = true
  local ok, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not ok then
    abandonCapture("navigation refresh send failed")
    return false, tostring(sendError)
  end
  return true
end

local function normalizeWeapon(value)
  local lower = trim(value):lower()
  if lower:find("autoblaster", 1, true) then
    return "autoblaster"
  end
  if lower:find("turbolaser", 1, true) then
    return "turbolaser"
  end
  if lower:find("laser", 1, true) then
    return "laser"
  end
  if lower:find("ion", 1, true) then
    return "ion"
  end
  if lower:find("missile", 1, true) then
    return "missile"
  end
  if lower:find("torpedo", 1, true) then
    return "torpedo"
  end
  if lower:find("rocket", 1, true) then
    return "rocket"
  end
  if lower:find("burst", 1, true) or lower:find("pulse", 1, true) then
    return "burst"
  end
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

local function formationContainsShip(name)
  local wanted = trim(name):lower()
  if wanted == "" then
    return false
  end
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local visited = {}
  local function contains(fleet)
    if type(fleet) ~= "table" or visited[fleet] then
      return false
    end
    visited[fleet] = true
    for _, member in ipairs(fleet.members or {}) do
      if trim(member.name):lower() == wanted then
        return true
      end
    end
    return false
  end
  if contains(metadata.fleet) then
    return true
  end
  for _, fleet in pairs(metadata.formations or {}) do
    if contains(fleet) then
      return true
    end
  end
  return false
end

local function markHostileSourceAgainstFriendlyTarget(sourceName, targetName)
  local source = trim(sourceName)
  local target = trim(targetName)
  if source == "" or target == "" or source:lower() == target:lower() then
    return
  end
  local observerName =
    trim(Scraper.state and Scraper.state.observer and Scraper.state.observer.name)
  local targetEntity = findEntity({ name = target })
  local targetIsFriendly = target:lower() == observerName:lower()
    or formationContainsShip(target)
    or targetEntity and targetEntity.disposition == "ally"
  if
    not targetIsFriendly
    or formationContainsShip(source)
    or source:lower() == observerName:lower()
  then
    return
  end
  local attacker = findEntity({ name = source })
  if attacker and attacker.kind == "ship" then
    attacker.disposition = "enemy"
  end
end

local function publishLaunchEvent(weapon, count, targetName, sourceName)
  local resolvedTarget = targetName or Scraper.combat.targetName
  local resolvedSource = sourceName
    or Scraper.fleetCommand.currentMemberName
    or trim(Scraper.state.observer and Scraper.state.observer.name)
  local now = os.time()
  if
    Scraper.combat.lastLaunchWeapon == weapon
    and Scraper.combat.lastLaunchTarget == resolvedTarget
    and Scraper.combat.lastLaunchSource == resolvedSource
    and now - (Scraper.combat.lastLaunchAt or 0) <= 2
  then
    return true
  end
  Scraper.combat.lastLaunchWeapon = weapon
  Scraper.combat.lastLaunchTarget = resolvedTarget
  Scraper.combat.lastLaunchSource = resolvedSource
  Scraper.combat.lastLaunchAt = now
  markHostileSourceAgainstFriendlyTarget(resolvedSource, resolvedTarget)
  local fleetOrder = Scraper.state.metadata.fleetOrder
  if
    Scraper.fleetCommand.currentMemberName
    and type(fleetOrder) == "table"
    and fleetOrder.order == "fire"
    and type(fleetOrder.results) == "table"
  then
    local result = fleetOrder.results[Scraper.fleetCommand.currentMemberName]
    if type(result) == "table" then
      result.status = "accepted"
      result.reason = nil
      result.observedAt = os.time()
      if recountFleetOrder then
        recountFleetOrder(fleetOrder)
      end
    end
  end
  local published = publishCombatEvent({
    type = "launch",
    weapon = weapon,
    count = count,
    targetName = resolvedTarget,
    sourceName = resolvedSource,
  })
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
  markHostileSourceAgainstFriendlyTarget(sourceName, resolvedTarget)
  local published = publishCombatEvent({
    type = "impact",
    weapon = weapon,
    targetName = resolvedTarget,
    sourceName = sourceName,
    count = math.max(1, tonumber(count) or 1),
    outcome = outcome,
  })
  if weapon == "missile" or weapon == "torpedo" or weapon == "rocket" or weapon == "burst" then
    Scraper.combat.lastRadarAt = 0
    if not Scraper.combat.projectileReconcileTimerId then
      Scraper.combat.projectileReconcileTimerId = tempTimer(0.05, function()
        Scraper.combat.projectileReconcileTimerId = nil
        if requestProjectileRadarReconciliation then
          requestProjectileRadarReconciliation()
        end
      end)
    end
  end
  return published
end

function Scraper.handleCombatLine(text)
  local raw = trim(text)
  local repeated = tonumber(raw:match("%[x(%d+)%]%s*$")) or 1
  local value = raw:gsub("%s+%[x%d+%]%s*$", "")
  local displayedTarget = value:match("^Target:%s+.-'([^']+)'")
  if displayedTarget then
    -- A channeled target attempt may echo a provisional Target line before it
    -- ultimately fails. Only Target Locked or the delayed status reconciliation
    -- is allowed to commit pending target state.
    if Scraper.pendingCommandKind == "target" then
      return true
    end
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
    local requested = type(fleetOrder) == "table"
        and fleetOrder.order == "fire"
        and trim(fleetOrder.weapon):lower()
      or ""
    local failedWeapon = normalizeWeapon(requested) or Scraper.combat.lastFireWeapon or "best"
    local sourceName = Scraper.fleetCommand.currentMemberName
      or trim(Scraper.state.observer and Scraper.state.observer.name)
    publishCombatEvent({
      type = "failure",
      weapon = failedWeapon,
      sourceName = sourceName,
      reason = "Failed to lock on to target",
    })
    if
      Scraper.fleetCommand.currentMemberName
      and type(fleetOrder) == "table"
      and type(fleetOrder.results) == "table"
    then
      local result = fleetOrder.results[Scraper.fleetCommand.currentMemberName]
      if type(result) == "table" then
        result.status = "rejected"
        result.reason = "Failed to lock on to target."
        result.observedAt = os.time()
        if recountFleetOrder then
          recountFleetOrder(fleetOrder)
        end
        Scraper.publish()
      end
    end
    Scraper.fleetCommand.currentMemberName = nil
    Scraper.fleetCommand.holdUntil = os.time() + 2
    return true
  end

  local forwardOnlyWeapon = value:match(
    "^The%s+(.+)%s+can%s+only%s+fire%s+forwards%.%s+You'll%s+need%s+to%s+turn%s+your%s+ship!$"
  ) or value:match(
    "^(.+)%s+can%s+only%s+fire%s+forwards%.%s+You'll%s+need%s+to%s+turn%s+your%s+ship!$"
  )
  if forwardOnlyWeapon then
    local weapon = normalizeWeapon(forwardOnlyWeapon)
    if weapon then
      publishCombatEvent({
        type = "failure",
        weapon = weapon,
        reason = "Forward arc blocked // turn ship",
      })
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

  local launchedWeapon, launchedTarget =
    value:match("^A%s+(.+)%s+is%s+launched%s+toward%s+.-'([^']+)'%s+by%s+your%s+ship%.$")
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

  local remoteLaunchSource, remoteLaunchWeapon, remoteLaunchTarget =
    value:match("^.-'([^']+)'%s+fires%s+an?%s+(.+)%s+towards?%s+.-'([^']+)'%.$")
  if remoteLaunchSource and remoteLaunchWeapon and remoteLaunchTarget then
    local weapon = normalizeWeapon(remoteLaunchWeapon)
    if weapon then
      publishLaunchEvent(weapon, repeated, remoteLaunchTarget, remoteLaunchSource)
      return true
    end
  end

  local directHitWeapon, directHitTarget =
    value:match("^Your ship's%s+(.+)%s+hits%s+.-'([^']+)'.-!$")
  if directHitWeapon and directHitTarget then
    local weapon = normalizeWeapon(directHitWeapon)
    if weapon then
      publishImpactEvent(
        weapon,
        directHitTarget,
        "hit",
        trim(Scraper.state.observer and Scraper.state.observer.name),
        repeated
      )
      return true
    end
  end

  local remoteHitWeapon, remoteHitSource, remoteHitTarget =
    value:match("^An%s+(.+)%s+from%s+.-'([^']+)'%s+hits%s+.-'([^']+)'.*$")
  if not remoteHitWeapon then
    remoteHitWeapon, remoteHitSource, remoteHitTarget =
      value:match("^A%s+(.+)%s+from%s+.-'([^']+)'%s+hits%s+.-'([^']+)'.*$")
  end
  if not remoteHitWeapon then
    remoteHitWeapon, remoteHitSource, remoteHitTarget =
      value:match("^(.+)%s+from%s+.-'([^']+)'%s+hits%s+.-'([^']+)'.*$")
  end
  if remoteHitWeapon and remoteHitTarget then
    local weapon = normalizeWeapon(remoteHitWeapon)
    if weapon then
      publishImpactEvent(weapon, remoteHitTarget, "hit", remoteHitSource, repeated)
      return true
    end
  end

  local remoteMissWeapon, remoteMissSource, remoteMissTarget =
    value:match("^An%s+(.+)%s+from%s+.-'([^']+)'%s+barely%s+misses%s+.-'([^']+)'.*$")
  if not remoteMissWeapon then
    remoteMissWeapon, remoteMissSource, remoteMissTarget =
      value:match("^A%s+(.+)%s+from%s+.-'([^']+)'%s+barely%s+misses%s+.-'([^']+)'.*$")
  end
  if not remoteMissWeapon then
    remoteMissWeapon, remoteMissSource, remoteMissTarget =
      value:match("^(.+)%s+from%s+.-'([^']+)'%s+barely%s+misses%s+.-'([^']+)'.*$")
  end
  if remoteMissWeapon and remoteMissTarget then
    local weapon = normalizeWeapon(remoteMissWeapon)
    if weapon then
      publishImpactEvent(weapon, remoteMissTarget, "miss", remoteMissSource, repeated)
      return true
    end
  end

  local explosionTarget, explosionWeapon =
    value:match("^You see a large explosion as%s+.-'([^']+)'%s+is%s+hit%s+by%s+an?%s+(.+)%.$")
  if explosionTarget and explosionWeapon then
    local weapon = normalizeWeapon(explosionWeapon)
    if weapon then
      if
        Scraper.combat.lastImpactWeapon == weapon
        and Scraper.combat.lastImpactTarget == explosionTarget
        and os.time() - (Scraper.combat.lastImpactAt or 0) <= 2
      then
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
      publishImpactEvent(
        weapon,
        hitTarget,
        "hit",
        trim(Scraper.state.observer and Scraper.state.observer.name),
        repeated
      )
      return true
    end
  end

  local missedWeapon, missedTarget =
    value:match("^Your ship's%s+(.+)%s+fire%s+at%s+.-'([^']+)'%s+but%s+miss%.$")
  if missedWeapon and missedTarget then
    local weapon = normalizeWeapon(missedWeapon)
    if weapon then
      publishImpactEvent(
        weapon,
        missedTarget,
        "miss",
        trim(Scraper.state.observer and Scraper.state.observer.name),
        repeated
      )
      return true
    end
  end

  local chargedWeapon = value:match("^(.+)%s+fully%s+charged%.$")
  if chargedWeapon then
    local weapon = normalizeWeapon(chargedWeapon)
    if weapon then
      publishCombatEvent({ type = "charged", weapon = weapon })
      return true
    end
  end
  local reloadedWeapon = value:match("^(.+)%s+launcher%(s%)%s+reloaded%.$")
    or value:match("^(.+)%s+launchers?%s+reloaded%.$")
  if reloadedWeapon then
    local weapon = normalizeWeapon(reloadedWeapon)
    if weapon then
      publishCombatEvent({ type = "charged", weapon = weapon })
      return true
    end
  end
  return false
end

local function isRemoteCombatStart(value)
  local lower = trim(value):lower():gsub("%s+", " ")
  return lower:match("^.- fire from .-'[^']+' hits ") ~= nil
    or lower:match("^an? .- from .-'[^']+' hits ") ~= nil
    or lower:match("^.- fire from .-'[^']+' barely misses ") ~= nil
    or lower:match("^an? .- from .-'[^']+' barely misses ") ~= nil
    or lower:match("^.-'[^']+' fires an? .- towards? ") ~= nil
    or lower:find(" explodes in a", 1, true) ~= nil
end

local function combatFragmentComplete(value)
  value = trim(value)
  return value:match("[%.!]%s*$") ~= nil or value:match("[%.!]%s*%[x%d+%]%s*$") ~= nil
end

local function clearPendingCombatLine()
  safeKill("killTimer", Scraper.combat.pendingLineTimerId)
  Scraper.combat.pendingLineTimerId = nil
  Scraper.combat.pendingLine = nil
end

local function rememberCombatFragment(value)
  clearPendingCombatLine()
  Scraper.combat.pendingLine = trim(value):gsub("%s+", " ")
  Scraper.combat.pendingLineTimerId = tempTimer(Scraper.COMBAT_FRAGMENT_TIMEOUT_SECONDS, function()
    Scraper.combat.pendingLine = nil
    Scraper.combat.pendingLineTimerId = nil
  end)
end

function Scraper.handleCombatFragment(text)
  local value = trim(text):gsub("%s+", " ")
  if value == "" then
    return false
  end
  local pending = Scraper.combat.pendingLine
  if pending and not isRemoteCombatStart(value) then
    clearPendingCombatLine()
    local combined = pending .. " " .. value
    if Scraper.handleShipDestruction(combined) then
      return true
    end
    if Scraper.handleCombatLine(combined) then
      return true
    end
    if #combined <= 2048 and not combatFragmentComplete(combined) then
      rememberCombatFragment(combined)
      return true
    end
    return false
  elseif pending then
    clearPendingCombatLine()
  end

  if Scraper.handleShipDestruction(value) then
    return true
  end
  if Scraper.handleCombatLine(value) then
    return true
  end
  if isRemoteCombatStart(value) and not combatFragmentComplete(value) then
    rememberCombatFragment(value)
    return true
  end
  return false
end

local function scanKey(entity)
  return tostring(entity.id or entity.name):lower()
end

local function scanCommandDue()
  if not Scraper.state then
    return nil
  end
  local observer = Scraper.state.observer or {}
  local range = tonumber(observer.radarRange)
    or (500 + math.max(0, tonumber(observer.sensorArray) or 0) * 10)
  local now = os.time()
  local best, bestOverdue, bestIsDiscovery
  for _, entity in pairs(Scraper.state.entities) do
    if entity.kind == "ship" and entity.name and entity.x and entity.y and entity.z then
      local distance = math.sqrt(
        (entity.x - (observer.x or 0)) ^ 2
          + (entity.y - (observer.y or 0)) ^ 2
          + (entity.z - (observer.z or 0)) ^ 2
      )
      if distance <= range then
        local state = Scraper.scanState[scanKey(entity)] or { statusAt = 0, infoAt = 0 }
        Scraper.scanState[scanKey(entity)] = state
        for _, source in ipairs({ "status", "info" }) do
          local interval = source == "status"
              and entity.disposition == "enemy"
              and Scraper.polling.hostileScanIntervalSeconds
            or Scraper.polling.standardScanIntervalSeconds
          local lastAttempt = state[source .. "At"] or 0
          local missingTelemetry = source == "status"
              and entity.hull == nil
              and entity.shields == nil
              and entity.condition == nil
            or source == "info" and entity.shipCategory == nil
          local discovery = missingTelemetry and lastAttempt == 0
          local overdue = now - lastAttempt - interval
          if
            overdue >= 0
            and (
              best == nil
              or discovery and not bestIsDiscovery
              or discovery == bestIsDiscovery and overdue > bestOverdue
            )
          then
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
    active = Scraper.polling.enabled
      and not Scraper.polling.paused
      and Scraper.state.metadata.inSpace == true,
    paused = Scraper.polling.paused == true,
    pausedAt = Scraper.polling.pausedAt,
    pauseReason = Scraper.polling.pauseReason,
    command = command,
    commandGapSeconds = Scraper.polling.commandGapSeconds,
    cycleDelaySeconds = Scraper.polling.cycleDelaySeconds,
    automaticCommandDedupSeconds = Scraper.AUTOMATIC_COMMAND_DEDUP_SECONDS,
    hostileScanIntervalSeconds = Scraper.polling.hostileScanIntervalSeconds,
    standardScanIntervalSeconds = Scraper.polling.standardScanIntervalSeconds,
    combatRadarIntervalSeconds = Scraper.polling.combatRadarIntervalSeconds,
    fleetRadarIntervalSeconds = Scraper.polling.fleetRadarIntervalSeconds,
    combatFleetRadarIntervalSeconds = Scraper.polling.combatFleetRadarIntervalSeconds,
    radarReconcileIntervalSeconds = Scraper.polling.radarReconcileIntervalSeconds,
    combatActivityWindowSeconds = Scraper.polling.combatActivityWindowSeconds,
    hydratingObserver = #(Scraper.polling.hydrationQueue or {}) > 0,
    initializationPending = #(Scraper.polling.initializationQueue or {}) > 0,
    initializationReason = Scraper.polling.initializationReason,
    radarRefreshPending = Scraper.polling.radarRefreshPending == true,
    fleetRadarRefreshPending = Scraper.polling.fleetRadarRefreshPending == true,
    radarRefreshReason = Scraper.polling.radarRefreshReason,
    sensorTickFallbackSeconds = Scraper.SENSOR_TICK_FALLBACK_SECONDS,
    sensorPollWaitingForTick = Scraper.polling.sensorPollPending == true
      and Scraper.polling.sensorTickGranted ~= true,
    sensorPollPendingCommand = Scraper.polling.sensorPollPendingCommand,
    lastSensorPollAt = Scraper.polling.lastSensorPollAt,
    lastSensorPollCommand = Scraper.polling.lastSensorPollCommand,
    lastSensorTickSource = Scraper.polling.lastSensorTickSource,
    lastSensorTickSequence = Scraper.polling.lastSensorTickSequence,
    lastSensorSyncWaitSeconds = Scraper.polling.lastSensorSyncWaitSeconds,
    sensorTickFallbackCount = Scraper.polling.sensorTickFallbackCount or 0,
    shipGmcpTickSequence = Scraper.shipGmcp.sequence or 0,
    lastShipGmcpTickAt = Scraper.shipGmcp.lastAt,
  }
end

local function shipGmcpIsFresh(now)
  local lastAt = tonumber(Scraper.shipGmcp and Scraper.shipGmcp.lastAt) or 0
  return lastAt > 0 and (tonumber(now) or os.time()) - lastAt <= Scraper.SHIP_GMCP_STALE_SECONDS
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

local function isTickSynchronizedSensorCommand(command)
  local normalized = normalizedCommand(command)
  return normalized == "radar" or normalized == "radar projectiles" or normalized == "fleetradar"
end

local function shipGmcpTickClockIsFresh(now)
  local sequence = tonumber(Scraper.shipGmcp.sequence) or 0
  local lastAt = tonumber(Scraper.shipGmcp.lastAt) or 0
  return sequence > 0
    and lastAt > 0
    and (tonumber(now) or os.time()) - lastAt < Scraper.SENSOR_TICK_FALLBACK_SECONDS
end

local function queueSensorPollForTick(command, now)
  now = tonumber(now) or os.time()
  if Scraper.polling.sensorPollPending ~= true then
    Scraper.polling.sensorPollPending = true
    Scraper.polling.sensorPollPendingCommand = normalizedCommand(command)
    Scraper.polling.sensorPollPendingSince = now
  end
  if Scraper.polling.sensorTickTimerId then
    return false
  end
  local lastTickAt = tonumber(Scraper.shipGmcp.lastAt) or now
  local delay = math.max(0.1, Scraper.SENSOR_TICK_FALLBACK_SECONDS - math.max(0, now - lastTickAt))
  Scraper.polling.sensorTickTimerId = tempTimer(delay, function()
    Scraper.polling.sensorTickTimerId = nil
    if Scraper.polling.sensorPollPending ~= true then
      return
    end
    Scraper.polling.sensorTickFallbackCount = (
      tonumber(Scraper.polling.sensorTickFallbackCount) or 0
    ) + 1
    releasePendingSensorPoll("fallback", Scraper.shipGmcp.sequence)
  end)
  profileCount("sensorPollsWaitingForTick")
  updatePollingMetadata("waiting for gmcp.Ship.Info")
  return true
end

releasePendingSensorPoll = function(source, sequence)
  if Scraper.polling.sensorPollPending ~= true or Scraper.polling.sensorTickGranted == true then
    return false
  end
  if hyperspaceTransitActive() then
    cancelSensorTickWait(true)
    return false
  end
  safeKill("killTimer", Scraper.polling.sensorTickTimerId)
  Scraper.polling.sensorTickTimerId = nil
  Scraper.polling.sensorTickGranted = true
  Scraper.polling.sensorTickSource = source == "gmcp" and "gmcp" or "fallback"
  Scraper.polling.sensorTickSequence = tonumber(sequence) or 0
  profileCount("sensorTicks:" .. Scraper.polling.sensorTickSource)
  updatePollingMetadata("sensor tick: " .. Scraper.polling.sensorTickSource)
  if Scraper.polling.enabled and not Scraper.polling.paused and scheduleNextPoll then
    scheduleNextPoll(0)
  end
  return true
end

local function prepareSensorTick(command, now, immediateInitialization, bypassSensorTick)
  if immediateInitialization or not isTickSynchronizedSensorCommand(command) then
    return nil, true
  end
  if bypassSensorTick then
    return {
      source = "realspace",
      sequence = tonumber(Scraper.shipGmcp.sequence) or 0,
    },
      true
  end
  if Scraper.polling.sensorTickGranted == true then
    return {
      source = Scraper.polling.sensorTickSource or "fallback",
      sequence = tonumber(Scraper.polling.sensorTickSequence) or 0,
    },
      true
  end
  if shipGmcpTickClockIsFresh(now) then
    queueSensorPollForTick(command, now)
    return nil, false
  end
  return {
    source = "fallback",
    sequence = tonumber(Scraper.shipGmcp.sequence) or 0,
  },
    true
end

local function consumeSensorTick(command, context, now)
  if not context then
    return nil
  end
  now = tonumber(now) or os.time()
  local pendingSince = tonumber(Scraper.polling.sensorPollPendingSince)
  context.waitSeconds = pendingSince and math.max(0, now - pendingSince) or 0
  Scraper.polling.lastSensorPollAt = now
  Scraper.polling.lastSensorPollCommand = normalizedCommand(command)
  Scraper.polling.lastSensorTickSource = context.source
  Scraper.polling.lastSensorTickSequence = context.sequence
  Scraper.polling.lastSensorSyncWaitSeconds = context.waitSeconds
  cancelSensorTickWait(true)
  Scraper.polling.sensorTickBypassPending = false
  return context
end

local function fleetStatusCommandDue(now, combatActive)
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local activeKind = metadata.fleet and metadata.fleet.active == true and metadata.fleet.kind or nil
  local formations = metadata.formations or {}
  local bothKnownInactive = formations.battlegroup
    and formations.battlegroup.active == false
    and formations.squadron
    and formations.squadron.active == false
  local activeInterval = combatActive
      and (Scraper.polling.combatFleetStatusIntervalSeconds or Scraper.COMBAT_FLEET_STATUS_INTERVAL_SECONDS)
    or (Scraper.polling.fleetStatusIntervalSeconds or Scraper.FLEET_STATUS_INTERVAL_SECONDS)
  local inactiveInterval = Scraper.polling.inactiveFormationProbeIntervalSeconds
    or Scraper.INACTIVE_FORMATION_PROBE_INTERVAL_SECONDS
  local allCandidates = {
    {
      kind = "battlegroup",
      command = "battlegroup",
      lastAt = Scraper.polling.lastBattlegroupAt or 0,
    },
    {
      kind = "squadron",
      command = "squadron status",
      lastAt = Scraper.polling.lastSquadronAt or 0,
    },
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
    if left.lastAt == right.lastAt then
      return left.kind < right.kind
    end
    return left.lastAt < right.lastAt
  end)
  for _, candidate in ipairs(candidates) do
    if candidate.lastAt == 0 or candidate.overdue >= 0 then
      return candidate
    end
  end
  return nil
end

local function pollOnce()
  Scraper.polling.timerId = nil
  if not Scraper.polling.enabled or Scraper.polling.paused then
    return
  end
  -- LOTJ rejects radar, fleet radar, status, and formation commands from
  -- hyperspace. Do not let an already-scheduled timer issue one, and do not
  -- chain a completed realspace capture into another poll after departure.
  -- The realspace lurch queues a fresh radar/fleetradar pair and resumes the
  -- scheduler only after the ship is authoritatively out of hyperspace.
  if hyperspaceTransitActive() then
    return
  end
  local initializationCommand = (Scraper.polling.initializationQueue or {})[1]
  local startupSpaceProbe = initializationCommand == "radar"
    and Scraper.polling.initializationSpaceProbe == true
    and Scraper.state
    and Scraper.state.metadata.inSpace ~= false
  if Scraper.pendingCommandKind then
    return
  end
  if not initializationCommand and os.time() < tonumber(Scraper.fleetCommand.holdUntil or 0) then
    scheduleNextPoll(1)
    return
  end
  -- Never issue hidden commands while Mudlet is connecting or showing the
  -- login screen. A launch event or a successful manual space command must
  -- positively establish the in-space state before automatic polling begins.
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true and not startupSpaceProbe then
    return
  end
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
      and (Scraper.polling.combatFleetRadarIntervalSeconds or Scraper.COMBAT_FLEETRADAR_INTERVAL_SECONDS)
    or (Scraper.polling.fleetRadarIntervalSeconds or Scraper.FLEETRADAR_INTERVAL_SECONDS)
  local fleetRadarDue = now - (Scraper.polling.lastFleetRadarAt or 0) >= fleetRadarInterval
  local projectileRadarPending = Scraper.combat.projectileRadarPending == true
  local fleetStatusDue = fleetStatusCommandDue(now, combatActive)
  local hydrationCommand = (Scraper.polling.hydrationQueue or {})[1]
  -- First-contact status/info hydration stays ahead of formation refreshes;
  -- routine repeat scans still yield to fleet status and radar below.
  local scanCandidate = not hydrationCommand
      and not combatRadarDue
      and not radarReconcileDue
      and scanCommandDue()
    or nil
  local dueScan = scanCandidate
      and (scanCandidate.discovery or Scraper.polling.scansSinceCore < 2)
      and scanCandidate
    or nil
  local command
  local selectedScan
  local selectedFleetStatus
  local immediateWorldRefresh = false
  local immediateInitialization = initializationCommand ~= nil
  if initializationCommand then
    command = initializationCommand
    Scraper.polling.scansSinceCore = 0
  elseif Scraper.polling.radarRefreshPending then
    command = "radar"
    immediateWorldRefresh = true
    Scraper.polling.scansSinceCore = 0
  elseif Scraper.polling.fleetRadarRefreshPending then
    command = "fleetradar"
    immediateWorldRefresh = true
    Scraper.polling.scansSinceCore = 0
  elseif projectileRadarPending then
    command = "radar projectiles"
    Scraper.polling.scansSinceCore = 0
  elseif hydrationCommand then
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
    selectedScan = dueScan
    Scraper.polling.scansSinceCore = Scraper.polling.scansSinceCore + 1
  elseif fleetStatusDue then
    command = fleetStatusDue.command
    selectedFleetStatus = fleetStatusDue
    Scraper.polling.scansSinceCore = 0
  elseif fleetRadarDue then
    command = "fleetradar"
    Scraper.polling.scansSinceCore = 0
  elseif dueScan then
    command = dueScan.command
    selectedScan = dueScan
    Scraper.polling.scansSinceCore = Scraper.polling.scansSinceCore + 1
  else
    command = Scraper.POLL_COMMANDS[Scraper.polling.index]
    Scraper.polling.scansSinceCore = 0
  end
  local sensorTickContext, sensorTickReady = prepareSensorTick(
    command,
    now,
    immediateInitialization,
    immediateWorldRefresh and Scraper.polling.sensorTickBypassPending == true
  )
  if not sensorTickReady then
    return
  end
  -- Reentry is a hard world-state boundary. Do not inherit the normal
  -- three-second automatic-command cooldown for either refresh capture.
  local immediatePriority = immediateWorldRefresh or immediateInitialization
  local repeatDelay = immediatePriority and 0 or automaticCommandRepeatDelay(command, now)
  if repeatDelay > 0 then
    profileCount("automaticCommandsThrottled")
    scheduleNextPoll(math.max(0.25, repeatDelay))
    return
  end
  sensorTickContext = consumeSensorTick(command, sensorTickContext, now)
  if normalizedCommand(command) == "radar projectiles" then
    Scraper.combat.projectileRadarPending = false
    Scraper.combat.projectileRadarRequestedAt = now
  end
  if selectedScan then
    Scraper.scanState[selectedScan.key][selectedScan.source .. "At"] = now
  end
  if selectedFleetStatus then
    if selectedFleetStatus.kind == "battlegroup" then
      Scraper.polling.lastBattlegroupAt = now
    else
      Scraper.polling.lastSquadronAt = now
    end
  end
  if selectedScan then
    local parserCommand = parserForCommand(command)
    local started, startError = Scraper.startCapture(
      parserCommand,
      command,
      { polled = true, pollDelay = Scraper.polling.commandGapSeconds }
    )
    if not started then
      scheduleNextPoll(0.5)
      return
    end
    updatePollingMetadata(command)
    Scraper.polling.dispatching = true
    markAutomaticCommandSent(command, now)
    local sent = pcall(send, command, false)
    Scraper.polling.dispatching = false
    if not sent then
      abandonCapture("scan send failed")
    end
    return
  end
  local completedCycle = false
  if
    not hydrationCommand
    and not immediateWorldRefresh
    and not immediateInitialization
    and not combatRadarDue
    and not radarReconcileDue
    and not projectileRadarPending
    and not fleetStatusDue
    and not fleetRadarDue
  then
    Scraper.polling.index = Scraper.polling.index + 1
    completedCycle = Scraper.polling.index > #Scraper.POLL_COMMANDS
    if completedCycle then
      Scraper.polling.index = 1
    end
  end
  local delay = immediateInitialization and 0
    or immediateWorldRefresh and 0.1
    or combatRadarDue and 0.5
    or completedCycle and Scraper.polling.cycleDelaySeconds
    or Scraper.polling.commandGapSeconds

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
    spaceProbe = startupSpaceProbe,
    initializationSweep = immediateInitialization,
    sensorTickSource = sensorTickContext and sensorTickContext.source or nil,
    sensorTickSequence = sensorTickContext and sensorTickContext.sequence or nil,
    sensorSyncWaitSeconds = sensorTickContext and sensorTickContext.waitSeconds or nil,
  })
  if not started then
    if normalizedCommand(command) == "radar projectiles" then
      Scraper.combat.projectileRadarPending = true
    end
    diagnostic(
      "warn",
      "telemetry poll could not capture " .. command .. ": " .. tostring(startError)
    )
    scheduleNextPoll(delay)
    return
  end

  updatePollingMetadata(command)
  if immediateInitialization then
    if command == "battlegroup" then
      Scraper.polling.lastBattlegroupAt = now
    elseif command == "squadron status" then
      Scraper.polling.lastSquadronAt = now
    end
  end
  Scraper.polling.dispatching = true
  markAutomaticCommandSent(command, now)
  local sent, sendResult, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    if normalizedCommand(command) == "radar projectiles" then
      Scraper.combat.projectileRadarPending = true
    end
    abandonCapture("poll send failed")
    diagnostic(
      "warn",
      "telemetry poll could not send "
        .. command
        .. ": "
        .. tostring(sent and sendError or sendResult)
    )
  end
end

scheduleNextPoll = function(delay)
  cancelPollTimer()
  if not Scraper.polling.enabled or Scraper.polling.paused then
    return
  end
  if hyperspaceTransitActive() then
    return
  end
  local startupSpaceProbe = (Scraper.polling.initializationQueue or {})[1] == "radar"
    and Scraper.polling.initializationSpaceProbe == true
    and Scraper.state
    and Scraper.state.metadata.inSpace ~= false
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true and not startupSpaceProbe then
    return
  end
  if Scraper.pendingCommandKind then
    return
  end
  Scraper.polling.timerId = tempTimer(tonumber(delay) or 0.25, pollOnce)
end

function Scraper.handleSectorArrival(text)
  local message = trim(text)
  local shipName =
    message:match("'([^']+)'%s+enters the starsystem,%s+coming out of its hyperjump at")
  if not shipName then
    return false
  end
  shipName = trim(shipName)
  if shipName == "" or #shipName > 64 or shipName:find("%s") then
    return false
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return true
  end
  queueImmediateWorldRefresh("ship entered sector: " .. shipName)
  Scraper.state.metadata.lastSectorArrival = {
    shipName = shipName,
    observedAt = os.time(),
  }
  return true
end

requestProjectileRadarReconciliation = function()
  if
    not Scraper.polling.enabled
    or Scraper.polling.paused
    or not Scraper.state
    or Scraper.state.metadata.inSpace ~= true
  then
    return false
  end
  Scraper.combat.projectileRadarPending = true
  Scraper.combat.lastRadarAt = 0
  scheduleNextPoll(0.1)
  return true
end

function Scraper.handleProjectileSummary(text)
  local total, incoming = trim(text):match("^(%d+)%s+projectiles?,%s+(%d+)%s+incoming")
  if not total then
    return false
  end
  total, incoming = tonumber(total) or 0, tonumber(incoming) or 0
  if total > 0 or incoming > 0 then
    Scraper.combat.lastActivityAt = os.time()
  end
  Scraper.state.metadata.projectileCount = total
  Scraper.state.metadata.incomingProjectileCount = incoming
  Scraper.publish()
  if total <= 0 then
    return true
  end
  return requestProjectileRadarReconciliation()
end

function Scraper.startPolling(options)
  if type(send) ~= "function" then
    return nil, "Mudlet send() is unavailable"
  end
  options = type(options) == "table" and options or {}
  cancelSensorTickWait(true)
  Scraper.polling.sensorTickBypassPending = false
  Scraper.combat.projectileRadarPending = false
  local waitingForSpace = Scraper.state and Scraper.state.metadata.inSpace == false
  Scraper.polling.enabled = not waitingForSpace
  Scraper.polling.resumeWhenInSpace = waitingForSpace == true
  Scraper.polling.index = 1
  Scraper.polling.lastFleetRadarAt = 0
  Scraper.polling.lastBattlegroupAt = 0
  Scraper.polling.lastSquadronAt = 0
  Scraper.polling.commandGapSeconds =
    math.max(0.5, tonumber(options.commandGapSeconds) or Scraper.POLL_COMMAND_GAP_SECONDS)
  Scraper.polling.cycleDelaySeconds =
    math.max(1, tonumber(options.cycleDelaySeconds) or Scraper.POLL_CYCLE_DELAY_SECONDS)
  Scraper.polling.hostileScanIntervalSeconds = math.max(
    3,
    tonumber(options.hostileScanIntervalSeconds) or Scraper.HOSTILE_SCAN_INTERVAL_SECONDS
  )
  Scraper.polling.standardScanIntervalSeconds = math.max(
    5,
    tonumber(options.standardScanIntervalSeconds) or Scraper.STANDARD_SCAN_INTERVAL_SECONDS
  )
  Scraper.polling.combatRadarIntervalSeconds = math.max(
    Scraper.AUTOMATIC_COMMAND_DEDUP_SECONDS,
    tonumber(options.combatRadarIntervalSeconds) or Scraper.COMBAT_RADAR_INTERVAL_SECONDS
  )
  Scraper.polling.fleetRadarIntervalSeconds =
    math.max(3, tonumber(options.fleetRadarIntervalSeconds) or Scraper.FLEETRADAR_INTERVAL_SECONDS)
  Scraper.polling.combatFleetRadarIntervalSeconds = math.max(
    5,
    tonumber(options.combatFleetRadarIntervalSeconds) or Scraper.COMBAT_FLEETRADAR_INTERVAL_SECONDS
  )
  Scraper.polling.fleetStatusIntervalSeconds = math.max(
    5,
    tonumber(options.fleetStatusIntervalSeconds) or Scraper.FLEET_STATUS_INTERVAL_SECONDS
  )
  Scraper.polling.combatFleetStatusIntervalSeconds = math.max(
    3,
    tonumber(options.combatFleetStatusIntervalSeconds)
      or Scraper.COMBAT_FLEET_STATUS_INTERVAL_SECONDS
  )
  Scraper.polling.inactiveFormationProbeIntervalSeconds = math.max(
    30,
    tonumber(options.inactiveFormationProbeIntervalSeconds)
      or Scraper.INACTIVE_FORMATION_PROBE_INTERVAL_SECONDS
  )
  Scraper.polling.radarReconcileIntervalSeconds = math.max(
    30,
    tonumber(options.radarReconcileIntervalSeconds) or Scraper.RADAR_RECONCILE_INTERVAL_SECONDS
  )
  Scraper.polling.combatActivityWindowSeconds = math.max(
    5,
    tonumber(options.combatActivityWindowSeconds) or Scraper.COMBAT_ACTIVITY_WINDOW_SECONDS
  )
  Scraper.polling.scansSinceCore = 2
  updatePollingMetadata(nil)
  scheduleNextPoll(tonumber(options.initialDelaySeconds) or 0.5)
  diagnostic(
    "info",
    Scraper.state and Scraper.state.metadata.inSpace == true and "telemetry polling enabled"
      or "telemetry polling armed; waiting for confirmed space activity"
  )
  return true
end

function Scraper.stopPolling()
  cancelPollTimer()
  cancelSensorTickWait(true)
  Scraper.polling.sensorTickBypassPending = false
  Scraper.polling.enabled = false
  Scraper.polling.paused = false
  Scraper.polling.pausedAt = nil
  Scraper.polling.pauseReason = nil
  Scraper.polling.resumeWhenInSpace = false
  Scraper.polling.dispatching = false
  Scraper.combat.projectileRadarPending = false
  if Scraper.state then
    updatePollingMetadata(nil)
  end
  return true
end

function Scraper.getPollingState()
  local state = copyTable(Scraper.polling)
  state.active = state.enabled
      and not state.paused
      and Scraper.state
      and Scraper.state.metadata.inSpace == true
    or false
  return state
end

function Scraper.setPollingPaused(paused, reason)
  paused = paused == true
  if Scraper.polling.paused == paused then
    if Scraper.state then
      updatePollingMetadata(nil)
      Scraper.publish()
    end
    return true
  end

  Scraper.polling.paused = paused
  Scraper.polling.pausedAt = paused and os.time() or nil
  Scraper.polling.pauseReason = paused and (trim(reason) ~= "" and trim(reason) or "manual") or nil

  if paused then
    cancelPollTimer()
    cancelSensorTickWait(true)
    Scraper.polling.sensorTickBypassPending = false
    Scraper.combat.projectileRadarPending = false
    safeKill("killTimer", Scraper.combat.projectileReconcileTimerId)
    Scraper.combat.projectileReconcileTimerId = nil
    safeKill("killTimer", Scraper.shields.damageTimerId)
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.damageTimerId = nil
    Scraper.shields.actionTimerId = nil
    if Scraper.active and Scraper.active.polled then
      abandonCapture("polling paused")
    end
    if Scraper.pendingCommandKind == "target" and completeTargetLock then
      completeTargetLock("rejected", "Polling paused before the target lock was confirmed.")
    end
    local shieldIntentId = Scraper.shields.manualIntentId
    Scraper.shields.manualIntentId = nil
    Scraper.shields.recharging = false
    Scraper.shields.awaiting = false
    Scraper.shields.attempts = 0
    Scraper.shields.statusPending = false
    Scraper.shields.checkForRecharge = false
    if Scraper.state then
      Scraper.state.metadata.shieldRecharging = false
      Scraper.state.metadata.shieldRechargeAttempts = 0
      Scraper.state.metadata.shieldStatusPending = false
    end
    if shieldIntentId and Scraper.proxy and type(Scraper.proxy.publishIntentAck) == "function" then
      Scraper.proxy.publishIntentAck(
        shieldIntentId,
        "rejected",
        "Polling paused before shield recharge completed."
      )
    end
  elseif Scraper.polling.enabled and Scraper.state and Scraper.state.metadata.inSpace == true then
    scheduleNextPoll(0.25)
  end

  if Scraper.state then
    updatePollingMetadata(nil)
    Scraper.publish()
  end
  diagnostic("info", paused and "telemetry polling paused" or "telemetry polling resumed")
  return true
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
    if Scraper.pendingCommandKind == "target" and completeTargetLock then
      completeTargetLock(
        "rejected",
        timeoutReason or "Target lock timed out without ship confirmation."
      )
      return
    end
    local expiredIntentId = Scraper.pendingCommandIntentId
    Scraper.pendingCommandIntentId = nil
    Scraper.pendingCommandKind = nil
    if
      expiredIntentId
      and timeoutReason
      and Scraper.proxy
      and type(Scraper.proxy.publishIntentAck) == "function"
    then
      Scraper.proxy.publishIntentAck(expiredIntentId, "rejected", timeoutReason)
    end
    scheduleNextPoll(0.25)
  end)
end

local function commandGateError()
  if Scraper.polling.paused then
    return "automatic polling is paused; resume polling before using Holocron3D commands"
  end
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
  if not Scraper.state then
    return
  end
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
  if Scraper.polling.paused or not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false
  end
  if Scraper.pendingCommandKind == "target" or Scraper.active then
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.actionTimerId = tempTimer(0.35, function()
      Scraper.shields.actionTimerId = nil
      requestShieldStatus(checkForRecharge)
    end)
    return false
  end
  local repeatDelay = automaticCommandRepeatDelay("status")
  if repeatDelay > 0 then
    profileCount("automaticCommandsThrottled")
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.actionTimerId = tempTimer(math.max(0.25, repeatDelay), function()
      Scraper.shields.actionTimerId = nil
      requestShieldStatus(checkForRecharge)
    end)
    return true
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
  markAutomaticCommandSent("status")
  local sent, sendResult, sendError = pcall(send, "status", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("shield status send failed")
    Scraper.shields.statusPending = false
    publishShieldState()
    diagnostic(
      "warn",
      "shield status check could not send: " .. tostring(sent and sendError or sendResult)
    )
    return false
  end
  return true
end

local function beginShieldRecharge(intentId)
  if Scraper.polling.paused then
    return false, "automatic polling is paused"
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "shield recharge is unavailable while landed"
  end
  if Scraper.pendingCommandKind == "target" then
    return false, "target lock is still concentrating; wait for Target Locked."
  end
  local shields = Scraper.state.observer.shields
  if
    type(shields) == "table"
    and tonumber(shields.maximum)
    and tonumber(shields.current)
    and tonumber(shields.current) >= tonumber(shields.maximum)
  then
    return false, "shields are already at peak power"
  end
  if Scraper.shields.recharging then
    return false, "shield recharge is already running"
  end
  Scraper.shields.recharging = true
  Scraper.shields.awaiting = false
  Scraper.shields.attempts = 0
  Scraper.shields.manualIntentId = intentId
  publishShieldState()
  sendRechargeAttempt()
  return true
end

sendRechargeAttempt = function()
  if Scraper.polling.paused or not Scraper.shields.recharging or Scraper.shields.awaiting then
    return
  end
  if Scraper.pendingCommandKind == "target" or Scraper.shields.statusPending then
    safeKill("killTimer", Scraper.shields.actionTimerId)
    Scraper.shields.actionTimerId = tempTimer(0.25, function()
      Scraper.shields.actionTimerId = nil
      sendRechargeAttempt()
    end)
    return
  end
  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by shield recharge")
  end
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
    if not Scraper.shields.recharging then
      return false
    end
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
    if
      type(Scraper.state.observer.shields) == "table"
      and Scraper.state.observer.shields.maximum
    then
      Scraper.state.observer.shields.current = Scraper.state.observer.shields.maximum
    end
    finishShieldRecharge("completed", response)
    return true
  end
  return false
end

function Scraper.handleShipHit(text, critical)
  local value = trim(text)
  local incomingWeapon, incomingSource
  if not critical then
    incomingWeapon, incomingSource = value:match("^You are hit by%s+(.+)%s+from%s+.-'([^']+)'!.*$")
  end
  if not critical and (not incomingWeapon or not incomingSource) then
    return false
  end
  Scraper.combat.lastActivityAt = os.time()
  if incomingWeapon and incomingSource then
    local weapon = normalizeWeapon(incomingWeapon)
    if weapon then
      local attacker = findEntity({ name = incomingSource })
      if attacker and attacker.kind == "ship" then
        attacker.disposition = "enemy"
      end
      publishImpactEvent(
        weapon,
        trim(Scraper.state.observer and Scraper.state.observer.name),
        "hit",
        incomingSource,
        1
      )
    end
  end
  if not Scraper.shields.auto then
    return true
  end
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
      if
        Scraper.shipGmcp.damageSequence ~= nil
        and (Scraper.shipGmcp.sequence or 0) <= Scraper.shipGmcp.damageSequence
      then
        Scraper.shipGmcp.damageSequence = nil
        requestShieldStatus(true)
      end
    end)
  end
  return true
end

local function gmcpNumber(info, key)
  if type(info) ~= "table" or info[key] == nil then
    return nil
  end
  return tonumber(info[key])
end

function Scraper.handleShipGmcp()
  local profiling = Scraper.profiler.enabled == true
  local profileStarted = profiling and os.clock() or nil
  if profiling then
    profileCount("shipGmcpEvents")
  end
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
  local posX, posY, posZ =
    gmcpNumber(info, "posX"), gmcpNumber(info, "posY"), gmcpNumber(info, "posZ")
  local headX, headY, headZ =
    gmcpNumber(info, "headX"), gmcpNumber(info, "headY"), gmcpNumber(info, "headZ")

  if speed ~= nil or maxSpeed ~= nil then
    observer.speed = observer.speed or {}
    if speed ~= nil then
      observer.speed.current = speed
    end
    if maxSpeed ~= nil then
      observer.speed.maximum = maxSpeed
    end
  end
  if energy ~= nil or maxEnergy ~= nil then
    observer.energy = observer.energy or {}
    if energy ~= nil then
      observer.energy.current = energy
    end
    if maxEnergy ~= nil then
      observer.energy.maximum = maxEnergy
    end
  end
  if hull ~= nil or maxHull ~= nil then
    observer.hull = observer.hull or {}
    if hull ~= nil then
      observer.hull.current = hull
    end
    if maxHull ~= nil then
      observer.hull.maximum = maxHull
    end
  end
  if shield ~= nil or maxShield ~= nil then
    observer.shields = observer.shields or {}
    if shield ~= nil then
      observer.shields.current = shield
    end
    if maxShield ~= nil then
      observer.shields.maximum = maxShield
    end
  end
  if posX ~= nil then
    observer.x = posX
  end
  if posY ~= nil then
    observer.y = posY
  end
  if posZ ~= nil then
    observer.z = posZ
  end
  if
    headX ~= nil
    and headY ~= nil
    and headZ ~= nil
    and (headX ~= 0 or headY ~= 0 or headZ ~= 0)
  then
    observer.heading = { x = headX, y = headY, z = headZ }
  end
  if info.piloting ~= nil then
    observer.piloting = info.piloting == true
      or info.piloting == 1
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
  releasePendingSensorPoll("gmcp", Scraper.shipGmcp.sequence)

  if
    Scraper.shipGmcp.damageSequence ~= nil
    and Scraper.shipGmcp.sequence > Scraper.shipGmcp.damageSequence
  then
    Scraper.shipGmcp.damageSequence = nil
    safeKill("killTimer", Scraper.shields.damageTimerId)
    Scraper.shields.damageTimerId = nil
    if
      Scraper.shields.auto
      and shield
      and maxShield
      and shield < maxShield
      and not Scraper.shields.recharging
    then
      beginShieldRecharge(nil)
    end
  end
  if Scraper.shields.recharging and shield and maxShield and shield >= maxShield then
    finishShieldRecharge("completed", "Shields confirmed at peak power by GMCP.")
  else
    Scraper.publish()
  end
  if profiling then
    profileTiming("ship_gmcp", profileStarted)
  end
  return true
end

ensureShieldsOn = function()
  if Scraper.polling.paused or not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false
  end
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
  payload = type(payload) == "table" and payload or {}
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "ship scanning is unavailable while landed"
  end
  local source = trim(payload.source):lower()
  if source ~= "status" and source ~= "info" then
    return false, "scan source must be status or info"
  end
  local observer = Scraper.state.observer or {}
  local targetId = trim(payload.targetId)
  local targetName = trim(payload.targetName)
  local isObserver = targetId == "player-ship"
    or (targetName ~= "" and targetName:lower() == trim(observer.name):lower())
  local target = isObserver and observer or findEntity({ id = targetId })
  if not target and targetName ~= "" then
    target = findEntity({ name = targetName })
  end

  local formationMember
  if not target then
    local metadata = Scraper.state.metadata or {}
    local visited = {}
    local function searchFleet(fleet)
      if formationMember or type(fleet) ~= "table" or visited[fleet] then
        return
      end
      visited[fleet] = true
      for _, member in ipairs(fleet.members or {}) do
        if
          (targetId ~= "" and trim(member.id):lower() == targetId:lower())
          or (targetName ~= "" and trim(member.name):lower() == targetName:lower())
        then
          formationMember = member
          return
        end
      end
    end
    searchFleet(metadata.fleet)
    for _, fleet in pairs(metadata.formations or {}) do
      searchFleet(fleet)
    end
    target = formationMember
  end

  local name = isObserver and trim(observer.name) or target and trim(target.name) or ""
  local targetIsShip = isObserver or target and (target.kind == nil or target.kind == "ship")
  if not target or not targetIsShip or name == "" or name:find("[%c\r\n]") then
    return false, "scan target is not present in the current snapshot"
  end

  if not isObserver and target.x ~= nil and target.y ~= nil and target.z ~= nil then
    local range = tonumber(observer.radarRange)
      or (500 + math.max(0, tonumber(observer.sensorArray) or 0) * 10)
    local distance = math.sqrt(
      (target.x - (observer.x or 0)) ^ 2
        + (target.y - (observer.y or 0)) ^ 2
        + (target.z - (observer.z or 0)) ^ 2
    )
    if distance > range then
      return false,
        string.format("target is %.0f units away; sensor range is %.0f", distance, range)
    end
  end

  if Scraper.active and not Scraper.active.polled then
    return false, "another manual telemetry capture is already active"
  end
  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by manual " .. source .. " scan")
    cancelPollTimer()
  end

  local command = isObserver and source or source .. " " .. name
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

  local key = isObserver and "player-ship" or scanKey(target)
  Scraper.scanState[key] = Scraper.scanState[key] or { statusAt = 0, infoAt = 0 }
  Scraper.scanState[key][source .. "At"] = os.time()
  return true
end

local function publishAutotrackState()
  if not Scraper.state then
    return
  end
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
    if not Scraper.autotrack.pending then
      return
    end
    completeAutotrack("rejected", "LotJ did not confirm the autotrack state.")
  end)
end

local function sendAutotrackToggle()
  if Scraper.polling.paused then
    return false, "automatic polling is paused"
  end
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
  if gateError then
    return false, gateError
  end
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
  elseif
    lower:find("disabled", 1, true)
    or lower:find("disengaged", 1, true)
    or lower:find("deactivated", 1, true)
    or lower:find("turned off", 1, true)
    or lower:match("%f[%a]off%f[%A]")
    or lower:find("no longer", 1, true)
  then
    observed = false
  elseif
    lower:find("enabled", 1, true)
    or lower:find("engaged", 1, true)
    or lower:find("activated", 1, true)
    or lower:find("turned on", 1, true)
    or lower:match("%f[%a]on%f[%A]")
  then
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
    if sent then
      return observed
    end
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

local function requestPendingTargetStatus()
  Scraper.combat.targetReconcileTimerId = nil
  if Scraper.polling.paused then
    if completeTargetLock then
      completeTargetLock("rejected", "Polling paused before the target lock was confirmed.")
    end
    return false
  end
  if Scraper.pendingCommandKind ~= "target" then
    return false
  end
  if Scraper.active then
    Scraper.combat.targetReconcileTimerId = tempTimer(0.5, requestPendingTargetStatus)
    return true
  end

  local started, startError = Scraper.startCapture("status", "status", {
    polled = true,
    targetReconciliation = true,
  })
  if not started then
    completeTargetLock(
      "rejected",
      "Target lock could not be verified by status: " .. tostring(startError)
    )
    return false
  end
  updatePollingMetadata("status")
  Scraper.polling.dispatching = true
  markAutomaticCommandSent("status")
  local sent, sendResult, sendError = pcall(send, "status", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("target reconciliation status send failed")
    completeTargetLock(
      "rejected",
      "Target lock could not be verified by status: " .. tostring(sent and sendError or sendResult)
    )
    return false
  end
  diagnostic("info", "target lock still unconfirmed; requesting authoritative ship status")
  return true
end

local function dispatchTargetShip(payload, message)
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "ship targeting is unavailable while landed"
  end
  local target = findEntity({ id = trim(payload.targetId) })
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
  holdPollingForCommand(
    message and message.id or nil,
    35,
    "Target lock timed out without confirmation from LotJ or ship status.",
    "target"
  )
  Scraper.combat.pendingTargetName = name
  Scraper.combat.pendingTargetContext = type(payload.targetContext) == "table"
      and copyTable(payload.targetContext)
    or nil
  Scraper.combat.pendingTargetPreviousName = Scraper.combat.targetName
  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "target " .. name)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    Scraper.combat.pendingTargetName = nil
    Scraper.combat.pendingTargetContext = nil
    Scraper.combat.pendingTargetPreviousName = nil
    resolvePendingCommand("rejected", tostring(sent and sendError or sendResult), 0.25)
    return false, tostring(sent and sendError or sendResult)
  end

  safeKill("killTimer", Scraper.combat.targetReconcileTimerId)
  Scraper.combat.targetReconcileTimerId =
    tempTimer(Scraper.TARGET_RECONCILE_SECONDS, requestPendingTargetStatus)
  return true
end

completeTargetLock = function(status, reason)
  if Scraper.pendingCommandKind ~= "target" then
    return false
  end
  local pendingTargetName = trim(Scraper.combat.pendingTargetName)
  local previousTargetName = trim(Scraper.combat.pendingTargetPreviousName)
  safeKill("killTimer", Scraper.combat.targetReconcileTimerId)
  Scraper.combat.targetReconcileTimerId = nil
  if status == "completed" then
    Scraper.combat.targetName = pendingTargetName
    Scraper.state.observer.target = Scraper.combat.targetName
    Scraper.state.metadata.combatTarget = Scraper.combat.targetName
    local context = Scraper.combat.pendingTargetContext
      or {
        key = "local",
        scope = "local",
        ownerId = "player-ship",
        ownerName = trim(Scraper.state.observer and Scraper.state.observer.name),
        ownerLabel = "YOUR SHIP'S TARGET",
      }
    rememberCombatTarget(context.key or "local", Scraper.combat.targetName, context)
    if (context.key or "local") ~= "local" then
      rememberCombatTarget("local", Scraper.combat.targetName, {
        scope = "local",
        ownerId = "player-ship",
        ownerName = trim(Scraper.state.observer and Scraper.state.observer.name),
        ownerLabel = "YOUR SHIP'S TARGET",
      })
    end
    local target = findEntity({ name = pendingTargetName })
    if target then
      target.disposition = "enemy"
    end
  elseif
    pendingTargetName ~= ""
    and trim(Scraper.combat.targetName):lower() == pendingTargetName:lower()
    and previousTargetName:lower() ~= pendingTargetName:lower()
  then
    Scraper.combat.targetName = previousTargetName ~= "" and previousTargetName or nil
    Scraper.state.observer.target = Scraper.combat.targetName
    Scraper.state.metadata.combatTarget = Scraper.combat.targetName
    rememberCombatTarget("local", previousTargetName, {
      scope = "local",
      ownerId = "player-ship",
      ownerName = trim(Scraper.state.observer and Scraper.state.observer.name),
      ownerLabel = "YOUR SHIP'S TARGET",
    })
  end
  Scraper.combat.pendingTargetName = nil
  Scraper.combat.pendingTargetContext = nil
  Scraper.combat.pendingTargetPreviousName = nil
  resolvePendingCommand(status, reason, 0.25)
  Scraper.publish()
  if
    status == "completed"
    and Scraper.autotrack.desired
    and Scraper.autotrack.observed ~= true
    and not Scraper.autotrack.pending
  then
    local tracking, trackingError = requestAutotrack(true)
    if not tracking then
      diagnostic(
        "warn",
        "target locked but autotrack could not be enabled: " .. tostring(trackingError)
      )
    end
  end
  return true
end

function Scraper.setDisposition(name, disposition)
  if disposition ~= "neutral" and disposition ~= "ally" and disposition ~= "enemy" then
    return nil, "disposition must be neutral, ally, or enemy"
  end
  local entity = findEntity({ name = name })
  if not entity or entity.kind ~= "ship" then
    return nil, "ship is not currently known"
  end
  entity.disposition = disposition
  Scraper.publish()
  return true
end

function Scraper.handleIncomingTargeting(text)
  local shipName = trim(text):match("^You are being targeted by .-'([^']+)'%.?$")
  if not shipName then
    return false
  end
  Scraper.combat.lastActivityAt = os.time()
  local marked, markError = Scraper.setDisposition(shipName, "enemy")
  if not marked then
    diagnostic(
      "warn",
      "could not mark targeting ship " .. shipName .. " as enemy: " .. tostring(markError)
    )
    return false
  end
  diagnostic("info", shipName .. " targeted the observer and was marked enemy")
  return true
end

local FIRE_COMMANDS = {
  autoblaster = { command = "fire autoblaster", field = "autoblasters" },
  laser = { command = "fire laser", field = "laserCannons" },
  turbolaser = { command = "fire turbolaser", field = "turbolasers" },
  ion = { command = "fire ion", field = "ionCannons" },
  missile = {
    command = "fire missile",
    field = "maximumMissiles",
    launcher = true,
    ammo = "missiles",
  },
  torpedo = {
    command = "fire torpedo",
    field = "maximumTorpedoes",
    launcher = true,
    ammo = "torpedoes",
  },
  rocket = { command = "fire rocket", field = "maximumRockets", launcher = true, ammo = "rockets" },
  burst = { command = "fire burst", field = "maximumPulses", launcher = true },
}
local FIRE_ORDER =
  { "autoblaster", "laser", "turbolaser", "ion", "missile", "torpedo", "rocket", "burst" }

local function installedFireCommands(requested)
  if requested == "best" then
    return { { weapon = "best", command = "fire" } }
  end
  local weapons = Scraper.state.observer.weapons or {}
  local function installed(weapon)
    local definition = FIRE_COMMANDS[weapon]
    local ammunition = definition and definition.ammo and Scraper.state.observer[definition.ammo]
      or nil
    local depleted = type(ammunition) == "table" and tonumber(ammunition.current) == 0
    return definition
      and not depleted
      and tonumber(weapons[definition.field] or 0) > 0
      and (not definition.launcher or tonumber(weapons.missileTubes or 0) > 0)
  end
  local commands = {}
  if requested == "all" then
    for _, weapon in ipairs(FIRE_ORDER) do
      if installed(weapon) then
        table.insert(commands, { weapon = weapon, command = FIRE_COMMANDS[weapon].command })
      end
    end
  elseif installed(requested) then
    table.insert(commands, { weapon = requested, command = FIRE_COMMANDS[requested].command })
  end
  return commands
end

local function dispatchFireWeapon(payload)
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "weapons are unavailable while landed"
  end
  if Scraper.state.observer.hasWeapons == false then
    return false, "this ship has no weapons"
  end
  if not Scraper.combat.targetName then
    return false, "no combat target is locked"
  end
  local requested = trim(payload.weapon):lower()
  if requested ~= "all" and requested ~= "best" and not FIRE_COMMANDS[requested] then
    return false, "unsupported weapon type"
  end
  local commands = installedFireCommands(requested)
  if #commands == 0 then
    return false, "requested weapon is not installed"
  end

  cancelPollTimer()
  local interruptedShieldCheck = Scraper.shields.statusPending == true
  if Scraper.active then
    abandonCapture("superseded by weapons command")
  end
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
  best = "fire",
  all = "fire",
  autoblaster = "fire autoblaster",
  laser = "fire laser",
  turbolaser = "fire turbolaser",
  ion = "fire ion",
  missile = "fire missile",
  torpedo = "fire torpedo",
  rocket = "fire rocket",
  burst = "fire burst",
}
local FLEET_WEAPON_FIELDS = {
  { weapon = "autoblaster", field = "autoblasters" },
  { weapon = "laser", field = "laserCannons" },
  { weapon = "turbolaser", field = "turbolasers" },
  { weapon = "ion", field = "ionCannons" },
  { weapon = "missile", field = "maximumMissiles", launcher = true },
  { weapon = "torpedo", field = "maximumTorpedoes", launcher = true },
  { weapon = "rocket", field = "maximumRockets", launcher = true },
  { weapon = "burst", field = "maximumPulses", launcher = true },
}

local function knownFleetMemberFireCommands(member)
  local entity = findEntity({ name = member.name })
  local weapons = entity and entity.weapons or nil
  if type(weapons) ~= "table" then
    return { "fire" }
  end
  local commands = {}
  for _, definition in ipairs(FLEET_WEAPON_FIELDS) do
    local installed = tonumber(weapons[definition.field] or 0) > 0
      and (not definition.launcher or tonumber(weapons.missileTubes or 0) > 0)
    if installed then
      table.insert(commands, FLEET_WEAPONS[definition.weapon])
    end
  end
  if #commands == 0 then
    table.insert(commands, "fire")
  end
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
  for _, fire in ipairs(installedFireCommands("all")) do
    add(fire.command)
  end
  for _, member in ipairs(fleet.members or {}) do
    if not member.leader then
      for _, command in ipairs(knownFleetMemberFireCommands(member)) do
        add(command)
      end
    end
  end
  if #commands == 0 then
    table.insert(commands, "fire")
  end
  return commands
end

local fleetRole

local function currentFleet()
  local fleet = Scraper.state and Scraper.state.metadata and Scraper.state.metadata.fleet or nil
  if type(fleet) ~= "table" or fleet.active ~= true then
    return nil
  end
  return fleet
end

local function dispatchTacticalViewRequest(payload, message)
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "remote tactical views are unavailable while landed"
  end
  local fleet = currentFleet()
  if not fleet or fleet.kind ~= "battlegroup" then
    return false, "an active battlegroup is required for a remote tactical view"
  end
  if fleetRole(fleet) ~= "commander" then
    return false, "only the battlegroup flagship can request a wing tactical view"
  end

  local member =
    findFormationMember(fleet, payload.memberName, payload.memberSlot, payload.memberId)
  if not member then
    return false, "the selected battlegroup member is no longer available"
  end
  local observerName = trim(Scraper.state.observer and Scraper.state.observer.name)
  if member.leader == true or trim(member.name):lower() == observerName:lower() then
    return false, "the flagship already owns the local tactical view"
  end

  if Scraper.active and not Scraper.active.polled then
    return false, "another manual telemetry capture is already active"
  end
  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by remote tactical view request")
    cancelPollTimer()
  end

  local command = "battlegroup nav " .. trim(member.name) .. " radar"
  local started, startError = Scraper.startCapture("radar", command, {
    polled = true,
    pollDelay = Scraper.polling.commandGapSeconds,
    intentId = message and message.id or nil,
    remoteViewMemberKey = formationMemberKey(member),
    remoteViewMemberId = trim(member.id or member.name):lower(),
    remoteViewMemberName = trim(member.name),
    remoteViewMemberSlot = member.slot,
    remoteViewMember = member,
  })
  if not started then
    return false, startError
  end

  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, command, false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("remote tactical radar could not be sent")
    return false, tostring(sent and sendError or sendResult)
  end
  return true
end

reconcileTargetFromStatus = function(result, failure)
  if Scraper.pendingCommandKind ~= "target" then
    return false
  end
  if failure then
    return completeTargetLock(
      "rejected",
      "Target lock could not be verified by status: " .. tostring(failure)
    )
  end
  local requested = trim(Scraper.combat.pendingTargetName)
  local observed = trim(result and result.target)
  observed = observed:lower() == "none" and observed or observed:match("'([^']+)'") or observed
  if observed ~= "" and observed:lower() == requested:lower() then
    return completeTargetLock("completed", "Target confirmed by ship status.")
  end
  local reported = observed == "" and "no target field"
    or observed:lower() == "none" and "no active target"
    or ("target " .. observed)
  return completeTargetLock(
    "rejected",
    "Target lock was not confirmed; ship status reports " .. reported .. "."
  )
end

fleetRole = function(fleet)
  local observerName =
    trim(Scraper.state and Scraper.state.observer and Scraper.state.observer.name):lower()
  for _, member in ipairs(fleet.members or {}) do
    if trim(member.name):lower() == observerName then
      if member.leader == true or member.role == "leader" then
        return "commander"
      end
      return member.role or "member"
    end
  end
  return fleet.role
end

local function dispatchClearCombatTarget(payload)
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if not Scraper.state or not Scraper.state.metadata or Scraper.state.metadata.inSpace ~= true then
    return false, "combat targets cannot be cleared while landed"
  end

  local rawKeys = type(payload.targetKeys) == "table" and payload.targetKeys or {}
  if #rawKeys == 0 or #rawKeys > 32 then
    return false, "one to thirty-two active target keys are required"
  end
  local metadata = Scraper.state.metadata
  local activeTargets = type(metadata.combatTargets) == "table" and metadata.combatTargets or {}
  local tracks, seenKeys = {}, {}
  for _, rawKey in ipairs(rawKeys) do
    local key = trim(rawKey):lower()
    if key == "" or key:find("[%c\r\n]") then
      return false, "an active target key is invalid"
    end
    if not seenKeys[key] then
      local track = activeTargets[key]
      if
        type(track) ~= "table"
        and key == "local"
        and trim(metadata.combatTarget):lower() ~= ""
        and trim(metadata.combatTarget):lower() ~= "none"
      then
        track = { key = "local", scope = "local", targetName = metadata.combatTarget }
      end
      if type(track) ~= "table" then
        return false, "the selected target scope is no longer active"
      end
      seenKeys[key] = true
      table.insert(tracks, { key = key, track = track })
    end
  end

  local fleet = currentFleet()
  local commands, seenCommands = {}, {}
  local clearsLocal = false
  local function addCommand(command)
    if not seenCommands[command] then
      seenCommands[command] = true
      table.insert(commands, command)
    end
  end
  local function requireBattlegroup()
    if not fleet or fleet.kind ~= "battlegroup" then
      return nil, "the battlegroup target is no longer active"
    end
    if fleetRole(fleet) ~= "commander" then
      return nil, "only the battlegroup flagship can clear formation targets"
    end
    return true
  end
  local function resolveOwnerMembers(track)
    local requestedIds = type(track.ownerIds) == "table" and track.ownerIds or {}
    local requestedNames = type(track.ownerNames) == "table" and track.ownerNames or {}
    if #requestedIds == 0 and trim(track.ownerId) ~= "" then
      requestedIds = { track.ownerId }
    end
    if #requestedNames == 0 and trim(track.ownerName) ~= "" then
      requestedNames = { track.ownerName }
    end
    local members, seenMembers = {}, {}
    for _, member in ipairs(fleet and fleet.members or {}) do
      local memberId = trim(member.id):lower()
      local memberName = trim(member.name):lower()
      local requested = false
      if #requestedNames > 0 then
        for _, ownerName in ipairs(requestedNames) do
          if memberName ~= "" and memberName == trim(ownerName):lower() then
            requested = true
          end
        end
      else
        for _, ownerId in ipairs(requestedIds) do
          if memberId ~= "" and memberId == trim(ownerId):lower() then
            requested = true
          end
        end
      end
      local memberKey = formationMemberKey(member)
      if requested and not seenMembers[memberKey] then
        seenMembers[memberKey] = true
        table.insert(members, member)
      end
    end
    return members
  end

  for _, entry in ipairs(tracks) do
    local scope = trim(entry.track.scope):lower()
    if scope == "local" or scope == "squadron" then
      addCommand("target none")
    elseif scope == "all" then
      local valid, reason = requireBattlegroup()
      if not valid then
        return false, reason
      end
      addCommand("bg target all none")
    elseif scope == "wings" then
      local valid, reason = requireBattlegroup()
      if not valid then
        return false, reason
      end
      for _, member in ipairs(fleet.members or {}) do
        local memberName = trim(member.name)
        if not member.leader and memberName ~= "" then
          if memberName:find("[%c\r\n]") then
            return false, "a battlegroup target owner name is invalid"
          end
          addCommand("bg target " .. memberName .. " none")
        end
      end
    elseif scope == "selected" then
      local valid, reason = requireBattlegroup()
      if not valid then
        return false, reason
      end
      local members = resolveOwnerMembers(entry.track)
      if #members == 0 then
        return false, "the selected battlegroup target owner is no longer available"
      end
      for _, member in ipairs(members) do
        local memberName = trim(member.name)
        if memberName == "" or memberName:find("[%c\r\n]") then
          return false, "a battlegroup target owner name is invalid"
        end
        if
          memberName:lower() == trim(Scraper.state.observer and Scraper.state.observer.name):lower()
        then
          addCommand("target none")
          clearsLocal = true
        else
          addCommand("bg target " .. memberName .. " none")
        end
      end
    else
      return false, "unsupported combat target scope"
    end
  end
  if #commands == 0 then
    return false, "no ships own the selected target"
  end

  cancelPollTimer()
  Scraper.polling.dispatching = true
  for _, command in ipairs(commands) do
    local sent, sendResult, sendError = pcall(send, command, false)
    if not sent or sendResult == false then
      Scraper.polling.dispatching = false
      scheduleNextPoll(0.25)
      return false, tostring(sent and sendError or sendResult)
    end
  end
  Scraper.polling.dispatching = false

  for _, entry in ipairs(tracks) do
    activeTargets[entry.key] = nil
    local scope = trim(entry.track.scope):lower()
    if scope == "local" or scope == "squadron" or clearsLocal then
      Scraper.combat.targetName = nil
      Scraper.state.observer.target = nil
      metadata.combatTarget = nil
    end
  end
  metadata.combatTargets = activeTargets
  Scraper.publish()
  scheduleNextPoll(0.25)
  return true
end

local function roundedVector(payload)
  local vectorValue = type(payload.vector) == "table" and payload.vector or {}
  local values = { tonumber(vectorValue.x), tonumber(vectorValue.y), tonumber(vectorValue.z) }
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
  return string.format(
    "course relative %d %d %d",
    round(values[1]),
    round(values[2]),
    round(values[3])
  )
end

local function fleetNavigationCommand(payload)
  local mode = trim(payload.mode):lower()
  if mode == "relative" then
    return roundedVector(payload)
  end
  if mode ~= "target" and mode ~= "away" then
    return nil, "unsupported fleet navigation mode"
  end
  local target = findPayloadTarget(payload)
  local name = target and trim(target.name) or ""
  if name == "" or name:find("[%c\r\n]") then
    return nil, "navigation target is not present in the current snapshot"
  end
  return mode == "away" and ("course away " .. name) or ("course " .. name)
end

recountFleetOrder = function(order)
  local accepted, rejected, awaiting = 0, 0, 0
  for _, result in pairs(order.results or {}) do
    if result.status == "accepted" then
      accepted = accepted + 1
    elseif result.status == "rejected" then
      rejected = rejected + 1
    else
      awaiting = awaiting + 1
    end
  end
  order.acceptedCount = accepted
  order.rejectedCount = rejected
  order.pendingCount = awaiting
  if rejected > 0 then
    order.status = "partial"
  elseif awaiting > 0 then
    order.status = "awaiting"
  elseif accepted > 0 then
    order.status = "accepted"
  else
    order.status = "transmitted"
  end
end

local function setFleetAutopilotState(name, enabled, statusText)
  local wanted = trim(name):lower()
  if wanted == "" then
    return
  end
  local metadata = Scraper.state and Scraper.state.metadata or {}
  local observer = Scraper.state and Scraper.state.observer or {}
  if trim(observer.name):lower() == wanted then
    observer.autopilot = enabled
    observer.autopilotStatus = statusText
  end
  local entity = findEntity({ name = name })
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
  for _, fleet in pairs(metadata.formations or {}) do
    updateFleet(fleet)
  end
end

local function queueAutopilotVerification(orderId)
  safeKill("killTimer", Scraper.fleetCommand.verificationTimerId)
  Scraper.fleetCommand.verificationTimerId = tempTimer(3, function()
    Scraper.fleetCommand.verificationTimerId = nil
    local order = Scraper.state and Scraper.state.metadata and Scraper.state.metadata.fleetOrder
      or nil
    if type(order) ~= "table" or order.id ~= orderId or order.order ~= "autopilot" then
      return
    end
    local queue = Scraper.polling.hydrationQueue or {}
    local queued = {}
    for _, command in ipairs(queue) do
      queued[command:lower()] = true
    end
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
    if #queue > 0 then
      scheduleNextPoll(0.1)
    end
  end)
end

function Scraper.handleFleetCommandLine(text)
  local message = trim(text)
  local memberName = message:match("^Sending command to .-'([^']+)'%.%.%.$")
  local capture = Scraper.active
  if memberName and capture and capture.remoteViewMemberId then
    capture.remoteResponseMemberName = memberName
    if trim(memberName):lower() ~= trim(capture.remoteViewMemberName):lower() then
      local reason = "remote radar response belonged to "
        .. trim(memberName)
        .. " instead of "
        .. trim(capture.remoteViewMemberName)
      if
        capture.intentId
        and Scraper.proxy
        and type(Scraper.proxy.publishIntentAck) == "function"
      then
        Scraper.proxy.publishIntentAck(capture.intentId, "rejected", reason)
      end
      abandonCapture(reason)
      return true
    end
    return true
  end
  if memberName then
    Scraper.fleetCommand.currentMemberName = memberName
  end
  local order = Scraper.state and Scraper.state.metadata and Scraper.state.metadata.fleetOrder
    or nil
  if type(order) ~= "table" or os.time() - tonumber(order.observedAt or 0) > 30 then
    return memberName ~= nil
  end

  if memberName then
    order.results = order.results or {}
    order.results[memberName] = {
      name = memberName,
      status = "awaiting",
      observedAt = os.time(),
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
  if not memberName or type(order.results) ~= "table" then
    return false
  end
  local result = order.results[memberName]
  if type(result) ~= "table" then
    result = { name = memberName, status = "awaiting", observedAt = os.time() }
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
    or message == "You're already traveling that speed."
  if not rejected and not accepted then
    return false
  end

  result.status = rejected and "rejected" or "accepted"
  result.reason = rejected and message or nil
  result.observedAt = os.time()
  if accepted and order.order == "speed" and tonumber(order.speed) then
    mergeFormationMemberTelemetry(memberName, { speed = tonumber(order.speed) })
  end
  Scraper.fleetCommand.currentMemberName = nil
  recountFleetOrder(order)
  Scraper.publish()
  return true
end

local function sendFleetCommands(commands, order, scope, context)
  cancelPollTimer()
  if Scraper.active then
    abandonCapture("superseded by fleet " .. order .. " order")
  end
  Scraper.fleetCommand.nextOrderId = (Scraper.fleetCommand.nextOrderId or 0) + 1
  Scraper.fleetCommand.currentMemberName = nil
  Scraper.fleetCommand.holdUntil = os.time() + 4
  local fleetOrder = {
    id = Scraper.fleetCommand.nextOrderId,
    order = order,
    scope = scope,
    status = "transmitted",
    observedAt = os.time(),
    commandCount = #commands,
    acceptedCount = 0,
    rejectedCount = 0,
    pendingCount = 0,
    results = {},
  }
  if type(context) == "table" then
    for key, value in pairs(context) do
      if key ~= "targetRecord" then
        fleetOrder[key] = type(value) == "table" and copyTable(value) or value
      end
    end
  end
  if order == "autopilot" then
    local fleet = currentFleet()
    local observerName = trim(Scraper.state.observer and Scraper.state.observer.name)
    for _, member in ipairs(fleet and fleet.members or {}) do
      local selectedNames = {}
      for _, name in ipairs(type(context) == "table" and context.recipientNames or {}) do
        selectedNames[trim(name):lower()] = true
      end
      local included = scope == "all"
        or scope == "wings" and not member.leader
        or scope == "local" and trim(member.name):lower() == observerName:lower()
        or scope == "selected" and selectedNames[trim(member.name):lower()] == true
      if included then
        fleetOrder.results[member.name] = {
          name = member.name,
          status = "awaiting",
          observedAt = os.time(),
        }
      end
    end
    if scope == "local" and next(fleetOrder.results) == nil and observerName ~= "" then
      fleetOrder.results[observerName] = {
        name = observerName,
        status = "awaiting",
        observedAt = os.time(),
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
  if order == "target" and type(context) == "table" and type(context.targetRecord) == "table" then
    local record = context.targetRecord
    rememberCombatTarget(record.key, record.targetName, record.details)
    if record.localShip then
      Scraper.combat.targetName = trim(record.targetName)
      Scraper.state.observer.target = Scraper.combat.targetName
      Scraper.state.metadata.combatTarget = Scraper.combat.targetName
      if record.key ~= "local" then
        rememberCombatTarget("local", record.targetName, {
          scope = "local",
          ownerId = "player-ship",
          ownerName = trim(Scraper.state.observer and Scraper.state.observer.name),
          ownerLabel = "YOUR SHIP'S TARGET",
        })
      end
    end
    Scraper.publish()
  end
  if order == "autopilot" then
    queueAutopilotVerification(fleetOrder.id)
  end
  scheduleNextPoll(2)
  return true
end

local function dispatchFleetOrder(payload, message)
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if not Scraper.state or Scraper.state.metadata.inSpace ~= true then
    return false, "fleet commands are unavailable while landed"
  end
  local fleet = currentFleet()
  if not fleet then
    return false, "no active battlegroup or squadron was detected"
  end
  local scope = trim(payload.scope):lower()
  if scope ~= "local" and scope ~= "all" and scope ~= "wings" and scope ~= "selected" then
    return false, "fleet scope must be local, all, wings, or selected"
  end
  local selectedMembers
  if scope == "selected" then
    selectedMembers, gateError = selectedFormationMembers(payload, fleet)
    if not selectedMembers then
      return false, gateError
    end
  end
  local order = trim(payload.order):lower()
  local target
  if order == "target" then
    target = findPayloadTarget(payload)
    if
      not target
      or target.kind ~= "ship"
      or trim(target.name) == ""
      or trim(target.name):find("[%c\r\n]")
    then
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
      if not localCommand then
        return false, gateError
      end
    elseif order == "speed" then
      local speed = tonumber(payload.speed)
      if not speed or speed ~= speed or speed < 0 or speed > 10000000 then
        return false, "fleet speed is outside supported limits"
      end
      localCommand = "speed " .. tostring(math.floor(speed + 0.5))
    elseif order == "fire" then
      local weapon = trim(payload.weapon):lower()
      localCommand = FLEET_WEAPONS[weapon]
      if not localCommand then
        return false, "unsupported fleet weapon"
      end
    elseif order == "recharge" then
      localCommand = "recharge"
    elseif order == "shields_on" then
      localCommand = "shields on"
    elseif order == "chaff" then
      localCommand = "chaff"
    elseif order == "autopilot" then
      localCommand = "autopilot"
    elseif order ~= "target" then
      return false, "unsupported battlegroup order"
    end

    local commands = {}
    local fireAll = order == "fire" and trim(payload.weapon):lower() == "all"
    local observerName = trim(Scraper.state.observer and Scraper.state.observer.name)
    if observerName == "" then
      return false, "the battlegroup flagship name is unavailable"
    end
    local departureSpeed
    if order == "navigate" and payload.departureSpeed ~= nil then
      departureSpeed = tonumber(payload.departureSpeed)
      if
        not departureSpeed
        or departureSpeed ~= departureSpeed
        or departureSpeed <= 0
        or departureSpeed > 10000000
      then
        return false, "fleet departure speed is outside supported limits"
      end
      departureSpeed = math.floor(departureSpeed + 0.5)
    end
    local recipients = {}
    if scope == "all" then
      table.insert(recipients, { selector = "all" })
    elseif scope == "local" then
      table.insert(recipients, { selector = observerName, localShip = true })
    elseif scope == "selected" then
      for _, member in ipairs(selectedMembers) do
        table.insert(recipients, {
          selector = trim(member.name),
          member = member,
          localShip = trim(member.name):lower() == observerName:lower(),
        })
      end
    else
      for _, member in ipairs(fleet.members or {}) do
        if not member.leader and tonumber(member.slot) then
          table.insert(recipients, { selector = tostring(member.slot), member = member })
        end
      end
    end
    if #recipients == 0 then
      return false, "no ships are available in the selected fleet scope"
    end

    if order == "target" then
      if scope == "local" and Scraper.state.observer.hasWeapons == false then
        return false, "this ship has no weapons"
      end
      for _, recipient in ipairs(recipients) do
        if recipient.localShip then
          table.insert(commands, "target " .. trim(target.name))
        else
          table.insert(
            commands,
            "battlegroup target " .. recipient.selector .. " " .. trim(target.name)
          )
        end
      end
      local targetDetails = { scope = scope, formationKind = "battlegroup" }
      local targetKey
      local localTarget = false
      if scope == "local" then
        targetKey = "local"
        targetDetails.ownerId = "player-ship"
        targetDetails.ownerName = observerName
        targetDetails.ownerLabel = "YOUR SHIP'S TARGET"
        localTarget = true
      elseif scope == "all" then
        targetKey = "fleet"
        targetDetails.ownerLabel = "FLEET TARGET"
      elseif scope == "wings" then
        targetKey = "wings"
        targetDetails.ownerLabel = "WING TARGET"
      else
        local ownerIds, ownerNames, ownerKeys = {}, {}, {}
        for _, member in ipairs(selectedMembers) do
          table.insert(ownerIds, trim(member.id or member.name):lower())
          table.insert(ownerNames, trim(member.name))
          table.insert(ownerKeys, trim(member.name or member.id):lower())
          if trim(member.name):lower() == observerName:lower() then
            localTarget = true
          end
        end
        targetKey = "selected:" .. table.concat(ownerKeys, ",")
        targetDetails.ownerIds = ownerIds
        targetDetails.ownerNames = ownerNames
        if #selectedMembers == 1 then
          targetDetails.ownerId = selectedMembers[1].id
          targetDetails.ownerName = selectedMembers[1].name
          targetDetails.ownerLabel = trim(selectedMembers[1].name):upper() .. "'S TARGET"
        else
          targetDetails.ownerLabel = tostring(#selectedMembers) .. " SELECTED CRAFT TARGET"
        end
      end
      payload.targetRecord = {
        key = targetKey,
        targetName = trim(target.name),
        details = targetDetails,
        localShip = localTarget,
      }
    else
      if order == "fire" and scope == "local" and Scraper.state.observer.hasWeapons == false then
        return false, "this ship has no weapons"
      end
      for _, recipient in ipairs(recipients) do
        if departureSpeed then
          if recipient.localShip then
            table.insert(commands, "speed " .. tostring(departureSpeed))
          else
            table.insert(
              commands,
              "battlegroup nav " .. recipient.selector .. " speed " .. tostring(departureSpeed)
            )
          end
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
            if #fireCommands == 0 then
              table.insert(fireCommands, "fire")
            end
          else
            fireCommands = knownFleetMemberFireCommands(recipient.member)
          end
          for _, fireCommand in ipairs(fireCommands) do
            if recipient.localShip then
              table.insert(commands, fireCommand)
            else
              table.insert(commands, "battlegroup nav " .. recipient.selector .. " " .. fireCommand)
            end
          end
        else
          if recipient.localShip then
            table.insert(commands, localCommand)
          else
            table.insert(commands, "battlegroup nav " .. recipient.selector .. " " .. localCommand)
          end
        end
      end
    end
    local recipientNames = {}
    for _, recipient in ipairs(recipients) do
      if recipient.member then
        table.insert(recipientNames, recipient.member.name)
      elseif recipient.localShip then
        table.insert(recipientNames, observerName)
      end
    end
    local orderContext = { recipientNames = recipientNames }
    if order == "fire" then
      orderContext.weapon = trim(payload.weapon):lower()
    elseif order == "target" then
      orderContext.targetName = trim(target.name)
      orderContext.targetRecord = payload.targetRecord
    elseif order == "speed" then
      orderContext.speed = math.floor(tonumber(payload.speed) + 0.5)
    end
    return sendFleetCommands(commands, order, scope, orderContext)
  end

  if fleet.kind ~= "squadron" then
    return false, "unsupported formation type"
  end
  -- Squadron formation actions use LotJ's native squadron channel. Movement,
  -- targeting, and fire remain lead-cockpit actions which wingmen inherit.
  local squadronScope = scope == "selected" and "local" or scope
  local commands = {}
  if order == "roll" or order == "chaff" then
    if squadronScope == "local" then
      return false, "use the local ship controls for a lead-ship-only " .. order
    end
    table.insert(commands, "squadron " .. order)
  elseif order == "assist" then
    table.insert(commands, "squadron assist")
  elseif order == "aim" then
    local system = trim(payload.system):lower()
    local allowed = {
      none = true,
      launcher = true,
      laser = true,
      ion = true,
      turret = true,
      tractor = true,
    }
    if not allowed[system] then
      return false, "unsupported squadron aim system"
    end
    table.insert(commands, "squadron aim " .. system)
  elseif order == "target" then
    if squadronScope == "wings" then
      return false, "squadron wings inherit the lead ship's target"
    end
    return dispatchTargetShip({
      targetId = target.id,
      targetContext = {
        key = "squadron",
        scope = "squadron",
        formationKind = "squadron",
        ownerLabel = "SQUADRON TARGET",
      },
    }, message)
  elseif order == "fire" then
    if squadronScope == "wings" then
      return false, "squadron wings fire through Fire Assist"
    end
    return dispatchFireWeapon({ weapon = trim(payload.weapon):lower() })
  elseif order == "navigate" then
    if squadronScope == "wings" then
      return false, "squadron wings follow the lead ship automatically"
    end
    local command, commandError = fleetNavigationCommand(payload)
    if not command then
      return false, commandError
    end
    if payload.departureSpeed ~= nil then
      local departureSpeed = tonumber(payload.departureSpeed)
      if
        not departureSpeed
        or departureSpeed ~= departureSpeed
        or departureSpeed <= 0
        or departureSpeed > 10000000
      then
        return false, "squadron departure speed is outside supported limits"
      end
      table.insert(commands, "speed " .. tostring(math.floor(departureSpeed + 0.5)))
    end
    table.insert(commands, command)
  elseif order == "speed" then
    if squadronScope == "wings" then
      return false, "squadron wings follow the lead ship automatically"
    end
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
  if Scraper.polling.paused then
    return false, "automatic polling is paused"
  end
  if hyperspaceTransitActive() then
    return false, "radar is unavailable during hyperspace transit"
  end
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
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
  if not started then
    return false, startError
  end

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

local function dispatchLocalHyperspaceRadar(_, message)
  if Scraper.polling.paused then
    return false, "automatic polling is paused"
  end
  if hyperspaceTransitActive() then
    return false, "radar is unavailable during hyperspace transit"
  end
  local gateError = commandGateError()
  if gateError then
    return false, gateError
  end
  if Scraper.active then
    return false, "another telemetry refresh is active"
  end

  cancelPollTimer()
  local started, startError = Scraper.startCapture("radar", "radar", {
    polled = true,
    pollDelay = 0.25,
    intentId = message and message.id or nil,
  })
  if not started then
    return false, startError
  end

  Scraper.polling.dispatching = true
  local sent, sendResult, sendError = pcall(send, "radar", false)
  Scraper.polling.dispatching = false
  if not sent or sendResult == false then
    abandonCapture("local hyperspace radar refresh could not be sent")
    return false, tostring(sent and sendError or sendResult)
  end
  return true
end

function Scraper.handleOutgoingCommand(eventName, command)
  if Scraper.polling.dispatching then
    return
  end
  refreshLotjUiCompatibility()
  local normalizedOutgoing = trim(command):lower():gsub("%s+", " ")
  recordOutgoingHyperspaceCommand(normalizedOutgoing)
  if
    normalizedOutgoing == "calc"
    or normalizedOutgoing == "calculate"
    or normalizedOutgoing:match("^calc .+")
    or normalizedOutgoing:match("^calculate .+")
  then
    Scraper.hyperspace.initiatedByHolocron = false
    Scraper.hyperspace.acknowledgedFuelRisk = false
  end
  if Scraper.pendingCommandKind == "target" then
    -- The target lock gates Holocron3D intents and automatic polling only.
    -- Mudlet remains the primary interactive client, so player-entered chat,
    -- movement, and utility commands must always pass through untouched.
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
  if Scraper.polling.enabled and Scraper.state and Scraper.state.metadata.inSpace == true then
    scheduleNextPoll(Scraper.USER_IDLE_POLL_DELAY_SECONDS)
  end

  local parserCommand = parserForCommand(command)
  if not parserCommand then
    return
  end
  if Scraper.state and Scraper.state.metadata.inSpace == false then
    return
  end
  Scraper.startCapture(parserCommand, command, { external = true })
end

function Scraper.showLastCapture()
  if not Scraper.lastCapture then
    if type(cecho) == "function" then
      cecho("\n<yellow>[Holocron3D] No capture recorded yet.\n")
    end
    return
  end

  if type(cecho) == "function" then
    cecho(
      "\n<cyan>[Holocron3D] Last capture: "
        .. Scraper.lastCapture.command
        .. " ("
        .. Scraper.lastCapture.reason
        .. ")\n"
    )
    for index, capturedLine in ipairs(Scraper.lastCapture.lines) do
      cecho(string.format("<dim_grey>%03d <reset>%s\n", index, capturedLine))
    end
  end
  return copyTable(Scraper.lastCapture)
end

function Scraper.getSnapshot()
  if not Scraper.state then
    return nil
  end
  return {
    observer = copyTable(Scraper.state.observer),
    entities = arrayOfEntities(),
    metadata = copyTable(Scraper.state.metadata),
  }
end

function Scraper.requestShipGmcpSupport(eventName, protocol)
  if protocol and tostring(protocol):upper() ~= "GMCP" then
    return false
  end
  if type(sendGMCP) ~= "function" then
    return false
  end
  local shipOk = pcall(sendGMCP, "Core.Supports.Add", '["Ship 1"]')
  local galaxyOk = pcall(sendGMCP, "Core.Supports.Add", '["Galaxy 1"]')
  return shipOk and galaxyOk
end

function Scraper.setup(proxy, options)
  if type(proxy) ~= "table" or type(proxy.parseGameOutput) ~= "function" then
    return nil, "proxy must provide parseGameOutput"
  end
  for _, required in ipairs({
    "registerAnonymousEventHandler",
    "tempRegexTrigger",
    "tempPromptTrigger",
    "tempTrigger",
    "tempTimer",
  }) do
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
  Scraper.fleetCommand =
    { nextOrderId = 0, currentMemberName = nil, verificationTimerId = nil, holdUntil = 0 }
  Scraper.projectileTracking = { nextId = 0, tracks = {} }
  Scraper.combat = {
    targetName = nil,
    pendingTargetName = nil,
    pendingTargetContext = nil,
    pendingTargetPreviousName = nil,
    targetReconcileTimerId = nil,
    nextEventId = 0,
    lastFireWeapon = nil,
    projectileRadarRequestedAt = 0,
    projectileRadarPending = false,
    lastRadarAt = 0,
    lastActivityAt = 0,
    lastLaunchWeapon = nil,
    lastLaunchTarget = nil,
    lastLaunchSource = nil,
    lastLaunchAt = 0,
    lastImpactWeapon = nil,
    lastImpactTarget = nil,
    lastImpactSource = nil,
    lastImpactAt = 0,
    projectileReconcileTimerId = nil,
    pendingLine = nil,
    pendingLineTimerId = nil,
  }
  Scraper.destruction = { nextEventId = 0, destroyedNames = {} }
  Scraper.shipGmcp = { lastAt = 0, sequence = 0, damageSequence = nil }
  Scraper.hyperspace.sampleSequence = 0
  Scraper.hyperspace.activeSample = nil
  Scraper.hyperspace.pendingArrivalSample = nil
  Scraper.hyperspace.routeUsesLocalCommand = nil
  Scraper.hyperspace.hyperjumpCompleteObserved = false
  Scraper.hyperspace.realspaceLurchObserved = false
  Scraper.hyperspace.awaitingArrivalRadar = false
  Scraper.hyperspace.reentrySystemName = nil
  safeKill("killTimer", Scraper.shields.damageTimerId)
  safeKill("killTimer", Scraper.shields.actionTimerId)
  Scraper.shields = {
    auto = true,
    recharging = false,
    awaiting = false,
    attempts = 0,
    damageTimerId = nil,
    actionTimerId = nil,
    statusPending = false,
    manualIntentId = nil,
    activationPending = false,
  }
  Scraper.shields = {
    auto = true,
    recharging = false,
    awaiting = false,
    attempts = 0,
    damageTimerId = nil,
    actionTimerId = nil,
    statusPending = false,
    manualIntentId = nil,
    activationPending = false,
  }
  Scraper.state = freshState()
  if Scraper.state.metadata.mudletCompatibility.lotjUiDetected then
    diagnostic(
      "info",
      "official LotJ Mudlet UI detected; shared chat and radar compatibility enabled"
    )
  else
    refreshLotjUiCompatibility()
  end
  Scraper.scanState = {}
  Scraper.polling.hydrationQueue = {}
  Scraper.polling.initializationQueue = {}
  Scraper.polling.initializationReason = nil
  Scraper.polling.initializationSpaceProbe = false
  Scraper.polling.radarRefreshPending = false
  Scraper.polling.radarRefreshReason = nil
  Scraper.polling.radarRefreshGeneration = 0
  Scraper.polling.radarRefreshIssuedGeneration = 0
  Scraper.polling.fleetRadarRefreshPending = false
  Scraper.polling.fleetRadarRefreshIssuedGeneration = 0
  cancelSensorTickWait(true)
  Scraper.polling.sensorTickBypassPending = false
  Scraper.polling.lastSensorPollAt = 0
  Scraper.polling.lastSensorPollCommand = nil
  Scraper.polling.lastSensorTickSource = nil
  Scraper.polling.lastSensorTickSequence = nil
  Scraper.polling.lastSensorSyncWaitSeconds = nil
  Scraper.polling.sensorTickFallbackCount = 0
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
      queueInitialStateSweep("launch sequence complete", false)
      queueObserverInfo()
    end),
    tempTrigger("You grip the controls.", function()
      queueObserverInfo()
    end),
    tempTrigger("Please wait until the ship has finished its current maneuver.", function()
      if Scraper.pendingCommandKind ~= "target" then
        resolvePendingCommand(
          "rejected",
          "Please wait until the ship has finished its current maneuver.",
          1
        )
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
      completeTargetLock(
        "rejected",
        "Your concentration is broken. You fail to lock on to your target."
      )
    end),
    tempTrigger("You must be in the gunners seat or turret of a ship to do that!", function()
      completeTargetLock(
        "rejected",
        "You must be in the gunners seat or turret of a ship to do that!"
      )
    end),
    tempTrigger("You fail to lock on to your target!", function()
      completeTargetLock("rejected", "You fail to lock on to your target!")
    end),
    tempTrigger("That ship is currently being protected by other ships.", function()
      completeTargetLock("rejected", "That ship is currently being protected by other ships.")
    end),
    tempRegexTrigger("^\\s*You are being targeted by .+'[^']+'\\.?\\s*$", function()
      Scraper.handleIncomingTargeting(line or "")
    end),
    tempRegexTrigger("^\\s*You are hit by .+ from .+'[^']+'!.*$", function()
      Scraper.handleShipHit(line or "", false)
    end),
    tempRegexTrigger(
      "^\\s*(?:.+\\s+'[^']+'\\s+explodes\\s+in\\s+a.*|(?:blinding\\s+)?flash\\s+of\\s+light!|of\\s+light!|light!)\\s*$",
      function()
        Scraper.handleCombatFragment(line or "")
      end
    ),
    tempTrigger("[WARNING]: Critical power overload... Shields down!", function()
      Scraper.handleShipHit(line or "", true)
    end),
    tempRegexTrigger(
      "^\\s*(?:Recharging shields\\.\\.|The shields are already at peak power\\.)\\s*$",
      function()
        Scraper.handleRechargeResponse(line or "")
      end
    ),
    tempRegexTrigger(
      "^\\s*(?:Shields ON\\. Autorecharge ON\\.|Autorecharge OFF\\. Shields IDLING\\.)\\s*$",
      function()
        Scraper.handleShieldPowerResponse(line or "")
      end
    ),
    tempRegexTrigger(
      "^\\s*(?:Target:\\s+.+|You fail to lock on to your target!|(?:The\\s+)?.+\\s+can\\s+only\\s+fire\\s+forwards\\.\\s+You'll\\s+need\\s+to\\s+turn\\s+your\\s+ship!|(?:Missile|Torpedo|Rocket)\\s+launched\\.|A\\s+.+\\s+is\\s+launched\\s+toward\\s+.+\\s+by\\s+your\\s+ship\\.|\\d+\\s+.+\\s+fired\\.\\.\\.|An?\\s+.+\\s+from\\s+.+'.+'\\s+(?:hits|barely\\s+misses)\\s+.+|.+\\s+fire\\s+from\\s+.+'.+'\\s+(?:hits|barely\\s+misses)\\s+.+|.+'.+'\\s+fires\\s+an?\\s+.+\\s+towards?\\s+.+|.*'[^']+'\\.\\s*(?:\\[x\\d+\\])?|Your ship's\\s+.+|You see a large explosion as\\s+.+|.+\\s+fully charged\\.|.+\\s+launcher(?:\\(s\\)|s)?\\s+reloaded\\.)\\s*$",
      function()
        Scraper.handleCombatFragment(line or "")
      end
    ),
    tempRegexTrigger("^\\s*\\d+\\s+projectiles?,\\s+\\d+\\s+incoming.*$", function()
      Scraper.handleProjectileSummary(line or "")
    end),
    tempRegexTrigger(
      "^\\s*.+\\s+'[^']+'\\s+enters the starsystem, coming out of its hyperjump at(?:\\s+.*)?$",
      function()
        Scraper.handleSectorArrival(line or "")
      end
    ),
    tempRegexTrigger("^\\s*[A-Za-z0-9][A-Za-z0-9 '\\-]+(?:Sector|System)\\s*$", function()
      Scraper.handleReentrySystemLine(line or "")
    end),
    tempRegexTrigger("(?i)^.*auto.*track.*$", function()
      Scraper.handleAutotrackResponse(line or "")
    end),
    tempRegexTrigger(
      "^\\s*(?:Hyperspace course locked\\. Running final jump checks\\.\\.\\.|Using your skill with navigation you reroute energy to the hyperdrives\\.|Checking hyperspace course integrity\\. Please wait\\.|Please Wait\\. The Navigation Computer is calculating the route\\.|Warning - Not enough fuel to complete the jump!|Jump requires .+|\\[Status\\]: Hyperspace calculations have been completed\\.|\\[ALERT\\]: Aborting Hyperspace calculation\\. Terminal reset\\.|\\[Alert\\]: Jump coordinates too close to stellar object\\. Jump not set\\.|Calculating Hyperspace Trajectory: \\d+ seconds remaining\\.|You are too close to .+ to make the jump to lightspeed!|You must be at a nav computer to calculate jumps\\.|You aren't in the pilots seat\\.|You aren't in the pilot's seat\\.|You push forward the hyperspeed lever\\.|The stars become streaks of light as you enter hyperspace\\.|Destination reached\\. Initiating realspace reentry\\.\\.\\.|Hyperjump complete\\.|The ship lurches slightly as it comes out of hyperspace\\.)\\s*$",
      function()
        Scraper.handleHyperspaceLine(line or "")
      end
    ),
    tempRegexTrigger(
      "^\\s*(?:Sending command to .+|New course set, approaching .+\\.|The ship begins to turn\\.|You're already traveling that speed\\.|Autopilot (?:ON|OFF)\\.|You'll have to disengage the ship's autopilot first\\.|Please wait until the ship has finished its current maneuver\\.)\\s*$",
      function()
        Scraper.handleFleetCommandLine(line or "")
      end
    ),
  }
  proxy.scraper = Scraper
  if type(proxy.registerIntentHandler) == "function" then
    proxy.registerIntentHandler("probe_space", dispatchSpaceProbe)
    proxy.registerIntentHandler("refresh_local_hyperspace_radar", dispatchLocalHyperspaceRadar)
    proxy.registerIntentHandler("set_polling_paused", function(payload)
      if type(payload.paused) ~= "boolean" then
        return false, "polling paused must be a boolean"
      end
      return Scraper.setPollingPaused(payload.paused, "renderer")
    end)
    proxy.registerIntentHandler("set_ship_disposition", function(payload)
      return Scraper.setDisposition(trim(payload.name), trim(payload.disposition):lower())
    end)
    proxy.registerIntentHandler("scan_ship", dispatchManualShipScan)
    proxy.registerIntentHandler("target_ship", dispatchTargetShip)
    proxy.registerIntentHandler("clear_combat_target", dispatchClearCombatTarget)
    proxy.registerIntentHandler("fire_weapon", dispatchFireWeapon)
    proxy.registerIntentHandler("fleet_order", dispatchFleetOrder)
    proxy.registerIntentHandler("request_tactical_view", dispatchTacticalViewRequest)
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
    proxy.registerIntentHandler("stop_hyperspace", function(payload, message)
      if Scraper.hyperspace.phase ~= "calculating" then
        -- Treat abort as idempotent. A wing can complete its jump without a
        -- local terminal transition, leaving the renderer with stale workflow
        -- state even though there is no calculation left to stop.
        if
          Scraper.hyperspace.phase == "hyperspace"
          or Scraper.hyperspace.phase == "reentry"
          or Scraper.hyperspace.phase == "engaging"
        then
          return false, "the ship is already in hyperspace"
        end
        Scraper.hyperspace.activeIntentId = message and message.id or nil
        completeHyperspaceAbort("Hyperspace calculation was already stopped")
        return true
      end
      local commands, _, scopeError = scopedHyperspaceCommands(payload, "calc stop")
      if not commands then
        return false, scopeError
      end
      Scraper.hyperspace.activeIntentId = message and message.id or nil
      local sent, sendError = sendScopedHyperspaceCommands(commands)
      if not sent then
        return false, sendError
      end
      -- Scoped battlegroup commands may not produce the observer terminal's
      -- abort confirmation. Sending succeeded, so complete the UI workflow now;
      -- a later local confirmation is harmless and remains idempotent.
      completeHyperspaceAbort("Hyperspace abort command transmitted")
      return true
    end)
    proxy.registerIntentHandler("engage_hyperdrive", function(payload, message)
      if Scraper.hyperspace.phase ~= "ready" then
        return false, "hyperspace calculations are not ready"
      end
      local commands, includesLocal, scopeError, usesLocalCommand =
        scopedHyperspaceCommands(payload, "hyper")
      if not commands then
        return false, scopeError
      end
      if usesLocalCommand then
        local clear, clearanceError = checkHyperspaceClearance(payload)
        if not clear then
          return false, clearanceError
        end
      end
      Scraper.hyperspace.activeIntentId = message and message.id or nil
      for _, command in ipairs(commands) do
        local selector = command:lower():match("^battlegroup nav (.-) hyper$")
        if selector then
          queueFleetJump(selector)
        end
      end
      if includesLocal then
        Scraper.hyperspace.pendingLocalJumpUntil = os.time() + 30
      end
      return sendScopedHyperspaceCommands(commands)
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
      if gateError then
        return false, gateError
      end
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
        local values = { tonumber(vector.x), tonumber(vector.y), tonumber(vector.z) }
        for _, value in ipairs(values) do
          if not value or value ~= value or math.abs(value) > 10000000 then
            return false, "course vector must contain finite coordinates within 10,000,000 units"
          end
        end
        if values[1] == 0 and values[2] == 0 and values[3] == 0 then
          return false, "course vector cannot be zero"
        end
        command = string.format(
          "course relative %d %d %d",
          round(values[1]),
          round(values[2]),
          round(values[3])
        )
      elseif mode == "target" or mode == "away" then
        local target = findEntity({ id = trim(payload.targetId) })
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
        if
          not departureSpeed
          or departureSpeed ~= departureSpeed
          or departureSpeed <= 0
          or departureSpeed > 10000000
          or (maximum and departureSpeed > maximum)
        then
          return false, "departure speed is outside the ship's known limits"
        end
        departureSpeed = round(departureSpeed)
      end

      Scraper.polling.dispatching = true
      local sent, sendError = pcall(function()
        if departureSpeed then
          send("speed " .. tostring(departureSpeed))
        end
        send(command)
      end)
      Scraper.polling.dispatching = false
      if not sent then
        return false, tostring(sendError)
      end
      holdPollingForCommand(
        message and message.id or nil,
        45,
        "Maneuver completion was not observed; course controls released."
      )
      return true
    end)
    proxy.registerIntentHandler("set_ship_speed", function(payload, message)
      local gateError = commandGateError()
      if gateError then
        return false, gateError
      end
      if Scraper.state.metadata.inSpace ~= true then
        return false, "ship speed is unavailable while landed"
      end
      local requestedSpeed = tonumber(payload.speed)
      local speedReading = Scraper.state.observer.speed
      local maximum = type(speedReading) == "table" and tonumber(speedReading.maximum) or nil
      if
        not requestedSpeed
        or requestedSpeed ~= requestedSpeed
        or requestedSpeed < 0
        or (maximum and requestedSpeed > maximum)
      then
        return false, "requested speed is outside the ship's known limits"
      end
      Scraper.polling.dispatching = true
      local sent, sendError = pcall(function()
        send("speed " .. tostring(math.floor(requestedSpeed + 0.5)))
      end)
      Scraper.polling.dispatching = false
      if not sent then
        return false, tostring(sendError)
      end
      holdPollingForCommand(message and message.id or nil, 1.5)
      return true
    end)
  end
  diagnostic(
    "info",
    "live scraping enabled for info, radar, status, and fleetradar; proximity is derived from coordinates"
  )
  if not options or options.polling ~= false then
    local pollingOptions = options and options.polling or nil
    local pollingReady, pollingError = Scraper.startPolling(pollingOptions)
    if not pollingReady then
      diagnostic("warn", "telemetry polling could not start: " .. tostring(pollingError))
    else
      queueInitialStateSweep("Holocron startup", true)
    end
  end
  return true
end

function Scraper.teardown()
  Scraper.stopPolling()
  safeKill("killTimer", Scraper.hyperspace and Scraper.hyperspace.reentryRefreshTimerId)
  if Scraper.hyperspace then
    Scraper.hyperspace.reentryRefreshTimerId = nil
    Scraper.hyperspace.awaitingReentrySystem = false
  end
  safeKill("killTimer", Scraper.combat and Scraper.combat.projectileReconcileTimerId)
  safeKill("killTimer", Scraper.combat and Scraper.combat.targetReconcileTimerId)
  safeKill("killTimer", Scraper.combat and Scraper.combat.pendingLineTimerId)
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
  Scraper.combat = {
    targetName = nil,
    pendingTargetName = nil,
    pendingTargetContext = nil,
    pendingTargetPreviousName = nil,
    targetReconcileTimerId = nil,
    nextEventId = 0,
    lastFireWeapon = nil,
    projectileRadarRequestedAt = 0,
    projectileRadarPending = false,
    lastRadarAt = 0,
    lastActivityAt = 0,
    lastLaunchWeapon = nil,
    lastLaunchTarget = nil,
    lastLaunchSource = nil,
    lastLaunchAt = 0,
    lastImpactWeapon = nil,
    lastImpactTarget = nil,
    lastImpactSource = nil,
    lastImpactAt = 0,
    projectileReconcileTimerId = nil,
    pendingLine = nil,
    pendingLineTimerId = nil,
  }
  Scraper.destruction = { nextEventId = 0, destroyedNames = {} }
  Scraper.shipGmcp = { lastAt = 0, sequence = 0, damageSequence = nil }
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
  Scraper.fleetCommand =
    { nextOrderId = 0, currentMemberName = nil, verificationTimerId = nil, holdUntil = 0 }
  return true
end

return Scraper
