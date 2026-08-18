local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
  assert(fixture.scraper.applyResult({
    source = "status",
    name = "TeeHee",
    weapons = { turbolasers = 7, ionCannons = 2 },
    hasWeapons = true,
  }, "status"))
  fixture.scraper.state.observer.hasWeapons = true
  fixture.scraper.state.observer.weapons = { turbolasers = 7, ionCannons = 2 }
  assert(fixture.scraper.applyResult(
    assert(fixture.parsers.parse(
      "radar",
      [[
Corellian System
YT-1300 'Wayfarer' 200 0 0
Your Coordinates: 0 0 0
]]
    )),
    "radar"
  ))
end)
h.after_each(function()
  fixture:close()
end)

local function battlegroup()
  local fleet = {
    kind = "battlegroup",
    active = true,
    role = "commander",
    members = {
      { id = "teehee", name = "TeeHee", leader = true, role = "leader" },
      { id = "reeheehee", name = "ReeHeeHee", leader = false, role = "wing", slot = 1 },
    },
  }
  fixture.scraper.state.metadata.fleet = fleet
  fixture.scraper.state.metadata.formations.battlegroup = fleet
  return fleet
end

local function finishFreshRadar(x, y, z)
  assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
  fixture.scraper.captureLine("Corellian System")
  fixture.scraper.captureLine(string.format("Your Coordinates: %d %d %d", x, y, z))
  assert(fixture.scraper.finishCapture("prompt"))
end

describe("scraper formation commands", function()
  it("scans a roster member even before fleet radar supplies coordinates", function()
    battlegroup()
    local ok, failure = fixture.intentHandlers.scan_ship({
      targetId = "reeheehee",
      targetName = "ReeHeeHee",
      source = "info",
    }, { id = "fleet-info" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "info ReeHeeHee")
  end)

  it("keeps status and info cards attached to formation members", function()
    local fleet = battlegroup()
    assert(
      fixture.scraper.applyResult(
        { source = "status", name = "ReeHeeHee", statusCard = { title = "STATUS", sections = {} } },
        "status ReeHeeHee"
      )
    )
    assert(
      fixture.scraper.applyResult(
        { source = "info", name = "ReeHeeHee", infoCard = { title = "INFO", sections = {} } },
        "info ReeHeeHee"
      )
    )
    equal(fleet.members[2].statusCard.title, "STATUS")
    equal(fleet.members[2].infoCard.title, "INFO")
  end)

  it("keeps fleet radar coordinates on roster members for formation plotting", function()
    local fleet = battlegroup()
    assert(fixture.scraper.applyResult({
      source = "fleetradar",
      entities = {
        { id = "teehee", name = "TeeHee", kind = "ship", x = 10, y = 20, z = 30 },
        { id = "reeheehee", name = "ReeHeeHee", kind = "ship", x = 40, y = 50, z = 60 },
      },
    }, "fleetradar"))
    equal(fleet.members[2].x, 40)
    equal(fleet.members[2].y, 50)
    equal(fleet.members[2].z, 60)

    assert(fixture.scraper.applyResult({
      source = "battlegroup",
      fleet = {
        kind = "battlegroup",
        active = true,
        members = {
          { id = "teehee", name = "TeeHee", leader = true, role = "leader" },
          { id = "reeheehee", name = "ReeHeeHee", leader = false, role = "wing", slot = 1 },
        },
      },
    }, "battlegroup"))
    equal(fixture.scraper.state.metadata.fleet.members[2].x, 40)
    equal(fixture.scraper.state.metadata.fleet.members[2].y, 50)
    equal(fixture.scraper.state.metadata.fleet.members[2].z, 60)
  end)

  it("captures a wing radar as an isolated remote tactical view", function()
    local fleet = battlegroup()
    fleet.members[2].name = "TeeHee3"
    fleet.members[2].id = "teehee3"
    fleet.members[2].system = "Esstran Sector"
    local localSystem = fixture.scraper.state.metadata.system
    local localX = fixture.scraper.state.observer.x

    local requested, failure = fixture.intentHandlers.request_tactical_view({
      memberId = "teehee3",
      memberName = "TeeHee3",
    }, { id = "remote-radar" })
    assert(requested, failure)
    equal(fixture:lastCommand().command, "battlegroup nav TeeHee3 radar")
    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Victory-II Class Star Destroyer 'TeeHee3'..."
      )
    )

    local output = [[
Esstran Sector

Dromund Kaas                                              0 0 0

Victory-II Class Star Destroyer 'VSD21'                   6 26 27
Imperial-II Class Star Destroyer 'TeeHee1'                0 0 0

Your Coordinates:                                         -60 521 -48
Command sent.]]
    for line in (output .. "\n"):gmatch("(.-)\n") do
      fixture.scraper.captureLine(line)
    end
    assert(fixture.scraper.finishCapture("fixture"))

    local view = fixture.scraper.state.metadata.tacticalViews["name:teehee3"]
    assert(view)
    equal(view.memberName, "TeeHee3")
    equal(view.system, "Esstran Sector")
    equal(view.observer.x, -60)
    equal(view.observer.y, 521)
    equal(view.observer.z, -48)
    equal(#view.entities, 3)
    equal(view.entities[2].name, "VSD21")
    equal(view.entities[3].name, "TeeHee1")
    equal(fixture.scraper.state.metadata.system, localSystem)
    equal(fixture.scraper.state.observer.x, localX)
    assert(fixture:entity("Wayfarer"), "local radar contacts must remain intact")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")

    local targeted, targetFailure = fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "selected",
      memberId = "teehee3",
      viewpointMemberKey = "name:teehee3",
      targetId = "vsd21",
    }, { id = "remote-target" })
    assert(targeted, targetFailure)
    equal(fixture:lastCommand().command, "battlegroup target TeeHee3 VSD21")
  end)

  it("uses the requested ship name when remote-view transport ids collide", function()
    local fleet = battlegroup()
    fleet.members[1].id = "shared-id"
    fleet.members[2].id = "shared-id"

    local requested, failure = fixture.intentHandlers.request_tactical_view({
      memberId = "shared-id",
      memberName = "ReeHeeHee",
      memberSlot = 1,
    }, { id = "duplicate-id-remote-radar" })
    assert(requested, failure)
    equal(fixture:lastCommand().command, "battlegroup nav ReeHeeHee radar")
  end)

  it("rejects a remote radar wrapper from the wrong wing ship", function()
    battlegroup()
    local requested, failure = fixture.intentHandlers.request_tactical_view({
      memberId = "reeheehee",
      memberName = "ReeHeeHee",
    }, { id = "mismatched-radar" })
    assert(requested, failure)
    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Victory-II Class Star Destroyer 'Impostor'..."
      )
    )
    equal(fixture.scraper.active, nil)
    equal(fixture.scraper.state.metadata.tacticalViews["name:reeheehee"], nil)
    equal(fixture.intentAcks[#fixture.intentAcks].status, "rejected")
  end)

  it("rejects an info response whose header belongs to a different ship", function()
    local fleet = battlegroup()
    local applied, failure = fixture.scraper.applyResult({
      source = "info",
      name = "Impostor",
      infoCard = { title = "SHIP INFORMATION", description = "Wrong ship", sections = {} },
    }, "info ReeHeeHee")
    equal(applied, nil)
    assert(failure:find("identity mismatch", 1, true))
    equal(fleet.members[2].infoCard, nil)
  end)

  it("rejects a status response whose header belongs to a different ship", function()
    local fleet = battlegroup()
    local applied, failure = fixture.scraper.applyResult({
      source = "status",
      name = "Impostor",
      statusCard = { title = "SHIP STATUS", sections = {} },
    }, "status ReeHeeHee")
    equal(applied, nil)
    assert(failure:find("identity mismatch", 1, true))
    equal(fleet.members[2].statusCard, nil)
    equal(fixture:entity("Impostor"), nil)
  end)

  it("captures a canonical status response returned for an abbreviated enemy ship name", function()
    assert(fixture.scraper.applyResult({
      source = "radar",
      entities = {
        { id = "abomination", name = "Abomination", kind = "ship", x = 100, y = 0, z = 0 },
      },
    }, "radar"))
    assert(fixture.scraper.setDisposition("Abomination", "enemy"))
    assert(fixture.scraper.setPollingPaused(true, "fixture"))

    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "status ab")
    assert(fixture.scraper.active and not fixture.scraper.active.polled)
    for outputLine in
      ([[
Readout for Imperial-II Class Star Destroyer 'Abomination':
Hull: 712/1000 Shields: 400/500
]] .. "\n"):gmatch("(.-)\n")
    do
      fixture.scraper.captureLine(outputLine)
    end
    assert(fixture.scraper.finishCapture("fixture"))

    equal(fixture:entity("Abomination").hull.current, 712)
    equal(fixture:entity("Abomination").disposition, "enemy")
    equal(fixture:entity("ab"), nil)
  end)

  it("infers squadron leadership after observer status arrives", function()
    fixture.scraper.state.observer.name = "Previous Carrier"
    assert(fixture.scraper.applyResult({
      source = "squadron",
      fleet = {
        kind = "squadron",
        active = true,
        members = {
          { id = "heehee", name = "HeeHee", leader = true, role = "lead" },
          { id = "wing", name = "Wing", leader = false, role = "wing" },
        },
      },
    }, "squadron status"))
    equal(fixture.scraper.state.metadata.fleet.role, nil)
    assert(fixture.scraper.applyResult({ source = "status", name = "HeeHee" }, "status"))
    equal(fixture.scraper.state.metadata.fleet.role, "lead")
  end)

  it("targets the whole battlegroup through the native channel", function()
    battlegroup()
    assert(
      fixture.scraper.applyResult(
        { source = "status", name = "TeeHee", target = "Privateer" },
        "status"
      )
    )
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "all",
      targetId = "wayfarer",
    })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "battlegroup target all Wayfarer")
    equal(fixture.scraper.state.metadata.combatTarget, "Privateer")
    equal(fixture.scraper.state.metadata.combatTargets["local"].targetName, "Privateer")
    equal(fixture.scraper.state.metadata.combatTargets.fleet.targetName, "Wayfarer")
    equal(fixture.scraper.state.metadata.combatTargets.fleet.ownerLabel, "FLEET TARGET")
  end)

  it("retains separate target memories for the fleet and its wings", function()
    battlegroup()
    assert(fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "all",
      targetId = "wayfarer",
    }))
    assert(fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "wings",
      targetId = "wayfarer",
    }))
    equal(fixture.scraper.state.metadata.combatTargets.fleet.scope, "all")
    equal(fixture.scraper.state.metadata.combatTargets.wings.scope, "wings")
    equal(fixture.scraper.state.metadata.combatTargets.wings.ownerLabel, "WING TARGET")
  end)

  it("retains a target memory for one selected battlegroup ship", function()
    battlegroup()
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "selected",
      memberId = "reeheehee",
      targetId = "wayfarer",
    })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "battlegroup target ReeHeeHee Wayfarer")
    local target = fixture.scraper.state.metadata.combatTargets["selected:reeheehee"]
    equal(target.targetName, "Wayfarer")
    equal(target.ownerName, "ReeHeeHee")
    equal(target.ownerLabel, "REEHEEHEE'S TARGET")
  end)

  it("clears a whole-fleet target with bg target all none", function()
    battlegroup()
    assert(fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "all",
      targetId = "wayfarer",
    }))
    local ok, failure = fixture.intentHandlers.clear_combat_target({
      targetKeys = { "fleet" },
    }, { id = "clear-fleet-target" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "bg target all none")
    equal(fixture.scraper.state.metadata.combatTargets.fleet, nil)
  end)

  it("clears a selected ship target with its validated roster name", function()
    battlegroup()
    assert(fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "selected",
      memberId = "reeheehee",
      targetId = "wayfarer",
    }))
    local ok, failure = fixture.intentHandlers.clear_combat_target({
      targetKeys = { "selected:reeheehee" },
    }, { id = "clear-selected-target" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "bg target ReeHeeHee none")
    equal(fixture.scraper.state.metadata.combatTargets["selected:reeheehee"], nil)
  end)

  it("clears every owner represented by a grouped target shortcut", function()
    battlegroup()
    fixture.scraper.combat.targetName = "Wayfarer"
    fixture.scraper.state.observer.target = "Wayfarer"
    fixture.scraper.state.metadata.combatTarget = "Wayfarer"
    fixture.scraper.state.metadata.combatTargets = {
      ["local"] = { key = "local", scope = "local", targetName = "Wayfarer" },
      fleet = { key = "fleet", scope = "all", targetName = "Wayfarer" },
    }
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.clear_combat_target({
      targetKeys = { "local", "fleet" },
    }, { id = "clear-grouped-target" })
    assert(ok, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "target none")
    equal(fixture.commands[before + 2].command, "bg target all none")
    equal(fixture.scraper.state.metadata.combatTargets["local"], nil)
    equal(fixture.scraper.state.metadata.combatTargets.fleet, nil)
  end)

  it("issues an order only to the selected battlegroup subset", function()
    local fleet = battlegroup()
    table.insert(fleet.members, {
      id = "meehee",
      name = "MeeHee",
      leader = false,
      role = "wing",
      slot = 2,
    })
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "speed",
      scope = "selected",
      speed = 420,
      memberIds = { "reeheehee", "meehee" },
    }, { id = "selected-subset-speed" })
    assert(ok, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "battlegroup nav ReeHeeHee speed 420")
    equal(fixture.commands[before + 2].command, "battlegroup nav MeeHee speed 420")
  end)

  it("commands every named selection when transport ids collide", function()
    local fleet = battlegroup()
    fleet.members[1].id = "shared-id"
    fleet.members[2].id = "shared-id"
    table.insert(fleet.members, {
      id = "shared-id",
      name = "MeeHee",
      leader = false,
      role = "wing",
      slot = 2,
    })
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "speed",
      scope = "selected",
      speed = 420,
      memberIds = { "shared-id", "shared-id" },
      memberNames = { "ReeHeeHee", "MeeHee" },
      memberSlots = { 1, 2 },
    }, { id = "duplicate-id-selected-speed" })
    assert(ok, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "battlegroup nav ReeHeeHee speed 420")
    equal(fixture.commands[before + 2].command, "battlegroup nav MeeHee speed 420")
  end)

  it("keeps the observer included in whole-fleet battlegroup orders", function()
    battlegroup()
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "speed",
      scope = "all",
      speed = 0,
    }, { id = "all-ships-stop" })
    assert(ok, failure)
    equal(#fixture.commands, before + 1)
    equal(fixture.commands[before + 1].command, "battlegroup nav all speed 0")
  end)

  it("uses native commands when the observer is the only selected fleet ship", function()
    battlegroup()
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "speed",
      scope = "selected",
      speed = 420,
      memberIds = { "teehee" },
      memberNames = { "TeeHee" },
    }, { id = "selected-observer-speed" })
    assert(ok, failure)
    equal(#fixture.commands, before + 1)
    equal(fixture.commands[before + 1].command, "speed 420")
  end)

  it("splits mixed selections into native and remote battlegroup commands", function()
    local fleet = battlegroup()
    table.insert(fleet.members, {
      id = "meehee",
      name = "MeeHee",
      leader = false,
      role = "wing",
      slot = 2,
    })
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "speed",
      scope = "selected",
      speed = 420,
      memberIds = { "teehee", "reeheehee" },
      memberNames = { "TeeHee", "ReeHeeHee" },
    }, { id = "mixed-selected-speed" })
    assert(ok, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "speed 420")
    equal(fixture.commands[before + 2].command, "battlegroup nav ReeHeeHee speed 420")
  end)

  it("uses native course commands for an observer-only fleet selection", function()
    battlegroup()
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "navigate",
      scope = "selected",
      mode = "relative",
      vector = { x = 100, y = 25, z = -50 },
      departureSpeed = 500,
      memberIds = { "teehee" },
      memberNames = { "TeeHee" },
    }, { id = "selected-observer-course" })
    assert(ok, failure)
    equal(fixture.commands[before + 1].command, "speed 500")
    equal(fixture.commands[before + 2].command, "course relative 100 25 -50")
  end)

  it("targets and clears natively for an observer-only fleet selection", function()
    battlegroup()
    local before = #fixture.commands
    local targeted, targetFailure = fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "selected",
      memberIds = { "teehee" },
      memberNames = { "TeeHee" },
      targetId = "wayfarer",
    })
    assert(targeted, targetFailure)
    equal(fixture.commands[before + 1].command, "target Wayfarer")

    local cleared, clearFailure = fixture.intentHandlers.clear_combat_target({
      targetKeys = { "selected:teehee" },
    })
    assert(cleared, clearFailure)
    equal(fixture.commands[before + 2].command, "target none")
  end)

  it("targets and clears only the named ship when transport ids collide", function()
    local fleet = battlegroup()
    fleet.members[1].id = "shared-id"
    fleet.members[2].id = "shared-id"
    local before = #fixture.commands
    local targeted, targetFailure = fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "selected",
      memberIds = { "shared-id" },
      memberNames = { "ReeHeeHee" },
      memberSlots = { 1 },
      targetId = "wayfarer",
    })
    assert(targeted, targetFailure)
    equal(fixture.commands[before + 1].command, "battlegroup target ReeHeeHee Wayfarer")

    local cleared, clearFailure = fixture.intentHandlers.clear_combat_target({
      targetKeys = { "selected:reeheehee" },
    })
    assert(cleared, clearFailure)
    equal(fixture.commands[before + 2].command, "bg target ReeHeeHee none")
  end)

  it("accepts an already-matched fleet speed instead of leaving it awaiting", function()
    battlegroup()
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "speed",
      scope = "selected",
      speed = 250,
      memberIds = { "reeheehee" },
    }, { id = "already-speed" })
    assert(ok, failure)
    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."
      )
    )
    assert(fixture.scraper.handleFleetCommandLine("You're already traveling that speed."))
    local order = fixture.scraper.state.metadata.fleetOrder
    equal(order.results.ReeHeeHee.status, "accepted")
    equal(order.pendingCount, 0)
    equal(fixture.scraper.state.metadata.fleet.members[2].speed, 250)
  end)

  it("sets a selected ship's speed before issuing its course change", function()
    battlegroup()
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "navigate",
      scope = "selected",
      mode = "relative",
      vector = { x = 100, y = 25, z = -50 },
      departureSpeed = 500,
      memberIds = { "reeheehee" },
      memberNames = { "ReeHeeHee" },
      memberSlots = { 1 },
    }, { id = "selected-course-with-speed" })
    assert(ok, failure)
    equal(fixture.commands[before + 1].command, "battlegroup nav ReeHeeHee speed 500")
    equal(
      fixture.commands[before + 2].command,
      "battlegroup nav ReeHeeHee course relative 100 25 -50"
    )
  end)

  it("records a squadron target as both squadron and lead-ship target", function()
    local fleet = {
      kind = "squadron",
      active = true,
      role = "lead",
      members = {
        { id = "teehee", name = "TeeHee", leader = true, role = "lead" },
        { id = "wing", name = "Wing", leader = false, role = "wing" },
      },
    }
    fixture.scraper.state.metadata.fleet = fleet
    fixture.scraper.state.metadata.formations.squadron = fleet
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "target",
      scope = "all",
      targetId = "wayfarer",
    }, { id = "squadron-target" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "target Wayfarer")
    assert(fixture:trigger("Target Locked."))
    equal(fixture.scraper.state.metadata.combatTargets.squadron.targetName, "Wayfarer")
    equal(fixture.scraper.state.metadata.combatTargets["local"].targetName, "Wayfarer")
  end)

  it("expands fire-all into known flagship weapons without cockpit fallthrough", function()
    battlegroup()
    fixture.scraper.combat.targetName = "Wayfarer"
    local before = #fixture.commands
    local ok, failure = fixture.intentHandlers.fleet_order({
      order = "fire",
      scope = "all",
      weapon = "all",
    })
    assert(ok, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "battlegroup nav all fire turbolaser")
    equal(fixture.commands[before + 2].command, "battlegroup nav all fire ion")
  end)

  it("uses native squadron commands for roll, chaff, assist, and aim", function()
    local fleet = {
      kind = "squadron",
      active = true,
      role = "lead",
      members = {
        { id = "teehee", name = "TeeHee", leader = true, role = "lead" },
        { id = "wing", name = "Wing", leader = false, role = "wing" },
      },
    }
    fixture.scraper.state.metadata.fleet = fleet
    fixture.scraper.state.metadata.formations.squadron = fleet
    local cases = {
      { { order = "roll", scope = "all" }, "squadron roll" },
      { { order = "chaff", scope = "all" }, "squadron chaff" },
      { { order = "assist", scope = "all" }, "squadron assist" },
      { { order = "aim", scope = "all", system = "none" }, "squadron aim none" },
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
      id = 1,
      order = "navigate",
      scope = "wings",
      status = "transmitted",
      observedAt = os.time(),
      results = {},
    }
    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Imperial-II Class Star Destroyer 'TeeHee'..."
      )
    )
    assert(fixture.scraper.handleFleetCommandLine("New course set, approaching 0 0 0."))
    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."
      )
    )
    assert(
      fixture.scraper.handleFleetCommandLine("You'll have to disengage the ship's autopilot first.")
    )
    equal(fixture.scraper.state.metadata.fleetOrder.results.TeeHee.status, "accepted")
    equal(fixture.scraper.state.metadata.fleetOrder.results.ReeHeeHee.status, "rejected")
    equal(fixture.scraper.state.metadata.fleetOrder.status, "partial")
  end)

  it("publishes wing hyperspace as a ship event without moving the observer", function()
    battlegroup()
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "battlegroup nav 1 hyp")
    assert(fixture.scraper.handleHyperspaceLine("You push forward the hyperspeed lever."))
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "idle")
    local events = fixture:lastSnapshot().metadata.shipJumpEvents
    equal(events[#events].shipName, "ReeHeeHee")
  end)

  it("tracks the observer through a whole-battlegroup jump and queues arrival refresh", function()
    battlegroup()
    fixture:entity("Wayfarer").x = 600
    fixture.scraper.state.metadata.sources.radar = os.time()
    local route = {
      mode = "local",
      scope = "all",
      formationKind = "battlegroup",
      destination = { x = 1200, y = -50, z = 800 },
      recipientLabel = "FLEET",
    }
    assert(fixture.intentHandlers.plot_hyperspace(route, { id = "fleet-route" }))
    assert(
      fixture.scraper.handleHyperspaceLine("[Status]: Hyperspace calculations have been completed.")
    )
    assert(fixture.intentHandlers.engage_hyperdrive(route, { id = "fleet-engage" }))
    assert(fixture.scraper.hyperspace.pendingLocalJumpUntil >= os.time())

    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Imperial-II Class Star Destroyer 'TeeHee'..."
      )
    )
    assert(fixture.scraper.handleHyperspaceLine("You push forward the hyperspeed lever."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "engaging")
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")

    assert(
      fixture.scraper.handleFleetCommandLine(
        "Sending command to Victory-II Class Star Destroyer 'ReeHeeHee'..."
      )
    )
    assert(fixture.scraper.handleHyperspaceLine("You push forward the hyperspeed lever."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")
    local events = fixture:lastSnapshot().metadata.shipJumpEvents
    equal(events[#events].shipName, "ReeHeeHee")

    assert(
      fixture.scraper.handleHyperspaceLine("Destination reached. Initiating realspace reentry...")
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    assert(fixture.scraper.handleHyperspaceLine("Hyperjump complete."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    assert(fixture.scraper.handleReentrySystemLine("Corellian System"))
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The ship lurches slightly as it comes out of hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    equal(fixture.scraper.getPollingState().radarRefreshPending, true)
    equal(fixture.scraper.getPollingState().fleetRadarRefreshPending, true)
    finishFreshRadar(1200, -50, 800)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "arrived")
  end)

  it("recovers an observer arrival from a regressed engaging phase", function()
    fixture.scraper.hyperspace.phase = "engaging"
    fixture.scraper.hyperspace.initiatedByHolocron = true
    fixture.scraper.hyperspace.routeIncludesLocalShip = true
    fixture.scraper.state.metadata.hyperspace = {
      phase = "engaging",
      route = { mode = "local", scope = "all" },
    }

    assert(fixture.scraper.handleHyperspaceLine("Hyperjump complete."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The ship lurches slightly as it comes out of hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    finishFreshRadar(1200, -50, 800)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "arrived")
    equal(fixture.scraper.hyperspace.initiatedByHolocron, false)
  end)

  it("plots and engages a hyperspace route for battlegroup wings only", function()
    battlegroup()
    local plotted, plotFailure = fixture.intentHandlers.plot_hyperspace({
      mode = "local",
      scope = "wings",
      formationKind = "battlegroup",
      destination = { x = 1200, y = -50, z = 800 },
      recipientLabel = "WINGS",
    }, { id = "wing-route" })
    assert(plotted, plotFailure)
    equal(fixture:lastCommand().command, "battlegroup nav 1 calculate local 1200 -50 800")
    equal(fixture.scraper.state.metadata.hyperspace.route.scope, "wings")
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, false)
    equal(fixture.scraper.hyperspace.routeUsesLocalCommand, false)

    assert(
      fixture.scraper.handleHyperspaceLine("[Status]: Hyperspace calculations have been completed.")
    )
    local engaged, engageFailure = fixture.intentHandlers.engage_hyperdrive({
      scope = "wings",
      formationKind = "battlegroup",
    }, { id = "wing-engage" })
    assert(engaged, engageFailure)
    equal(fixture:lastCommand().command, "battlegroup nav 1 hyper")
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "ready")
    local events = fixture:lastSnapshot().metadata.shipJumpEvents
    equal(events[#events].shipName, "ReeHeeHee")
  end)

  it("rejects a local engage outside the pilot seat and keeps the route ready", function()
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.hyperspace = {
      phase = "ready",
      route = { mode = "local", scope = "local" },
    }
    fixture.scraper.state.metadata.sources.radar = os.time()
    fixture.scraper.state.entities = {}

    local engaged, engageFailure = fixture.intentHandlers.engage_hyperdrive(
      { mode = "local", scope = "local" },
      { id = "local-engage" }
    )
    assert(engaged, engageFailure)
    equal(fixture:lastCommand().command, "hyper")

    assert(fixture.scraper.handleHyperspaceLine("You aren't in the pilots seat."))
    local ack = fixture.intentAcks[#fixture.intentAcks]
    equal(ack.id, "local-engage")
    equal(ack.status, "rejected")
    equal(ack.reason, "You aren't in the pilots seat.")
    equal(fixture.scraper.state.metadata.hyperspace.phase, "ready")
    equal(fixture.scraper.state.metadata.hyperspace.error, "You aren't in the pilots seat.")
  end)

  it("rejects a plotted route when the local ship is not at a nav computer", function()
    local plotted, plotFailure = fixture.intentHandlers.plot_hyperspace({
      mode = "local",
      scope = "local",
      destination = { x = 1200, y = -50, z = 800 },
    }, { id = "local-route" })
    assert(plotted, plotFailure)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "calculating")

    assert(
      fixture.scraper.handleHyperspaceLine("You must be at a nav computer to calculate jumps.")
    )
    local ack = fixture.intentAcks[#fixture.intentAcks]
    equal(ack.id, "local-route")
    equal(ack.status, "rejected")
    equal(ack.reason, "You must be at a nav computer to calculate jumps.")
    equal(fixture.scraper.state.metadata.hyperspace.phase, "failed")
    equal(
      fixture.scraper.state.metadata.hyperspace.error,
      "You must be at a nav computer to calculate jumps."
    )
  end)

  it("does not reject a fleet route when the commander is away from the nav computer", function()
    battlegroup()
    local plotted, plotFailure = fixture.intentHandlers.plot_hyperspace({
      mode = "local",
      scope = "all",
      formationKind = "battlegroup",
      destination = { x = 1200, y = -50, z = 800 },
    }, { id = "fleet-route" })
    assert(plotted, plotFailure)
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, true)
    equal(fixture.scraper.hyperspace.routeUsesLocalCommand, false)

    assert(
      fixture.scraper.handleHyperspaceLine("You must be at a nav computer to calculate jumps.")
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "calculating")
    equal(#fixture.intentAcks, 0)

    assert(
      fixture.scraper.handleHyperspaceLine("[Status]: Hyperspace calculations have been completed.")
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "ready")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("returns an early fleet engage to calculating until readiness is confirmed", function()
    battlegroup()
    local route = {
      mode = "local",
      scope = "all",
      formationKind = "battlegroup",
      destination = { x = 1200, y = -50, z = 800 },
      recipientLabel = "FLEET",
    }
    assert(fixture.intentHandlers.plot_hyperspace(route, { id = "fleet-route" }))
    local timerId = fixture.scraper.hyperspace.statusTimerId
    assert(timerId and fixture.timers[timerId])
    fixture:tick(timerId)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "ready")
    equal(fixture.scraper.state.metadata.hyperspace.calculationEstimated, true)

    assert(fixture.intentHandlers.engage_hyperdrive(route, { id = "fleet-engage" }))
    assert(
      fixture.scraper.handleHyperspaceLine(
        "Please Wait. The Navigation Computer is calculating the route."
      )
    )
    local state = fixture.scraper.state.metadata.hyperspace
    equal(state.phase, "calculating")
    equal(state.waitingForCalculation, true)
    local ack = fixture.intentAcks[#fixture.intentAcks]
    equal(ack.id, "fleet-engage")
    equal(ack.status, "rejected")

    assert(
      fixture.scraper.handleHyperspaceLine("[Status]: Hyperspace calculations have been completed.")
    )
    state = fixture.scraper.state.metadata.hyperspace
    equal(state.phase, "ready")
    equal(state.waitingForCalculation, false)
    equal(state.calculationEstimated, false)
    assert(tonumber(state.readyAt) > 0)
  end)

  it("estimates remote local calculations when the wing emits no completion line", function()
    battlegroup()
    local route = {
      mode = "local",
      scope = "selected",
      formationKind = "battlegroup",
      destination = { x = 1200, y = -50, z = 800 },
      recipientLabel = "REEHEEHEE",
      memberIds = { "reeheehee" },
      memberNames = { "ReeHeeHee" },
      memberSlots = { 1 },
    }
    local plotted, plotFailure =
      fixture.intentHandlers.plot_hyperspace(route, { id = "estimated-wing-route" })
    assert(plotted, plotFailure)
    assert(
      fixture.scraper.handleHyperspaceLine("Hyperspace course locked. Running final jump checks...")
    )
    assert(
      fixture.scraper.handleHyperspaceLine(
        "Jump requires 3 units of fuel. It will consume 0% of the remaining fuel."
      )
    )
    assert(
      fixture.scraper.handleHyperspaceLine("Checking hyperspace course integrity. Please wait.")
    )
    local timerId = fixture.scraper.hyperspace.statusTimerId
    assert(timerId and fixture.timers[timerId])
    equal(fixture.timers[timerId].seconds, 2)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "calculating")
    equal(fixture.scraper.state.metadata.hyperspace.calculationEstimated, true)
    equal(fixture.scraper.state.metadata.hyperspace.remainingSeconds, 2)

    fixture:tick(timerId)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "ready")
    equal(fixture.scraper.state.metadata.hyperspace.remainingSeconds, 0)
    equal(fixture.intentAcks[#fixture.intentAcks].id, "estimated-wing-route")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")

    local engaged, engageFailure =
      fixture.intentHandlers.engage_hyperdrive(route, { id = "estimated-wing-engage" })
    assert(engaged, engageFailure)
    equal(fixture:lastCommand().command, "battlegroup nav 1 hyper")
  end)

  it("routes a whole battlegroup through the all selector", function()
    battlegroup()
    local route = {
      mode = "galactic",
      scope = "all",
      formationKind = "battlegroup",
      galaxy = { x = 12, y = -8 },
      destination = { x = 100, y = 200, z = -300 },
      recipientLabel = "FLEET",
    }
    local plotted, failure = fixture.intentHandlers.plot_hyperspace(route, { id = "fleet-route" })
    assert(plotted, failure)
    equal(fixture:lastCommand().command, "battlegroup nav all calculate '12 -8' 100 200 -300")
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, true)
    equal(fixture.scraper.hyperspace.routeUsesLocalCommand, false)
    equal(fixture.scraper.state.metadata.hyperspace.route.recipientLabel, "FLEET")
  end)

  it("allows a whole battlegroup to jump while its ships are within 500 units", function()
    battlegroup()
    fixture:entity("Wayfarer").x = 600
    table.insert(fixture.scraper.state.entities, {
      id = "reeheehee",
      name = "ReeHeeHee",
      kind = "ship",
      x = 21,
      y = 0,
      z = 0,
    })
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.sources.radar = os.time()

    local engaged, failure = fixture.intentHandlers.engage_hyperdrive({
      scope = "all",
      formationKind = "battlegroup",
    }, { id = "nearby-fleet-engage" })
    assert(engaged, failure)
    equal(fixture:lastCommand().command, "battlegroup nav all hyper")
  end)

  it("allows a local-only jump near a ship in the observer's active battlegroup", function()
    battlegroup()
    fixture:entity("Wayfarer").x = 600
    table.insert(fixture.scraper.state.entities, {
      id = "reeheehee",
      name = "ReeHeeHee",
      kind = "ship",
      x = 240,
      y = 0,
      z = 0,
    })
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.sources.radar = os.time()

    local engaged, failure = fixture.intentHandlers.engage_hyperdrive({
      scope = "local",
    }, { id = "nearby-local-engage" })
    assert(engaged, failure)
    equal(fixture:lastCommand().command, "hyper")
  end)

  it("does not apply the commander's local clearance to a remote battlegroup jump", function()
    battlegroup()
    fixture:entity("Wayfarer").x = 100
    fixture.scraper.hyperspace.phase = "ready"
    fixture.scraper.state.metadata.sources.radar = os.time()

    local engaged, failure = fixture.intentHandlers.engage_hyperdrive({
      scope = "all",
      formationKind = "battlegroup",
    }, { id = "nearby-outsider-engage" })
    assert(engaged, failure)
    equal(fixture:lastCommand().command, "battlegroup nav all hyper")
  end)

  it("routes one selected battlegroup wing by its stable slot", function()
    battlegroup()
    local route = {
      mode = "local",
      scope = "selected",
      formationKind = "battlegroup",
      memberId = "reeheehee",
      memberName = "ReeHeeHee",
      memberSlot = 1,
      destination = { x = 50, y = 60, z = 70 },
      recipientLabel = "REEHEEHEE",
    }
    local plotted, failure =
      fixture.intentHandlers.plot_hyperspace(route, { id = "selected-route" })
    assert(plotted, failure)
    equal(fixture:lastCommand().command, "battlegroup nav 1 calculate local 50 60 70")
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, false)
  end)

  it("uses the native hyperspace computer for an observer-only fleet selection", function()
    battlegroup()
    local route = {
      mode = "local",
      scope = "selected",
      formationKind = "battlegroup",
      memberId = "teehee",
      memberName = "TeeHee",
      memberIds = { "teehee" },
      memberNames = { "TeeHee" },
      destination = { x = 50, y = 60, z = 70 },
      recipientLabel = "TEEHEE",
    }
    local plotted, failure =
      fixture.intentHandlers.plot_hyperspace(route, { id = "selected-observer-route" })
    assert(plotted, failure)
    equal(fixture:lastCommand().command, "calculate local 50 60 70")
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, true)
  end)

  it("plots a route for each ship in a selected battlegroup subset", function()
    local fleet = battlegroup()
    table.insert(fleet.members, {
      id = "meehee",
      name = "MeeHee",
      leader = false,
      role = "wing",
      slot = 2,
    })
    local before = #fixture.commands
    local plotted, failure = fixture.intentHandlers.plot_hyperspace({
      mode = "local",
      scope = "selected",
      formationKind = "battlegroup",
      memberIds = { "reeheehee", "meehee" },
      destination = { x = 50, y = 60, z = 70 },
      recipientLabel = "2 SELECTED CRAFT",
    }, { id = "selected-subset-route" })
    assert(plotted, failure)
    equal(#fixture.commands, before + 2)
    equal(fixture.commands[before + 1].command, "battlegroup nav 1 calculate local 50 60 70")
    equal(fixture.commands[before + 2].command, "battlegroup nav 2 calculate local 50 60 70")
  end)

  it("uses the lead cockpit for squadron hyperspace workflows", function()
    local fleet = {
      kind = "squadron",
      active = true,
      role = "lead",
      members = {
        { id = "teehee", name = "TeeHee", leader = true, role = "lead" },
        { id = "wing", name = "Wing", leader = false, role = "wing" },
      },
    }
    fixture.scraper.state.metadata.fleet = fleet
    fixture.scraper.state.metadata.formations.squadron = fleet
    local route = {
      mode = "local",
      scope = "all",
      formationKind = "squadron",
      destination = { x = 25, y = 35, z = 45 },
      recipientLabel = "SQUADRON",
    }
    local plotted, failure =
      fixture.intentHandlers.plot_hyperspace(route, { id = "squadron-route" })
    assert(plotted, failure)
    equal(fixture:lastCommand().command, "calculate local 25 35 45")
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, true)
    equal(fixture.scraper.state.metadata.hyperspace.navigatorApplied, false)
    assert(
      fixture.scraper.handleHyperspaceLine(
        "Using your skill with navigation you reroute energy to the hyperdrives."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.navigatorApplied, true)
    assert(
      fixture.scraper.handleHyperspaceLine("[Status]: Hyperspace calculations have been completed.")
    )
    fixture.scraper.state.metadata.lastSpatialFixAt = os.time()
    fixture:entity("Wayfarer").x = 600
    local engaged, engageFailure =
      fixture.intentHandlers.engage_hyperdrive(route, { id = "squadron-engage" })
    assert(engaged, engageFailure)
    equal(fixture:lastCommand().command, "hyper")
  end)

  it("completes a wing calculation abort without a local terminal response", function()
    battlegroup()
    local route = {
      mode = "local",
      scope = "wings",
      formationKind = "battlegroup",
      destination = { x = 1200, y = -50, z = 800 },
      recipientLabel = "WINGS",
    }
    assert(fixture.intentHandlers.plot_hyperspace(route, { id = "wing-route" }))

    local stopped, stopFailure = fixture.intentHandlers.stop_hyperspace(route, { id = "wing-stop" })
    assert(stopped, stopFailure)
    equal(fixture:lastCommand().command, "battlegroup nav 1 calc stop")
    equal(fixture.scraper.state.metadata.hyperspace.phase, "idle")
    equal(fixture.scraper.state.metadata.hyperspace.aborted, true)
    equal(fixture.scraper.state.metadata.hyperspace.route, nil)
    equal(fixture.scraper.hyperspace.initiatedByHolocron, false)
    equal(fixture.scraper.hyperspace.routeIncludesLocalShip, nil)

    local commandCount = #fixture.commands
    local stoppedAgain, retryFailure =
      fixture.intentHandlers.stop_hyperspace(route, { id = "wing-stop-again" })
    assert(stoppedAgain, retryFailure)
    equal(#fixture.commands, commandCount)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "idle")
  end)

  it("does not reinterpret an in-flight hyperspace escape as a calculation abort", function()
    fixture.scraper.hyperspace.phase = "hyperspace"
    fixture.scraper.state.metadata.hyperspace = {
      phase = "hyperspace",
      route = { mode = "local", destination = { x = 1, y = 2, z = 3 } },
    }
    local commandCount = #fixture.commands
    local stopped, failure = fixture.intentHandlers.stop_hyperspace({}, { id = "late-stop" })
    equal(stopped, false)
    assert(failure:find("already in hyperspace", 1, true))
    equal(#fixture.commands, commandCount)
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")
    assert(fixture.scraper.state.metadata.hyperspace.route)
  end)

  it("moves the observer into hyperspace after a direct local command", function()
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "hyper")
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")
  end)
end)
