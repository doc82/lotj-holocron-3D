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

  it("distinguishes a marked star from an unprefixed planet contact", function()
    local result = assert(parsers.parseRadar([[
Corellian System

(STAR) Corell                                             345 285 674
Corellia                                                  1567 -10000 21812

YT-1000 Light Freighter 'Fast Hauler Three'               1585 -10116 21786
JumpMaster 5000 'High Flier'                              1643 -13647 25592
JumpMaster 5000 'Planet Jumper Three'                     1567 -10000 21812

Your Coordinates:                                         2008 -10017 21858
]]))
    equal(result.system, "Corellian System")
    equal(#result.entities, 5)
    equal(result.entities[1].name, "Corell")
    equal(result.entities[1].kind, "star")
    equal(result.entities[2].name, "Corellia")
    equal(result.entities[2].kind, "celestial")
    equal(result.entities[5].name, "Planet Jumper Three")
    equal(result.entities[5].kind, "ship")
    equal(result.observer.x, 2008)
  end)

  it("keeps planet words in quoted ship callsigns from changing their kind", function()
    local result = assert(parsers.parseRadar([[
Hutt Space

(STAR) Y'Toub                                             -23000 5432 -2135
Nar Shaddaa                                               10000 0 1000
Nal Hutta                                                 13000 5250 -300

YT-1000 Light Freighter 'Planetary Lanes Co'              9918 -45 925
JumpMaster 5000 'Planet Jumper Six'                       12988 4978 1

Your Coordinates:                                         12883 5428 -441
]]))
    equal(result.system, "Hutt Space")
    equal(#result.entities, 5)
    equal(result.entities[1].name, "Y'Toub")
    equal(result.entities[1].kind, "star")
    equal(result.entities[2].kind, "celestial")
    equal(result.entities[3].kind, "celestial")
    equal(result.entities[4].name, "Planetary Lanes Co")
    equal(result.entities[4].class, "YT-1000 Light Freighter")
    equal(result.entities[4].kind, "ship")
    equal(result.entities[5].name, "Planet Jumper Six")
    equal(result.entities[5].class, "JumpMaster 5000")
    equal(result.entities[5].kind, "ship")
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

  it("ignores trailing character HUD lines that resemble radar coordinates", function()
    local result = assert(parsers.parseRadar([[
Esstran Sector
Dromund Kaas 0 0 0
Speed: 80 Fuel Level: 97% Coords: -1 3 26
Your Coordinates: -1 3 26
]]))
    equal(#result.entities, 1)
    equal(result.entities[1].name, "Dromund Kaas")
    equal(result.entities[1].kind, "celestial")
    equal(result.observer.x, -1)
    equal(result.observer.y, 3)
    equal(result.observer.z, 26)
  end)

  it("rejects arrival prose while accepting spaced ship callsigns", function()
    local result = assert(parsers.parseRadar([[
Esstran Sector
Victory-II Class Star Destroyer 'TeeHee3' enters the starsystem, coming out of its hyperjump at celestial 3670 3491 3402
Victory-II Class Star Destroyer 'Bad Name' 100 200 300
Victory-II Class Star Destroyer 'VSD02' 3670 3491 3402
Planet 'Dromund Kaas' 0 0 0
Your Coordinates: 3510 3491 3402
]]))
    equal(#result.entities, 3)
    equal(result.entities[1].name, "Bad Name")
    equal(result.entities[1].kind, "ship")
    equal(result.entities[2].name, "VSD02")
    equal(result.entities[2].kind, "ship")
    equal(result.entities[3].name, "Dromund Kaas")
    equal(result.entities[3].kind, "planet")
  end)

  it("parses named stations and grouped ships in nebula radar output", function()
    local result = assert(parsers.parseRadar([[
Bala Trix Nebula
Black Market Station 'Rust Ring'                            0 0 0

Z-95 Headhunter 'AngerTL's squadron:
Z-95 Headhunter 'AngerTL'                             (Ctr) 1 37 -1
Z-95 Headhunter 'AngerT5'                             (Out) 1 37 -1
Z-95 Headhunter 'AngerT4'                             (Out) 1 37 -1
Z-95 Headhunter 'AngerT2'                             (Out) 1 37 -1
Z-95 Headhunter 'AngerT3'                             (Out) 1 37 -1
Z-95 Headhunter 'AngerT6'                             (Out) 1 37 -1
]]))

    equal(result.system, "Bala Trix Nebula")
    equal(#result.entities, 7)
    equal(result.entities[1].name, "Rust Ring")
    equal(result.entities[1].class, "Black Market Station")
    equal(result.entities[1].kind, "ship")
    equal(result.entities[1].shipCategory, "battlestation")
    equal(result.entities[2].name, "AngerTL")
    equal(result.entities[2].position, "Ctr")
    equal(result.entities[7].name, "AngerT6")
    equal(result.entities[7].position, "Out")
  end)

  it("classifies projectile radar contacts", function()
    local result = assert(parsers.parse(
      "radar projectiles",
      [[
Esstran Sector
Mark-I Assault Frigate 'MK1AF19' -369 -34 -120
A Concussion Missile -240 -34 -120
Your Coordinates: 0 0 0
]]
    ))
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
    local velocity = assert(parsers.parse(
      "proximity speed",
      [[
YT-1300 'Wayfarer' Velocity: -120
Corellia Velocity: 0
Your Coordinates: 11 21 -4
]]
    ))
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
    equal(remote.statusCard.sections[1].title, "FLIGHT")
    equal(remote.statusCard.sections[1].rows[1].label, "Lifeforms detected")
    local disabled = assert(parsers.parseStatus([[
Readout for Victory-II Class Star Destroyer 'TeeHee2':
Hull: 1286/4200 [30%]        Ship Condition: Disabled
Shields: 1400/4200 [33%]     Energy(fuel): 35926/37500 [95%]
]]))
    equal(disabled.condition, "Disabled")
  end)

  it("does not reinterpret a ship information dossier as status", function()
    local result, failure = parsers.parseStatus([[
[Class: Cruiser] : Victory-II Class Star Destroyer 'TeeHee3'
Kill Markers:
Quota: 0.00/2770.00    Value: 4109300 credit(s)
Maximum Speed: 55      Hyperspeed: 70
]])
    equal(result, nil)
    assert(failure:find("ship information response", 1, true))
  end)

  it("splits turret summaries and ignores Mudlet prompt fields in status cards", function()
    local result = assert(parsers.parseStatus([[
Forrestal:
--Weapons----------------------------------------------------------------
Total Turrets: 2. Damaged Turrets: [ (All turrets working) ]
--Storage----------------------------------------------------------------
Escape Pods: 30/30
Hangar 1: Closed
Slot(s): 0/17
{Tone: none } {Time: night } {Ambience: quiet }
{Health: 1100/1100} {OOC:||||||} [ ] {Movement: 1990/1990} []
]]))
    local rows = {}
    for _, section in ipairs(result.statusCard.sections) do
      for _, row in ipairs(section.rows) do
        rows[row.label] = row.value
        assert(not row.label:find("{", 1, true))
        assert(not row.value:find("{", 1, true))
      end
    end
    equal(rows["Total Turrets"], "2")
    equal(rows["Damaged Turrets"], "[ (All turrets working) ]")
    equal(rows["Escape Pods"], "30/30")
  end)

  it("parses complete info cards including access codes", function()
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
    local hatchway
    for _, section in ipairs(result.infoCard.sections) do
      for _, row in ipairs(section.rows) do
        if row.label == "Hatchway" then
          hatchway = row.value
        end
      end
    end
    equal(hatchway, "94599")
  end)

  it("builds info cards only from validated static fields and one prose paragraph", function()
    local result = assert(parsers.parseInfo([[
[Class: Battleship] : Victory-II Class Star Destroyer 'TeeHee2'
The Victory-class Star Destroyer, also known simply as the
Victory-class Destroyer, is a direct predecessor to the feared Imperial-class
Star Destroyers of the Galactic Empire. At just under a
1 kilometre in length,
the ship is ideal for deep space combat.
Kill Markers:
Quota: 0.00/2770.00    Value: 4109300 credit(s)
Owner: [Blipee       ] Pilot: [              ]  Copilot: [              ]
Crew:  [ ]
--Weapons----------------------------------------------------------------
Autoblasters:    0     Laser cannons:    0      Turbolasers:       27
Ion cannons:     35    Maximum Missiles: 0      Maximum Torpedoes: 80
Maximum Rockets: 40    Maximum Pulses:   0      Maximum Chaff:     0
Missile Tubes:   15    Tractorbeams:     1      Escape Pods:       30
--Access Codes-----------------------------------------------------------
Hatchway: 42156        Hangar Bays:  56748      Docking: 30950
--------: 31223        Selfdestruct: 44883      -------: 65555
--Systems----------------------------------------------------------------
Max Hull:      4200    Max Shields:     4200    Max Energy(fuel): 37500
Maximum Speed: 55      Hyperspeed:      70      Maneuver:         40
Sensor Array:  50      Shield Boosters: 40      Communications:   55
Cloaking Device: Not Installed
{Tone: none } {Time: dawn } {Ambience: quiet }
{Health: 1100/1100} {OOC:||||||} [ ] {Movement: 1990/1990} []
]]))
    equal(result.name, "TeeHee2")
    equal(result.shipCategory, "Battleship")
    equal(result.infoCard.title, "SHIP INFORMATION")
    equal(
      result.infoCard.description,
      "The Victory-class Star Destroyer, also known simply as the Victory-class Destroyer, is a direct predecessor to the feared Imperial-class Star Destroyers of the Galactic Empire. At just under a kilometre in length, the ship is ideal for deep space combat."
    )
    equal(result.maximumSpeed, 55)
    equal(result.hyperspeed, 70)
    equal(result.sensorArray, 50)
    equal(result.weapons.turbolasers, 27)
    equal(result.weapons.maximumTorpedoes, 80)

    local rows = {}
    for _, section in ipairs(result.infoCard.sections) do
      for _, row in ipairs(section.rows) do
        rows[row.label] = row.value
        assert(not row.label:match("^%d"))
        assert(not row.label:find("Tone", 1, true))
        assert(not row.value:find("Health", 1, true))
      end
    end
    equal(rows["Laser Cannons"], "0")
    equal(rows["Maximum Hull"], "4200")
    equal(rows["Maximum Shields"], "4200")
    equal(rows["Maximum Energy (fuel)"], "37500")
    equal(rows["Pilot"], "UNASSIGNED")
    equal(rows["Copilot"], "UNASSIGNED")
    equal(rows["Cloaking Device"], "Not Installed")
  end)

  it("rejects info output that has only a header and Mudlet prompt fields", function()
    local result, failure = parsers.parseInfo([[
[Class: Battleship] : Victory-II Class Star Destroyer 'TeeHee2'
{Tone: none } {Time: dawn } {Ambience: quiet }
{Health: 1100/1100} {OOC:||||||} [ ] {Movement: 1990/1990} []
]])
    equal(result, nil)
    assert(failure:find("validated ship header and body", 1, true))
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
    local callsigns = assert(parsers.parseFleetRadar([[
Hutt Space
YT-1000 Light Freighter 'Planetary Lanes Co' |  | (Ctr) 9918 -45 925
JumpMaster 5000 'Planet Jumper Six' |  | (Out) 12988 4978 1
]]))
    equal(callsigns.entities[1].kind, "ship")
    equal(callsigns.entities[2].kind, "ship")
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

  it("recognizes fleet radar being unavailable outside the co-pilot seat", function()
    local result = assert(parsers.parseFleetRadar("You must be in the co-pilots seat!"))
    equal(result.unavailableReason, "copilot_seat_required")
    equal(#result.entities, 0)
  end)

  it("parses battlegroup and squadron formations", function()
    local battlegroup = assert(parsers.parse(
      "battlegroup",
      [[
[ L ] Battleship :MC-90 Star Cruiser 'AzureVanguard' -<Pos:Central>-
 Energy: 100%|Hull: 91%|Shields: 73%|Crew: 001|System: Corellian System 2/19
[001] Cruiser :Thranta-Class Light Cruiser 'CeruleanSpear' -<Pos:Outer>-
 Energy: 88%|Hull: 76%|Shields: 54%|Crew: 000|System: Corellian System 2/19
]]
    ))
    equal(battlegroup.fleet.kind, "battlegroup")
    equal(battlegroup.fleet.memberCount, 2)
    equal(battlegroup.fleet.members[1].leader, true)
    equal(battlegroup.fleet.members[2].slot, 1)
    local squadron = assert(parsers.parse(
      "squadron status",
      [[
Lead: TIE/S Striker 'Wrecker01'
 Energy: 97% Shield: 100% Hull: 100% Location: Kanz Sector
TIE/S Striker 'Wrecker10'
 Energy: 67% Shield: 67% Hull: 100% Location: Kanz Sector
Squadron Fire Assist: Active Systems Target: Laser
]]
    ))
    equal(squadron.fleet.memberCount, 2)
    equal(squadron.fleet.members[1].role, "lead")
    equal(squadron.fleet.members[2].role, "wing")
    equal(squadron.fleet.assist, true)
  end)

  it("treats a non-fighter cockpit as an inactive squadron", function()
    local squadron = assert(
      parsers.parse("squadron status", "You must be in a fighter cockpit to manage squadrons.")
    )
    equal(squadron.fleet.kind, "squadron")
    equal(squadron.fleet.active, false)
    equal(squadron.fleet.unavailableReason, "fighter_cockpit_required")
  end)

  it("parses navigation status and destinations", function()
    local navstat = assert(parsers.parse(
      "navstat",
      [[
Readout for E-wing Escort Fighter 'Booger':
Current Coordinates: 5 10 -17
Current System: Esstran Sector
Current System X/Y: (92, 12)
This ship can jump to all standard sectors.
Jump System: Mandalore Sector
Jump Distance: 49.5 parsecs
Jump Time: 7m 36s
]]
    ))
    equal(navstat.galaxy.x, 92)
    equal(navstat.jumpTimeSeconds, 456)
    local destinations = assert(parsers.parse(
      "calc",
      [[
Possible destinations:
Starsystem Parsecs Time Fuel
Mandalore Sector 49.5 7m 36s 87%
Wroona System 67.1 (Out of Range)
]]
    ))
    equal(destinations.mode, "destinations")
    equal(destinations.destinations[1].reachable, true)
    equal(destinations.destinations[2].reachable, false)
  end)

  it("parses hyperlane status and planet resources", function()
    local lanes = assert(parsers.parse(
      "l hyp",
      [[
 .--------------------------------------------------.
 |   Between Naboo and Bespin         : No Route    |
 |   Between Corellia and Wroona      : Passable    |
 *--------------------------------------------------*
]]
    ))
    equal(lanes.lanes[1].from, "Naboo")
    equal(lanes.lanes[1].to, "Bespin")
    equal(lanes.lanes[1].status, "no_route")
    equal(lanes.lanes[2].status, "passable")

    local planet = assert(parsers.parse(
      "showp",
      [[
--Planet Data: -----------------------------------------
Planet: Bespin
Starsystem: Anoat Sector
Coordinates: 0 0 0
Governed By: Confederacy of Independent Systems
Tax Rate: 5.00
Tibanna gas          ( Price per unit: 76.00)
Common metals        ( Price per unit: 38.30)
Food                 ( Price per unit: 23.97)
]]
    ))
    equal(planet.planet, "Bespin")
    equal(planet.system, "Anoat Sector")
    equal(planet.governedBy, "Confederacy of Independent Systems")
    equal(planet.taxRate, 5)
    equal(planet.resources["Tibanna gas"], 76)

    local catalogue = assert(parsers.parse(
      "planets",
      [[
  Planet           Starsystem            Governed By               Notices
  Ithor            Ottega System         A Neutral Government      [FP]
  Lorrd            Kanz Sector           A Neutral Government      [FP]
  ]]
    ))
    equal(catalogue.planets[1].name, "Ithor")
    equal(catalogue.planets[1].system, "Ottega System")
    equal(catalogue.planets[1].governedBy, "A Neutral Government")
  end)

  it("parses clans, cargo manifests, and transaction confirmations", function()
    local clans = assert(parsers.parse(
      "clans",
      [[
Major Organizations:
Clan Name                                | Planets | Active Members
A Neutral Government                     | 7       | (None)
Confederacy of Independent Systems       | 3       | 30+
Minor Organizations:
Clan Name                                | Planets | Active Members
Merr-Sonn Munitions                      | 0       | 20+
]]
    ))
    equal(#clans.organizations, 3)
    equal(clans.organizations[2].name, "Confederacy of Independent Systems")
    equal(clans.organizations[3].category, "minor")

    local cargo = assert(parsers.parse(
      "listc",
      [[
Cargo Readout for YT-1000 Light Freighter 'BlueSkies':
[ID:] [Contents:           ] [Amount:  ]
[1  ] [Precious metals     ] [500/500  ]
[2  ] [Textiles            ] [120/500  ]
]]
    ))
    equal(cargo.shipName, "BlueSkies")
    equal(cargo.items[1].resource, "Precious metals")
    equal(cargo.items[2].current, 120)

    local bought =
      assert(parsers.parse("buycargo", "You purchased 4500 units of Textiles for 162162 credits."))
    equal(bought.action, "buy")
    equal(bought.amount, 4500)
    equal(bought.cost, 162162)

    local sold = assert(
      parsers.parse("sellcargo", "You sell 4500 units of Precious metals for 307094 credits.")
    )
    equal(sold.action, "sell")
    equal(sold.revenue, 307094)

    local refueled = assert(parsers.parse("refuel", "You pay 3228 credits to refuel the ship."))
    equal(refueled.action, "refuel")
    equal(refueled.cost, 3228)
    local full = assert(parsers.parse("refuel", "That ship is already fully fueled!"))
    equal(full.action, "refuel")
    equal(full.cost, 0)
    equal(full.alreadyFull, true)
    equal(assert(parsers.parse("credits", "You have 1097793 credits.")).balance, 1097793)
    equal(assert(parsers.parse("credits", "You have 0 credits.")).balance, 0)
    equal(parsers.parse("credits", "You pay 10 credits to refuel the ship."), nil)
  end)

  it("rejects unsupported commands", function()
    local result, failure = parsers.parse("unknown", "anything")
    equal(result, nil)
    assert(failure:find("unsupported command", 1, true))
  end)
end)
