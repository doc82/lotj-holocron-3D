local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
  assert(fixture.scraper.applyResult(assert(fixture.parsers.parse("status", [[
Forrestal:
Current Coordinates: 0 0 0
Current Speed: 0/200
Hull: 150/150 Shields: 150/150 Energy(fuel): 5000/5000
]])), "status"))
  assert(fixture.scraper.applyResult(assert(fixture.parsers.parse("radar", [[
Corellian System
YT-1300 'Wayfarer' 600 0 0
Your Coordinates: 0 0 0
]])), "radar"))
end)
h.after_each(function() fixture:close() end)

describe("scraper renderer commands", function()
  it("validates and sends relative navigation vectors", function()
    local ok, failure = fixture.intentHandlers.navigate_ship({
      mode = "relative", vector = {x = 10.2, y = -4.8, z = 30}, departureSpeed = 100,
    }, {id = "navigate"})
    assert(ok, failure)
    equal(fixture.commands[#fixture.commands - 1].command, "speed 100")
    equal(fixture:lastCommand().command, "course relative 10 -5 30")
    equal(fixture.scraper.pendingCommandKind, "command")
  end)

  it("rejects invalid vectors and excessive speed", function()
    local ok, failure = fixture.intentHandlers.navigate_ship({
      mode = "relative", vector = {x = 0, y = 0, z = 0},
    }, {id = "zero"})
    equal(ok, false)
    assert(failure:find("cannot be zero", 1, true))
    local speedOk, speedFailure = fixture.intentHandlers.set_ship_speed({speed = 250}, {id = "speed"})
    equal(speedOk, false)
    assert(speedFailure:find("outside", 1, true))
  end)

  it("navigates toward and away from known contacts", function()
    local toward, towardFailure = fixture.intentHandlers.navigate_ship({
      mode = "target", targetId = "wayfarer",
    }, {id = "toward"})
    assert(toward, towardFailure)
    equal(fixture:lastCommand().command, "course Wayfarer")
    fixture:trigger("Maneuver complete.")
    local away, awayFailure = fixture.intentHandlers.navigate_ship({
      mode = "away", targetId = "wayfarer",
    }, {id = "away"})
    assert(away, awayFailure)
    equal(fixture:lastCommand().command, "course away Wayfarer")
  end)

  it("locks a target before enabling autotrack", function()
    local ok, failure = fixture.intentHandlers.target_ship({targetId = "wayfarer"}, {id = "target"})
    assert(ok, failure)
    equal(fixture:lastCommand().command, "target Wayfarer")
    equal(fixture.scraper.pendingCommandKind, "target")
    assert(fixture:trigger("Target Locked."))
    equal(fixture:lastCommand().command, "autotrack")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("blocks hyperdrive when contacts are within 500 units", function()
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.lastSpatialFixAt = os.time()
    fixture:entity("Wayfarer").x = 400
    local ok, failure = fixture.intentHandlers.engage_hyperdrive({}, {id = "hyper"})
    equal(ok, false)
    assert(failure:find("500", 1, true))
  end)

  it("engages hyperdrive with a fresh clear spatial fix", function()
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.lastSpatialFixAt = os.time()
    fixture:entity("Wayfarer").x = 600
    local ok, failure = fixture.intentHandlers.engage_hyperdrive({}, {id = "hyper"})
    assert(ok, failure)
    equal(fixture:lastCommand().command, "hyper")
  end)

  it("starts and completes manual shield recharge", function()
    fixture.scraper.state.observer.shields = {current = 100, maximum = 150}
    local ok, failure = fixture.intentHandlers.recharge_shields({}, {id = "recharge"})
    assert(ok, failure)
    equal(fixture:lastCommand().command, "recharge")
    assert(fixture.scraper.handleRechargeResponse("The shields are already at peak power."))
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("persists explicit dispositions in published snapshots", function()
    assert(fixture.intentHandlers.set_ship_disposition({name = "Wayfarer", disposition = "ally"}))
    equal(fixture:entity("Wayfarer").disposition, "ally")
    local entity
    for _, value in ipairs(fixture:lastSnapshot().entities) do
      if value.name == "Wayfarer" then entity = value end
    end
    equal(entity.disposition, "ally")
  end)
end)
