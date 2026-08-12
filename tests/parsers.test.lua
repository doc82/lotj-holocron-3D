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
equal(liveRadar.recognizedLines, 12)
equal(liveRadar.entities[1].name, "Dromund Kaas")
equal(liveRadar.entities[1].kind, "celestial")
equal(liveRadar.entities[2].name, "MK1AF19")
equal(liveRadar.entities[2].class, "Mark-I Assault Frigate")
equal(liveRadar.observer.z, -1400)

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

local fleet = assert(parsers.parseFleetRadar([[
Ship                     Squadron Leader          Position
Wayfarer                 Resolute                 Screen
Bandit                   None                     Independent
]]))
equal(#fleet.entities, 2)
equal(fleet.entities[1].leader, "Resolute")
equal(fleet.entities[2].position, "Independent")

local liveFleet = assert(parsers.parseFleetRadar([[
Imperial-II Class Star Destroyer 'Pollution' |  | (Ctr) -51 62 32
Victory-II Class Star Destroyer 'Gore' |  | (Out) 0 0 0
]]))
equal(liveFleet.entities[1].name, "Pollution")
equal(liveFleet.entities[1].class, "Imperial-II Class Star Destroyer")
equal(liveFleet.entities[1].kind, "ship")
equal(liveFleet.entities[1].position, "Ctr")
equal(liveFleet.entities[1].x, -51)
equal(liveFleet.entities[2].name, "Gore")

local dispatched = assert(parsers.parse("proximity speed", "Wayfarer  75"))
equal(dispatched.source, "prox_velocity")
equal(dispatched.entities[1].speed, 75)

local bad, badError = parsers.parse("unknown", "anything")
equal(bad, nil)
assert(badError:find("unsupported command", 1, true))

print("parser tests passed")
