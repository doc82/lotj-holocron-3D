local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

local function memoryInfoCache()
  local persisted = { version = 1, records = {} }
  return {
    load = function()
      return persisted
    end,
    save = function(_, payload)
      persisted = payload
      return true
    end,
    persisted = function()
      return persisted
    end,
  }
end

h.before_each(function()
  fixture = Fixture.new()
end)
h.after_each(function()
  fixture:close()
end)

describe("scraper capture lifecycle", function()
  local function response(lines)
    for value in (lines .. "\n"):gmatch("(.-)\n") do
      fixture.scraper.captureLine(value)
    end
    if fixture.scraper.active then
      fixture.scraper.finishCapture("prompt")
    end
  end

  it("discovers logistics from an empty landed catalogue and completes all markets", function()
    fixture.scraper.setInSpace(false, "landed")
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "refresh-1" }))
    equal(fixture:lastCommand().command, "planets")
    response(
      "  Planet           Starsystem            Governed By               Notices\n  Ithor            Ottega System         A Neutral Government      [FP]"
    )
    equal(fixture.scraper.state.metadata.inSpace, false)
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "clans")
    response(
      "Major Organizations:\nClan Name | Planets | Active Members\nA Neutral Government | 7 | (None)"
    )
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "l hyp")
    response(" | Between Ithor and Naboo : Passable |\n *----------------------*")
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "showp Ithor resources")
    response("--Planet Data: ---\nPlanet: Ithor\nFood ( Price per unit: 10.00)")
    fixture:tickTimersAt(0.05)
    local logistics = fixture.scraper.state.metadata.logistics
    equal(logistics.refresh.phase, "completed")
    equal(logistics.refresh.completed, 4)
    equal(logistics.refresh.total, 4)
    equal(logistics.markets.ithor.resources.Food, 10)
    equal(fixture.scraper.state.metadata.inSpace, false)
    equal(#fixture.intentAcks, 1)
    equal(fixture.intentAcks[1].status, "completed")
  end)

  it("rejects overlapping logistics refreshes without replacing the active batch", function()
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "first" }))
    equal(fixture.intentHandlers.refresh_logistics({}, { id = "second" }), false)
    equal(fixture.scraper.logistics.refreshIntentId, "first")
    equal(#fixture.commands, 1)
  end)

  local function beginMonCalaRefresh()
    fixture.scraper.setInSpace(false, "landed")
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "mon-cala" }))
    response(
      "  Planet           Starsystem            Governed By               Notices\n  Mon Cala         Calamari System       A Neutral Government      [FP]\n  Lorrd            Kanz Sector           A Neutral Government      [FP]"
    )
    fixture:tickTimersAt(0.05)
    response(
      "Major Organizations:\nClan Name | Planets | Active Members\nA Neutral Government | 7 | (None)"
    )
    fixture:tickTimersAt(0.05)
    response(" | Between Mon Cala and Lorrd : Passable |\n *----------------------*")
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, 'showp "Mon Cala" resources')
  end

  it("quotes multi-word market destinations and matches their unquoted response names", function()
    beginMonCalaRefresh()
    response([[You use the datapad to lookup the information.
--Planet Data: -----------------------------------------
Planet: Mon Cala
Starsystem: Calamari System
Governed By: A Neutral Government
Tax Rate: 15.00
Food                 ( Price per unit: 11.00)
Water                ( Price per unit: 18.92)
Use 'SHOWPLANET <planet> RESOURCES <resource>' for price history.
]])
    local logistics = fixture.scraper.state.metadata.logistics
    equal(logistics.markets["mon cala"].planet, "Mon Cala")
    equal(logistics.markets["mon cala"].resources.Water, 18.92)
    equal(#fixture.intentAcks, 0)
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "showp Lorrd resources")
    response("--Planet Data: ---\nPlanet: Lorrd\nFood ( Price per unit: 11.00)")
    fixture:tickTimersAt(0.05)
    equal(logistics.refresh.phase, "completed")
    equal(logistics.refresh.completed, 5)
    equal(fixture.intentAcks[1].status, "completed")
    equal(fixture.scraper.state.metadata.inSpace, false)
  end)

  it("does not accept a planet description as a multi-word market response", function()
    beginMonCalaRefresh()
    response([[You use the datapad to lookup the information.
--Planet Data: -----------------------------------------
Planet: Mon Cala
Starsystem: Calamari System
Coordinates: 0 0 0
Governed By: A Neutral Government
--Planet Description: ------------------------
Mon Cala is home to the Mon Calamari and the Quarren.
--Planet Economy: ----------------------------
GDP:               143002/hr
Tax Rate:               15.00%
Use 'SHOWPLANET <planet> RESOURCES' for current resources.
Use 'SHOWPLANET <planet> AI' for current population status.
Use 'SHOWPLANET <planet> NEWS' for current events.
]])
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(fixture.scraper.state.metadata.logistics.markets, nil)
    equal(fixture.intentAcks[1].status, "rejected")
  end)

  it("rejects another planet's prices during a quoted market request", function()
    beginMonCalaRefresh()
    response("--Planet Data: ---\nPlanet: Lorrd\nFood ( Price per unit: 11.00)")
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(fixture.scraper.state.metadata.logistics.markets, nil)
    equal(fixture.intentAcks[1].status, "rejected")
  end)

  it("waits for the clan prompt before capturing the next hyperlane response", function()
    fixture.scraper.setInSpace(false, "landed")
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "clan-prompt" }))
    response(
      "  Planet           Starsystem            Governed By               Notices\n  Naboo            Naboo System          A Neutral Government      [FP]"
    )
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "clans")
    for value in
      ([[Major Organizations:
Clan Name                                | Planets | Active Members
A Neutral Government                     | 7       | (None)
Confederacy of Independent Systems       | 3       | 30+
The Galactic Republic                    | 5       | 30+
Minor Organizations:
Clan Name                                | Planets | Active Members
Merr-Sonn Munitions                      | 0       | 20+
Durafly                                  | 0       | 10+
Lorellian Raiders                        | 0       | 20+
Use SHOWCLAN for more information.
]]):gmatch("(.-)\n")
    do
      fixture.scraper.captureLine(value)
    end
    -- The footer is not the end of the command's output envelope.
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "clans")
    equal(fixture.scraper.active.parserCommand, "clans")
    fixture.scraper.captureLine("{Tone: none } {Time: night } {Ambience: average }")
    fixture.scraper.captureLine("{Health: 1400/1400} {OOC:||||||} [ ] {Movement: 2690/2690} []")
    assert(fixture:trigger("prompt"))
    equal(#fixture.scraper.state.metadata.logistics.clans, 6)
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "l hyp")
    -- Even an extra delayed prompt cannot consume an empty new capture.
    local capture = fixture.scraper.active
    assert(fixture:trigger("prompt"))
    equal(fixture.scraper.active, capture)
    equal(#fixture.intentAcks, 0)
    for value in
      ([[You glance at the monitor's rendering of the galactic hyperlane hazards:
.--------------------------------------------------.
|   Between Naboo and Bespin         : No Route    |
|   Between Corellia and Wroona      : Passable    |
|   Between Kashyyyk and Core Worlds : No Route    |
|   Between Arkania and Lorrd        : No Route    |
|   Between Hutt Space and Tatooine  : No Route    |
*--------------------------------------------------*
]]):gmatch("(.-)\n")
    do
      fixture.scraper.captureLine(value)
    end
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "l hyp")
    assert(fixture:trigger("prompt"))
    local lanes = fixture.scraper.state.metadata.logistics.hyperlanes
    equal(#lanes, 5)
    equal(lanes[2].from, "Corellia")
    equal(lanes[2].status, "passable")
    equal(lanes[3].to, "Core Worlds")
    fixture:tickTimersAt(0.05)
    equal(fixture:lastCommand().command, "showp Naboo resources")
    response("--Planet Data: ---\nPlanet: Naboo\nFood ( Price per unit: 10.00)")
    fixture:tickTimersAt(0.05)
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "completed")
    equal(fixture.scraper.state.metadata.inSpace, false)
  end)

  it("times out a logistics capture even after ignoring an early prompt", function()
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "no-response" }))
    assert(fixture:trigger("prompt"))
    assert(fixture.scraper.active)
    fixture:tickTimersAt(fixture.scraper.CAPTURE_TIMEOUT_SECONDS)
    equal(fixture.scraper.active, nil)
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(#fixture.intentAcks, 1)
    equal(fixture.intentAcks[1].status, "rejected")
  end)

  it("fails a partial logistics timeout and permits a fresh retry", function()
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "timeout" }))
    fixture.scraper.captureLine(
      "  Planet           Starsystem            Governed By               Notices"
    )
    fixture.scraper.finishCapture("timeout")
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(#fixture.intentAcks, 1)
    equal(fixture.intentAcks[1].status, "rejected")
    fixture:tickTimersAt(0.05)
    equal(#fixture.commands, 1)
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "retry" }))
  end)

  it("cancels queued logistics commands when the user intervenes between captures", function()
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "interrupted" }))
    response(
      "  Planet           Starsystem            Governed By               Notices\n  Ithor            Ottega System         A Neutral Government      [FP]"
    )
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "look")
    fixture:tickTimersAt(0.05)
    equal(#fixture.commands, 1)
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
  end)

  it("captures typed cargo confirmations while landed before completing their intent", function()
    fixture.scraper.setInSpace(false, "landed")
    assert(
      fixture.intentHandlers.logistics_action(
        { action = "buy", shipName = "BlueSkies", resource = "Textiles", quantity = 10 },
        { id = "buy-1" }
      )
    )
    equal(#fixture.intentAcks, 0)
    response("You purchased 10 units of Textiles for 100 credits.")
    equal(fixture.scraper.state.metadata.logistics.lastTransaction.amount, 10)
    equal(fixture.scraper.state.metadata.inSpace, false)
    equal(fixture.intentAcks[1].id, "buy-1")
    equal(fixture.intentAcks[1].status, "completed")
  end)

  it("captures manually requested logistics while landed", function()
    fixture.scraper.setInSpace(false, "landed")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "refuel BlueSkies")
    assert(fixture.scraper.active)
    response("You pay 10 credits to refuel the ship.")
    equal(fixture.scraper.state.metadata.logistics.lastTransaction.action, "refuel")
    equal(fixture.scraper.state.metadata.inSpace, false)
  end)

  it("completes refueling when the ship is already full", function()
    fixture.scraper.setInSpace(false, "landed")
    assert(
      fixture.intentHandlers.logistics_action(
        { action = "refuel", shipName = "gg" },
        { id = "full-refuel" }
      )
    )
    response("That ship is already fully fueled!")
    equal(fixture.scraper.state.metadata.logistics.lastTransaction.cost, 0)
    equal(fixture.scraper.state.metadata.logistics.lastTransaction.alreadyFull, true)
    equal(fixture.intentAcks[1].status, "completed")
  end)

  it("captures the credit balance while landed", function()
    fixture.scraper.setInSpace(false, "landed")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "credits")
    response("You have 1097793 credits.")
    equal(fixture.scraper.state.metadata.logistics.credits, 1097793)
    equal(fixture.scraper.active, nil)
  end)

  it("uses only bare showplanet as a current location observation", function()
    fixture.scraper.setInSpace(false, "landed")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "showplanet")
    response(
      "Planet: Naboo\nStarsystem: Naboo System\nUse 'SHOWPLANET <planet> RESOURCES' for current resources."
    )
    equal(fixture.scraper.state.metadata.logistics.location.planet, "Naboo")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", 'showplanet "Mon Cala"')
    response(
      "Planet: Mon Cala\nStarsystem: Calamari System\nUse 'SHOWPLANET <planet> RESOURCES' for current resources."
    )
    equal(fixture.scraper.state.metadata.logistics.location.planet, "Naboo")
  end)

  it("rejects an empty catalogue without reporting a successful refresh", function()
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "empty" }))
    response("  Planet           Starsystem            Governed By               Notices")
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(#fixture.intentAcks, 1)
    equal(fixture.intentAcks[1].status, "rejected")
    equal(fixture.scraper.logistics.refreshing, false)
  end)

  it("does not allow polling to supersede a logistics capture", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startPolling({ initialDelaySeconds = 0.1 }))
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "poll-safe" }))
    local capture = fixture.scraper.active
    fixture:tickTimersAt(0.1)
    equal(fixture.scraper.active, capture)
    equal(#fixture.commands, 1)
  end)

  it("fails an interrupted logistics capture rather than advancing its queue", function()
    assert(fixture.intentHandlers.refresh_logistics({}, { id = "superseded" }))
    fixture.scraper.captureLine(
      "  Planet           Starsystem            Governed By               Notices"
    )
    assert(fixture.scraper.startCapture("status", "status", { allowLanded = true }))
    fixture:tickTimersAt(0.05)
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(fixture.scraper.active.parserCommand, "status")
    equal(#fixture.intentAcks, 1)
  end)

  it("releases logistics refresh ownership when sending fails", function()
    _G.send = function()
      return false, "disconnected"
    end
    equal(fixture.intentHandlers.refresh_logistics({}, { id = "send-failed" }), false)
    equal(fixture.scraper.state.metadata.logistics.refresh.phase, "failed")
    equal(fixture.scraper.active, nil)
    equal(fixture.scraper.logistics.refreshing, false)
  end)

  it("does not retry a cargo action without a confirmation", function()
    assert(
      fixture.intentHandlers.logistics_action(
        { action = "refuel", shipName = "BlueSkies" },
        { id = "refuel-timeout" }
      )
    )
    fixture.scraper.finishCapture("timeout")
    equal(#fixture.commands, 1)
    equal(fixture.intentAcks[1].status, "rejected")
    equal(fixture.scraper.state.metadata.logistics, nil)
  end)

  it("rejects an unrelated transaction confirmation for a typed cargo action", function()
    assert(
      fixture.intentHandlers.logistics_action(
        { action = "buy", shipName = "BlueSkies", resource = "Textiles", quantity = 10 },
        { id = "buy-mismatch" }
      )
    )
    response("You pay 10 credits to refuel the ship.")
    equal(fixture.intentAcks[1].status, "rejected")
    equal(fixture.scraper.state.metadata.logistics, nil)
    equal(#fixture.commands, 1)
  end)

  it("registers protocol listeners and intent handlers in a fresh fixture", function()
    equal(#fixture.scraper.eventHandlerIds, 8)
    equal(#fixture.scraper.stateTriggerIds, 26)
    equal(fixture.gmcpRequests[1].command, 'Core.Supports.Add ["Ship 1", "Galaxy 1", "Room 1"]')
    assert(type(fixture.intentHandlers.scan_ship) == "function")
    assert(type(fixture.intentHandlers.navigate_ship) == "function")
    assert(type(fixture.intentHandlers.route_operation) == "function")
    assert(type(fixture.intentHandlers.route_stop) == "function")
  end)

  it("connects navigation intents to command responses and completion telemetry", function()
    fixture.scraper.setInSpace(false, "landed")
    assert(fixture.intentHandlers.route_operation({
      operation = {
        id = "run:1",
        runId = "run",
        kind = "reconcile",
        destination = { name = "Corellia" },
      },
      ship = { name = "Sunrise", enterPath = { "n" }, exitPath = { "s" } },
    }, { id = "navigation-intent" }))
    equal(fixture.scraper.polling.paused, true)
    equal(fixture.commands[#fixture.commands].command, "showplanet")
    local active = fixture.scraper.routeNavigation.active
    local sent = #fixture.commands
    local accepted = fixture.intentHandlers.route_operation({}, { id = "duplicate" })
    equal(accepted, false)
    equal(fixture.scraper.routeNavigation.active, active)
    equal(fixture.scraper.polling.paused, true)
    equal(fixture.scraper.routeNavigation.ownsPolling, true)
    equal(#fixture.commands, sent)
    local function reply(lines)
      for line in (lines .. "\n"):gmatch("([^\n]*)\n") do
        fixture.scraper.routeNavigation:line(line)
      end
      fixture.scraper.routeNavigation:prompt()
      fixture:tickTimersAt(0)
    end
    reply("Planet: Corellia\nStarsystem: Corellia System")
    reply("Landing Pad\nLethisk-Class Armed Freighter: Sunrise")
    reply("Cargo Readout for Freighter 'Sunrise':\n[1 ] [(Empty)] [0/500]")
    reply("You have 1097793 credits.")
    equal(fixture.scraper.state.metadata.routeNavigation.confirmation.operationId, "run:1")
    equal(fixture.scraper.state.metadata.routeNavigation.confirmation.location.ship, "Sunrise")
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
    equal(fixture.intentAcks[#fixture.intentAcks].id, "navigation-intent")
    assert(fixture.intentHandlers.route_stop({ runId = "run" }))
    equal(fixture.scraper.polling.paused, false)
  end)

  it(
    "completes a planet flight through registered callbacks and outgoing command events",
    function()
      fixture:close()
      fixture = Fixture.new({ outgoingEvents = true })
      local driver = fixture.scraper.routeNavigation
      local function reply(text)
        for line in (text .. "\n"):gmatch("([^\n]*)\n") do
          assert(fixture:trigger("^.*$", line))
        end
        fixture.triggers[fixture.scraper.stateTriggerIds[2]].callback()
        fixture:tickTimersAt(0)
      end
      assert(fixture.intentHandlers.route_operation({
        operation = {
          id = "launch-run:0",
          runId = "launch-run",
          kind = "reconcile",
          destination = { name = "Corellia" },
        },
        ship = { name = "Test Hauler", enterPath = { "n" }, exitPath = { "s" } },
      }, { id = "reconcile-intent" }))
      reply("Planet: Corellia")
      reply("Landing Pad\nFreighter: Test Hauler")
      reply("Cargo Readout for Freighter 'Test Hauler':\n[1 ] [(Empty)] [0/500]")
      reply("You have 1000 credits.")
      equal(driver.active, nil)
      assert(fixture.intentHandlers.route_operation({
        operation = {
          id = "launch-run:1",
          runId = "launch-run",
          kind = "navigate",
          destination = {
            name = "Wroona",
            system = "Wroona System",
            arrival = { kind = "planet", pad = "Test Pad" },
          },
        },
        from = { name = "Corellia" },
        ship = { name = "Test Hauler", enterPath = { "n" }, exitPath = { "s" } },
      }, { id = "launch-intent" }))
      reply("Planet: Corellia")
      reply("Landing Pad\nFreighter: Test Hauler")
      reply("| Between Corellia and Wroona : Passable |")
      reply("Planet: Wroona\nStarsystem: Wroona System\nCoordinates: 100 200 300")
      reply("That ship is already fully fueled!")
      reply("You open the hatch on Freighter 'Test Hauler'.")
      for _ = 1, 4 do
        reply("Done.")
      end
      reply("You grip the controls.")
      equal(fixture:lastCommand().command, "launch")
      local active = driver.active
      reply("You'll have to disengage the ship's autopilot first.")
      equal(driver.active, active)
      fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "autopilot off")
      reply("Autopilot OFF.")
      equal(driver.active, active)
      for _, command in ipairs({
        "launch confirm",
        "remove overcoat;wear env",
        "shields on",
        "l hyp",
        "say Ready when you are",
        "inventory",
        "tell TestPilot checking supplies",
        "look",
        "n",
      }) do
        fixture.scraper.handleOutgoingCommand("sysDataSendRequest", command)
        equal(driver.active, active)
        reply("Launch sequence initiated.")
        equal(fixture:lastCommand().command, "launch")
      end
      assert(
        fixture:trigger("^.*$", "The ship leaves the platform far behind as it flies into space.")
      )
      assert(fixture:trigger("The ship leaves the platform far behind as it flies into space"))
      fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "wear test coat")
      assert(fixture:trigger("^.*$", "You can't wear that."))
      fixture:tickTimersAt(0)
      equal(fixture:lastCommand().command, 'calculate "Wroona System" 389 489 589')
      equal(fixture.scraper.polling.paused, true)
      fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "practice test skill")
      reply("You fail.")
      equal(driver.active, active)
      equal(active.waitingForMilestone, nil)
      reply("[Status]: Hyperspace calculations have been completed.")
      equal(fixture:lastCommand().command, "navstat")
      fixture.scraper.polling.dispatching = true
      send("shields on", false)
      fixture.scraper.polling.dispatching = false
      equal(driver.active, active)
      reply("Jump System: Wroona System")
      equal(fixture:lastCommand().command, "hyperspace")
      reply("The stars become streaks of light as you enter hyperspace.")
      equal(fixture:lastCommand().command, "hyperspace")
      reply("The ship lurches slightly as it comes out of hyperspace.")
      equal(fixture:lastCommand().command, "navstat")
      reply("Current System: Wroona System")
      equal(fixture:lastCommand().command, 'course "Wroona"')
      reply("You begin orbiting Wroona.")
      equal(fixture:lastCommand().command, 'land "Wroona" Test Pad')
      assert(fixture:trigger("^.*$", "You feel a slight thud as the ship sets down on the ground."))
      assert(fixture:trigger("You feel a slight thud as the ship sets down on the ground."))
      fixture:tickTimersAt(0)
      equal(fixture:lastCommand().command, "autopilot on")
      reply("Autopilot ON.")
      reply("Ship hatch")
      reply("You open the hatch.")
      reply("Landing Pad\nFreighter: Test Hauler")
      reply("You close the hatch.")
      reply("Planet: Wroona")
      reply("Landing Pad\nFreighter: Test Hauler")
      reply("Cargo Readout for Freighter 'Test Hauler':\n[1 ] [(Empty)] [0/500]")
      reply("That ship is already fully fueled!")
      equal(fixture.scraper.state.metadata.routeNavigation.status, "completed")
      equal(
        fixture.scraper.state.metadata.routeNavigation.confirmation.location.destination,
        "Wroona"
      )
    end
  )

  it("applies observer status without depending on snapshot indexes", function()
    assert(fixture:capture(
      "status",
      [[
Forrestal:
Current Coordinates: 10 20 -5
Current Speed: 120/300
Hull: 140/150  Ship Condition: Running
Shields: 100/150 Energy(fuel): 3916/5000
]]
    ))
    local snapshot = fixture:lastSnapshot()
    equal(snapshot.observer.name, "Forrestal")
    equal(snapshot.observer.x, 10)
    equal(snapshot.observer.speed.maximum, 300)
    equal(snapshot.observer.hull.current, 140)
  end)

  it("does not let a late background info response rename the observer", function()
    assert(fixture.scraper.applyResult({
      source = "status",
      name = "TeeHee1",
      coordinates = { x = 10, y = 20, z = -5 },
    }, "status"))
    assert(fixture.scraper.startCapture("status", "status", { external = true }))
    fixture.scraper.captureLine("[Class: Cruiser] : Victory-II Class Star Destroyer 'TeeHee3'")
    fixture.scraper.captureLine("Kill Markers:")
    fixture.scraper.captureLine("Quota: 0.00/2770.00 Value: 4109300 credit(s)")
    fixture.scraper.captureLine("Maximum Speed: 55 Hyperspeed: 70")

    local result, failure = fixture.scraper.finishCapture("prompt")
    equal(result, nil)
    assert(failure:find("ignored in-flight ship information response", 1, true))
    equal(fixture.scraper.state.observer.name, "TeeHee1")
  end)

  it(
    "resets observer-scoped telemetry when an unqualified info response reveals a ship change",
    function()
      fixture.scraper.setInSpace(true, "fixture")
      assert(fixture.scraper.applyResult({
        source = "status",
        name = "JM17",
        coordinates = { x = 10, y = 20, z = -5 },
        hull = { current = 90, maximum = 100 },
      }, "status"))
      assert(fixture.scraper.applyResult({
        source = "radar",
        system = "Corellian System",
        entities = {
          { id = "wayfarer", name = "Wayfarer", kind = "ship", x = 30, y = 20, z = -5 },
        },
      }, "radar"))
      fixture.scraper.state.metadata.formations.squadron = {
        kind = "squadron",
        active = false,
        members = {},
      }

      local applied, failure = fixture.scraper.applyResult({
        source = "info",
        name = "Wizard",
        shipCategory = "starfighter",
        sensorArray = 8,
      }, "info")

      assert(applied, failure)
      equal(fixture.scraper.state.observer.name, "Wizard")
      equal(fixture.scraper.state.observer.shipCategory, "starfighter")
      equal(fixture.scraper.state.observer.x, nil)
      equal(fixture.scraper.state.observer.hull, nil)
      equal(next(fixture.scraper.state.entities), nil)
      equal(next(fixture.scraper.state.metadata.formations), nil)
      equal(fixture.scraper.state.metadata.initializationPending, true)
      equal(fixture.scraper.state.metadata.observerGeneration, 1)
    end
  )

  it("merges info telemetry and excludes access codes", function()
    assert(fixture:capture(
      "info",
      [[
[Class: Transport] : Rojan-class Patrol Craft 'Forrestal'
Hatchway: 94599 Hangar Bays: 47894 Docking: 62351
Maximum Speed: 200 Sensor Array: 7
]]
    ))
    local observer = fixture:lastSnapshot().observer
    equal(observer.sensorArray, 7)
    equal(observer.radarRange, 570)
    equal(observer.hatchway, nil)
    local redacted = false
    for _, value in ipairs(fixture.scraper.lastCapture.lines) do
      if value:find("redacted", 1, true) then
        redacted = true
      end
    end
    assert(redacted, "captured access codes should be redacted")
  end)

  it("persists safe ship info by name and class and hydrates it after reload", function()
    local cache = memoryInfoCache()
    fixture:close()
    fixture = Fixture.new({ infoCache = cache })
    assert(fixture:capture(
      "info",
      [[
[Class: Freighter] : YT-1300 'Wayfarer'
--Weapons----------------------------------------------------------------
Autoblasters: 0 Laser cannons: 2 Turbolasers: 1
Ion cannons: 0 Maximum Missiles: 8 Maximum Torpedoes: 0
Maximum Rockets: 0 Maximum Pulses: 0 Missile Tubes: 2
--Access Codes-----------------------------------------------------------
Hatchway: 94599 Hangar Bays: 47894 Docking: 62351 Selfdestruct: 12345
--Systems----------------------------------------------------------------
Maximum Speed: 80 Hyperspeed: 100 Sensor Array: 7
]]
    ))

    local persistedRecord
    for _, record in pairs(cache.persisted().records) do
      persistedRecord = record
    end
    assert(persistedRecord)
    equal(persistedRecord.name, "Wayfarer")
    equal(persistedRecord.class, "YT-1300")
    equal(persistedRecord.telemetry.weapons.laserCannons, 2)
    for _, section in ipairs(persistedRecord.telemetry.infoCard.sections) do
      assert(section.title ~= "ACCESS CODES")
    end

    fixture:close()
    fixture = Fixture.new({ infoCache = cache })
    assert(fixture:capture(
      "radar",
      [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 10 20 -5
]]
    ))
    local hydrated = assert(fixture:entity("Wayfarer"))
    equal(hydrated.shipCategory, "Freighter")
    equal(hydrated.weapons.turbolasers, 1)
    assert(hydrated.infoCachedAt)

    assert(fixture:capture(
      "radar",
      [[
Corellian System
YT-2400 'Wayfarer' 200 30 40
Your Coordinates: 10 20 -5
]]
    ))
    local differentClass = assert(fixture:entity("Wayfarer"))
    equal(differentClass.class, "YT-2400")
    equal(differentClass.weapons, nil)
    equal(differentClass.infoCard, nil)
  end)

  it("replaces cached ship info after a manually issued info command", function()
    local cache = memoryInfoCache()
    fixture:close()
    fixture = Fixture.new({ infoCache = cache })
    fixture.scraper.setInSpace(true, "fixture")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "info Wayfarer")
    assert(fixture.scraper.active and fixture.scraper.active.polled == false)
    fixture.scraper.captureLine("[Class: Freighter] : YT-1300 'Wayfarer'")
    fixture.scraper.captureLine("Autoblasters: 0 Laser cannons: 2 Turbolasers: 9")
    fixture.scraper.captureLine("Ion cannons: 0 Maximum Missiles: 8 Maximum Torpedoes: 0")
    fixture.scraper.captureLine("Maximum Rockets: 0 Maximum Pulses: 0 Missile Tubes: 2")
    fixture.scraper.captureLine("--Systems----------------------------------------")
    fixture.scraper.captureLine("Sensor Array: 8")
    assert(fixture.scraper.finishCapture("prompt"))

    local persistedRecord
    for _, record in pairs(cache.persisted().records) do
      persistedRecord = record
    end
    equal(persistedRecord.telemetry.weapons.turbolasers, 9)
    equal(persistedRecord.telemetry.sensorArray, 8)
  end)

  it("does not cache an incomplete ship info response", function()
    local cache = memoryInfoCache()
    fixture:close()
    fixture = Fixture.new({ infoCache = cache })
    assert(fixture:capture(
      "info",
      [[
[Class: Freighter] : YT-1300 'Wayfarer'
Sensor Array: 7
]]
    ))

    equal(next(cache.persisted().records), nil)
  end)

  it("merges fleet radar contacts without duplicating the observer", function()
    assert(fixture:capture(
      "status",
      [[
Forrestal:
Current Coordinates: 10 20 -5
Current Speed: 0/200
]]
    ))
    assert(fixture:capture(
      "fleetradar",
      [[
Corellian System
Rojan-class Patrol Craft 'Forrestal' |  | (Ctr) 10 20 -5
YT-1300 'Wayfarer' |  | (Out) 200 30 40
]]
    ))
    equal(fixture.scraper.state.metadata.system, "Corellian System")
    assert(fixture:entity("Wayfarer"))
    equal(fixture:entity("Forrestal"), nil)
  end)

  it("uses fleet radar as an authoritative ship census for radar contacts", function()
    assert(fixture.scraper.applyResult({
      source = "radar",
      system = "Hutt Space",
      entities = {
        {
          id = "nar-shaddaa",
          name = "Nar Shaddaa",
          kind = "celestial",
          x = 10000,
          y = 0,
          z = 1000,
        },
        {
          id = "planet-jumper-six",
          name = "Planet Jumper Six",
          kind = "celestial",
          x = 12988,
          y = 4978,
          z = 1,
        },
      },
    }, "radar"))
    equal(fixture:entity("Planet Jumper Six").kind, "celestial")

    assert(fixture.scraper.applyResult({
      source = "fleetradar",
      system = "Hutt Space",
      entities = {
        {
          id = "planet-jumper-six",
          name = "Planet Jumper Six",
          class = "JumpMaster 5000",
          kind = "ship",
          x = 12988,
          y = 4978,
          z = 1,
        },
      },
    }, "fleetradar"))
    equal(fixture:entity("Planet Jumper Six").kind, "ship")
    equal(fixture:entity("Nar Shaddaa").kind, "celestial")

    assert(fixture.scraper.applyResult({
      source = "radar",
      system = "Hutt Space",
      entities = {
        {
          id = "nar-shaddaa",
          name = "Nar Shaddaa",
          kind = "celestial",
          x = 10000,
          y = 0,
          z = 1000,
        },
        {
          id = "planet-jumper-six",
          name = "Planet Jumper Six",
          kind = "celestial",
          x = 12988,
          y = 4978,
          z = 1,
        },
      },
    }, "radar"))
    equal(fixture:entity("Planet Jumper Six").kind, "ship")
    equal(fixture:entity("Nar Shaddaa").kind, "celestial")
  end)

  it("does not merge a synchronized fleet-radar observer after a newer GMCP fix", function()
    fixture.scraper.state.observer.name = "VSD14"
    fixture.scraper.state.observer.x = 3084
    fixture.scraper.state.observer.y = -2800
    fixture.scraper.state.observer.z = 3025
    fixture.scraper.shipGmcp.sequence = 1285

    assert(fixture.scraper.applyResult({
      source = "fleetradar",
      entities = {
        {
          id = "vsd14",
          name = "VSD14",
          class = "Victory-II Class Star Destroyer",
          kind = "ship",
          x = 3071,
          y = -2788,
          z = 3012,
        },
      },
    }, "fleetradar", { sensorTickSequence = 1284 }))

    equal(fixture.scraper.state.observer.x, 3084)
    equal(fixture.scraper.state.observer.y, -2800)
    equal(fixture.scraper.state.observer.z, 3025)
    equal(fixture:entity("VSD14"), nil)
  end)

  it("keeps externally issued telemetry visible", function()
    fixture.scraper.setInSpace(true, "fixture")
    local before = fixture.deletedLines
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "radar")
    assert(fixture.scraper.active and fixture.scraper.active.polled == false)
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("YT-1300 'Wayfarer' 200 30 40")
    fixture.scraper.captureLine("Your Coordinates: 10 20 -5")
    equal(fixture.scraper.active, nil)
    equal(fixture.deletedLines, before)
  end)

  it("hides owned background lines but leaves asynchronous chat visible", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    local before = fixture.deletedLines
    fixture.scraper.captureLine("Corellian System")
    equal(fixture.scraper.captureLine("(OOC) @Bando: hello"), false)
    fixture.scraper.captureLine("YT-1300 'Wayfarer' 200 30 40")
    fixture.scraper.captureLine("Your Coordinates: 10 20 -5")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.deletedLines, before, "gagging must wait for the complete trigger pass")
    assert(fixture:tickTimersAt(0) > 0)
    assert(fixture.deletedLines > before)
  end)

  it("lets other packages read telemetry before its deferred gag runs", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    local before = fixture.deletedLines
    local telemetryLine = "Corellian System"

    assert(fixture.scraper.captureLine(telemetryLine))
    local copiedByAnotherPackage = telemetryLine

    equal(copiedByAnotherPackage, telemetryLine)
    equal(fixture.deletedLines, before)
    equal(fixture:tickTimersAt(0), 1)
    equal(fixture.deletedLines, before + 1)
  end)

  it("leaves lotj-ui clan and local communication formats untouched", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    assert(fixture.scraper.captureLine("Corellian System"))
    equal(fixture:tickTimersAt(0), 1)

    for _, communicationLine in ipairs({
      "{clan}<member>[Clan] Pilot: Form up on me.",
      "A pilot speaks in your mind 'Can you hear me?'",
      "You speak through your mind 'Affirmative.'",
      "You sign, in Lorrdian, 'Stand by.'",
      "[Hail from Wayfarer] Incoming transmission.",
      "[INTERCOM: Wayfarer] All hands report in.",
      "A pilot says 'Clear skies.'",
    }) do
      equal(
        fixture.scraper.captureLine(communicationLine),
        false,
        "communication should remain available to lotj-ui: " .. communicationLine
      )
    end
    equal(fixture:tickTimersAt(0), 0)
  end)

  it("does not gag when the Mudlet buffer has advanced to another line", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    local before = fixture.deletedLines
    assert(fixture.scraper.captureLine("Corellian System"))
    _G.getCurrentLine = function()
      return "{clan}<member>[Clan] Pilot: emergency message"
    end

    equal(fixture:tickTimersAt(0), 1)
    equal(fixture.deletedLines, before)
  end)

  it("can leave all background polling output visible", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.setPolledOutputGagged(false))
    equal(fixture.scraper.getPollingState().gagPolledOutput, false)
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    local before = fixture.deletedLines
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 10 20 -5")
    assert(fixture.scraper.finishCapture("prompt"))

    equal(fixture:tickTimersAt(0), 0)
    equal(fixture.deletedLines, before)
    equal(fixture.scraper.state.observer.x, 10)
  end)

  it("keeps unknown critical events visible inside an active background response", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    fixture.scraper.captureLine("Corellian System")
    equal(fixture:tickTimersAt(0), 1)
    local deletedAfterHeading = fixture.deletedLines

    for _, eventLine in ipairs({
      "The ship settles into orbit around Corellia.",
      "The ship begins docking with Corellian Orbital Station.",
      "The ship leaves the platform far behind as it flies into space.",
      "A tractor beam locks onto your ship.",
      "Destination reached. Initiating realspace reentry...",
      "[ALERT]: Navigation computer reports an unexpected hazard.",
    }) do
      assert(fixture.scraper.captureLine(eventLine))
      equal(
        fixture.deletedLines,
        deletedAfterHeading,
        "critical event should remain visible: " .. eventLine
      )
    end

    equal(fixture:tickTimersAt(0), 0, "critical events must not schedule deferred gags")

    fixture.scraper.captureLine("YT-1300 'Wayfarer' 200 30 40")
    fixture.scraper.captureLine("Your Coordinates: 10 20 -5")
    assert(fixture.scraper.finishCapture("prompt"))
    assert(fixture:entity("Wayfarer"))
    assert(
      table
        .concat(fixture.scraper.lastCapture.lines, "\n")
        :find("The ship settles into orbit around Corellia.", 1, true),
      "visible continuation should remain available as parser context"
    )
  end)

  it("does not capture a sector-arrival announcement as a radar contact", function()
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    fixture.scraper.captureLine("Esstran Sector")
    equal(
      fixture.scraper.captureLine(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at celestial 3670 3491 3402"
      ),
      false
    )
    fixture.scraper.captureLine("Victory-II Class Star Destroyer 'VSD02' 3670 3491 3402")
    fixture.scraper.captureLine("Your Coordinates: 3510 3491 3402")
    assert(fixture.scraper.finishCapture("prompt"))

    equal(fixture:entity("VSD02").name, "VSD02")
    equal(fixture:entity("TeeHee3"), nil)
  end)

  it("does not publish the trailing character HUD as a celestial contact", function()
    assert(fixture:capture(
      "radar",
      [[
Esstran Sector
Dromund Kaas 0 0 0
Speed: 80 Fuel Level: 97% Coords: -1 3 26
Your Coordinates: -1 3 26
]]
    ))

    equal(fixture:entity("Dromund Kaas").kind, "celestial")
    equal(fixture:entity("Speed: 80 Fuel Level: 97% Coords:"), nil)
    local count = 0
    for _ in pairs(fixture.scraper.state.entities) do
      count = count + 1
    end
    equal(count, 1)
  end)

  it("publishes named stations and multi-word ships from nebula radar", function()
    assert(fixture:capture(
      "radar",
      [[
Fictional Test Nebula
Test Research Station 'Test Beacon' 0 0 0
Z-95 Headhunter 'Anger Flight Lead' (Ctr) 1 37 -1
]]
    ))

    local station = assert(fixture:entity("Test Beacon"))
    equal(station.class, "Test Research Station")
    equal(station.kind, "ship")
    equal(station.shipCategory, "battlestation")
    equal(fixture:entity("Anger Flight Lead").position, "Ctr")
    equal(fixture.scraper.state.metadata.system, "Fictional Test Nebula")
  end)

  it("rejects malformed entities at the telemetry state boundary", function()
    assert(fixture.scraper.applyResult({
      source = "radar",
      system = "Esstran Sector",
      observer = { x = 0, y = 0, z = 0 },
      entities = {
        {
          name = "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem",
          kind = "celestial",
          x = 10,
          y = 20,
          z = 30,
        },
        { name = string.rep("A", 65), kind = "ship", x = 40, y = 50, z = 60 },
        { name = "Dromund Kaas", kind = "planet", x = 70, y = 80, z = 90 },
      },
    }, "radar"))

    local count = 0
    for _ in pairs(fixture.scraper.state.entities) do
      count = count + 1
    end
    equal(count, 1)
    equal(fixture:entity("Dromund Kaas").name, "Dromund Kaas")
  end)

  it("landing abandons captures and clears stale contacts", function()
    assert(fixture:capture(
      "radar",
      [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 10 20 -5
]]
    ))
    assert(fixture:entity("Wayfarer"))
    fixture.scraper.setInSpace(true, "fixture")
    assert(fixture.scraper.startCapture("radar", "radar"))
    assert(fixture.scraper.setInSpace(false, "landed"))
    equal(fixture.scraper.active, nil)
    equal(next(fixture.scraper.state.entities), nil)
    equal(fixture:lastSnapshot().metadata.inSpace, false)
  end)

  it("reports a useful error when finishing without a capture", function()
    local result, failure = fixture.scraper.finishCapture("prompt")
    equal(result, nil)
    equal(failure, "no capture is active")
  end)

  it("isolates capture diagnostics from surrounding game output", function()
    fixture.scraper.showLastCapture()
    equal(fixture.output[1]:sub(1, 1), "\n")
    equal(fixture.output[1]:sub(-1), "\n")

    fixture.output = {}
    assert(fixture:capture(
      "status",
      [[
Forrestal:
Current Coordinates: 10 20 -5
]]
    ))
    assert(fixture.scraper.showLastCapture())
    equal(fixture.output[1]:sub(1, 1), "\n")
    equal(fixture.output[#fixture.output]:sub(-1), "\n")
  end)
end)
