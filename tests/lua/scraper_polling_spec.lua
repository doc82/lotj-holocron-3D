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

describe("scraper polling scheduler", function()
  it("prioritizes a full radar refresh when a ship exits hyperspace into the sector", function()
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
