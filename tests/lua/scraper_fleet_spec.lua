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

    local view = fixture.scraper.state.metadata.tacticalViews.teehee3
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
      viewpointMemberId = "teehee3",
      targetId = "vsd21",
    }, { id = "remote-target" })
    assert(targeted, targetFailure)
    equal(fixture:lastCommand().command, "battlegroup target TeeHee3 VSD21")
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
    equal(fixture.scraper.state.metadata.tacticalViews.reeheehee, nil)
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
    equal(fixture.scraper.state.metadata.hyperspace.route.recipientLabel, "FLEET")
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
