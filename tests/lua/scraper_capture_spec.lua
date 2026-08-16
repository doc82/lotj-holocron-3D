local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function() fixture = Fixture.new() end)
h.after_each(function() fixture:close() end)

describe("scraper capture lifecycle", function()
  it("registers protocol listeners and intent handlers in a fresh fixture", function()
    equal(#fixture.scraper.eventHandlerIds, 5)
    equal(#fixture.scraper.stateTriggerIds, 21)
    equal(fixture.gmcpRequests[1].command, "Core.Supports.Add")
    assert(type(fixture.intentHandlers.scan_ship) == "function")
    assert(type(fixture.intentHandlers.navigate_ship) == "function")
  end)

  it("applies observer status without depending on snapshot indexes", function()
    assert(fixture:capture("status", [[
Forrestal:
Current Coordinates: 10 20 -5
Current Speed: 120/300
Hull: 140/150  Ship Condition: Running
Shields: 100/150 Energy(fuel): 3916/5000
]]))
    local snapshot = fixture:lastSnapshot()
    equal(snapshot.observer.name, "Forrestal")
    equal(snapshot.observer.x, 10)
    equal(snapshot.observer.speed.maximum, 300)
    equal(snapshot.observer.hull.current, 140)
  end)

  it("merges info telemetry and excludes access codes", function()
    assert(fixture:capture("info", [[
[Class: Transport] : Rojan-class Patrol Craft 'Forrestal'
Hatchway: 94599 Hangar Bays: 47894 Docking: 62351
Maximum Speed: 200 Sensor Array: 7
]]))
    local observer = fixture:lastSnapshot().observer
    equal(observer.sensorArray, 7)
    equal(observer.radarRange, 570)
    equal(observer.hatchway, nil)
    local redacted = false
    for _, value in ipairs(fixture.scraper.lastCapture.lines) do
      if value:find("redacted", 1, true) then redacted = true end
    end
    assert(redacted, "captured access codes should be redacted")
  end)

  it("merges fleet radar contacts without duplicating the observer", function()
    assert(fixture:capture("status", [[
Forrestal:
Current Coordinates: 10 20 -5
Current Speed: 0/200
]]))
    assert(fixture:capture("fleetradar", [[
Corellian System
Rojan-class Patrol Craft 'Forrestal' |  | (Ctr) 10 20 -5
YT-1300 'Wayfarer' |  | (Out) 200 30 40
]]))
    equal(fixture.scraper.state.metadata.system, "Corellian System")
    assert(fixture:entity("Wayfarer"))
    equal(fixture:entity("Forrestal"), nil)
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
    assert(fixture.scraper.startCapture("radar", "radar", {polled = true}))
    local before = fixture.deletedLines
    fixture.scraper.captureLine("Corellian System")
    equal(fixture.scraper.captureLine("(OOC) @Bando: hello"), false)
    fixture.scraper.captureLine("YT-1300 'Wayfarer' 200 30 40")
    fixture.scraper.captureLine("Your Coordinates: 10 20 -5")
    assert(fixture.scraper.finishCapture("prompt"))
    assert(fixture.deletedLines > before)
  end)

  it("landing abandons captures and clears stale contacts", function()
    assert(fixture:capture("radar", [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 10 20 -5
]]))
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
end)
