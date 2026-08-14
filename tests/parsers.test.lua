local source = debug.getinfo(1, "S").source
local testPath = source:sub(1, 1) == "@" and source:sub(2) or source
testPath = testPath:gsub("\\", "/")
local repoRoot = testPath:match("^(.*)/tests/parsers%.test%.lua$")
  or testPath:match("^tests/parsers%.test%.lua$") and "."
assert(repoRoot, "could not locate repository root from " .. testPath)
package.path = package.path .. ";" .. repoRoot .. "/mudlet/?.lua"

local parsers = require("lotj_holocron_parsers")

local function equal(actual, expected, message)
  assert(actual == expected, (message or "values differ")
    .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
end

local radar = assert(parsers.parseRadar([[
Corellian System
Planet 'Corellia'    5,000 -200 30
YT-1300 'Wayfarer'  800 -250 40

Your Coordinates:   10 20 -5
]]))
equal(radar.system, "Corellian System")
equal(#radar.entities, 2)
equal(radar.entities[1].kind, "planet")
equal(radar.entities[2].name, "Wayfarer")
equal(radar.entities[2].class, "YT-1300")
equal(radar.observer.z, -5)

local liveRadar = assert(parsers.parseRadar([[
Esstran Sector

Dromund Kaas                                              0 0 0

Mark-I Assault Frigate 'MK1AF19'                          -369 -34 -120
Victory-II Class Star Destroyer 'Gore'                    0 0 0
Victory-II Class Star Destroyer 'Strega'                  0 0 0
Imperial-II Class Star Destroyer 'Pollution'              -51 62 32
Imperial-II Class Star Destroyer 'Sleepybattleboo'        5 18 23
Victory-II Class Star Destroyer 'Stella'                  0 0 0
Victory-II Class Star Destroyer 'Siphon'                  0 0 0
Imperial-II Class Star Destroyer 'Verdandi'               0 0 0
Imperial-II Class Star Destroyer 'Pillowslookcomfy'       37 23 16
Imperial-II Class Star Destroyer 'Coldsideofthepillow'    -19 35 23

Your Coordinates:                                         332 807 -1400
]]))
equal(liveRadar.system, "Esstran Sector")

local unchartedRadar = assert(parsers.parseRadar([[
Uncharted space
YT-1300 'Wayfarer'  100 200 300
Your Coordinates:  10 20 30
]]))
equal(unchartedRadar.system, "Uncharted space")

local chatInterleavedRadar = assert(parsers.parseRadar([[
(OOC) @Bando [NEW]: My apologies, Paragod.
[Red Team]{The Grand Council}<New Meat>[A Human male]: are you en route?
CommNet 0 [Malakilli]: Testing
Esstran Sector
Victory-II Class Star Destroyer 'Gore'  0 0 0
Your Coordinates:  12 22 -3
]]))
equal(chatInterleavedRadar.system, "Esstran Sector",
  "asynchronous communication must never become the radar system heading")
equal(liveRadar.recognizedLines, 12)
equal(liveRadar.entities[1].name, "Dromund Kaas")
equal(liveRadar.entities[1].kind, "celestial")
equal(liveRadar.entities[2].name, "MK1AF19")
equal(liveRadar.entities[2].class, "Mark-I Assault Frigate")
equal(liveRadar.observer.z, -1400)

local projectileRadar = assert(parsers.parse("radar projectiles", [[
Esstran Sector
Mark-I Assault Frigate 'MK1AF19'                          -369 -34 -120
A Concussion Missile                                      -240 -34 -120
Your Coordinates:                                         0 0 0
]]))
equal(projectileRadar.entities[2].name, "A Concussion Missile")
equal(projectileRadar.entities[2].kind, "projectile")

local prox = assert(parsers.parseProx([[
Proximity scan
Corellia                                              Prox: 1,250 units
YT-1300 'Wayfarer'                                   Prox: 375
Your Coordinates: 10 20 -5
{Health: 3610/3610} {Movement: 3460/3460}
]]))
equal(#prox.entities, 2)
equal(prox.entities[1].distance, 1250)
equal(prox.entities[2].name, "Wayfarer")
equal(prox.entities[2].class, "YT-1300")
equal(prox.observer.x, 10)

local velocity = assert(parsers.parseProxVelocity([[
Object                    Velocity
YT-1300 'Wayfarer'        Velocity: -120
Corellia                  Velocity: 0
Your Coordinates: 11 21 -4
]]))
equal(velocity.entities[1].speed, -120)
equal(velocity.entities[2].speed, 0)
equal(velocity.entities[1].name, "Wayfarer")
equal(velocity.observer.y, 21)

local status = assert(parsers.parseStatus([[
Wayfarer:
Current Coordinates: 10 -20 30
Current Heading: 1 0 -1
Current Speed: 120/300
Hull: 900/1000  Ship Condition: Good
Shields: 400/500   Energy(fuel): 2000/2500
Laser Condition: Good  Current Target: Bandit
Missiles: 3/6  Torpedos: 1/2  Rockets: 0/4
]]))
equal(status.name, "Wayfarer")
equal(status.coordinates.y, -20)
equal(status.speed.maximum, 300)
equal(status.hull.current, 900)
equal(status.condition, "Good")
equal(status.energy.maximum, 2500)
equal(status.torpedoes.current, 1)

local liveStatus = assert(parsers.parseStatus([[
Readout for Rojan-class Invincible Firespray Patrol Craft 'Forrestal':
Hull: 150/150  Ship Condition: Running
Shields: 150/150   Energy(fuel): 3916/5000
]]))
equal(liveStatus.name, "Forrestal")
equal(liveStatus.class, "Rojan-class Invincible Firespray Patrol Craft")
equal(liveStatus.id, "forrestal")

local info = assert(parsers.parseInfo([[
[Class: Transport] : Rojan-class Invincible Firespray Patrol Craft 'Forrestal'
Autoblasters:    0     Laser cannons:    0      Turbolasers:       0
Ion cannons:     0     Maximum Missiles: 0      Maximum Torpedoes: 0
Maximum Rockets: 0     Maximum Pulses:   0      Maximum Chaff:     0
Missile Tubes:   0     Tractorbeams:     1      Escape Pods:       3
Hatchway: 94599        Hangar Bays:  47894      Docking: 62351
--------: 34073        Selfdestruct: 11553      -------: 23792
Max Hull:      150     Max Shields:     150     Max Energy(fuel): 5000
Maximum Speed: 200     Hyperspeed:      200     Maneuver:         200
Sensor Array:  7       Shield Boosters: 0       Communications:   0
Cloaking Device: Not Installed
]]))
equal(info.source, "info")
equal(info.sensorArray, 7)
equal(info.radarRange, 570)
equal(info.maximumSpeed, 200)
equal(info.hasWeapons, false)
equal(info.weapons.turbolasers, 0)
equal(info.weapons.missileTubes, 0)
equal(info.weapons.tractorbeams, nil, "utility systems must not count as weapons")
equal(info.hatchway, nil, "info parser must not retain access codes")
local allowedInfoKeys = {source = true, sensorArray = true, radarRange = true,
  maximumSpeed = true, shipCategory = true, name = true, class = true,
  weapons = true, hasWeapons = true, recognizedLines = true}
for key in pairs(info) do
  assert(allowedInfoKeys[key], "info parser exposed unexpected field: " .. tostring(key))
end
equal(assert(parsers.parse("info", "Sensor Array: 0")).radarRange, 500)
equal(info.shipCategory, "Transport")
equal(info.name, "Forrestal")

local armedInfo = assert(parsers.parseInfo([[
[Class: Cruiser] : Victory-II Class Star Destroyer 'Gore'
Autoblasters: 0  Laser cannons: 0  Turbolasers: 27
Ion cannons: 35  Maximum Missiles: 0  Maximum Torpedoes: 80
Maximum Rockets: 40  Maximum Pulses: 0
Missile Tubes: 15
]]))
equal(armedInfo.hasWeapons, true)
equal(armedInfo.weapons.ionCannons, 35)

local remoteStatus = assert(parsers.parseStatus([[
Readout for Victory-II Class Star Destroyer 'Gore':
Current Coordinates: 0 0 0
Lifeforms detected: Need 50 sensors to scan for lifeforms.
Hull: 4200/4200  Ship Condition: Running
Shields: 4000/4200  Energy(fuel): 37500/37500
Primary Target: none
]]))
equal(remoteStatus.lifeformScan.available, false)
equal(remoteStatus.lifeformScan.requiredSensors, 50)
equal(remoteStatus.target, "none")

local fleet = assert(parsers.parseFleetRadar([[
Ship                     Squadron Leader          Position
Wayfarer                 Resolute                 Screen
Bandit                   None                     Independent
]]))
equal(#fleet.entities, 2)
equal(fleet.entities[1].leader, "Resolute")
equal(fleet.entities[2].position, "Independent")

local liveFleet = assert(parsers.parseFleetRadar([[
Esstran Sector
Imperial-II Class Star Destroyer 'Pollution' |  | (Ctr) -51 62 32
Victory-II Class Star Destroyer 'Gore' |  | (Out) 0 0 0
]]))
equal(liveFleet.entities[1].name, "Pollution")
equal(liveFleet.entities[1].class, "Imperial-II Class Star Destroyer")
equal(liveFleet.entities[1].kind, "ship")
equal(liveFleet.entities[1].position, "Ctr")
equal(liveFleet.entities[1].x, -51)
equal(liveFleet.entities[2].name, "Gore")

local groupedFleet = assert(parsers.parseFleetRadar([[
Esstran Sector
Mark-I Assault Frigate 'MK1AF19'                            -369 -34 -120

Imperial-II Class Star Destroyer 'Verdandi's battlegroup:
Imperial-II Class Star Destroyer 'Verdandi'           (Ctr) 0 0 0
Victory-II Class Star Destroyer 'Stella'              (Mid) 0 0 0

Your Coordinates: 0 0 0
]]))
equal(groupedFleet.system, "Esstran Sector")
equal(#groupedFleet.entities, 3)
equal(groupedFleet.entities[1].name, "MK1AF19")
equal(groupedFleet.entities[1].x, -369)
equal(groupedFleet.entities[2].name, "Verdandi")
equal(groupedFleet.entities[2].leader, "Verdandi")
equal(groupedFleet.entities[2].position, "Ctr")
equal(groupedFleet.entities[3].position, "Mid")
equal(groupedFleet.observer.x, 0)

local dispatched = assert(parsers.parse("proximity speed", "Wayfarer  75"))
equal(dispatched.source, "prox_velocity")
equal(dispatched.entities[1].speed, 75)

local navstat = assert(parsers.parse("navstat", [[
Readout for E-wing Escort Fighter 'Booger':
Current Coordinates: 5 10 -17
Current Heading: 0 1 -1
Current Speed: 0/170
Current System: Esstran Sector
Current System X/Y: (92, 12)
This ship can jump to all standard sectors.
Jump System: Mandalore Sector
Jump Distance: 49.5 parsecs
Jump Time: 7m 36s
]]))
equal(liveFleet.system, "Esstran Sector")
equal(navstat.system, "Esstran Sector")
equal(navstat.galaxy.x, 92)
equal(navstat.galaxy.y, 12)
equal(navstat.jumpSystem, "Mandalore Sector")
equal(navstat.jumpDistanceParsecs, 49.5)
equal(navstat.jumpTimeSeconds, 456)
equal(navstat.standardSectorsAvailable, true)

local destinations = assert(parsers.parse("calc", [[
Possible destinations:
Starsystem                      Parsecs   Time    Fuel
Mandalore Sector                   49.5   7m 36s   87%
Wroona System                      67.1                 (Out of Range)
Esstran Sector                      0.0      06s    0%
]]))
equal(destinations.mode, "destinations")
equal(#destinations.destinations, 3)
equal(destinations.destinations[1].system, "Mandalore Sector")
equal(destinations.destinations[1].travelTimeSeconds, 456)
equal(destinations.destinations[1].reachable, true)
equal(destinations.destinations[2].reachable, false)
equal(destinations.destinations[3].reachable, true)
equal(destinations.destinations[3].travelTimeSeconds, 6)

local calculation = assert(parsers.parse("calculate", [[
Calculating Hyperspace Trajectory: 31 seconds remaining.
Use CALC STOP to abort the sequence.
]]))
equal(calculation.mode, "status")
equal(calculation.remainingSeconds, 31)

local bad, badError = parsers.parse("unknown", "anything")
equal(bad, nil)
assert(badError:find("unsupported command", 1, true))

print("parser tests passed")
