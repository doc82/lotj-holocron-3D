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
  it("retains aboard through cockpit exit and recognizes revisited interiors", function()
    local function room(vnum, planet)
      _G.gmcp.Room = { Info = { vnum = vnum, planet = planet } }
      fixture.scraper.handleRoomGmcp()
    end
    room(70086)
    _G.gmcp.Ship = {
      Info = {
        piloting = false,
        hull = 120,
        maxHull = 120,
        energy = 6300,
        maxEnergy = 6300,
        shield = 100,
        maxShield = 100,
        maxSpeed = 80,
      },
    }
    fixture.scraper.handleShipGmcp()
    equal(fixture.scraper.state.metadata.shipAccess.aboard, true)
    room(70081)
    _G.gmcp.Ship.Info = {}
    fixture.scraper.handleShipGmcp()
    equal(fixture.scraper.state.metadata.shipAccess.aboard, true)
    equal(fixture.scraper.state.metadata.shipAccess.telemetryPresent, false)
    room(70080)
    equal(fixture.scraper.state.metadata.shipAccess.aboard, true)
    room(170001, "Nal Hutta")
    equal(fixture.scraper.state.metadata.shipAccess.aboard, false)
    room(70080)
    equal(fixture.scraper.state.metadata.shipAccess.aboard, true)
    room(170001, "Nal Hutta")
    room(71275)
    equal(fixture.scraper.state.metadata.shipAccess.aboard, nil)
    fixture.scraper.handleGmcpDisconnect()
    room(70080)
    equal(fixture.scraper.state.metadata.shipAccess.aboard, nil)
  end)

  it("clears missing spatial fields without inferring landed or hyperspace phase", function()
    for _, inSpace in ipairs({ true, false }) do
      fixture.scraper.setInSpace(inSpace, "fixture")
      _G.gmcp.Ship = {
        Info = {
          speed = 80,
          maxSpeed = 80,
          posX = 100,
          posY = 20,
          posZ = 30,
          energy = 6300,
          maxEnergy = 6300,
          hull = 120,
          maxHull = 120,
          shield = 100,
          maxShield = 100,
        },
      }
      fixture.scraper.handleShipGmcp()
      equal(fixture.scraper.state.metadata.shipSpatialAvailable, true)
      assert(fixture.scraper.startCapture("radar", "radar", { polled = true, allowLanded = true }))
      _G.gmcp.Ship.Info = {
        piloting = true,
        maxSpeed = 80,
        energy = 6200,
        maxEnergy = 6300,
        hull = 120,
        maxHull = 120,
        shield = 100,
        maxShield = 100,
      }
      fixture.scraper.handleShipGmcp()
      equal(fixture.scraper.state.metadata.shipSpatialAvailable, false)
      equal(fixture.scraper.active, nil)
      equal(fixture.scraper.state.observer.x, nil)
      equal(fixture.scraper.state.observer.speed.current, nil)
      equal(fixture.scraper.state.observer.energy.current, 6200)
      equal(fixture.scraper.state.metadata.inSpace, inSpace)
    end
  end)
  it(
    "normalizes piloting representations without confusing released controls with outside",
    function()
      for _, value in ipairs({ true, 1, "1", "true", false, 0, "0", "false" }) do
        _G.gmcp = { Ship = { Info = { piloting = value } } }
        assert(fixture.scraper.handleShipGmcp())
        local expected = value == true or value == 1 or value == "1" or value == "true"
        equal(fixture.scraper.state.observer.piloting, expected)
        equal(fixture.scraper.state.metadata.shipAccess.piloting, expected)
        equal(fixture.scraper.state.metadata.shipAccess.aboard, true)
        equal(fixture.scraper.state.metadata.inSpace, true)
        equal(fixture.scraper.state.metadata.shipGmcpHealthy, false)
      end
    end
  )

  it("does not let partial packets refresh vital health or retain control confirmation", function()
    _G.gmcp = {
      Ship = {
        Info = {
          speed = 0,
          maxSpeed = 100,
          energy = 10,
          maxEnergy = 20,
          hull = 10,
          maxHull = 20,
          shield = 0,
          maxShield = 20,
          posX = 0,
          posY = 0,
          posZ = 0,
          piloting = true,
        },
      },
    }
    fixture.scraper.handleShipGmcp()
    equal(fixture.scraper.state.metadata.shipGmcpHealthy, true)
    fixture.scraper.shipGmcp.statusAt = os.time() - 61
    _G.gmcp.Ship.Info = { headX = 1, headY = 0, headZ = 0 }
    fixture.scraper.handleShipGmcp()
    equal(fixture.scraper.state.metadata.shipGmcpHealthy, false)
    equal(fixture.scraper.state.metadata.shipAccess.piloting, nil)
  end)

  it("requires room evidence after empty ship telemetry before classifying outside", function()
    _G.gmcp = { Ship = { Info = { piloting = true, posX = 10 } } }
    fixture.scraper.handleShipGmcp()
    _G.gmcp.Ship.Info = {}
    fixture.scraper.handleShipGmcp()
    equal(fixture.scraper.state.observer.x, nil)
    equal(fixture.scraper.state.observer.piloting, nil)
    equal(fixture.scraper.state.metadata.shipAccess.aboard, nil)
    equal(fixture.scraper.state.metadata.inSpace, true)
    _G.gmcp.Room = { Info = { vnum = 42, name = "Cabin" } }
    fixture.scraper.handleRoomGmcp()
    equal(fixture.scraper.state.metadata.shipAccess.aboard, nil)
    _G.gmcp.Room.Info = { vnum = 43, name = "Landing pad", planet = "Corellia" }
    fixture.scraper.handleRoomGmcp()
    equal(fixture.scraper.state.metadata.shipAccess.aboard, false)
    equal(fixture.scraper.state.metadata.inSpace, false)
    local count = #fixture.commands
    local ok = fixture.intentHandlers.probe_space({}, { id = "probe" })
    equal(ok, false)
    equal(#fixture.commands, count)
  end)

  it("invalidates room control evidence and clears location on disconnect", function()
    _G.gmcp = { Ship = { Info = { piloting = true } }, Room = { Info = { vnum = 42 } } }
    fixture.scraper.handleShipGmcp()
    fixture.scraper.handleRoomGmcp()
    equal(fixture.scraper.state.metadata.shipAccess.piloting, nil)
    fixture.scraper.handleGmcpDisconnect()
    equal(fixture.scraper.state.metadata.room, nil)
    equal(fixture.scraper.state.metadata.inSpace, nil)
    equal(fixture.scraper.shipGmcp.statusAt, 0)
  end)

  it("bounds opt-in GMCP traces and stops collecting when requested", function()
    local trace = fixture.scraper.startGmcpTrace()
    _G.gmcp = { Ship = { Info = { speed = 0 } } }
    for _ = 1, 305 do
      fixture.scraper.handleShipGmcp()
    end
    equal(#trace, 300)
    equal(fixture.scraper.stopGmcpTrace(), trace)
    fixture.scraper.handleShipGmcp()
    equal(#trace, 300)
  end)

  it("publishes every live GMCP galactic position update", function()
    _G.gmcp = {
      Galaxy = { Systems = { Corellian = { x = 10, y = 20 } } },
      Ship = { System = { name = "Corellian", x = 10, y = 20 } },
    }
    assert(fixture.scraper.publishGalaxyCatalog())
    local first = fixture.messages[#fixture.messages]
    equal(first.type, "galaxy_catalog")
    equal(first.shipSystem.x, 10)
    equal(first.shipSystem.y, 20)

    _G.gmcp.Ship.System = { name = "Hyperspace", x = 14, y = 23 }
    assert(fixture.scraper.publishGalaxyCatalog())
    local moved = fixture.messages[#fixture.messages]
    equal(moved.shipSystem.x, 14)
    equal(moved.shipSystem.y, 23)
  end)

  it("reads personal discoveries from the current registry without changing it", function()
    local recorded = { ["Fictional Discovery"] = { x = 17, y = 29 } }
    _G.lotj.galaxyMap = { recorded = recorded }
    _G.gmcp = { Galaxy = { Systems = { ["Test Public System"] = { x = 3, y = 4 } } } }

    assert(fixture.scraper.publishGalaxyCatalog())
    local first = fixture.messages[#fixture.messages]
    equal(first.customSystems["Fictional Discovery"].x, 17)
    equal(first.systems["Fictional Discovery"], nil)
    first.customSystems["Fictional Discovery"].x = 99
    equal(recorded["Fictional Discovery"].x, 17)

    recorded["Later Test Discovery"] = { x = 31, y = 42 }
    assert(fixture.scraper.publishGalaxyCatalog())
    equal(fixture.messages[#fixture.messages].customSystems["Later Test Discovery"].x, 31)

    _G.lotj.galaxyMap.recorded = {}
    assert(fixture.scraper.publishGalaxyCatalog())
    equal(next(fixture.messages[#fixture.messages].customSystems), nil)
  end)

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

  it("respects autotrack changes made directly in Mudlet", function()
    local commandCount = #fixture.commands
    equal(fixture.scraper.handleAutotrackResponse("Autotracking on."), true)
    equal(#fixture.commands, commandCount)
    equal(fixture:lastSnapshot().observer.autotrack, true)
    equal(fixture:lastSnapshot().metadata.autotrackDesired, true)
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
