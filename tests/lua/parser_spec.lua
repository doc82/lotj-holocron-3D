local h = require("harness")
local parsers = require("lotj_holocron_parsers")
local describe, it, equal = h.describe, h.it, h.equal

describe("telemetry parsers", function()
  it("parses radar contacts and observer coordinates", function()
    local result = assert(parsers.parseRadar([[
Corellian System
Planet 'Corellia'    5,000 -200 30
YT-1300 'Wayfarer'  800 -250 40
Your Coordinates:   10 20 -5
]]))
    equal(result.system, "Corellian System")
    equal(#result.entities, 2)
    equal(result.entities[1].kind, "planet")
    equal(result.entities[2].name, "Wayfarer")
    equal(result.entities[2].class, "YT-1300")
    equal(result.observer.z, -5)
  end)

  it("ignores chat while finding a radar system heading", function()
    local result = assert(parsers.parseRadar([[
(OOC) @Bando: My apologies.
[Red Team]{The Grand Council}: are you en route?
CommNet 0 [Malakilli]: Testing
Esstran Sector
Victory-II Class Star Destroyer 'Gore'  0 0 0
Your Coordinates: 12 22 -3
]]))
    equal(result.system, "Esstran Sector")
    equal(result.entities[1].name, "Gore")
  end)

  it("classifies projectile radar contacts", function()
    local result = assert(parsers.parse("radar projectiles", [[
Esstran Sector
Mark-I Assault Frigate 'MK1AF19' -369 -34 -120
A Concussion Missile -240 -34 -120
Your Coordinates: 0 0 0
]]))
    equal(result.entities[2].name, "A Concussion Missile")
    equal(result.entities[2].kind, "projectile")
  end)

  it("parses proximity and velocity responses", function()
    local prox = assert(parsers.parseProx([[
Proximity scan
Corellia Prox: 1,250 units
YT-1300 'Wayfarer' Prox: 375
Your Coordinates: 10 20 -5
]]))
    equal(#prox.entities, 2)
    equal(prox.entities[1].distance, 1250)
    equal(prox.entities[2].class, "YT-1300")
    local velocity = assert(parsers.parse("proximity speed", [[
YT-1300 'Wayfarer' Velocity: -120
Corellia Velocity: 0
Your Coordinates: 11 21 -4
]]))
    equal(velocity.entities[1].speed, -120)
    equal(velocity.observer.y, 21)
  end)

  it("parses local and remote ship status", function()
    local localStatus = assert(parsers.parseStatus([[
Wayfarer:
Current Coordinates: 10 -20 30
Current Heading: 1 0 -1
Current Speed: 120/300
Hull: 900/1000  Ship Condition: Good
Shields: 400/500   Energy(fuel): 2000/2500
Missiles: 3/6  Torpedos: 1/2  Rockets: 0/4
]]))
    equal(localStatus.coordinates.y, -20)
    equal(localStatus.speed.maximum, 300)
    equal(localStatus.torpedoes.current, 1)
    local remote = assert(parsers.parseStatus([[
Readout for Victory-II Class Star Destroyer 'Gore':
Lifeforms detected: Need 50 sensors to scan for lifeforms.
Hull: 4200/4200  Ship Condition: Running
Primary Target: none
Autopilot Status: Offline
]]))
    equal(remote.name, "Gore")
    equal(remote.lifeformScan.available, false)
    equal(remote.lifeformScan.requiredSensors, 50)
    equal(remote.autopilot, false)
  end)

  it("parses safe info telemetry without access codes", function()
    local result = assert(parsers.parseInfo([[
[Class: Transport] : Rojan-class Patrol Craft 'Forrestal'
Autoblasters: 0  Laser cannons: 0  Turbolasers: 0
Ion cannons: 0  Maximum Missiles: 0  Maximum Torpedoes: 0
Maximum Rockets: 0  Maximum Pulses: 0  Missile Tubes: 0
Hatchway: 94599  Hangar Bays: 47894  Docking: 62351
Maximum Speed: 200  Sensor Array: 7
]]))
    equal(result.sensorArray, 7)
    equal(result.radarRange, 570)
    equal(result.hasWeapons, false)
    equal(result.hatchway, nil)
    equal(result.name, "Forrestal")
  end)

  it("parses tabular, piped, and grouped fleet radar", function()
    local tabular = assert(parsers.parseFleetRadar([[
Ship                     Squadron Leader          Position
Wayfarer                 Resolute                 Screen
Bandit                   None                     Independent
]]))
    equal(tabular.entities[1].leader, "Resolute")
    local piped = assert(parsers.parseFleetRadar([[
Esstran Sector
Imperial-II Class Star Destroyer 'Pollution' |  | (Ctr) -51 62 32
Victory-II Class Star Destroyer 'Gore' |  | (Out) 0 0 0
]]))
    equal(piped.entities[1].name, "Pollution")
    equal(piped.entities[1].position, "Ctr")
    equal(piped.entities[1].x, -51)
    local grouped = assert(parsers.parseFleetRadar([[
Esstran Sector
Imperial-II Class Star Destroyer 'Verdandi's battlegroup:
Imperial-II Class Star Destroyer 'Verdandi' (Ctr) 0 0 0
Victory-II Class Star Destroyer 'Stella' (Mid) 0 0 0
Your Coordinates: 0 0 0
]]))
    equal(grouped.entities[1].leader, "Verdandi")
    equal(grouped.entities[2].position, "Mid")
  end)

  it("parses battlegroup and squadron formations", function()
    local battlegroup = assert(parsers.parse("battlegroup", [[
[ L ] Battleship :MC-90 Star Cruiser 'Azure Vanguard' -<Pos:Central>-
 Energy: 100%|Hull: 91%|Shields: 73%|Crew: 001|System: Corellian System 2/19
[001] Cruiser :Thranta-Class Light Cruiser 'Cerulean Spear' -<Pos:Outer>-
 Energy: 88%|Hull: 76%|Shields: 54%|Crew: 000|System: Corellian System 2/19
]]))
    equal(battlegroup.fleet.kind, "battlegroup")
    equal(battlegroup.fleet.memberCount, 2)
    equal(battlegroup.fleet.members[1].leader, true)
    equal(battlegroup.fleet.members[2].slot, 1)
    local squadron = assert(parsers.parse("squadron status", [[
Lead: TIE/S Striker 'Wrecker01'
 Energy: 97% Shield: 100% Hull: 100% Location: Kanz Sector
TIE/S Striker 'Wrecker10'
 Energy: 67% Shield: 67% Hull: 100% Location: Kanz Sector
Squadron Fire Assist: Active Systems Target: Laser
]]))
    equal(squadron.fleet.memberCount, 2)
    equal(squadron.fleet.members[1].role, "lead")
    equal(squadron.fleet.members[2].role, "wing")
    equal(squadron.fleet.assist, true)
  end)

  it("parses navigation status and destinations", function()
    local navstat = assert(parsers.parse("navstat", [[
Readout for E-wing Escort Fighter 'Booger':
Current Coordinates: 5 10 -17
Current System: Esstran Sector
Current System X/Y: (92, 12)
This ship can jump to all standard sectors.
Jump System: Mandalore Sector
Jump Distance: 49.5 parsecs
Jump Time: 7m 36s
]]))
    equal(navstat.galaxy.x, 92)
    equal(navstat.jumpTimeSeconds, 456)
    local destinations = assert(parsers.parse("calc", [[
Possible destinations:
Starsystem Parsecs Time Fuel
Mandalore Sector 49.5 7m 36s 87%
Wroona System 67.1 (Out of Range)
]]))
    equal(destinations.mode, "destinations")
    equal(destinations.destinations[1].reachable, true)
    equal(destinations.destinations[2].reachable, false)
  end)

  it("rejects unsupported commands", function()
    local result, failure = parsers.parse("unknown", "anything")
    equal(result, nil)
    assert(failure:find("unsupported command", 1, true))
  end)
end)
