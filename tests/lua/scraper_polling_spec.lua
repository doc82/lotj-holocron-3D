local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
end)
h.after_each(function()
  fixture:close()
end)

local function beginPolling(options)
  options = options or {}
  options.initialDelaySeconds = options.initialDelaySeconds or 0.1
  assert(fixture.scraper.startPolling(options))
  return fixture.scraper.getPollingState().timerId
end

local function emitShipGmcp(x)
  _G.gmcp.Ship = {
    Info = {
      posX = x or 0,
      posY = 0,
      posZ = 0,
      speed = 0,
      maxSpeed = 100,
    },
  }
  assert(fixture.scraper.handleShipGmcp())
end

local function finishInitializationCapture(command)
  if command == "radar" then
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 0 0 0")
  elseif command == "fleetradar" then
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Imperial-II Class Star Destroyer 'TeeHee1' | | (Ctr) 0 0 0")
  elseif command == "battlegroup" then
    fixture.scraper.captureLine(
      "[ L ] Battleship :Imperial-II Class Star Destroyer 'TeeHee1' -<Pos:Central>-"
    )
    fixture.scraper.captureLine(
      " Energy: 100%|Hull: 100%|Shields: 100%|Crew: 001|System: Corellian System 2/19"
    )
  elseif command == "squadron status" then
    fixture.scraper.captureLine("Lead: TIE/S Striker 'Wrecker01'")
    fixture.scraper.captureLine(" Energy: 97% Shield: 100% Hull: 100% Location: Corellian System")
  else
    error("unsupported initialization command: " .. tostring(command))
  end
  assert(fixture.scraper.finishCapture("prompt"))
end

local function expectImmediateInitializationSweep()
  for _, expected in ipairs({ "radar", "fleetradar", "battlegroup", "squadron status" }) do
    local timerId = fixture.scraper.getPollingState().timerId
    assert(timerId and fixture.timers[timerId])
    equal(fixture.timers[timerId].seconds, 0)
    fixture:tick(timerId)
    equal(fixture:lastCommand().command, expected)
    finishInitializationCapture(expected)
  end
  equal(fixture.scraper.state.metadata.initializationPending, false)
end

describe("scraper polling scheduler", function()
  it("logs current local-jump timing without storing calibration history", function()
    fixture.scraper.state.observer.name = "TeeHee1"
    fixture.scraper.state.observer.x = 0
    fixture.scraper.state.observer.y = 0
    fixture.scraper.state.observer.z = 0
    fixture.scraper.state.observer.hyperspeed = 70
    fixture.epochMs = 1000

    assert(fixture.intentHandlers.plot_hyperspace({
      mode = "local",
      scope = "local",
      destination = { x = 100, y = 200, z = 300 },
      predictionModel = "provisional-v1",
      estimatedTravelSeconds = 15,
    }, { id = "sample-plot" }))

    fixture.epochMs = 1200
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "navstat",
        [[
Readout for Imperial-II Class Star Destroyer 'TeeHee1':
Current Coordinates: 0 0 0
Jump Distance: 1.5 parsecs
Jump Time: 8s
]]
      )),
      "navstat"
    ))

    fixture.epochMs = 1600
    assert(
      fixture.scraper.handleHyperspaceLine("[Status]: Hyperspace calculations have been completed.")
    )
    fixture.epochMs = 2000
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    fixture.epochMs = 2500
    assert(
      fixture.scraper.handleHyperspaceLine("Destination reached. Initiating realspace reentry...")
    )
    fixture.epochMs = 8500
    assert(fixture.scraper.handleHyperspaceLine("Hyperjump complete."))
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The ship lurches slightly as it comes out of hyperspace."
      )
    )
    fixture.epochMs = 8600
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 101 200 300")
    assert(fixture.scraper.finishCapture("prompt"))

    local output = table.concat(fixture.output, "\n")
    for _, entry in ipairs(fixture.output) do
      equal(entry:sub(1, 1), "\n", "Holocron output must start on a new line")
      equal(entry:sub(-1), "\n", "Holocron output must terminate its line")
    end
    assert(output:find("[Holocron3D][HyperspaceSample]", 1, true))
    assert(output:find("event=destination_reached", 1, true))
    assert(output:find("event=navigation_report", 1, true))
    assert(output:find("reported_parsecs=1.5", 1, true))
    assert(output:find("reported_seconds=8", 1, true))
    assert(output:find("transit_ms=500", 1, true))
    assert(output:find("reentry_ms=6000", 1, true))
    assert(output:find("event=arrival_fix", 1, true))
    assert(output:find("arrival_error_units=1", 1, true))
  end)

  it("runs an immediate state-discovery sweep when Holocron boots", function()
    fixture:close()
    fixture = Fixture.new({ polling = true })
    expectImmediateInitializationSweep()
  end)

  it("runs an immediate state-discovery sweep after planetary launch", function()
    fixture.scraper.setInSpace(false, "landed fixture")
    beginPolling()
    assert(
      fixture:trigger(
        "The ship leaves the platform far behind as it flies into space",
        "The ship leaves the platform far behind as it flies into space"
      )
    )
    expectImmediateInitializationSweep()
  end)

  it("immediately refreshes radar and fleet radar when a ship exits hyperspace", function()
    beginPolling()
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )
    equal(fixture.scraper.state.metadata.lastSectorArrival.shipName, "TeeHee3")
    equal(fixture.scraper.getPollingState().radarRefreshPending, true)

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Victory-II Class Star Destroyer 'TeeHee3' 6145 500 -661")
    fixture.scraper.captureLine("Your Coordinates: 0 0 0")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    equal(fixture.scraper.getPollingState().fleetRadarRefreshPending, true)

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "fleetradar")
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Victory-II Class Star Destroyer 'TeeHee3' | | (Out) 6145 500 -661")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.scraper.getPollingState().fleetRadarRefreshPending, false)
  end)

  it("rejects sector-arrival announcements with an invalid ship callsign", function()
    beginPolling()
    equal(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'Bad Name' enters the starsystem, coming out of its hyperjump at 6145"
      ),
      false
    )
    equal(fixture.scraper.state.metadata.lastSectorArrival, nil)
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
  end)

  it("bypasses automatic command cooldowns for the hyperspace exit refresh", function()
    beginPolling()
    fixture.scraper.polling.lastAutomaticCommandAt.radar = os.time()
    fixture.scraper.polling.lastAutomaticCommandAt.fleetradar = os.time()
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 0 0 0")
    assert(fixture.scraper.finishCapture("prompt"))

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "fleetradar")
  end)

  it("waits for the realspace lurch before refreshing the observer", function()
    beginPolling()
    fixture.scraper.hyperspace.phase = "reentry"
    assert(fixture.scraper.handleHyperspaceLine("Hyperjump complete."))
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    assert(fixture.scraper.handleReentrySystemLine("Corellian System"))
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    equal(fixture.scraper.getPollingState().fleetRadarRefreshPending, false)

    assert(
      fixture.scraper.handleHyperspaceLine(
        "The ship lurches slightly as it comes out of hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    equal(fixture.scraper.getPollingState().radarRefreshPending, true)
    equal(fixture.scraper.getPollingState().fleetRadarRefreshPending, true)

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")
    equal(fixture.scraper.active.sensorTickSource, "realspace")
  end)

  it("suspends automatic telemetry until the observer finishes reentry", function()
    local pendingTimer = beginPolling()
    fixture.scraper.hyperspace.pendingLocalJumpUntil = os.time() + 30

    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "hyperspace")
    equal(fixture.scraper.getPollingState().timerId, nil)
    equal(fixture.timers[pendingTimer], nil)

    local commandCount = #fixture.commands
    local refreshed, refreshError = fixture.intentHandlers.refresh_local_hyperspace_radar(
      {},
      { id = "transit-radar" }
    )
    equal(refreshed, false)
    assert(refreshError:find("hyperspace transit", 1, true))
    equal(#fixture.commands, commandCount)

    assert(
      fixture.scraper.handleHyperspaceLine("Destination reached. Initiating realspace reentry...")
    )
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    equal(fixture.scraper.getPollingState().timerId, nil)
    equal(#fixture.commands, commandCount)

    assert(fixture.scraper.handleHyperspaceLine("Hyperjump complete."))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    assert(fixture.scraper.handleReentrySystemLine("Corellian System"))
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The ship lurches slightly as it comes out of hyperspace."
      )
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 1200 -50 800")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "arrived")
  end)

  it("accepts a successful full radar as arrival confirmation if the lurch was missed", function()
    beginPolling()
    fixture.scraper.hyperspace.phase = "reentry"
    assert(fixture.scraper.handleHyperspaceLine("Hyperjump complete."))
    equal(fixture.scraper.getPollingState().radarRefreshPending, false)
    equal(fixture.scraper.hyperspace.reentryRefreshTimerId, nil)

    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
Your Coordinates: 1200 -50 800
]]
      )),
      "radar"
    ))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "arrived")
    equal(fixture.scraper.state.metadata.hyperspace.arrivalConfirmedBy, "fresh radar")
  end)

  it("does not let a radar started before the arrival satisfy the refresh", function()
    beginPolling()
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true, pollDelay = 0.1 }))
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 0 0 0")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.scraper.getPollingState().radarRefreshPending, true)
  end)

  it("does not end reentry with a radar capture started before the realspace lurch", function()
    beginPolling()
    fixture.scraper.hyperspace.phase = "reentry"
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true, pollDelay = 0.1 }))

    assert(
      fixture.scraper.handleHyperspaceLine(
        "The ship lurches slightly as it comes out of hyperspace."
      )
    )
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 0 0 0")
    assert(fixture.scraper.finishCapture("prompt"))

    equal(fixture.scraper.state.metadata.hyperspace.phase, "reentry")
    equal(fixture.scraper.getPollingState().radarRefreshPending, true)
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 1200 -50 800")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.scraper.state.metadata.hyperspace.phase, "arrived")
  end)

  it("hydrates a newly discovered in-range ship before routine formation polls", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    local timer = beginPolling()
    fixture:tick(timer)
    equal(fixture:lastCommand().command, "status Wayfarer")
    assert(fixture.scraper.active and fixture.scraper.active.parserCommand == "status")
  end)

  it("requests both status and info during first-contact hydration", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    fixture:tick(beginPolling())
    fixture.scraper.captureLine("Readout for YT-1300 'Wayfarer':")
    fixture.scraper.captureLine("Hull: 90/100 Shields: 40/50")
    assert(fixture.scraper.finishCapture("prompt"))
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "info Wayfarer")
  end)

  it("throttles periodic hostile scans until explicitly overdue", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "status",
        [[
Readout for YT-1300 'Wayfarer':
Hull: 90/100 Shields: 40/50
]]
      )),
      "status Wayfarer"
    ))
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "info",
        [[
[Class: Transport] : YT-1300 'Wayfarer'
Sensor Array: 1
]]
      )),
      "info Wayfarer"
    ))
    assert(fixture.scraper.setDisposition("Wayfarer", "enemy"))
    local timer = beginPolling({ hostileScanIntervalSeconds = 3 })
    fixture.scraper.polling.lastBattlegroupAt = os.time()
    fixture.scraper.polling.lastSquadronAt = os.time()
    fixture.scraper.polling.lastFleetRadarAt = os.time()
    fixture.scraper.polling.scansSinceCore = 0
    fixture.scraper.scanState.wayfarer = { statusAt = os.time() - 3, infoAt = os.time() }
    fixture:tick(timer)
    equal(fixture:lastCommand().command, "status Wayfarer")
  end)

  it("does not issue deprecated proximity commands", function()
    local timer = beginPolling()
    fixture.scraper.polling.lastBattlegroupAt = os.time()
    fixture.scraper.polling.lastSquadronAt = os.time()
    fixture.scraper.polling.lastFleetRadarAt = os.time()
    fixture.scraper.combat.lastRadarAt = os.time()
    for _ = 1, 5 do
      fixture:tick(timer)
      local command = fixture:lastCommand() and fixture:lastCommand().command or ""
      assert(command ~= "prox" and command ~= "proximity" and command ~= "proximity speed")
      if fixture.scraper.active then
        fixture.scraper.finishCapture("fixture")
      end
      timer = fixture.scraper.getPollingState().timerId
    end
  end)

  it("does not send the same automatic command twice within three seconds", function()
    local timer = beginPolling({ combatRadarIntervalSeconds = 1 })
    fixture.scraper.combat.lastActivityAt = os.time()
    fixture.scraper.combat.lastRadarAt = 0
    fixture:tick(timer)
    equal(fixture:lastCommand().command, "radar projectiles")
    local commandCount = #fixture.commands
    fixture.scraper.finishCapture("fixture")
    fixture.scraper.combat.lastRadarAt = 0
    timer = fixture.scraper.getPollingState().timerId
    fixture:tick(timer)
    equal(#fixture.commands, commandCount)
    local state = fixture.scraper.getPollingState()
    equal(state.combatRadarIntervalSeconds, 3)
  end)

  it("releases a pending sensor scrape on the next Ship.Info game tick", function()
    beginPolling()
    emitShipGmcp(10)
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(#fixture.commands, 0)
    local waiting = fixture.scraper.getPollingState()
    equal(waiting.sensorPollPending, true)
    equal(waiting.sensorPollPendingCommand, "radar")
    equal(fixture.timers[waiting.sensorTickTimerId].seconds, 4)

    emitShipGmcp(11)
    local released = fixture.scraper.getPollingState()
    equal(released.sensorTickGranted, true)
    equal(fixture.timers[waiting.sensorTickTimerId], nil)
    local releaseTimer = released.timerId
    emitShipGmcp(12)
    equal(fixture.scraper.getPollingState().timerId, releaseTimer)

    fixture:tick(releaseTimer)
    equal(fixture:lastCommand().command, "radar")
    equal(fixture.scraper.active.sensorTickSource, "gmcp")
    equal(fixture.scraper.getPollingState().lastSensorTickSource, "gmcp")
  end)

  it("uses a synthetic sensor tick when Ship.Info does not return within four seconds", function()
    beginPolling()
    emitShipGmcp(10)
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    local watchdog = fixture.scraper.getPollingState().sensorTickTimerId
    assert(watchdog and fixture.timers[watchdog])
    equal(fixture.timers[watchdog].seconds, 4)

    fixture:tick(watchdog)
    local fallbackTimer = fixture.scraper.getPollingState().timerId
    equal(fixture.timers[fallbackTimer].seconds, 0)
    fixture:tick(fallbackTimer)
    equal(fixture:lastCommand().command, "radar")
    equal(fixture.scraper.active.sensorTickSource, "fallback")
    equal(fixture.scraper.getPollingState().sensorTickFallbackCount, 1)
  end)

  it("runs an arrival fleet-radar scrape on the following Ship.Info tick", function()
    beginPolling()
    emitShipGmcp(10)
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    emitShipGmcp(11)
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 11 0 0")
    assert(fixture.scraper.finishCapture("prompt"))

    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(#fixture.commands, 1)
    equal(fixture.scraper.getPollingState().sensorPollPendingCommand, "fleetradar")
    emitShipGmcp(12)
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "fleetradar")
    equal(fixture.scraper.active.sensorTickSource, "gmcp")
  end)

  it("does not let a synchronized radar overwrite a newer Ship.Info observer fix", function()
    beginPolling()
    emitShipGmcp(10)
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    emitShipGmcp(11)
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar")

    emitShipGmcp(20)
    fixture.scraper.captureLine("Corellian System")
    fixture.scraper.captureLine("Your Coordinates: 5 0 0")
    assert(fixture.scraper.finishCapture("prompt"))
    equal(fixture.scraper.state.observer.x, 20)
    equal(fixture.scraper.state.metadata.lastSensorCapture.preservedNewerGmcpObserver, true)
  end)

  it("synchronizes projectile reconciliation with Ship.Info", function()
    beginPolling()
    emitShipGmcp(10)
    assert(fixture.scraper.handleProjectileSummary("1 projectile, 1 incoming"))
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(#fixture.commands, 0)
    equal(fixture.scraper.getPollingState().sensorPollPendingCommand, "radar projectiles")

    emitShipGmcp(11)
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar projectiles")
    equal(fixture.scraper.active.sensorTickSource, "gmcp")
  end)

  it("discards a queued sensor tick when the observer enters hyperspace", function()
    beginPolling()
    emitShipGmcp(10)
    assert(
      fixture.scraper.handleSectorArrival(
        "Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at 6145"
      )
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    local waiting = fixture.scraper.getPollingState()
    assert(waiting.sensorTickTimerId and fixture.timers[waiting.sensorTickTimerId])

    fixture.scraper.hyperspace.pendingLocalJumpUntil = os.time() + 30
    assert(
      fixture.scraper.handleHyperspaceLine(
        "The stars become streaks of light as you enter hyperspace."
      )
    )
    equal(fixture.scraper.getPollingState().sensorPollPending, false)
    equal(fixture.scraper.getPollingState().sensorTickTimerId, nil)
    equal(fixture.timers[waiting.sensorTickTimerId], nil)
  end)

  it("manual Mudlet input preempts a background capture and debounces polling", function()
    beginPolling()
    assert(fixture.scraper.startCapture("radar", "radar", { polled = true }))
    fixture.scraper.captureLine("YT-1300 'Incomplete' 1 2 3")
    fixture.scraper.handleOutgoingCommand("sysDataSendRequest", "ooc hello")
    equal(fixture.scraper.active, nil)
    local timer = fixture.scraper.getPollingState().timerId
    assert(timer and fixture.timers[timer])
    equal(fixture.timers[timer].seconds, fixture.scraper.USER_IDLE_POLL_DELAY_SECONDS)
  end)

  it("pauses every automatic command source and resumes on demand", function()
    local timer = beginPolling()
    assert(fixture.timers[timer])

    local paused, pauseError = fixture.intentHandlers.set_polling_paused({ paused = true })
    assert(paused, pauseError)
    local pausedState = fixture.scraper.getPollingState()
    equal(pausedState.enabled, true)
    equal(pausedState.paused, true)
    equal(pausedState.active, false)
    equal(pausedState.timerId, nil)
    equal(fixture.timers[timer], nil)
    equal(fixture:lastSnapshot().metadata.polling.paused, true)

    fixture.scraper.handleProjectileSummary("1 projectile, 1 incoming")
    equal(#fixture.commands, 0)

    local resumed, resumeError = fixture.intentHandlers.set_polling_paused({ paused = false })
    assert(resumed, resumeError)
    local resumedState = fixture.scraper.getPollingState()
    equal(resumedState.paused, false)
    equal(resumedState.active, true)
    assert(resumedState.timerId and fixture.timers[resumedState.timerId])
    fixture:tick(resumedState.timerId)
    assert(#fixture.commands > 0)
  end)

  it("stops completely and cancels its active timer", function()
    local timer = beginPolling()
    assert(fixture.timers[timer])
    assert(fixture.scraper.stopPolling())
    equal(fixture.scraper.getPollingState().enabled, false)
    equal(fixture.timers[timer], nil)
  end)
end)
