-- Reusable, response-driven navigation transport. Cargo is an optional stop action.
local Navigation = {}
Navigation.MIN_HYPERSPACE_CLEARANCE = 500
Navigation.MAX_CLEARANCE_CHECKS = 10
local function key(value)
  local value = tostring(value or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
  if value == "kashyyk" then
    return "kashyyyk"
  end
  if value == "mon-cal" or value == "mon cal" or value == "mon-cala" then
    return "mon cala"
  end
  return value
end

Navigation.canJump = require("lotj_holocron_topology").canJump
local function validPath(path)
  local directions = {
    n = true,
    s = true,
    e = true,
    w = true,
    ne = true,
    nw = true,
    se = true,
    sw = true,
    u = true,
    d = true,
    north = true,
    south = true,
    east = true,
    west = true,
    northeast = true,
    northwest = true,
    southeast = true,
    southwest = true,
    up = true,
    down = true,
  }
  for _, direction in ipairs(path) do
    if not directions[direction] then
      return false
    end
  end
  return true
end
local function quote(value)
  assert(
    type(value) == "string" and value ~= "" and not value:find('[%c"]'),
    "Invalid command argument"
  )
  return '"' .. value .. '"'
end

local function checkJumpRange(from, to, maximum)
  maximum = tonumber(maximum) or 35
  local function finite(value)
    local number = tonumber(value)
    return number and number == number and math.abs(number) < math.huge and number
  end
  local a, b = from and from.galaxy, to and to.galaxy
  local ax, ay, bx, by = finite(a and a.x), finite(a and a.y), finite(b and b.x), finite(b and b.y)
  assert(
    ax and ay and bx and by and finite(maximum) and maximum > 0,
    "Sector coordinates and a finite maximum distance are required for a manual jump."
  )
  assert(
    math.sqrt((ax - bx) ^ 2 + (ay - by) ^ 2) <= maximum,
    "A manual jump exceeds the maximum sector distance."
  )
end

function Navigation.isCommunicationLine(value)
  value = tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
  local parenthesizedChannel = value:match("^%(([%u]+)%)%s")
  local knownParenthesizedChannel = parenthesizedChannel == "OOC"
    or parenthesizedChannel == "IMM"
    or parenthesizedChannel == "RPC"
    or parenthesizedChannel == "NEWBIE"
    or parenthesizedChannel == "OSAY"
    or parenthesizedChannel == "CLAN"
  local lower = value:lower()
  return knownParenthesizedChannel
    or value:match("^CommNet%s+%d+%s+%[") ~= nil
    or value:match("^ImmNet%[") ~= nil
    or value:match("^CouncilNet%[") ~= nil
    or value:match("^%([^)]*R|P|C[^)]*%)%s") ~= nil
    or value:match("^%b{}%s*%b<>%s*%[[^%]]+%].-:%s") ~= nil
    or value:find("[Incoming Transmission from", 1, true) ~= nil
    or value:find("[Outgoing Transmission to", 1, true) ~= nil
    or value:find("[Hail from ", 1, true) == 1
    or value:find("[Broadcasting Hail to ", 1, true) == 1
    or value:find("[INTERCOM:", 1, true) ~= nil
    or value:match("^Broadcasting Network%s+%[") ~= nil
    or value:match("^'.-'%s+you%s+[%a]+") ~= nil
    or value:match("^You%s+[%a]+.-'.-'$") ~= nil
    or lower:match("^.- speaks in your mind ") ~= nil
    or lower:match("^you speak through your mind ") ~= nil
    or lower:find("you sign, in lorrdian", 1, true) ~= nil
    or lower:match("^.-%s+says%s") ~= nil
    or lower:match("^.-%s+whispers%s") ~= nil
    or lower:match("^.-%s+exclaims%s") ~= nil
    or lower:match("^.-%s+asks%s") ~= nil
    or lower:match("^.-%s+yells%s") ~= nil
    or lower:match("^.-%s+radios%s") ~= nil
end

function Navigation.isCommunicationCommand(command)
  local verbs = {
    ooc = true,
    say = true,
    talk = true,
    clan = true,
    tell = true,
    reply = true,
    chat = true,
    osay = true,
    whisper = true,
    yell = true,
    shout = true,
  }
  local found = false
  for part in tostring(command or ""):gmatch("[^;\n\r]+") do
    if not verbs[part:lower():match("^%s*(%S+)")] then
      return false
    end
    found = true
  end
  return found
end

function Navigation.new(io)
  local self = { io = io, active = nil, runId = nil, completed = {}, transactions = {}, at = nil }
  local function now()
    return io.now and io.now() or os.time()
  end
  function self:publishAccounts()
    if io.accounts then
      io.accounts(self.runId, self.accounts)
    end
  end
  function self:recordTransaction(result)
    if result.action ~= "refuel" or result.cost ~= 0 then
      if self.evidence then
        self.evidence.credits = nil
      end
    end
    local accounts = self.accounts
    if result.action == "buy" then
      accounts.cargo = accounts.cargo + (result.cost or 0)
    elseif result.action == "refuel" then
      accounts.fuel = accounts.fuel + (result.cost or 0)
    elseif result.action == "sell" then
      accounts.revenue = accounts.revenue + (result.revenue or 0)
      self.taxPendingUntil = result.tradeMode ~= "contraband" and now() + 10 or nil
    end
    accounts.revision = accounts.revision + 1
    self:publishAccounts()
    io.transaction(result)
  end
  function self:invalidateEvidence()
    self.evidence = {}
  end
  function self:allowExternalCommand(command)
    local active = self.active
    if active and (active.flightReady or active.flightStarted) then
      return true
    end
    if Navigation.isCommunicationCommand(command) then
      if active then
        active.concurrentChatCommand = true
      end
      return true
    end
    -- Once sent, cargo completes asynchronously. Chat and personal utility
    -- commands must not discard its confirmation or make a retry ambiguous.
    if
      active
      and (
        active.operation.kind ~= "stop_action"
        or self.transactions[active.operation.id] ~= "uncertain"
      )
    then
      return false
    end
    local harmless = {
      say = true,
      tell = true,
      reply = true,
      clan = true,
      ooc = true,
      chat = true,
      emote = true,
      look = true,
      l = true,
      inventory = true,
      inv = true,
      i = true,
      score = true,
      sc = true,
      equipment = true,
      eq = true,
      wear = true,
      remove = true,
    }
    local sawCommand = false
    for part in tostring(command or ""):gmatch("[^;\n\r]+") do
      local verb = part:lower():match("^%s*(%S+)")
      if not harmless[verb] then
        if not active then
          self.pendingCargo = nil
          return true
        end
        return false
      end
      sawCommand = true
    end
    if sawCommand and active then
      active.concurrentCargoCommand = true
    end
    return sawCommand
  end
  local function remember(kind, ship, planet, value)
    local room = io.evidenceRoom and io.evidenceRoom()
    if not room then
      return
    end
    self.evidence = self.evidence or {}
    self.evidence[kind] =
      { room = room, ship = key(ship.name), planet = key(planet), at = now(), value = value }
  end
  local function recalled(kind, ship, planet)
    local saved = (self.evidence or {})[kind]
    local room = io.evidenceRoom and io.evidenceRoom()
    if
      saved
      and room
      and saved.room == room
      and saved.ship == key(ship.name)
      and saved.planet == key(planet)
      and now() >= saved.at
      and now() - saved.at <= 60
    then
      return saved.value
    end
  end
  function self:clearanceDelay(active, seconds, callback)
    if active.timer then
      io.cancel(active.timer)
    end
    active.timer = io.timer(seconds, function()
      if self.active == active then
        callback()
      end
    end)
  end
  function self:clearanceFailed(active, detail, delay)
    local clearance = active.clearance
    if clearance.attempts >= Navigation.MAX_CLEARANCE_CHECKS then
      self:stop(
        "Aborted jump clearance after 10 checks: "
          .. detail
          .. ". 500 units are required; inspect proximity and ship movement before resuming."
      )
      return
    end
    clearance.phase = "wait"
    io.progress(
      active,
      string.format("Clearance %d/10: %s. Recheck in %ds", clearance.attempts, detail, delay)
    )
    self:clearanceDelay(active, delay, function()
      self:scanClearance(active)
    end)
  end
  function self:scanClearance(active)
    local clearance = active.clearance
    if clearance.attempts >= Navigation.MAX_CLEARANCE_CHECKS then
      self:clearanceFailed(active, "the game still rejects the jump", 1)
      return
    end
    clearance.attempts = clearance.attempts + 1
    clearance.phase, active.lines, active.matched = "scan", {}, false
    io.progress(
      active,
      string.format("Checking jump clearance %d/10 (500 units required)", clearance.attempts)
    )
    self:clearanceDelay(active, 8, function()
      self:clearanceFailed(active, "no usable proximity response", 5)
    end)
    io.send("prox")
  end
  function self:beginClearance(active, blocker)
    if active.clearance and active.clearance.phase ~= "retry" then
      return
    end
    active.clearance = active.clearance or { attempts = 0 }
    local clearance = active.clearance
    clearance.blocker = blocker or clearance.blocker
    clearance.phase, active.advancing = "queued", false
    self:clearanceDelay(active, 0, function()
      self:scanClearance(active)
    end)
  end
  function self:clearancePrompt(active)
    local clearance = active.clearance
    if clearance.phase ~= "scan" then
      return
    end
    local ok, result = pcall(io.parse, "prox", active.lines)
    if not ok or not result then
      return
    end -- Ignore an early prompt; the scan timeout is bounded.
    local info = io.clearanceInfo and io.clearanceInfo() or {}
    local nearest, nearestName, blockerSeen, recognized = nil, nil, false, false
    for _, entity in ipairs(result.entities or {}) do
      local distance = tonumber(entity.distance)
      if distance and distance >= 0 and distance < math.huge then
        -- Rejections use the full ship display label; prox parsing separates
        -- its class from the quoted callsign.
        local blockerName = clearance.blocker
          and (clearance.blocker:match("^.-%s+'(.-)'$") or clearance.blocker)
        local namedBlocker = blockerName and key(entity.name) == key(blockerName)
        if namedBlocker then
          blockerSeen = true
        end
        local exempt = entity.kind == "ship"
          and (
            (info.exemptShips or {})[key(entity.name)]
            or key(entity.name) == key(active.ship.name)
          )
        local relevant = entity.kind == "ship"
          or entity.kind == "planet"
          or entity.kind == "celestial"
          or entity.kind == "star"
        if (relevant and not exempt) or namedBlocker then
          recognized = true
          if not nearest or distance < nearest then
            nearest, nearestName = distance, entity.name
          end
        end
      end
    end
    if not recognized or (clearance.blocker and not blockerSeen) then
      self:clearanceFailed(active, "proximity did not identify the blocking object", 5)
      return
    end
    if nearest >= Navigation.MIN_HYPERSPACE_CLEARANCE then
      clearance.phase = "retry"
      active.lines, active.matched = {}, false
      io.progress(
        active,
        string.format(
          "Clearance confirmed at %.0f units; retrying hyperspace (%d/10)",
          nearest,
          clearance.attempts
        )
      )
      self:clearanceDelay(active, 0, function()
        self:clearanceDelay(active, active.steps[active.index].timeout or 900, function()
          self:stop("Hyperspace completion was not confirmed after clearance recovery.")
        end)
        io.send("hyperspace")
      end)
      return
    end
    local rate = tonumber(info.speed)
    local timestamp = now()
    if
      clearance.previous
      and clearance.previous.name == nearestName
      and timestamp > clearance.previous.at
    then
      rate = (nearest - clearance.previous.distance) / (timestamp - clearance.previous.at)
    end
    clearance.previous = { name = nearestName, distance = nearest, at = timestamp }
    -- Speed predicts only when to scan again. A fresh proximity scan authorizes the jump.
    local delay = rate
        and rate > 0
        and rate < math.huge
        and math.max(
          1,
          math.min(30, math.ceil((Navigation.MIN_HYPERSPACE_CLEARANCE - nearest) / rate))
        )
      or 5
    self:clearanceFailed(active, string.format("%s at %.0f units", nearestName, nearest), delay)
  end
  function self:stop(reason, discard)
    self:invalidateEvidence()
    local active = self.active
    if
      active
      and active.operation.kind == "stop_action"
      and self.transactions[active.operation.id] == "uncertain"
      and not active.advancing
    then
      self.pendingCargo = { active = active, expires = now() + 180 }
    end
    self.active = nil
    if active and active.navigation and not discard then
      self.suspended = active
    end
    if discard then
      self.suspended = nil
      self.pendingCargo = nil
    end
    if active and active.timer then
      io.cancel(active.timer)
    end
    if active then
      io.finish(active, nil, reason or "Navigation stopped; reconcile before resuming.")
    end
  end
  function self:finish()
    local active = self.active
    if not active then
      return
    end
    self.active = nil
    if active.timer then
      io.cancel(active.timer)
    end
    local op = active.operation
    local result = {
      operationId = op.id,
      runId = op.runId,
      outcome = "completed",
      location = {
        ship = active.ship.name,
        destination = op.destination.name,
        landedOrDocked = true,
      },
      interruptedOutcome = active.interruptedOutcome or "not_started",
    }
    self.completed[op.id] = true
    io.finish(active, result)
  end
  function self:waitForFlight(active, reason)
    if active.timer then
      io.cancel(active.timer)
    end
    active.matched, active.advancing = false, false
    active.waitingForMilestone = true
    io.progress(
      active,
      "Waiting for flight progress: "
        .. reason
        .. " Manual flight milestones will continue this route."
    )
    active.timer = io.timer(900, function()
      if self.active == active then
        self:stop("No flight progress observed for 15 minutes. Reconcile before resuming.")
      end
    end)
  end
  function self:next()
    local active = self.active
    if not active then
      return
    end
    if active.timer then
      io.cancel(active.timer)
    end
    active.index = active.index + 1
    local step = active.steps[active.index]
    if not step then
      self:finish()
      return
    end
    active.lines, active.matched = {}, false
    active.waitingForMilestone = nil
    active.gmcpResult = nil
    active.shipGmcpSequence = self.shipAccess and self.shipAccess.sequence or 0
    active.phase = step.phase or "ground"
    if step.label == "Open ship" then
      self:invalidateEvidence()
      active.flightReady = true -- Departure, lane and destination checks have completed.
    end
    local ok, command = pcall(step.command)
    if not ok then
      self:stop(tostring(command))
      return
    end
    active.timer = io.timer(step.timeout or 30, function()
      if self.active == active then
        if active.flightReady and active.phase ~= "ground" then
          self:waitForFlight(active, "No confirmation for " .. step.label .. ".")
        else
          self:stop("No confirmation for " .. step.label .. "; inspect Mudlet before resuming.")
        end
      end
    end)
    io.progress(active, step.label)
    if active.pendingOrbit and step.label:match("^Approach ") then
      local event = active.pendingOrbit
      active.pendingOrbit = nil
      self:line(event)
      return
    end
    if step.gmcp then
      local ok, result = pcall(step.gmcp)
      if not ok then
        self:stop(tostring(result))
        return
      end
      if result then
        active.gmcpResult, active.matched = result, true
        self:prompt()
        return
      end
    end
    if
      active.operation.kind == "stop_action"
      and (
        command:match("^buycargo ")
        or command:match("^sellcargo ")
        or command:match("^buycontraband ")
        or command:match("^sellcontraband ")
      )
    then
      self.transactions[active.operation.id] = "uncertain"
    end
    io.send(command)
  end
  function self:shipGmcp(access)
    self.shipAccess = access
    local active = self.active
    if not active then
      return
    end
    local step = active.steps[active.index]
    if
      step
      and step.label == "Take flight controls"
      and (access.sequence or 0) > (active.shipGmcpSequence or 0)
    then
      if access.piloting ~= true then
        if active.advancing then
          self:stop("Flight controls changed before launch; reconcile before resuming.")
        end
        return
      end
      if active.advancing then
        return
      end
      active.matched = true
      active.waitingForMilestone = nil
      self:prompt()
    end
  end
  function self:line(text)
    -- Channel text is not a navigation or commerce response, even when it
    -- quotes a failure or transaction confirmation.
    if Navigation.isCommunicationLine(text) then
      return
    end
    if self.taxPendingUntil then
      local tax =
        text:match("^Total profit, accounting for purchase price: .- Tax paid: ([%d,]+)%.$")
      if tax and now() <= self.taxPendingUntil then
        self.accounts.tax = self.accounts.tax + tonumber((tax:gsub(",", "")))
        self.accounts.revision = self.accounts.revision + 1
        self:publishAccounts()
        self.taxPendingUntil = nil
      elseif now() > self.taxPendingUntil then
        self.taxPendingUntil = nil
      end
    end
    local pending = self.pendingCargo
    if pending then
      local waiting = pending.active
      local step = waiting.steps[waiting.index]
      if now() > pending.expires then
        self.pendingCargo = nil
      elseif step.match and step.match(text) then
        self.pendingCargo = nil
        local ok = pcall(step.confirm, { text })
        if ok then
          self.completed[waiting.operation.id] = true
        end
      end
    end
    local active = self.active
    if not active then
      local paused = self.suspended
      if paused and (paused.flightReady or paused.flightStarted) then
        for i, candidate in ipairs(paused.steps) do
          if i >= paused.index and candidate.event and candidate.match(text) then
            paused.resumeEvent = { index = i, text = text }
            paused.flightStarted = true
            if candidate.label:match("^Approach ") then
              paused.orbitConfirmed = true
            end
            if candidate.label == "Land" then
              paused.landed = true
            end
          end
        end
      end
      return
    end
    text = tostring(text):gsub("\r", "")
    table.insert(active.lines, text)
    local lower = key(text)
    -- Some profiles display the final HUD without a Mudlet prompt event.
    -- Use the same confirmation gates and deferred advancement as a real prompt.
    if text:match("^%s*{Health:") and text:find("{Movement:", 1, true) then
      self:prompt()
      return
    end
    -- Navigation milestones may be supplied by a manual command. Never skip ground checks.
    if active.flightReady or active.flightStarted then
      if
        text == "The stars become streaks of light as you enter hyperspace"
        or text == "The stars become streaks of light as you enter hyperspace."
      then
        for i, candidate in ipairs(active.steps) do
          if candidate.clearanceRetry and i >= active.index then
            if active.timer then
              io.cancel(active.timer)
            end
            active.index, active.clearance, active.advancing = i, nil, false
            active.flightStarted, active.waitingForMilestone = true, nil
            active.phase = "hyperspace"
            io.progress(active, "Hyperspace: waiting for confirmed arrival")
            active.timer = io.timer(900, function()
              if self.active == active then
                self:stop("Hyperspace arrival not confirmed. Finish the jump, then resume.")
              end
            end)
            return
          end
        end
      end
      for i, candidate in ipairs(active.steps) do
        if i >= active.index and candidate.event and candidate.match(text) then
          if i == active.index and active.advancing then
            return
          end
          if active.timer then
            io.cancel(active.timer)
          end
          if candidate.label:match("^Approach ") and not active.arrivalVerified then
            active.pendingOrbit = text
            for checkIndex, check in ipairs(active.steps) do
              if check.label == "Verify arrival system" then
                active.index = checkIndex - 1
                active.waitingForMilestone = nil
                active.advancing = true
                active.timer = io.timer(0, function()
                  if self.active == active then
                    active.advancing = false
                    self:next()
                  end
                end)
                return
              end
            end
          end
          active.index, active.clearance, active.advancing = i, nil, false
          active.flightStarted = true
          active.waitingForMilestone = nil
          active.phase = candidate.phase
          if candidate.label == "Land" then
            active.landed = true
          end
          if candidate.label:match("^Approach ") then
            active.orbitConfirmed = true
          end
          active.lines, active.matched = { text }, true
          self:prompt()
          return
        end
      end
    end
    local step = active.steps[active.index]
    local blocker = text:match("^You are too close to (.-) to make the jump to lightspeed!$")
    if active.advancing then
      return -- Unrelated output cannot undo an already confirmed milestone.
    end
    local cannotJumpYet = lower == "you can't jump yet."
      or lower == "you can't jump yet!"
      or lower == "you cannot jump yet."
      or lower == "you cannot jump yet!"
    if step.clearanceRetry and (blocker or cannotJumpYet) then
      self:beginClearance(active, blocker)
      return
    end
    local flightContext = active.flightReady or active.flightStarted
    local flightFailure = false
    for _, word in ipairs({
      "ship",
      "pilot",
      "launch",
      "hyperspace",
      "navigation",
      "course",
      "land",
      "maneuver",
      "jump",
      "stellar",
      "fuel",
      "controls",
    }) do
      if lower:find(word, 1, true) then
        flightFailure = true
        break
      end
    end
    if
      (not flightContext or flightFailure)
      and (not active.concurrentCargoCommand or lower:find("cargo", 1, true) or lower:find(
        "credits",
        1,
        true
      ) or lower:find("ship", 1, true) or lower:find("smuggl", 1, true))
      and (
        lower == "you fail."
        or lower:find("you fail to", 1, true)
        or lower:find("you can't", 1, true) == 1
        or lower:find("you aren't", 1, true) == 1
        or lower:find("you must", 1, true) == 1
        or lower:find("not enough", 1, true)
        or lower:find("insufficient", 1, true)
        or lower:find("restricted landing", 1, true)
        or lower:find("too close to", 1, true)
        or lower:find("could not locate", 1, true)
        or lower:find("jump not set", 1, true)
        or lower:find("disengage the ship's autopilot", 1, true)
      )
    then
      if (active.flightReady or active.flightStarted) and active.phase ~= "ground" then
        self:waitForFlight(active, text)
      else
        self:stop(text .. " Return to the expected ship/location and click Resume when ready.")
      end
      return
    end
    if active.clearance and active.clearance.phase ~= "retry" then
      return
    end
    if step.match and step.match(text) then
      active.matched = true
      active.waitingForMilestone = nil
      if step.event then
        active.clearance = nil
        self:prompt() -- Asynchronous completions may arrive without a prompt.
      end
    end
  end
  function self:prompt()
    local active = self.active
    if not active then
      return
    end
    if active.waitingForMilestone then
      return
    end
    if active.clearance and active.clearance.phase ~= "retry" then
      self:clearancePrompt(active)
      return
    end
    local step = active.steps[active.index]
    if step.match and not active.matched then
      return
    end
    if active.concurrentChatCommand and not step.match then
      local response = false
      for _, line in ipairs(active.lines) do
        if line:match("%S") and not line:match("^%s*{Tone:") and not line:match("^%s*{Health:") then
          response = true
          break
        end
      end
      if not response then
        return
      end
    end
    if active.advancing then
      return
    end
    active.advancing = true
    local ok, err = pcall(function()
      if step.confirm then
        step.confirm(active.lines)
      end
    end)
    if not ok then
      self:stop(tostring(err))
      return
    end
    -- Defer until all handlers for this response have finished.
    if active.timer then
      io.cancel(active.timer)
    end
    active.timer = io.timer(0, function()
      if self.active == active then
        active.advancing = false
        self:next()
      end
    end)
  end
  function self:start(payload, intentId)
    if self.active then
      return false, "Another navigation operation is active."
    end
    local op, ship = payload.operation, payload.ship
    if
      type(op) ~= "table"
      or type(ship) ~= "table"
      or not op.id
      or not op.runId
      or type(op.destination) ~= "table"
    then
      return false, "Invalid navigation operation."
    end
    if self.runId ~= op.runId then
      self.pendingCargo = nil
      self:invalidateEvidence()
      self.runId, self.completed, self.transactions, self.at = op.runId, {}, {}, nil
      self.taxPendingUntil = nil
      self.accounts = {}
      for _, field in ipairs({ "revision", "cargo", "fuel", "tax", "revenue" }) do
        local value = tonumber((payload.accounts or {})[field]) or 0
        self.accounts[field] = value >= 0 and value < math.huge and value or 0
      end
      self:publishAccounts()
    end
    if
      op.kind == "reconcile"
      and payload.interrupted
      and payload.interrupted.kind == "navigate"
      and self.suspended
    then
      local previous = self.suspended
      if
        previous.operation.runId == op.runId
        and key(previous.ship.name) == key(ship.name)
        and key(previous.operation.destination.name) == key(op.destination.name)
        and (previous.flightReady or previous.flightStarted)
        and not previous.landed
      then
        self.suspended = nil
        local confirmedBeforePause = previous.matched
        previous.operation, previous.intentId = op, intentId
        previous.interruptedOutcome = "completed"
        previous.advancing, previous.matched, previous.clearance = false, false, nil
        self.active = previous
        if previous.resumeEvent then
          local event = previous.resumeEvent.text
          previous.resumeEvent = nil
          previous.waitingForMilestone = nil
          self:line(event)
          return true, nil, true
        end
        if confirmedBeforePause then
          previous.matched = true
          self:prompt()
          return true, nil, true
        end
        io.progress(
          previous,
          "Resumed flight observation. Complete the pending maneuver manually if needed; arrival will be verified before trading."
        )
        previous.timer = io.timer(900, function()
          if self.active == previous then
            self:stop(
              "No flight milestone observed. Complete travel to the expected destination and resume."
            )
          end
        end)
        return true, nil, true
      end
    end
    if op.kind == "stop_action" then
      self.pendingCargo = nil
      self.transactions[op.id] = self.transactions[op.id] or "not_started"
    end
    local active = {
      navigation = op.kind == "navigate",
      operation = op,
      ship = ship,
      intentId = intentId,
      steps = {},
      index = 0,
      phase = "ground",
    }
    local function step(label, command, match, confirm, timeout)
      table.insert(active.steps, {
        label = label,
        command = type(command) == "function" and command or function()
          return command
        end,
        match = match,
        confirm = confirm,
        timeout = timeout,
      })
    end
    local function parsed(command, lines)
      local result, err = io.parse(command, lines)
      assert(result, err)
      return result
    end
    local function query(label, command, parser, match, confirm)
      step(label, command, match, function(lines)
        confirm(active.gmcpResult or parsed(parser, lines))
      end)
      if command == "showplanet" and io.groundLocation then
        active.steps[#active.steps].gmcp = io.groundLocation
      end
      if
        command == "showplanet"
        and op.kind == "reconcile"
        and op.destination.arrival
        and op.destination.arrival.kind == "station"
      then
        active.steps[#active.steps].gmcp = function()
          assert(
            self.stationAt
              and key(self.stationAt.name) == key(op.destination.name)
              and key(self.stationAt.ship) == key(ship.name),
            "Station arrival is unverified."
          )
          return { planet = op.destination.name }
        end
      end
    end
    local function location(expected, force)
      expected = expected or op.destination.name
      if not force and recalled("location", ship, expected) then
        return
      end
      query("Verify trading location", "showplanet", "showplanet", function(line)
        return line:match("^Planet:")
      end, function(result)
        assert(
          key(result.planet) == key(expected),
          "Wrong planet. Return to "
            .. expected
            .. " and its ship landing pad, then click Resume. No transaction was sent."
        )
        self.at = result.planet
      end)
      local place = key(expected) == key(op.destination.name) and op.destination or payload.from
      if place and place.arrival and place.arrival.kind == "station" then
        active.steps[#active.steps].gmcp = function()
          assert(
            self.stationAt
              and key(self.stationAt.name) == key(expected)
              and key(self.stationAt.ship) == key(ship.name),
            "Station arrival is unverified. Complete a verified station landing before resuming."
          )
          return { planet = expected }
        end
      end
      step("Confirm ship on landing pad", "look", nil, function(lines)
        local found = false
        for _, line in ipairs(lines) do
          local names = line:match("^[^:]+:%s*(.+)$")
          for name in tostring(names or ""):gmatch("[^,]+") do
            if key(name) == key(ship.name) then
              found = true
            end
          end
        end
        assert(
          found,
          "Return to the landing pad containing "
            .. ship.name
            .. ", stand outside the ship, then click Resume."
        )
        remember("location", ship, expected, true)
      end)
    end
    local function cargo(force)
      local saved = not force and recalled("cargo", ship, self.at)
      if saved then
        active.cargo = saved
        return
      end
      query("Inspect cargo", "listcargo " .. quote(ship.name), "listcargo", function(line)
        return line:find("Cargo Readout for", 1, true) ~= nil
      end, function(result)
        assert(key(result.shipName) == key(ship.name), "Cargo readout belongs to another ship.")
        active.cargo = result
        remember("cargo", ship, self.at, result)
      end)
    end
    local function credits(confirm)
      local saved = recalled("credits", ship, self.at)
      if saved ~= nil then
        active.credits = saved
        if confirm then
          confirm()
        end
        return
      end
      query("Check available credits", "credits", "credits", function(line)
        return line:match("^You have [%d,]+ credits%.$")
      end, function(result)
        active.credits = result.balance
        remember("credits", ship, self.at, result.balance)
        if confirm then
          confirm()
        end
      end)
    end
    local function refuel(force)
      if not force and recalled("fuel", ship, self.at) then
        return
      end
      query("Refuel " .. ship.name, "refuel " .. quote(ship.name), "refuel", function(line)
        return line == "That ship is already fully fueled!"
          or line:match("^You pay .+ credits to refuel the ship%.$")
      end, function(result)
        assert(result.action == "refuel", "Unexpected refuel response.")
        self:recordTransaction(result)
        remember("fuel", ship, self.at, true)
      end)
    end
    local ok, err = pcall(function()
      quote(ship.name)
      assert(
        type(ship.enterPath) == "table" and type(ship.exitPath) == "table",
        "Configure ship entry and exit paths before starting autopilot."
      )
      if ship.directCockpit == true then
        assert(
          #ship.enterPath == 0 and #ship.exitPath == 0,
          "Direct cockpit access cannot include movement paths."
        )
      else
        assert(
          #ship.enterPath > 0 and #ship.exitPath > 0,
          "Configure both ship entry and exit paths, or explicitly confirm direct cockpit access."
        )
      end
      assert(
        validPath(ship.enterPath) and validPath(ship.exitPath),
        "Invalid cockpit or exit path."
      )
      if op.kind == "reconcile" then
        self:invalidateEvidence()
        if payload.itinerary then
          query("Verify circuit before commerce", "l hyp", "hyperlane", function(line)
            return line:find("Between ", 1, true) ~= nil
          end, function(result)
            for i = 2, #payload.itinerary do
              if payload.manualRoute == true then
                checkJumpRange(payload.itinerary[i - 1], payload.itinerary[i], payload.maxDistance)
              end
              assert(
                Navigation.canJump(
                  payload.itinerary[i - 1],
                  payload.itinerary[i],
                  result.lanes,
                  payload.manualRoute
                ),
                "Circuit contains a blocked connection. Edit the route before buying cargo."
              )
            end
          end)
        end
        query("Confirm current planet", "showplanet", "showplanet", function(line)
          return line:match("^Planet:")
        end, function(result)
          assert(
            key(result.planet) == key(op.destination.name),
            "Current planet does not match this stop. Move to "
              .. op.destination.name
              .. " before resuming."
          )
          self.at = result.planet
        end)
        step("Confirm ship is on this landing pad", "look", nil, function(lines)
          local found = false
          for _, line in ipairs(lines) do
            local names = line:match("^[^:]+:%s*(.+)$")
            for name in tostring(names or ""):gmatch("[^,]+") do
              if key(name) == key(ship.name) then
                found = true
              end
            end
          end
          assert(
            found,
            "Stand outside " .. ship.name .. " on its landing pad before starting or resuming."
          )
          remember("location", ship, op.destination.name, true)
        end)
        cargo()
        credits(function()
          local interrupted = payload.interrupted
          if not interrupted then
            active.interruptedOutcome = "not_started"
          elseif self.completed[interrupted.id] or interrupted.kind == "navigate" then
            active.interruptedOutcome = "completed"
          elseif self.transactions[interrupted.id] == "not_started" then
            active.interruptedOutcome = "not_started"
          elseif interrupted.kind == "refuel" then
            active.interruptedOutcome = "not_started"
          else
            error(
              "An interrupted cargo transaction is uncertain. Inspect the hold and stop this run before creating a new route."
            )
          end
        end)
      elseif op.kind == "refuel" then
        location()
        assert(key(self.at) == key(op.destination.name), "Location must be reconciled first.")
        refuel()
      elseif op.kind == "stop_action" then
        location()
        assert(key(self.at) == key(op.destination.name), "Location must be reconciled first.")
        local action = op.action
        assert(
          action and (action.kind == "cargo.buy" or action.kind == "cargo.sell"),
          "Unsupported stop action."
        )
        local data = action.payload
        assert(
          data.tradeMode == nil or data.tradeMode == "cargo" or data.tradeMode == "contraband",
          "Invalid cargo trading mode."
        )
        assert(
          type(data.quantity) == "number"
            and data.quantity > 0
            and data.quantity <= 9007199254740991
            and data.quantity % 1 == 0,
          "Invalid cargo quantity."
        )
        quote(data.resource)
        cargo()
        credits()
        if action.kind == "cargo.buy" then
          query(
            "Check purchase price",
            "showplanet " .. quote(self.at) .. " resources",
            "showplanet",
            function(line)
              return line:find("Price per unit:", 1, true) ~= nil
            end,
            function(result)
              assert(key(result.planet) == key(self.at), "Market belongs to another planet.")
              local price
              for name, value in pairs(result.resources) do
                if key(name) == key(data.resource) then
                  price = value
                end
              end
              assert(
                price and price * data.quantity <= active.credits,
                "Insufficient credits or missing current price."
              )
              assert(
                active.cargo.capacity - active.cargo.used >= data.quantity,
                "Insufficient free cargo space."
              )
            end
          )
        end
        local buying = action.kind == "cargo.buy"
        query(
          buying and "Buy cargo" or "Sell cargo",
          function()
            if not buying then
              local held = 0
              for _, item in ipairs(active.cargo.items) do
                if key(item.resource) == key(data.resource) then
                  held = held + (item.current or 0)
                end
              end
              assert(held >= data.quantity, "Planned cargo is not in the hold.")
            end
            return (
              data.tradeMode == "contraband"
                and (buying and "buycontraband " or "sellcontraband ")
              or (buying and "buycargo " or "sellcargo ")
            )
              .. quote(ship.name)
              .. " "
              .. quote(data.resource)
              .. " "
              .. data.quantity
          end,
          "cargo_transaction",
          function(line)
            return line:match("^You purchased .+ credits%.$")
              or line:match("^You sell .+ credits%.$")
              or line:match("^You pay .+ units of smuggled .+ loaded on to your ship%.$")
              or line:match("^You find a contact willing to pay .+ units of smuggled .+%.$")
          end,
          function(result)
            self.evidence = self.evidence or {}
            self.evidence.cargo = nil
            assert(
              result.action == (buying and "buy" or "sell")
                and (result.tradeMode or "cargo") == (data.tradeMode or "cargo")
                and key(result.resource) == key(data.resource)
                and result.amount == data.quantity,
              "Cargo confirmation differs from the planned transaction; reconcile the hold."
            )
            self:recordTransaction(result)
            -- Persist the validated outcome before the deferred step completion.
            self.completed[op.id] = true
          end
        )
        -- Loading/unloading completes asynchronously and need not emit a prompt.
        active.steps[#active.steps].event = true
      elseif op.kind == "navigate" then
        location(payload.from and payload.from.name)
        assert(self.at, "Location must be reconciled first.")
        local destination = op.destination
        local target = destination.arrival.kind == "station" and destination.arrival.station
          or destination.name
        quote(target)
        if destination.arrival.pad then
          quote(destination.arrival.pad)
        end
        if key(self.at) == key(destination.name) then
          error("Already at this destination; reconcile before navigating.")
        end
        local position, system
        if payload.manualRoute == true then
          checkJumpRange(payload.from, destination, payload.maxDistance)
        end
        query("Verify hyperlane availability", "l hyp", "hyperlane", function(line)
          return line:find("Between ", 1, true) ~= nil
        end, function(result)
          assert(
            payload.from and key(payload.from.name) == key(self.at),
            "Departure does not match the previous stop."
          )
          assert(
            Navigation.canJump(payload.from, destination, result.lanes, payload.manualRoute),
            "The next jump is blocked. Recalculate the route."
          )
        end)
        if destination.arrival.kind == "station" then
          position, system = destination.position, destination.system
        else
          query(
            "Resolve destination coordinates",
            "showplanet " .. quote(destination.name),
            "showplanet",
            function(line)
              return line:match("^Coordinates:")
            end,
            function(result)
              assert(
                key(result.planet) == key(destination.name) and result.coordinates and result.system,
                "Destination coordinates were not confirmed."
              )
              position, system = result.coordinates, result.system
            end
          )
        end
        refuel()
        step(
          "Open ship",
          "open " .. quote(ship.name) .. (ship.hatchCode and " " .. quote(ship.hatchCode) or ""),
          function(line)
            return line == "It's already open!" or line:match("^You open the hatch on ")
          end
        )
        step("Board ship", "enter " .. quote(ship.name))
        step("Close hatch", "close")
        for _, direction in ipairs(ship.enterPath or {}) do
          assert(
            ({
              n = true,
              s = true,
              e = true,
              w = true,
              ne = true,
              nw = true,
              se = true,
              sw = true,
              u = true,
              d = true,
              north = true,
              south = true,
              east = true,
              west = true,
              northeast = true,
              northwest = true,
              southeast = true,
              southwest = true,
              up = true,
              down = true,
            })[direction],
            "Invalid cockpit path."
          )
          step("Move to cockpit: " .. direction, direction)
        end
        step("Disable ship autopilot", "autopilot off")
        step("Take flight controls", "pilot", function(line)
          return line == "You grip the controls."
        end)
        step("Launch", function()
          active.flightStarted = true
          return "launch"
        end, function(line)
          return line == "The ship leaves the platform far behind as it flies into space."
        end, function()
          self.at = nil
          self.stationAt = nil
        end, 120)
        step("Calculate hyperspace", function()
          assert(
            position and tonumber(position.x) and tonumber(position.y) and tonumber(position.z),
            "Missing destination coordinates."
          )
          return "calculate "
            .. quote(system)
            .. " "
            .. (position.x + 289)
            .. " "
            .. (position.y + 289)
            .. " "
            .. (position.z + 289)
        end, function(line)
          return line:find("[Status]: Hyperspace calculations have been completed.", 1, true) ~= nil
        end, nil, 180)
        query("Verify calculated destination", "navstat", "navstat", function(line)
          return line:match("^Jump System:")
        end, function(result)
          assert(
            key(result.jumpSystem) == key(destination.system),
            "Calculated jump does not match "
              .. destination.system
              .. ". Correct the calculation before continuing."
          )
        end)
        step("Travel through hyperspace", "hyperspace", function(line)
          return line == "The ship lurches slightly as it comes out of hyperspace."
        end, nil, 900)
        active.steps[#active.steps].clearanceRetry = true
        query("Verify arrival system", "navstat", "navstat", function(line)
          return line:match("^Current System:")
        end, function(result)
          assert(
            key(result.system) == key(destination.system),
            "Arrived in a different system. Navigate to "
              .. destination.system
              .. " before continuing."
          )
          active.arrivalVerified = true
        end)
        local approachTarget = destination.arrival.approachTarget or target
        step("Approach " .. approachTarget, "course " .. quote(approachTarget), function(line)
          return key(line:match("^You begin orbiting (.-)%.$")) == key(approachTarget)
        end, function()
          active.stationApproached = destination.arrival.kind == "station"
        end, 900)
        if destination.arrival.kind == "station" then
          step(
            "Check station hangar",
            "land " .. quote(destination.arrival.landingTarget or target),
            function(line)
              return line:match("^Hangar %d+:") ~= nil
            end,
            function(lines)
              local wanted = tostring(destination.arrival.pad or "")
              assert(
                wanted:match("^[1-9]%d*$"),
                "Configure a numbered station hangar before landing."
              )
              for _, line in ipairs(lines) do
                local number, status, used, capacity =
                  line:match("^Hangar (%d+):%s*(%a+)%s+Slot%(s%):%s*(%d+)/(%d+)%s*$")
                if number == wanted then
                  assert(
                    status:lower() == "open" and tonumber(used) < tonumber(capacity),
                    "Station hangar "
                      .. wanted
                      .. " is closed or full. Choose an available hangar before resuming."
                  )
                  active.pad = wanted
                  return
                end
              end
              error(
                "Configured station hangar "
                  .. wanted
                  .. " was not listed; no landing command sent."
              )
            end
          )
        elseif not destination.arrival.pad then
          step("Find landing pad", "land " .. quote(target), function(line)
            return line:match("^Possible choices for ")
          end, function(lines)
            for _, line in ipairs(lines) do
              local pad = line:match("^(.-) %(All Sizes%)$") or line:match("^(.-) %(Max: .-%)$")
              if pad then
                active.pad = pad
                break
              end
            end
            assert(active.pad, "No landing pad was listed. Set a preferred pad.")
          end)
        end
        step("Land", function()
          return "land "
            .. quote(destination.arrival.landingTarget or target)
            .. " "
            .. (destination.arrival.pad or active.pad)
        end, function(line)
          return line == "You feel a slight thud as the ship sets down on the ground."
        end, function()
          if destination.arrival.kind == "station" then
            assert(
              active.arrivalVerified and active.stationApproached,
              "Station approach and arrival system were not verified."
            )
            self.stationAt = { name = destination.name, ship = ship.name }
          end
        end, 120)
        step("Enable ship autopilot", "autopilot on")
        for _, direction in ipairs(ship.exitPath or {}) do
          assert(
            ({
              n = true,
              s = true,
              e = true,
              w = true,
              ne = true,
              nw = true,
              se = true,
              sw = true,
              u = true,
              d = true,
              north = true,
              south = true,
              east = true,
              west = true,
              northeast = true,
              northwest = true,
              southeast = true,
              southwest = true,
              up = true,
              down = true,
            })[direction],
            "Invalid exit path."
          )
          step("Move to hatch: " .. direction, direction)
        end
        step("Open hatch", "open")
        step("Leave ship", "leave")
        step("Close ship", "close " .. quote(ship.name))
        location(nil, true)
        -- A cargo readout outside the ship also verifies access before trading.
        cargo(true)
        refuel(true)
        active.steps[#active.steps].confirm = function(lines)
          local result = parsed("refuel", lines)
          self:recordTransaction(result)
          self.at = destination.name
          remember("fuel", ship, self.at, true)
        end
      else
        error("Unsupported navigation operation.")
      end
    end)
    if not ok then
      return false, tostring(err)
    end
    local phase = "ground"
    for _, item in ipairs(active.steps) do
      if item.label == "Open ship" then
        phase = "pre_hyperspace"
      end
      if item.label == "Travel through hyperspace" then
        phase = "hyperspace"
      end
      if item.label == "Verify arrival system" then
        phase = "post_hyperspace"
      end
      if item.label == "Enable ship autopilot" then
        phase = "ground"
      end
      item.phase = phase
      item.event = item.event
        or item.label == "Launch"
        or item.label == "Calculate hyperspace"
        or item.label == "Travel through hyperspace"
        or item.label == "Land"
        or item.label:match("^Approach ") ~= nil
    end
    self.active = active
    self:next()
    return true, nil, true
  end
  return self
end
return Navigation
