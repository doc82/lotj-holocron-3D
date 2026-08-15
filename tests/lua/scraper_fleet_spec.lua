local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
  assert(fixture.scraper.applyResult({source = "status", name = "TeeHee",
    weapons = {turbolasers = 7, ionCannons = 2}, hasWeapons = true}, "status"))
  fixture.scraper.state.observer.hasWeapons = true
  fixture.scraper.state.observer.weapons = {turbolasers = 7, ionCannons = 2}
  assert(fixture.scraper.applyResult(assert(fixture.parsers.parse("radar", [[
Corellian System
YT-1300 'Wayfarer' 200 0 0
Your Coordinates: 0 0 0
]])), "radar"))
end)
h.after_each(function() fixture:close() end)

local function battlegroup()
  local fleet = {kind = "battlegroup", active = true, role = "commander", members = {
    {id = "teehee", name = "TeeHee", leader = true, role = "leader"},
    {id = "reeheehee", name = "ReeHeeHee", leader = false, role = "wing", slot = 1},
  }}
  fixture.scraper.state.metadata.fleet = fleet
  fixture.scraper.state.metadata.formations.battlegroup = fleet
  return fleet
end

describe("scraper formation commands", function()
  it("infers squadron leadership after observer status arrives", function()
    fixture.scraper.state.observer.name = "Previous Carrier"
    assert(fixture.scraper.applyResult({source = "squadron", fleet = {
      kind = "squadron", active = true, members = {
        {id = "heehee", name = "HeeHee", leader = true, role = "lead"},
        {id = "wing", name = "Wing", leader = false, role = "wing"},
      },
    }}, "squadron status"))
    equal(fixture.scraper.state.metadata.fleet.role, nil)
    assert(fixture.scraper.applyResult({source = "status", name = "HeeHee"}, "status"))
    equal(fixture.scraper.state.metadata.fleet.role, "lead")
  end)

  it("targets the whole battlegroup through the native channel", function()
    battlegroup()
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "target", scope = "all", targetId = "wayfarer",
    })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "battlegroup target all Wayfarer")
    equal(fixture.scraper.state.metadata.combatTarget, "Wayfarer")
  end)

  it("expands fire-all into known flagship weapons without cockpit fallthrough", function()
    battlegroup()
    fixture.scraper.combat.targetName = "Wayfarer"
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "fire", scope = "all", weapon = "all",
    })
    assert(ok, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "battlegroup nav all fire turbolaser")
    equal(fixture.commands[before + 2].command, "battlegroup nav all fire ion")
  end)

  it("uses native squadron commands for roll, chaff, assist, and aim", function()
    local fleet = {kind = "squadron", active = true, role = "lead", members = {
      {id = "teehee", name = "TeeHee", leader = true, role = "lead"},
      {id = "wing", name = "Wing", leader = false, role = "wing"},
    }}
    fixture.scraper.state.metadata.fleet = fleet
    fixture.scraper.state.metadata.formations.squadron = fleet
    local cases = {
      {{order = "roll", scope = "all"}, "squadron roll"},
      {{order = "chaff", scope = "all"}, "squadron chaff"},
      {{order = "assist", scope = "all"}, "squadron assist"},
      {{order = "aim", scope = "all", system = "none"}, "squadron aim none"},
    }
    for _, case in ipairs(cases) do
      local ok, failure = fixture.intentHandlers.fleet_order(case[1])
      assert(ok, failure)
      equal(fixture:lastCommand().command, case[2])
    end
  end)

  it("records accepted and rejected responses for individual fleet members", function()
    battlegroup()
    fixture.scraper.state.metadata.fleetOrder = {
      id = 1, order = "navigate", scope = "wings", status = "transmitted",
      observedAt = os.time(), results = {},
    }
    assert(fixture.scraper.handleFleetCommandLine(
      "Sending command to Imperial-II Class Star Destroyer 'TeeHee'..."))
    assert(fixture.scraper.handleFleetCommandLine("New course set, approaching 0 0 0."))
    assert(fixture.scraper.handleFleetCommandLine(
      "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."))
    assert(fixture.scraper.handleFleetCommandLine(
      "You'll have to disengage the ship's autopilot first."))
    equal(fixture.scraper.state.metadata.fleetOrder.results.TeeHee.status, "accepted")
    equal(fixture.scraper.state.metadata.fleetOrder.results.ReeHeeHee.status, "rejected")
    equal(fixture.scraper.state.metadata.fleetOrder.status, "partial")
  end)

  it("publishes wing hyperspace as a ship event without moving the observer", function()
    battlegroup()
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "battlegroup nav 1 hyp")
    assert(fixture.scraper.handleHyperspaceLine("You push forward the hyperspeed lever."))
    assert(fixture.scraper.handleHyperspaceLine(
      "The stars become streaks of light as you enter hyperspace."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "idle")
    local events = fixture:lastSnapshot().metadata.shipJumpEvents
    equal(events[#events].shipName, "ReeHeeHee")
  end)

  it("moves the observer into hyperspace after a direct local command", function()
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "hyper")
    assert(fixture.scraper.handleHyperspaceLine(
      "The stars become streaks of light as you enter hyperspace."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")
  end)
end)
