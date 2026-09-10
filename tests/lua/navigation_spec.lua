local h = require("harness")
local Navigation = require("lotj_holocron_navigation")
local parsers = require("lotj_holocron_parsers")
local describe, it, equal = h.describe, h.it, h.equal

local function fixture()
  local f = { commands = {}, timers = {}, results = {}, transactions = {}, clock = 0, speed = 20 }
  f.driver = Navigation.new({
    parse = parsers.parse,
    evidenceRoom = function()
      return f.room
    end,
    groundLocation = function()
      return f.groundLocation
    end,
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
  local creditQueries = 0
  for _, command in ipairs(f.commands) do
    if command == "credits" then
      creditQueries = creditQueries + 1
    end
  end
  equal(creditQueries, 1)
  equal(f.results[#f.results].result.outcome, "completed")
end
local function ground(f, name)
  f:respond("Planet: " .. name)
  f:respond("Landing Pad\nFreighter: Sunrise")
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
  ground(f, planet)
  f:respond(cargo(buying and "(Empty)" or resource, buying and 0 or 10))
  f:respond("You have 1097793 credits.")
  if buying then
    f:respond("Planet: " .. planet .. "\n" .. resource .. " ( Price per unit: 10.00)")
  end
  local resultCount, transactionCount = #f.results, #f.transactions
  f:respond("You direct a team of dockworkers to begin loading some cargo.")
  equal(#f.results, resultCount)
  local confirmation = (buying and "You purchased" or "You sell")
    .. " 10 units of "
    .. resource
    .. " for 100 credits."
  f.driver:line(confirmation)
  f.driver:line(confirmation)
  f:tick(0) -- The server need not send a prompt after loading/unloading.
  equal(#f.results, resultCount + 1)
  equal(#f.transactions, transactionCount + 1)
  equal(f.results[#f.results].result.outcome, "completed")
end
local function fly(f, id, from, to, pauseAtJump, pauseAtCalculation, pauseAtControls)
  assert(
    f.driver:start(
      { operation = operation(id, "navigate", to), ship = ship, from = destination(from) },
      id
    )
  )
  ground(f, from)
  f:respond("| Between Corellia and Wroona : Passable |")
  f:respond("Planet: " .. to .. "\nStarsystem: " .. to .. " System\nCoordinates: 100 200 300")
  f:respond("That ship is already fully fueled!")
  f:respond("You open the hatch on Freighter 'Sunrise'.")
  for _ = 1, 4 do
    f:respond("Done.")
  end -- enter, close, north, autopilot off
  if pauseAtControls then
    return
  end
  f:respond("You grip the controls.")
  equal(f.commands[#f.commands], "launch")
  f.driver:line("The ship leaves the platform far behind as it flies into space.")
  f:tick(0)
  equal(f.commands[#f.commands], 'calculate "' .. to .. ' System" 389 489 589')
  if pauseAtCalculation then
    return
  end
  f.driver:line("[Status]: Hyperspace calculations have been completed.")
  f:tick(0)
  f:respond("Jump System: " .. to .. " System")
  if pauseAtJump then
    return
  end
  f:respond("The ship lurches slightly as it comes out of hyperspace.")
  f:respond("Current System: " .. to .. " System")
  f.driver:line("You begin orbiting " .. to .. ".")
  f:tick(0)
  equal(f.commands[#f.commands], 'land "' .. to .. '" Main Pad')
  f.driver:line("You feel a slight thud as the ship sets down on the ground.")
  f:tick(0)
  for _ = 1, 5 do
    f:respond("Done.")
  end -- autopilot on, south, open, leave, close
  ground(f, to)
  f:respond(cargo("Textiles", 10))
  f:respond("You pay 10 credits to refuel the ship.")
  equal(f.results[#f.results].result.location.destination, to)
end

describe("navigation transport", function()
  it("starts a circuit through visible HUD boundaries without prompt callbacks", function()
    local f = fixture()
    local function response(text)
      for line in (text .. "\n"):gmatch("([^\n]*)\n") do
        f.driver:line(line)
      end
      f.driver:line("{Tone: none } {Time: day } {Ambience: average }")
      f.driver:line("{Health: 1410/1410} {OOC:||||||} [ ] {Movement: 2680/2680} []")
      f.driver:prompt() -- A real prompt following the HUD must not advance twice.
      f:tick(0)
    end
    assert(f.driver:start({
      operation = operation("start", "reconcile", "Corellia"),
      ship = ship,
      itinerary = { destination("Corellia"), destination("Lorrd") },
    }, "start"))
    equal(f.commands[#f.commands], "l hyp")
    response("An unrelated message before the response.")
    equal(f.commands[#f.commands], "l hyp")
    -- No real prompt callback for the response that used to stall.
    f.driver:line("| Between Naboo and Bespin : No Route |")
    f.driver:line("| Between Corellia and Wroona : No Route |")
    f.driver:line("| Between Kashyyyk and Core Worlds : No Route |")
    f.driver:line("| Between Arkania and Lorrd : No Route |")
    f.driver:line("| Between Hutt Space and Tatooine : Passable |")
    f.driver:line("*--------------------------------------------------*")
    f.driver:line("{Health: 1410/1410} {OOC:||||||} [ ] {Movement: 2680/2680} []")
    f:tick(0)
    equal(f.commands[#f.commands], "showplanet")
    response("Planet: Corellia")
    equal(f.commands[#f.commands], "look")
    response("Landing Pad\nFreighter: Sunrise")
    equal(f.commands[#f.commands], 'listcargo "Sunrise"')
    response(cargo("(Empty)", 0))
    equal(f.commands[#f.commands], "credits")
    response("You have 1000 credits.")
    equal(f.driver.active, nil)
    equal(f.results[#f.results].result.outcome, "completed")
    equal(#f.commands, 5)
  end)

  it("lands at Lodestar bay 1, refuels outside, and departs for Lorrd", function()
    local f = fixture()
    reconcile(f)
    local station = {
      name = "Eeropha",
      system = "Eeropha System",
      position = { x = 9137, y = 4521, z = -18941 },
      arrival = {
        kind = "station",
        station = "Lodestar Utopia Refueling Station",
        landingTarget = "Lodestar",
        approachTarget = "Eeropha",
        pad = "1",
      },
    }
    local op = operation("station", "navigate", "Eeropha")
    op.destination = station
    assert(
      f.driver:start({ operation = op, ship = ship, from = destination("Corellia") }, "station")
    )
    ground(f, "Corellia")
    f:respond("| Between Corellia and Wroona : Passable |")
    equal(f.commands[#f.commands], 'refuel "Sunrise"')
    f:respond("That ship is already fully fueled!")
    f:respond("You open the hatch on Freighter 'Sunrise'.")
    for _ = 1, 4 do
      f:respond("Done.")
    end
    f:respond("You grip the controls.")
    f:respond("The ship leaves the platform far behind as it flies into space.")
    equal(f.commands[#f.commands], 'calculate "Eeropha System" 9426 4810 -18652')
    f:respond("[Status]: Hyperspace calculations have been completed.")
    f:respond("Jump System: Eeropha System")
    f:respond("The ship lurches slightly as it comes out of hyperspace.")
    f:respond("Current System: Eeropha System")
    equal(f.commands[#f.commands], 'course "Eeropha"')
    f:respond("You begin orbiting Eeropha.")
    equal(f.commands[#f.commands], 'land "Lodestar"')
    local hangarStep = f.driver.active.steps[f.driver.active.index]
    for _, invalid in ipairs({
      "Hangar 1: Closed Slot(s): 2/40",
      "Hangar 1: Open Slot(s): 40/40",
      "Hangar 2: Open Slot(s): 0/40",
    }) do
      equal(pcall(hangarStep.confirm, { invalid }), false)
    end
    f:respond(
      "Please type the hangar after the ship name.\nPossible choices for Freighter 'Sunrise':\n\nHangar 1: Open       Slot(s): 2/40\nHangar 2: Open       Slot(s): 15/40\nHangar 3: Open       Slot(s): 2/40\nHangar 4: Open       Slot(s): 0/40"
    )
    equal(f.commands[#f.commands], 'land "Lodestar" 1')
    f:respond("You feel a slight thud as the ship sets down on the ground.")
    for _ = 1, 5 do
      f:respond("Done.")
    end
    f:tick(0) -- station evidence completes without showplanet
    equal(f.commands[#f.commands], "look")
    f:respond("Hangar Bay 1\nFreighter: Sunrise")
    f:respond(cargo("Food", 10))
    equal(f.commands[#f.commands], 'refuel "Sunrise"')
    f:respond("You pay 10 credits to refuel the ship.")
    equal(f.results[#f.results].result.location.destination, "Eeropha")
    assert(
      f.driver:start(
        { operation = operation("depart", "navigate", "Lorrd"), ship = ship, from = station },
        "depart"
      )
    )
    f:tick(0)
    equal(f.commands[#f.commands], "look")
    f:respond("Hangar Bay 1\nFreighter: Sunrise")
    f:respond("| Between Arkania and Lorrd : No Route |")
    equal(f.commands[#f.commands], 'showplanet "Lorrd"')
  end)

  it("tracks actual session cargo, fuel, revenue and sale tax once", function()
    local f = fixture()
    reconcile(f)
    trade(f, "buy", "buy", "Corellia", "Food")
    equal(f.driver.accounts.cargo, 100)
    trade(f, "sell", "sell", "Corellia", "Food")
    f.driver:line("Total profit, accounting for purchase price: 20. Tax paid: 3.")
    f.driver:line("Total profit, accounting for purchase price: 20. Tax paid: 3.")
    assert(
      f.driver:start({ operation = operation("fuel", "refuel", "Corellia"), ship = ship }, "fuel")
    )
    ground(f, "Corellia")
    f:respond("You pay 10 credits to refuel the ship.")
    equal(f.driver.accounts.revenue, 100)
    equal(f.driver.accounts.tax, 3)
    equal(f.driver.accounts.fuel, 10)
    equal(f.driver.accounts.revision, 4)
    local saved = f.driver.accounts
    local other = fixture()
    assert(
      other.driver:start(
        { operation = operation("restore", "reconcile", "Corellia"), ship = ship, accounts = saved },
        "restore"
      )
    )
    equal(other.driver.accounts.cargo, 100)
    equal(other.driver.accounts.revision, 4)
  end)

  it("reconciles a sale confirmed after pause without sending it again", function()
    local f = fixture()
    reconcile(f)
    local sale = operation("sale", "stop_action", "Corellia", {
      kind = "cargo.sell",
      payload = { resource = "Food", quantity = 10 },
    })
    assert(f.driver:start({ operation = sale, ship = ship }, "sale"))
    ground(f, "Corellia")
    f:respond(cargo("Food", 10))
    f:respond("You have 1000 credits.")
    f.driver:stop("Paused")
    f.driver:line("You sell 10 units of Food for 100 credits.")
    f.driver:line("You sell 10 units of Food for 100 credits.")
    equal(#f.transactions, 1)
    assert(f.driver:start({
      operation = operation("resume", "reconcile", "Corellia"),
      interrupted = sale,
      ship = ship,
    }, "resume"))
    ground(f, "Corellia")
    f:respond(cargo("(Empty)", 0))
    f:respond("You have 1100 credits.")
    equal(f.results[#f.results].result.interruptedOutcome, "completed")
    local count = 0
    for _, command in ipairs(f.commands) do
      if command == 'sellcargo "Sunrise" "Food" 10' then
        count = count + 1
      end
    end
    equal(count, 1)
  end)

  it(
    "reuses the startup balance after an already-full refuel, then invalidates it on purchase",
    function()
      local f = fixture()
      f.room = 123
      reconcile(f)
      assert(
        f.driver:start({ operation = operation("fuel", "refuel", "Corellia"), ship = ship }, "fuel")
      )
      f:respond("That ship is already fully fueled!")
      assert(f.driver:start({
        operation = operation("buy", "stop_action", "Corellia", {
          kind = "cargo.buy",
          payload = { resource = "Textiles", quantity = 10 },
        }),
        ship = ship,
      }, "buy"))
      equal(f.commands[#f.commands], 'showplanet "Corellia" resources')
      f:respond("Planet: Corellia\nTextiles ( Price per unit: 10.00)")
      equal(f.commands[#f.commands], 'buycargo "Sunrise" "Textiles" 10')
      f:respond("You purchased 10 units of Textiles for 100 credits.")
      equal(f.driver.evidence.credits, nil)
      equal(f.results[#f.results].result.outcome, "completed")
      local count = 0
      for _, command in ipairs(f.commands) do
        if command == "credits" then
          count = count + 1
        end
      end
      equal(count, 1)
    end
  )

  for _, reason in ipairs({ "expired", "external command" }) do
    it("rechecks credits before buying when startup evidence is " .. reason, function()
      local f = fixture()
      f.room = 123
      reconcile(f)
      if reason == "expired" then
        f.clock = 61
      else
        f.driver:invalidateEvidence()
      end
      assert(f.driver:start({
        operation = operation("buy", "stop_action", "Corellia", {
          kind = "cargo.buy",
          payload = { resource = "Textiles", quantity = 10 },
        }),
        ship = ship,
      }, "buy"))
      equal(f.commands[#f.commands], "showplanet")
      ground(f, "Corellia")
      f:respond(cargo("(Empty)", 0))
      equal(f.commands[#f.commands], "credits")
      f:respond("You have 0 credits.")
      f:respond("Planet: Corellia\nTextiles ( Price per unit: 10.00)")
      equal(f.driver.active, nil)
      assert(f.results[#f.results].reason:find("Insufficient credits", 1, true))
      for _, command in ipairs(f.commands) do
        assert(not command:match("^buycargo"))
      end
    end)
  end

  it("reuses startup evidence across refueling, purchase and departure", function()
    local f = fixture()
    f.room = 123
    reconcile(f)
    assert(
      f.driver:start({ operation = operation("fuel", "refuel", "Corellia"), ship = ship }, "fuel")
    )
    equal(f.commands[#f.commands], 'refuel "Sunrise"')
    f:respond("You pay 10 credits to refuel the ship.")
    assert(f.driver:start({
      operation = operation("buy", "stop_action", "Corellia", {
        kind = "cargo.buy",
        payload = { resource = "Textiles", quantity = 10 },
      }),
      ship = ship,
    }, "buy"))
    equal(f.commands[#f.commands], "credits")
    f:respond("You have 1097783 credits.")
    f:respond("Planet: Corellia\nTextiles ( Price per unit: 10.00)")
    equal(f.commands[#f.commands], 'buycargo "Sunrise" "Textiles" 10')
    f:respond("You purchased 10 units of Textiles for 100 credits.")
    equal(f.driver.evidence.cargo, nil)
    assert(f.driver:start({
      operation = operation("fly", "navigate", "Wroona"),
      ship = ship,
      from = destination("Corellia"),
    }, "fly"))
    equal(f.commands[#f.commands], "l hyp")
    f:respond("| Between Corellia and Wroona : Passable |")
    f:respond("Planet: Wroona\nStarsystem: Wroona System\nCoordinates: 100 200 300")
    equal(f.commands[#f.commands], 'open "Sunrise"')
    local counts = {}
    for _, command in ipairs(f.commands) do
      counts[command] = (counts[command] or 0) + 1
    end
    equal(counts.showplanet, 1)
    equal(counts.look, 1)
    equal(counts['listcargo "Sunrise"'], 1)
    equal(counts['refuel "Sunrise"'], 1)
    equal(counts.credits, 2)
  end)

  for _, reason in ipairs({
    "expired",
    "room",
    "external command",
    "stop",
    "new run",
    "ship",
    "missing room",
  }) do
    it("rechecks startup evidence after " .. reason, function()
      local f = fixture()
      f.room = 123
      reconcile(f)
      local nextShip = ship
      local op = operation("fuel", "refuel", "Corellia")
      if reason == "expired" then
        f.clock = 61
      elseif reason == "room" then
        f.room = 124
      elseif reason == "external command" then
        f.driver:invalidateEvidence()
      elseif reason == "stop" then
        f.driver:stop()
      elseif reason == "new run" then
        op = operation("again", "reconcile", "Corellia")
        op.runId = "another-run"
      elseif reason == "ship" then
        nextShip = { name = "Other", enterPath = { "n" }, exitPath = { "s" } }
      elseif reason == "missing room" then
        f.room = nil
      end
      assert(f.driver:start({ operation = op, ship = nextShip }, "next"))
      equal(f.commands[#f.commands], "showplanet")
    end)
  end

  it(
    "matches a class-qualified blocker and jumps when the tenth proximity scan clears it",
    function()
      local f = fixture()
      f.speed = 0
      reconcile(f)
      fly(f, "out", "Corellia", "Wroona", true)
      f:respond("You are too close to Test Cruiser 'Test Blocker' to make the jump to lightspeed!")
      local distances = { 164, 206, 248, 276, 318, 360, 402, 430, 458, 500 }
      for i, distance in ipairs(distances) do
        equal(f.commands[#f.commands], "prox")
        equal(f.driver.active.clearance.attempts, i)
        f:respond(
          "Test System:\nTest Cruiser 'Test Blocker' Prox: "
            .. distance
            .. "\nFreighter 'Another Test Ship' Prox: "
            .. (distance + 10)
            .. "\nYour Coordinates: 0 0 0"
        )
        if i < #distances then
          equal(f.driver.active.clearance.phase, "wait")
          f:tick(f.driver.active.timer.seconds)
        end
      end
      equal(f.commands[#f.commands], "hyperspace")
      equal(f.driver.active.clearance.attempts, 10)
    end
  )

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
    equal(f.commands[#f.commands], "navstat")
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
    equal(other.driver.active.waitingForMilestone, true)
    equal(other.commands[#other.commands], "hyperspace")
    other.driver:line("The stars become streaks of light as you enter hyperspace.")
    other.driver:line("The ship lurches slightly as it comes out of hyperspace.")
    other:tick(0)
    equal(other.commands[#other.commands], "navstat")
  end)
  it(
    "rejects invalid movement paths during reconciliation before any cargo can be bought",
    function()
      for _, field in ipairs({ "enterPath", "exitPath" }) do
        local f = fixture()
        local invalid = { name = ship.name, enterPath = { "n" }, exitPath = { "s" } }
        invalid[field] = { "typo" }
        local ok, reason = f.driver:start(
          { operation = operation("start", "reconcile", "Corellia"), ship = invalid },
          "start"
        )
        equal(ok, false)
        assert(reason:find("Invalid cockpit or exit path", 1, true))
        equal(#f.commands, 0)
      end
    end
  )

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
        ground(f, "Corellia")
        f:respond(cargo(buying and "(Empty)" or "Food", buying and 0 or 10))
        f:respond("You have 1097793 credits.")
        if buying then
          f:respond("Planet: Corellia\nFood ( Price per unit: 10.00)")
        end
        equal(
          f.commands[#f.commands],
          (buying and "buycontraband" or "sellcontraband") .. ' "Sunrise" "Food" 10'
        )
        f.driver:line(
          buying and "You pay 100 credits to have 10 units of smuggled Food loaded on to your ship."
            or "You find a contact willing to pay 100 credits to unload 10 units of smuggled Food."
        )
        f:tick(0)
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
    ground(f, "Corellia")
    f:respond(cargo("Food", 10))
    f:respond("You have 1000 credits.")
    f:respond("You sell 10 units of Food for 100 credits.")
    assert(f.results[#f.results].reason:find("confirmation differs", 1, true))
  end)
end)

describe("recoverable flight phases and commerce gates", function()
  it("adopts a manual launch after controls fail without replaying boarding or launch", function()
    local f = fixture()
    reconcile(f)
    fly(f, "flight", "Corellia", "Wroona", false, false, true)
    equal(f.commands[#f.commands], "pilot")
    f:respond("You'll have to disengage the ship's autopilot first.")
    local sent = #f.commands
    f:respond("Autopilot OFF.")
    equal(#f.commands, sent)
    f.driver:line("The ship leaves the platform far behind as it flies into space.")
    f.driver:line("The ship leaves the platform far behind as it flies into space.")
    f:tick(0)
    equal(#f.commands, sent + 1)
    equal(f.commands[#f.commands], 'calculate "Wroona System" 389 489 589')
  end)

  it("keeps a timed-out controls step recoverable by the subsequent launch event", function()
    local f = fixture()
    reconcile(f)
    fly(f, "flight", "Corellia", "Wroona", false, false, true)
    f:tick(30)
    equal(f.driver.active.waitingForMilestone, true)
    f.driver:line("The ship leaves the platform far behind as it flies into space.")
    f:tick(0)
    equal(f.commands[#f.commands], 'calculate "Wroona System" 389 489 589')
  end)

  it(
    "uses orbit evidence after a missed hyperspace exit but verifies the system before landing",
    function()
      local f = fixture()
      reconcile(f)
      fly(f, "flight", "Corellia", "Wroona", true)
      local sent = #f.commands
      f.driver:line("You begin orbiting Another Planet.")
      f:tick(0)
      equal(#f.commands, sent)
      f.driver:line("You begin orbiting Wroona.")
      f:tick(0)
      equal(f.commands[#f.commands], "navstat")
      f:respond("Current System: Wroona System")
      f:tick(0)
      equal(f.commands[#f.commands], 'land "Wroona" Main Pad')
    end
  )

  it("adopts an observed landing when orbit output was missed", function()
    local f = fixture()
    reconcile(f)
    fly(f, "flight", "Corellia", "Wroona", true)
    f.driver:line("The ship lurches slightly as it comes out of hyperspace.")
    f:tick(0)
    f:respond("Current System: Wroona System")
    equal(f.commands[#f.commands], 'course "Wroona"')
    f:respond("You must wait for the current maneuver.")
    f.driver:line("You feel a slight thud as the ship sets down on the ground.")
    f:tick(0)
    equal(f.commands[#f.commands], "autopilot on")
    equal(f.driver.active.landed, true)
    for _ = 1, 5 do
      f:respond("Done.")
    end
    f:respond("Planet: Corellia")
    equal(f.driver.active, nil)
    assert(f.results[#f.results].reason:find("Wrong planet", 1, true))
  end)

  it(
    "adopts manually initiated hyperspace after a failed calculation without replaying it",
    function()
      local f = fixture()
      reconcile(f)
      fly(f, "manual", "Corellia", "Wroona", false, true)
      f:respond("You fail.")
      equal(f.driver.active.phase, "pre_hyperspace")
      local count = #f.commands
      f.driver:line("The stars become streaks of light as you enter hyperspace.")
      equal(f.driver.active.phase, "hyperspace")
      equal(#f.commands, count)
      f.driver:line("The ship lurches slightly as it comes out of hyperspace.")
      f:tick(0)
      equal(f.commands[#f.commands], "navstat")
      f:respond("Current System: Wroona System")
      equal(f.commands[#f.commands], 'course "Wroona"')
    end
  )
  it("does not approach the planned planet after arrival in another system", function()
    local f = fixture()
    reconcile(f)
    fly(f, "wrong-system", "Corellia", "Wroona", true)
    f.driver:line("The ship lurches slightly as it comes out of hyperspace.")
    f:tick(0)
    f:respond("Current System: Anoat Sector")
    equal(f.driver.active, nil)
    equal(f.commands[#f.commands], "navstat")
  end)
  it("rechecks planet before buying even when cached location matches", function()
    local f = fixture()
    reconcile(f)
    assert(f.driver:start({
      operation = operation(
        "buy",
        "stop_action",
        "Corellia",
        { kind = "cargo.buy", payload = { resource = "Food", quantity = 10 } }
      ),
      ship = ship,
    }, "buy"))
    f:respond("Planet: Naboo")
    equal(f.driver.active, nil)
    equal(f.commands[#f.commands], "showplanet")
    assert(f.results[#f.results].reason:find("Wrong planet", 1, true))
  end)
  it("checks later manual jump ranges before commerce begins", function()
    local f = fixture()
    local itinerary = { destination("Corellia"), destination("Wroona"), destination("Corellia") }
    itinerary[1].galaxy, itinerary[2].galaxy, itinerary[3].galaxy =
      { x = 0, y = 0 }, { x = 10, y = 0 }, { x = 90, y = 0 }
    assert(f.driver:start({
      operation = operation("preflight", "reconcile", "Corellia"),
      ship = ship,
      itinerary = itinerary,
      manualRoute = true,
      maxDistance = 35,
    }, "preflight"))
    f:respond("| Between Corellia and Wroona : Passable |")
    equal(f.driver.active, nil)
    assert(f.results[#f.results].reason:find("maximum sector distance", 1, true))
    equal(#f.commands, 1)
  end)

  it("blocks the entire itinerary before any purchase when a lane is closed", function()
    local f = fixture()
    assert(f.driver:start({
      operation = operation("preflight", "reconcile", "Corellia"),
      ship = ship,
      itinerary = { destination("Corellia"), destination("Wroona"), destination("Corellia") },
    }, "preflight"))
    f:respond("| Between Corellia and Wroona : No Route |")
    equal(f.driver.active, nil)
    equal(#f.commands, 1)
  end)
  it("preserves a confirmed arrival when paused before the deferred next step", function()
    local f = fixture()
    reconcile(f)
    fly(f, "flight", "Corellia", "Wroona", true)
    local interrupted = f.driver.active.operation
    f.driver:line("The ship lurches slightly as it comes out of hyperspace.")
    f.driver:stop("Paused before next command")
    local sent = #f.commands
    f:tick(0)
    equal(#f.commands, sent)
    assert(f.driver:start({
      operation = operation("resume", "reconcile", "Wroona"),
      ship = ship,
      interrupted = interrupted,
    }, "resume"))
    f:tick(0)
    equal(f.commands[#f.commands], "navstat")
    f:respond("Current System: Wroona System")
    equal(f.commands[#f.commands], 'course "Wroona"')
  end)

  it("resumes a paused flight from an arrival event and cancellation discards recovery", function()
    local f = fixture()
    reconcile(f)
    fly(f, "flight", "Corellia", "Wroona", true)
    local interrupted = f.driver.active.operation
    f.driver:stop("Paused")
    assert(f.driver:start({
      operation = operation("resume", "reconcile", "Wroona"),
      ship = ship,
      interrupted = interrupted,
    }, "resume"))
    f.driver:line("The ship lurches slightly as it comes out of hyperspace.")
    f:tick(0)
    equal(f.commands[#f.commands], "navstat")
    f.driver:stop("Cancelled", true)
    equal(f.driver.suspended, nil)
    local count = #f.commands
    f.driver:line("You begin orbiting Wroona.")
    f:tick(0)
    equal(#f.commands, count)
  end)
end)

describe("ground recovery", function()
  for _, launchWhilePaused in ipairs({ false, true }) do
    it(
      "recovers cockpit correction with manual launch "
        .. (launchWhilePaused and "before" or "after")
        .. " resume",
      function()
        local f = fixture()
        reconcile(f)
        fly(f, "flight", "Corellia", "Wroona", false, false, true)
        local interrupted = f.driver.active.operation
        f:respond("You must be in the cockpit to pilot this ship.")
        f.driver:stop("Paused to correct cockpit access")
        local count = #f.commands
        if launchWhilePaused then
          f.driver:line("The ship leaves the platform far behind as it flies into space.")
          f:tick(0)
          equal(#f.commands, count)
        end
        assert(f.driver:start({
          operation = operation("recovery", "reconcile", "Wroona"),
          ship = ship,
          interrupted = interrupted,
        }, "recovery-intent"))
        equal(#f.commands, count)
        if not launchWhilePaused then
          f.driver:line("The ship leaves the platform far behind as it flies into space.")
        end
        f:tick(0)
        equal(#f.commands, count + 1)
        equal(f.commands[#f.commands], 'calculate "Wroona System" 389 489 589')
        f:respond("[Status]: Hyperspace calculations have been completed.")
        equal(f.commands[#f.commands], "navstat")
        f:respond("Jump System: Wroona System")
        equal(f.commands[#f.commands], "hyperspace")
        equal(f.driver.active.operation.id, "recovery")
        equal(#f.results, 2) -- Initial reconciliation and pause, not a fabricated arrival.
      end
    )
  end

  it("uses verified GMCP planet observations but still checks the ship on the pad", function()
    local f = fixture()
    f.groundLocation = { planet = "Corellia" }
    assert(
      f.driver:start(
        { operation = operation("gmcp-location", "reconcile", "Corellia"), ship = ship },
        "gmcp-location"
      )
    )
    equal(#f.commands, 0)
    f:tick(0)
    equal(f.commands[#f.commands], "look")
    f:respond("Landing Pad\nFreighter: Other")
    equal(f.driver.active, nil)
    assert(f.results[#f.results].reason:find("Stand outside", 1, true))
    local wrong = fixture()
    wrong.groundLocation = { planet = "Wroona" }
    assert(
      wrong.driver:start(
        { operation = operation("wrong-location", "reconcile", "Corellia"), ship = ship },
        "wrong-location"
      )
    )
    equal(wrong.driver.active, nil)
    equal(#wrong.commands, 0)
  end)

  it("accepts only a fresh piloting event for the active controls step", function()
    local f = fixture()
    f.driver:shipGmcp({ sequence = 7, piloting = true })
    reconcile(f)
    assert(f.driver:start({
      operation = operation("gmcp-flight", "navigate", "Wroona"),
      ship = ship,
      from = destination("Corellia"),
    }, "gmcp-flight"))
    ground(f, "Corellia")
    f:respond("| Between Corellia and Wroona : Passable |")
    f:respond("Planet: Wroona\nStarsystem: Wroona System\nCoordinates: 1 2 3")
    f:respond("That ship is already fully fueled!")
    f:respond("It's already open!")
    for _ = 1, 4 do
      f:respond("Done.")
    end
    equal(f.commands[#f.commands], "pilot")
    f.driver:shipGmcp({ sequence = 7, piloting = true })
    f:tick(0)
    equal(f.commands[#f.commands], "pilot")
    f.driver:shipGmcp({ sequence = 8, piloting = false })
    f:tick(0)
    equal(f.commands[#f.commands], "pilot")
    f.driver:shipGmcp({ sequence = 9, piloting = true })
    f:tick(0)
    equal(f.commands[#f.commands], "launch")
    f.driver:shipGmcp({ sequence = 10, piloting = true })
    f:tick(0)
    equal(f.commands[#f.commands], "launch")
    f.driver:stop("Cancelled", true)
    f.driver:shipGmcp({ sequence = 11, piloting = true })
    f:tick(0)
    equal(f.commands[#f.commands], "launch")
  end)

  it("cancels deferred launch if GMCP reports lost controls", function()
    local f = fixture()
    reconcile(f)
    assert(f.driver:start({
      operation = operation("lost-controls", "navigate", "Wroona"),
      ship = ship,
      from = destination("Corellia"),
    }, "lost-controls"))
    ground(f, "Corellia")
    f:respond("| Between Corellia and Wroona : Passable |")
    f:respond("Planet: Wroona\nStarsystem: Wroona System\nCoordinates: 1 2 3")
    f:respond("That ship is already fully fueled!")
    f:respond("It's already open!")
    for _ = 1, 4 do
      f:respond("Done.")
    end
    equal(f.commands[#f.commands], "pilot")
    f.driver:shipGmcp({ sequence = 1, piloting = true })
    f.driver:shipGmcp({ sequence = 2, piloting = false })
    f:tick(0)
    equal(f.commands[#f.commands], "pilot")
    equal(f.driver.active, nil)
  end)

  it(
    "can resume a missing-ship purchase preflight without calling it an uncertain purchase",
    function()
      local f = fixture()
      reconcile(f)
      local op = operation(
        "purchase",
        "stop_action",
        "Corellia",
        { kind = "cargo.buy", payload = { resource = "Food", quantity = 10 } }
      )
      assert(f.driver:start({ operation = op, ship = ship }, "purchase"))
      f:respond("Planet: Corellia")
      f:respond("Landing Pad\nFreighter: Other")
      equal(f.driver.active, nil)
      assert(f.driver:start({
        operation = operation("recover", "reconcile", "Corellia"),
        ship = ship,
        interrupted = op,
      }, "recover"))
      f:respond("Planet: Corellia")
      f:respond("Landing Pad\nFreighter: Sunrise")
      f:respond(cargo("(Empty)", 0))
      f:respond("You have 1000 credits.")
      equal(f.results[#f.results].result.interruptedOutcome, "not_started")
    end
  )
  it(
    "waits for actual control acquisition rather than treating a bare prompt as cockpit evidence",
    function()
      local f = fixture()
      reconcile(f)
      assert(f.driver:start({
        operation = operation("flight", "navigate", "Wroona"),
        ship = ship,
        from = destination("Corellia"),
      }, "flight"))
      ground(f, "Corellia")
      f:respond("| Between Corellia and Wroona : Passable |")
      f:respond("Planet: Wroona\nStarsystem: Wroona System\nCoordinates: 1 2 3")
      f:respond("That ship is already fully fueled!")
      f:respond("It's already open!")
      for i = 1, 4 do
        f:respond("Done.")
      end
      equal(f.commands[#f.commands], "pilot")
      f:respond("")
      equal(f.commands[#f.commands], "pilot")
      f:respond("You grip the controls.")
      equal(f.commands[#f.commands], "launch")
    end
  )
end)
