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
  it("registers protocol listeners and intent handlers in a fresh fixture", function()
    equal(#fixture.scraper.eventHandlerIds, 5)
    equal(#fixture.scraper.stateTriggerIds, 24)
    equal(fixture.gmcpRequests[1].command, "Core.Supports.Add")
    assert(type(fixture.intentHandlers.scan_ship) == "function")
    assert(type(fixture.intentHandlers.navigate_ship) == "function")
  end)

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
Bala Trix Nebula
Black Market Station 'Rust Ring' 0 0 0
Z-95 Headhunter 'Anger Flight Lead' (Ctr) 1 37 -1
]]
    ))

    local station = assert(fixture:entity("Rust Ring"))
    equal(station.class, "Black Market Station")
    equal(station.kind, "ship")
    equal(station.shipCategory, "battlestation")
    equal(fixture:entity("Anger Flight Lead").position, "Ctr")
    equal(fixture.scraper.state.metadata.system, "Bala Trix Nebula")
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
