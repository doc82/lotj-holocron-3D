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
Hull: 150/150 Shields: 100/150 Energy(fuel): 5000/5000
]]
    )),
    "status"
  ))
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

describe("scraper authoritative telemetry", function()
  it("applies GMCP ship readings without treating piloting as space state", function()
    _G.gmcp = {
      Ship = {
        Info = {
          energy = 2773,
          maxEnergy = 4500,
          hull = 115,
          maxHull = 115,
          shield = 60,
          maxShield = 60,
          speed = 50,
          maxSpeed = 170,
          posX = 101,
          posY = -22,
          posZ = 303,
          headX = 1,
          headY = 0,
          headZ = -1,
          piloting = false,
        },
      },
    }
    assert(fixture.scraper.handleShipGmcp())
    local observer = fixture:lastSnapshot().observer
    equal(observer.speed.current, 50)
    equal(observer.speed.maximum, 170)
    equal(observer.x, 101)
    equal(observer.heading.z, -1)
    equal(observer.piloting, false)
    equal(fixture.scraper.state.metadata.inSpace, true)
  end)

  it("preserves a useful heading when GMCP reports an ambiguous zero vector", function()
    _G.gmcp = { Ship = { Info = { headX = 1, headY = 0, headZ = -1 } } }
    assert(fixture.scraper.handleShipGmcp())
    _G.gmcp.Ship.Info = { headX = 0, headY = 0, headZ = 0 }
    assert(fixture.scraper.handleShipGmcp())
    equal(fixture:lastSnapshot().observer.heading.x, 1)
  end)

  it("rejects a manual scan cleanly when LotJ reports range failure", function()
    local ok, failure = fixture.intentHandlers.scan_ship({
      targetId = "wayfarer",
      source = "status",
    }, { id = "scan" })
    assert(ok, failure)
    fixture.scraper.captureLine("That target is too far away to scan.")
    local result, scanFailure = fixture.scraper.finishCapture("prompt")
    equal(result, nil)
    assert(scanFailure:find("outside sensor range", 1, true))
    equal(fixture.intentAcks[#fixture.intentAcks].status, "rejected")
  end)

  it("opens local status and info cards with unqualified commands", function()
    local ok, failure = fixture.intentHandlers.scan_ship({
      targetId = "player-ship",
      targetName = "Forrestal",
      source = "status",
    }, { id = "local-status" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "status")
  end)

  it("turns navigation-computer output into one intent rejection", function()
    local diagnosticCount = #fixture.diagnostics
    local ok, failure = fixture.intentHandlers.refresh_navigation(
      { command = "calc" },
      { id = "nav" }
    )
    assert(ok, failure)
    equal(fixture:lastCommand().command, "calc")
    fixture.scraper.captureLine("You must be at a nav computer to calculate jumps.")
    local result, navFailure = fixture.scraper.finishCapture("prompt")
    equal(result, nil)
    assert(navFailure:find("navigation computer", 1, true))
    equal(#fixture.diagnostics, diagnosticCount)
    equal(fixture.intentAcks[#fixture.intentAcks].status, "rejected")
  end)

  it("retries an autotrack toggle until the requested state is confirmed", function()
    local ok, failure = fixture.intentHandlers.set_autotrack({ enabled = false }, { id = "track" })
    assert(ok, failure)
    equal(fixture:lastCommand().command, "autotrack")
    assert(fixture.scraper.handleAutotrackResponse("Autotracking on."))
    equal(fixture:lastCommand().command, "autotrack")
    equal(fixture.scraper.handleAutotrackResponse("Autotracking off."), false)
    equal(fixture:lastSnapshot().observer.autotrack, false)
    equal(fixture.intentAcks[#fixture.intentAcks].status, "completed")
  end)

  it("consolidates ship damage into a delayed shield status check", function()
    assert(
      fixture.scraper.handleShipHit(
        "You are hit by lasers from Assassin-Class Corvette 'Calculated'!",
        false
      )
    )
    local timerId = fixture.scraper.shields.damageTimerId
    assert(timerId and fixture.timers[timerId])
    fixture:tick(timerId)
    equal(fixture:lastCommand().command, "status")
    assert(fixture.scraper.shields.statusPending)
  end)

  it("profiles captures, lines, snapshots, and GMCP events per fixture", function()
    assert(fixture.scraper.startProfiler())
    assert(fixture:capture(
      "info",
      [[
[Class: Transport] : Rojan-class Patrol Craft 'Forrestal'
Sensor Array: 7
]]
    ))
    _G.gmcp = { Ship = { Info = { speed = 20, maxSpeed = 200 } } }
    assert(fixture.scraper.handleShipGmcp())
    local report = fixture.scraper.getProfilerReport()
    assert((report.counts.capturesStarted or 0) > 0)
    assert((report.counts.capturedLines or 0) > 0)
    assert((report.counts.snapshotPublishes or 0) > 0)
    equal(report.counts.shipGmcpEvents, 1)
    equal(fixture.scraper.stopProfiler().enabled, false)
  end)
end)
