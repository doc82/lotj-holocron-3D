local h = require("harness")
local Navigation = require("lotj_holocron_navigation")
local parsers = require("lotj_holocron_parsers")
local describe, it, equal = h.describe, h.it, h.equal

local function fixture()
  local f = { commands = {}, timers = {}, results = {}, transactions = {}, clock = 0, speed = 20 }
  f.driver = Navigation.new({
    parse = parsers.parse,
    now = function()
      return f.clock
    end,
    clearanceInfo = function()
      return { speed = f.speed, exemptShips = f.exemptShips }
    end,
    timer = function(seconds, callback)
      local timer = { seconds = seconds, callback = callback }
      f.timers[timer] = true
      return timer
    end,
    cancel = function(timer)
      f.timers[timer] = nil
    end,
    send = function(command)
      table.insert(f.commands, command)
    end,
    progress = function() end,
    transaction = function(result)
      table.insert(f.transactions, result)
    end,
    finish = function(_, result, reason)
      table.insert(f.results, { result = result, reason = reason })
    end,
  })
  function f:respond(lines)
    for line in (lines .. "\n"):gmatch("([^\n]*)\n") do
      self.driver:line(line)
    end
    self.driver:prompt()
    local due = {}
    for timer in pairs(self.timers) do
      if timer.seconds == 0 then
        table.insert(due, timer)
      end
    end
    for _, timer in ipairs(due) do
      self.timers[timer] = nil
      timer.callback()
    end
  end
  function f:tick(seconds)
    self.clock = self.clock + seconds
    local due = {}
    for timer in pairs(self.timers) do
      if timer.seconds == seconds then
        table.insert(due, timer)
      end
    end
    for _, timer in ipairs(due) do
      if self.timers[timer] then
        self.timers[timer] = nil
        timer.callback()
      end
    end
  end
  return f
end
local ship = { name = "Sunrise", enterPath = { "n" }, exitPath = { "s" } }
local function destination(name)
  return { name = name, system = name .. " System", arrival = { kind = "planet", pad = "Main Pad" } }
end
local function operation(id, kind, name, action)
  return {
    id = id,
    runId = "test-run",
    kind = kind,
    destination = destination(name),
    action = action,
  }
end
local function cargo(resource, quantity)
  return "Cargo Readout for Freighter 'Sunrise':\n[1 ] ["
    .. resource
    .. "] ["
    .. quantity
    .. "/500]"
end
local function reconcile(f)
  assert(
    f.driver:start(
      { operation = operation("start", "reconcile", "Corellia"), ship = ship },
      "intent-start"
    )
  )
  f:respond("Planet: Corellia\nStarsystem: Corellia System")
  f:respond("Landing Pad\nFreighter: Other, Sunrise")
  f:respond(cargo("(Empty)", 0))
  f:respond("You have 1097793 credits.")
  f:respond("You have 1097793 credits.")
  equal(f.results[#f.results].result.outcome, "completed")
end
local function trade(f, id, kind, planet, resource)
  local buying = kind == "buy"
  assert(f.driver:start({
    operation = operation(
      id,
      "stop_action",
      planet,
      { kind = "cargo." .. kind, payload = { resource = resource, quantity = 10 } }
    ),
    ship = ship,
  }, id))
  f:respond(cargo(buying and "(Empty)" or resource, buying and 0 or 10))
  f:respond("You have 1097793 credits.")
  if buying then
    f:respond("Planet: " .. planet .. "\n" .. resource .. " ( Price per unit: 10.00)")
  end
  f:respond(
    (buying and "You purchased" or "You sell") .. " 10 units of " .. resource .. " for 100 credits."
  )
  equal(f.results[#f.results].result.outcome, "completed")
end
local function fly(f, id, from, to, pauseAtJump)
  assert(
    f.driver:start(
      { operation = operation(id, "navigate", to), ship = ship, from = destination(from) },
      id
    )
  )
  f:respond("| Between Corellia and Wroona : Passable |")
  f:respond("Planet: " .. to .. "\nStarsystem: " .. to .. " System\nCoordinates: 100 200 300")
  f:respond("That ship is already fully fueled!")
  f:respond("You open the hatch on Freighter 'Sunrise'.")
  for _ = 1, 5 do
    f:respond("Done.")
  end -- enter, close, north, autopilot off, pilot
  equal(f.commands[#f.commands], "launch")
  f:respond("The ship leaves the platform far behind as it flies into space.")
  equal(f.commands[#f.commands], 'calculate "' .. to .. ' System" 389 489 589')
  f:respond("[Status]: Hyperspace calculations have been completed.")
  if pauseAtJump then
    return
  end
  f:respond("The ship lurches slightly as it comes out of hyperspace.")
  f:respond("You begin orbiting " .. to .. ".")
  equal(f.commands[#f.commands], 'land "' .. to .. '" Main Pad')
  f:respond("You feel a slight thud as the ship sets down on the ground.")
  for _ = 1, 5 do
    f:respond("Done.")
  end -- autopilot on, south, open, leave, close
  f:respond(cargo("Textiles", 10))
  f:respond("You pay 10 credits to refuel the ship.")
  equal(f.results[#f.results].result.location.destination, to)
end

describe("navigation transport", function()
  it("rescans using speed and retries only after fresh 500-unit clearance", function()
    local f = fixture()
    reconcile(f)
    fly(f, "out", "Corellia", "Wroona", true)
    f:respond("You are too close to Corellia to make the jump to lightspeed!")
    equal(f.commands[#f.commands], "prox")
    f:respond("Corellia Prox: 400\nFreighter 'Sunrise' Prox: 0")
    equal(f.driver.active.clearance.phase, "wait")
    f:tick(5)
    equal(f.driver.active.clearance.attempts, 2)
    f:respond("Corellia Prox: 499")
    equal(f.commands[#f.commands], "prox")
    f:tick(1)
    f:respond("Corellia Prox: 500")
    equal(f.commands[#f.commands], "hyperspace")
    equal(f.driver.active.clearance.attempts, 3)
    f.driver:line("The ship lurches slightly as it comes out of hyperspace.")
    f:tick(0)
    equal(f.commands[#f.commands], 'course "Wroona"')
    equal(f.driver.active.clearance, nil)
  end)

  it("aborts after ten unsuccessful scans without an eleventh scan or blind jump", function()
    local f = fixture()
    f.speed = 0
    reconcile(f)
    fly(f, "out", "Corellia", "Wroona", true)
    f:respond("You are too close to Corellia to make the jump to lightspeed!")
    for i = 1, 10 do
      f:respond("Corellia Prox: 400")
      if i < 10 then
        f:tick(5)
      end
    end
    equal(f.driver.active, nil)
    assert(f.results[#f.results].reason:find("after 10 checks", 1, true))
    local scans, jumps = 0, 0
    for _, command in ipairs(f.commands) do
      if command == "prox" then
        scans = scans + 1
      end
      if command == "hyperspace" then
        jumps = jumps + 1
      end
    end
    equal(scans, 10)
    equal(jumps, 1)
  end)

  it("cancels clearance timers and handles closing distance without assuming clearance", function()
    local f = fixture()
    reconcile(f)
    fly(f, "out", "Corellia", "Wroona", true)
    f:respond("You are too close to Corellia to make the jump to lightspeed!")
    f:respond("Corellia Prox: 400")
    f:tick(5)
    f:respond("Corellia Prox: 300")
    local count = #f.commands
    local callbacks = {}
    for timer in pairs(f.timers) do
      table.insert(callbacks, timer.callback)
    end
    f.driver:stop("Paused by user")
    for _, callback in ipairs(callbacks) do
      callback()
    end
    equal(#f.commands, count)
  end)

  it("checks all blockers, preserves fleet exemptions and bounds rejected retries", function()
    local f = fixture()
    f.exemptShips = { wing = true }
    reconcile(f)
    fly(f, "out", "Corellia", "Wroona", true)
    for i = 1, 10 do
      f:respond("You are too close to Corellia to make the jump to lightspeed!")
      f:respond("Corellia Prox: 500\nFreighter 'Wing' Prox: 50")
      equal(f.commands[#f.commands], "hyperspace")
    end
    f:respond("You are too close to Corellia to make the jump to lightspeed!")
    equal(f.driver.active, nil)
    assert(f.results[#f.results].reason:find("after 10 checks", 1, true))
  end)

  it("keeps waiting when another non-exempt object is still inside 500 units", function()
    local f = fixture()
    reconcile(f)
    fly(f, "out", "Corellia", "Wroona", true)
    f:respond("You are too close to Corellia to make the jump to lightspeed!")
    f:respond("Corellia Prox: 600\nFreighter 'Other' Prox: 250")
    equal(f.driver.active.clearance.phase, "wait")
    equal(f.commands[#f.commands], "prox")
    equal(f.driver.active.clearance.previous.name, "Other")
  end)

  it("does not retry unrelated failures and times out missing proximity responses", function()
    local f = fixture()
    reconcile(f)
    fly(f, "out", "Corellia", "Wroona", true)
    f:respond("You can't jump yet.")
    equal(f.commands[#f.commands], "prox")
    for i = 1, 10 do
      f:tick(8)
      if i < 10 then
        f:tick(5)
      end
    end
    equal(f.driver.active, nil)
    local other = fixture()
    reconcile(other)
    fly(other, "out", "Corellia", "Wroona", true)
    other:respond("You aren't in the pilots seat.")
    equal(other.driver.active, nil)
    equal(other.commands[#other.commands], "hyperspace")
  end)
  it("rejects missing access paths before sending any command", function()
    local f = fixture()
    local payload = {
      operation = operation("start", "reconcile", "Corellia"),
      ship = { name = "Sunrise", enterPath = {}, exitPath = {} },
    }
    local accepted, reason = f.driver:start(payload, "intent")
    equal(accepted, false)
    assert(reason:find("entry and exit paths", 1, true))
    equal(#f.commands, 0)
    payload.ship.directCockpit = true
    assert(f.driver:start(payload, "direct-intent"))
    equal(f.commands[1], "showplanet")
    f.driver:stop()
  end)
  it("executes a complete circuit with outbound and return cargo", function()
    local f = fixture()
    reconcile(f)
    trade(f, "buy-out", "buy", "Corellia", "Textiles")
    fly(f, "out", "Corellia", "Wroona")
    trade(f, "sell-out", "sell", "Wroona", "Textiles")
    trade(f, "buy-back", "buy", "Wroona", "Water")
    fly(f, "back", "Wroona", "Corellia")
    trade(f, "sell-back", "sell", "Corellia", "Water")
    equal(#f.results, 7)
    equal(#f.transactions, 8)
  end)
  it("cancels deferred commands when stopped", function()
    local f = fixture()
    assert(
      f.driver:start(
        { operation = operation("start", "reconcile", "Corellia"), ship = ship },
        "intent"
      )
    )
    f.driver:line("Planet: Corellia")
    f.driver:prompt()
    local callbacks = {}
    for timer in pairs(f.timers) do
      table.insert(callbacks, timer.callback)
    end
    f.driver:stop("User stopped")
    for _, callback in ipairs(callbacks) do
      callback()
    end
    equal(#f.commands, 1)
    equal(f.results[1].reason, "User stopped")
  end)
  it("blocks a different planet before boarding or commerce", function()
    local f = fixture()
    assert(
      f.driver:start(
        { operation = operation("start", "reconcile", "Corellia"), ship = ship },
        "intent"
      )
    )
    f:respond("Planet: Naboo")
    equal(#f.commands, 1)
    assert(f.results[1].reason:find("Current planet", 1, true))
  end)
  it("enforces directional topology and temporary controls", function()
    equal(Navigation.canJump(destination("Lorrd"), destination("Ryloth"), {}, true), false)
    equal(
      Navigation.canJump(destination("Lorrd"), destination("Ryloth"), {
        { from = "Lorrd", to = "Ryloth", status = "no_route" },
      }, true),
      false
    )
    equal(Navigation.canJump(destination("Naboo"), destination("Ryloth"), {}), false)
    equal(Navigation.canJump(destination("Mon Cala"), destination("Ryloth"), {}), false)
    equal(Navigation.canJump(destination("Lorrd"), destination("Ryloth"), {}), false)
    equal(Navigation.canJump(destination("Arkania"), destination("Bespin"), {}), true)
    equal(Navigation.canJump(destination("Bespin"), destination("Naboo"), {}), false)
    equal(
      Navigation.canJump(
        destination("Bespin"),
        destination("Naboo"),
        { { from = "Naboo", to = "Bespin", status = "passable" } }
      ),
      true
    )
  end)
end)

describe("shared navigation topology", function()
  it("validates every directed permanent edge and every control state", function()
    local data = require("lotj_holocron_topology_data")
    local function dest(id)
      for _, node in ipairs(data.nodes) do
        if node.id == id then
          return { name = node.name, system = node.system }
        end
      end
      error("Unknown node " .. id)
    end
    for _, edge in ipairs(data.permanentEdges) do
      equal(Navigation.canJump(dest(edge.from), dest(edge.to), {}), true)
    end
    for _, control in ipairs(data.temporaryControls) do
      local origins = data.regions[control.from] and data.regions[control.from].members
        or { control.from }
      local targets = data.regions[control.to] and data.regions[control.to].members
        or { control.to }
      for _, a in ipairs(origins) do
        for _, b in ipairs(targets) do
          equal(Navigation.canJump(dest(a), dest(b), {}), false)
          equal(Navigation.canJump(dest(b), dest(a), {}, true), false)
          for _, status in ipairs({ "passable", "no_route", "stale", "unknown" }) do
            local lanes =
              { { from = control.monitor[2], to = control.monitor[1], status = status } }
            equal(Navigation.canJump(dest(a), dest(b), lanes), status == "passable")
            equal(Navigation.canJump(dest(b), dest(a), lanes, true), status == "passable")
          end
        end
      end
    end
    equal(Navigation.canJump(dest("bespin"), dest("ryloth"), {}), false)
    equal(Navigation.canJump(dest("bespin"), dest("ryloth"), {}, true), true)
    equal(Navigation.canJump(dest("lorrd"), dest("ryloth"), {}, true), false)
  end)
end)

describe("contraband confirmations from AutoPilot trigger definitions", function()
  for _, buying in ipairs({ true, false }) do
    it(
      buying and "buys using the smuggled loading confirmation"
        or "sells using the smuggler contact confirmation",
      function()
        local f = fixture()
        reconcile(f)
        local kind = buying and "buy" or "sell"
        assert(f.driver:start({
          operation = operation("smuggle", "stop_action", "Corellia", {
            kind = "cargo." .. kind,
            payload = {
              resource = "Food",
              quantity = 10,
              tradeMode = "contraband",
            },
          }),
          ship = ship,
        }, "smuggle"))
        f:respond(cargo(buying and "(Empty)" or "Food", buying and 0 or 10))
        f:respond("You have 1097793 credits.")
        if buying then
          f:respond("Planet: Corellia\nFood ( Price per unit: 10.00)")
        end
        equal(
          f.commands[#f.commands],
          (buying and "buycontraband" or "sellcontraband") .. ' "Sunrise" "Food" 10'
        )
        f:respond(
          buying and "You pay 100 credits to have 10 units of smuggled Food loaded on to your ship."
            or "You find a contact willing to pay 100 credits to unload 10 units of smuggled Food."
        )
        equal(f.results[#f.results].result.outcome, "completed")
        equal(f.transactions[#f.transactions].tradeMode, "contraband")
      end
    )
  end
  it("does not accept a normal cargo confirmation for a contraband command", function()
    local f = fixture()
    reconcile(f)
    assert(f.driver:start({
      operation = operation("smuggle", "stop_action", "Corellia", {
        kind = "cargo.sell",
        payload = { resource = "Food", quantity = 10, tradeMode = "contraband" },
      }),
      ship = ship,
    }, "smuggle"))
    f:respond(cargo("Food", 10))
    f:respond("You have 1000 credits.")
    f:respond("You sell 10 units of Food for 100 credits.")
    assert(f.results[#f.results].reason:find("confirmation differs", 1, true))
  end)
end)
