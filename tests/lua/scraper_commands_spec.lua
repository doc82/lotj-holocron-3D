local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
  assert(fixture.scraper.applyResult(
    assert(fixture.parsers.parse(
      "status",
      [[
Forrestal:
Current Coordinates: 0 0 0
Current Speed: 0/200
Hull: 150/150 Shields: 150/150 Energy(fuel): 5000/5000
]]
    )),
    "status"
  ))
  assert(fixture.scraper.applyResult(
    assert(fixture.parsers.parse(
      "radar",
      [[
Corellian System
YT-1300 'Wayfarer' 600 0 0
Planet 'Corellia' 5000 0 0
Your Coordinates: 0 0 0
]]
    )),
    "radar"
  ))
end)
h.after_each(function()
  fixture:close()
end)

describe("scraper renderer commands", function()
  it(
    "reuses verified startup evidence before Room.Info arrives with a seconds-based expiry",
    function()
      local driver = fixture.scraper.routeNavigation
      local ship = { name = "Test Hauler", enterPath = { "n" }, exitPath = { "s" } }
      local function start(id, kind)
        assert(
          driver:start(
            {
              operation = {
                id = id,
                runId = "startup",
                kind = kind,
                destination = { name = "Corellia" },
              },
              ship = ship,
            },
            id
          )
        )
      end
      local function reply(text)
        for line in (text .. "\n"):gmatch("([^\n]*)\n") do
          driver:line(line)
        end
        driver:prompt()
        fixture:tickTimersAt(0)
        fixture.epochMs = fixture.epochMs + 2000
      end
      equal(fixture.scraper.state.metadata.room, nil)
      start("start", "reconcile")
      reply("Planet: Corellia")
      reply("Landing Pad\nFreighter: Test Hauler")
      reply("Cargo Readout for Freighter 'Test Hauler':\n[1 ] [(Empty)] [0/500]")
      reply("You have 1000 credits.")
      start("fuel", "refuel")
      equal(fixture:lastCommand().command, 'refuel "Test Hauler"')
      reply("That ship is already fully fueled!")
      local count = #fixture.commands
      start("fuel-again", "refuel")
      equal(#fixture.commands, count)
      equal(driver.active, nil)
      fixture.epochMs = fixture.epochMs + 61000
      start("fuel-expired", "refuel")
      equal(fixture:lastCommand().command, "showplanet")
    end
  )

  it("invalidates route evidence on player commands but preserves it for internal sends", function()
    local driver = fixture.scraper.routeNavigation
    driver.evidence = { location = true }
    driver.dispatching = true
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "credits")
    equal(driver.evidence.location, true)
    driver.dispatching = false
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "look")
    equal(driver.evidence.location, nil)
  end)

  it("invalidates route evidence when GMCP reports a different room", function()
    local driver = fixture.scraper.routeNavigation
    _G.gmcp = { Room = { Info = { vnum = 100, name = "Test pad", planet = "Corellia" } } }
    fixture.scraper.handleRoomGmcp()
    driver.evidence = { location = true }
    fixture.scraper.handleRoomGmcp()
    equal(driver.evidence.location, true)
    _G.gmcp.Room.Info.vnum = 101
    fixture.scraper.handleRoomGmcp()
    equal(driver.evidence.location, nil)
  end)

  it("does not replace confirmed space telemetry with a redundant startup probe", function()
    local count = #fixture.commands
    local active = fixture.scraper.active
    assert(fixture.intentHandlers.probe_space({}, { id = "late-startup" }))
    equal(#fixture.commands, count)
    equal(fixture.scraper.active, active)
    equal(fixture.scraper.state.metadata.inSpace, true)
  end)

  it("does not interpret an unanswered radar probe as landing", function()
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true, spaceProbe = true }))
    fixture.scraper.finishCapture("timeout")
    equal(fixture.scraper.state.metadata.inSpace, true)
  end)

  it("refreshes local hyperspace radar without using the startup space probe", function()
    local ok, failure = fixture.intentHandlers.refresh_local_hyperspace_radar(
      {},
      { id = "local-hyperspace-radar" }
    )
    assert(ok, failure)
    equal(fixture:lastCommand().command, "radar")
    equal(fixture.scraper.active.spaceProbe, false)
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("YT-1300 'Wayfarer' 625 0 0")
    fixture.scraper.captureLine("Your Coordinates: 0 0 0")
    assert(fixture.scraper.finishCapture("fixture"))
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("validates and sends relative navigation vectors", function()
    local ok, failure = fixture.intentHandlers.navigate_ship({
      mode = "relative",
      vector = { x = 10.2, y = -4.8, z = 30 },
      departureSpeed = 100,
    }, { id = "navigate" })
    assert(ok, failure)
    equal(fixture.commands[#fixture.commands - 1].command, "speed 100")
    equal(fixture:lastCommand().command, "course relative 10 -5 30")
    equal(fixture.scraper.pendingCommandKind, "command")
  end)

  it("rejects invalid vectors and excessive speed", function()
    local ok, failure = fixture.intentHandlers.navigate_ship({
      mode = "relative",
      vector = { x = 0, y = 0, z = 0 },
    }, { id = "zero" })
    equal(ok, false)
    assert(failure:find("cannot be zero", 1, true))
    local speedOk, speedFailure = fixture.intentHandlers.set_ship_speed(
      { speed = 250 },
      { id = "speed" }
    )
    equal(speedOk, false)
    assert(speedFailure:find("outside", 1, true))
  end)

  it("navigates toward and away from known contacts and faces ships", function()
    local toward, towardFailure = fixture.intentHandlers.navigate_ship({
      mode = "target",
      targetId = "wayfarer",
    }, { id = "toward" })
    assert(toward, towardFailure)
    equal(fixture:lastCommand().command, "course Wayfarer")
    fixture:trigger("Maneuver complete.")
    local away, awayFailure = fixture.intentHandlers.navigate_ship({
      mode = "away",
      targetId = "wayfarer",
    }, { id = "away" })
    assert(away, awayFailure)
    equal(fixture:lastCommand().command, "course away Wayfarer")
    fixture:trigger("Maneuver complete.")
    local face, faceFailure = fixture.intentHandlers.navigate_ship({
      mode = "face",
      targetId = "wayfarer",
    }, { id = "face" })
    assert(face, faceFailure)
    equal(fixture:lastCommand().command, "face Wayfarer")

    fixture:trigger("Maneuver complete.")
    local planetFace, planetFaceFailure = fixture.intentHandlers.navigate_ship({
      mode = "face",
      targetId = "corellia",
    }, { id = "face-planet" })
    equal(planetFace, false)
    assert(planetFaceFailure:find("only ships", 1, true))
  end)

  it("locks a target without automatically enabling autotrack", function()
    local ok, failure = fixture.intentHandlers.target_ship(
      { targetId = "wayfarer" },
      { id = "target" }
    )
    assert(ok, failure)
    equal(fixture:lastCommand().command, "target Wayfarer")
    local commandCount = #fixture.commands
    equal(fixture.scraper.pendingCommandKind, "target")
    equal(fixture:entity("Wayfarer").disposition, nil)
    assert(fixture:trigger("Target Locked."))
    equal(#fixture.commands, commandCount)
    equal(fixture:lastCommand().command, "target Wayfarer")
    equal(fixture.scraper.state.metadata.autotrackDesired, false)
    equal(fixture:entity("Wayfarer").disposition, "enemy")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("rejects protected targets and removes any unconfirmed target state", function()
    local ok, failure = fixture.intentHandlers.target_ship(
      { targetId = "wayfarer" },
      { id = "protected" }
    )
    assert(ok, failure)
    assert(fixture.scraper.handleCombatLine("Target: YT-1300 'Wayfarer'"))
    equal(fixture.scraper.state.metadata.combatTarget, nil)
    assert(fixture:trigger("That ship is currently being protected by other ships."))
    equal(fixture.scraper.pendingCommandKind, nil)
    equal(fixture.scraper.combat.targetName, nil)
    equal(fixture.scraper.state.observer.target, nil)
    equal(fixture.scraper.state.metadata.combatTarget, nil)
    equal(fixture.scraper.state.metadata.combatTargets["local"], nil)
    equal(fixture.intentAcks[#fixture.intentAcks].status, "rejected")
    assert(fixture.intentAcks[#fixture.intentAcks].reason:find("protected", 1, true))
  end)

  it("clears the local ship target with target none", function()
    fixture.scraper.combat.targetName = "Wayfarer"
    fixture.scraper.state.observer.target = "Wayfarer"
    fixture.scraper.state.metadata.combatTarget = "Wayfarer"
    fixture.scraper.state.metadata.combatTargets = {
      ["local"] = { key = "local", scope = "local", targetName = "Wayfarer" },
    }
    local ok, failure = fixture.intentHandlers.clear_combat_target({
      targetKeys = { "local" },
    }, { id = "clear-local-target" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "target none")
    equal(fixture.scraper.combat.targetName, nil)
    equal(fixture.scraper.state.observer.target, nil)
    equal(fixture.scraper.state.metadata.combatTarget, nil)
    equal(fixture.scraper.state.metadata.combatTargets["local"], nil)
  end)

  it("reconciles an unconfirmed target from status after twenty seconds", function()
    local ok, failure = fixture.intentHandlers.target_ship(
      { targetId = "wayfarer" },
      { id = "reconcile" }
    )
    assert(ok, failure)
    local timerId = fixture.scraper.combat.targetReconcileTimerId
    assert(timerId and fixture.timers[timerId])
    equal(fixture.timers[timerId].seconds, 20)
    fixture:tick(timerId)
    equal(fixture:lastCommand().command, "status")
    assert(fixture.scraper.active and fixture.scraper.active.targetReconciliation)
    fixture.scraper.captureLine("Forrestal:")
    fixture.scraper.captureLine("Primary Target: YT-1300 'Wayfarer'")
    assert(fixture.scraper.finishCapture("fixture"))
    equal(fixture.scraper.pendingCommandKind, nil)
    equal(fixture.scraper.state.metadata.combatTarget, "Wayfarer")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
    assert(fixture.intentAcks[#fixture.intentAcks].reason:find("status", 1, true))
  end)

  it("rejects an unconfirmed target when status reports none", function()
    local ok, failure = fixture.intentHandlers.target_ship(
      { targetId = "wayfarer" },
      { id = "no-target" }
    )
    assert(ok, failure)
    fixture:tick(fixture.scraper.combat.targetReconcileTimerId)
    fixture.scraper.captureLine("Forrestal:")
    fixture.scraper.captureLine("Primary Target: none")
    assert(fixture.scraper.finishCapture("fixture"))
    equal(fixture.scraper.pendingCommandKind, nil)
    equal(fixture.scraper.state.metadata.combatTarget, nil)
    equal(fixture.intentAcks[#fixture.intentAcks].status, "rejected")
    assert(fixture.intentAcks[#fixture.intentAcks].reason:find("no active target", 1, true))
  end)

  it("keeps Mudlet commands available while Holocron awaits a target lock", function()
    local ok, failure = fixture.intentHandlers.target_ship(
      { targetId = "wayfarer" },
      { id = "target" }
    )
    assert(ok, failure)
    equal(fixture.scraper.pendingCommandKind, "target")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "clan Targeting now")
    equal(fixture.deniedSends, 0)
    equal(fixture.scraper.pendingCommandKind, "target")
    assert(fixture:trigger("You must be in the gunners seat or turret of a ship to do that!"))
    equal(fixture.scraper.pendingCommandKind, nil)
    equal(fixture.intentAcks[#fixture.intentAcks].status, "rejected")
  end)

  it("blocks hyperdrive when contacts are within 500 units", function()
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.lastSpatialFixAt = os.time()
    fixture:entity("Wayfarer").x = 400
    local ok, failure = fixture.intentHandlers.engage_hyperdrive({}, { id = "hyper" })
    equal(ok, false)
    assert(failure:find("500", 1, true))
  end)

  it("engages hyperdrive with a fresh clear spatial fix", function()
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.lastSpatialFixAt = os.time()
    fixture:entity("Wayfarer").x = 600
    local ok, failure = fixture.intentHandlers.engage_hyperdrive({}, { id = "hyper" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "hyper")
  end)

  it("starts and completes manual shield recharge", function()
    fixture.scraper.state.observer.shields = { current = 100, maximum = 150 }
    local ok, failure = fixture.intentHandlers.recharge_shields({}, { id = "recharge" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "recharge")
    assert(fixture.scraper.handleRechargeResponse("The shields are already at peak power."))
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("persists explicit dispositions in published snapshots", function()
    assert(fixture.intentHandlers.set_ship_disposition({ name = "Wayfarer", disposition = "ally" }))
    equal(fixture:entity("Wayfarer").disposition, "ally")
    local entity
    for _, value in ipairs(fixture:lastSnapshot().entities) do
      if value.name == "Wayfarer" then
        entity = value
      end
    end
    equal(entity.disposition, "ally")
  end)
end)
