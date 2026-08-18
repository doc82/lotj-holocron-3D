local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
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
end)
h.after_each(function()
  fixture:close()
end)

describe("scraper combat telemetry", function()
  it("marks ships targeting the observer as enemies", function()
    assert(
      fixture.scraper.handleIncomingTargeting(
        "You are being targeted by Mark-I Assault Frigate 'Wayfarer'."
      )
    )
    equal(fixture:entity("Wayfarer").disposition, "enemy")
    equal(fixture.scraper.pendingCommandKind, nil)
  end)

  it("issues only installed weapon commands for fire all", function()
    fixture.scraper.state.observer.weapons = {
      autoblasters = 5,
      laserCannons = 1,
      turbolasers = 0,
      ionCannons = 2,
      maximumMissiles = 10,
      maximumTorpedoes = 0,
      maximumRockets = 0,
      maximumPulses = 0,
      missileTubes = 2,
    }
    fixture.scraper.state.observer.hasWeapons = true
    fixture.scraper.combat.targetName = "Wayfarer"
    local before = #fixture.commands
    assert(fixture.intentHandlers.fire_weapon({ weapon = "all" }, { id = "fire-all" }))
    equal(#fixture.commands, before + 4)
    equal(fixture.commands[before + 1].command, "fire autoblaster")
    equal(fixture.commands[before + 4].command, "fire missile")
  end)

  it("publishes launch, impact, and charged events independently", function()
    fixture.scraper.combat.targetName = "Wayfarer"
    assert(fixture.scraper.handleCombatLine("1 ion cannons fired..."))
    equal(fixture:lastSnapshot().metadata.combatEvent.type, "launch")
    equal(fixture:lastSnapshot().metadata.combatEvent.weapon, "ion")
    assert(
      fixture.scraper.handleCombatLine(
        "Your ship's ion cannons fire at Mark-I Assault Frigate 'Wayfarer' but miss."
      )
    )
    equal(fixture:lastSnapshot().metadata.combatEvent.outcome, "miss")
    assert(fixture.scraper.handleCombatLine("Ion cannons fully charged."))
    equal(fixture:lastSnapshot().metadata.combatEvent.type, "charged")
  end)

  it("publishes inbound enemy fire against the observer", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
Assassin-Class Corvette 'Calculated' -100 30 40
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    assert(
      fixture.scraper.handleShipHit(
        "You are hit by lasers from Assassin-Class Corvette 'Calculated'!",
        false
      )
    )
    local event = fixture:lastSnapshot().metadata.combatEvent
    equal(event.type, "impact")
    equal(event.weapon, "laser")
    equal(event.sourceName, "Calculated")
    equal(event.targetName, "Player Ship")
    equal(event.outcome, "hit")
    equal(fixture:entity("Calculated").disposition, "enemy")
  end)

  it("publishes fire exchanged between nearby ships", function()
    assert(
      fixture.scraper.handleCombatLine(
        "An ion blast from Assassin-Class Corvette 'Calculated' hits YT-1300 'Wayfarer' dead on!"
      )
    )
    local hit = fixture:lastSnapshot().metadata.combatEvent
    equal(hit.type, "impact")
    equal(hit.weapon, "ion")
    equal(hit.sourceName, "Calculated")
    equal(hit.targetName, "Wayfarer")
    equal(hit.outcome, "hit")

    assert(
      fixture.scraper.handleCombatLine(
        "A laser blast from Assassin-Class Corvette 'Calculated' barely misses YT-1300 'Wayfarer'."
      )
    )
    local miss = fixture:lastSnapshot().metadata.combatEvent
    equal(miss.weapon, "laser")
    equal(miss.sourceName, "Calculated")
    equal(miss.targetName, "Wayfarer")
    equal(miss.outcome, "miss")
  end)

  it("reassembles wrapped hostile volleys and rocket launches", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
Imperial-II Class Star Destroyer 'ISD45' -200 30 40
Victory-II Class Star Destroyer 'TeeHee3' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    local fleet = {
      kind = "battlegroup",
      active = true,
      members = {
        { id = "player-ship", name = "Player Ship", leader = true },
        { id = "teehee3", name = "TeeHee3", role = "wing" },
      },
    }
    fixture.scraper.state.metadata.fleet = fleet
    fixture.scraper.state.metadata.formations.battlegroup = fleet

    local snapshotsBefore = #fixture.snapshots
    assert(
      fixture.scraper.handleCombatFragment(
        "An ion blast from Imperial-II Class Star Destroyer 'ISD45' hits Victory-II Class Star Destroyer"
      )
    )
    equal(#fixture.snapshots, snapshotsBefore)
    assert(fixture.scraper.handleCombatFragment("'TeeHee3'. [x7]"))
    local ion = fixture:lastSnapshot().metadata.combatEvent
    equal(ion.type, "impact")
    equal(ion.weapon, "ion")
    equal(ion.sourceName, "ISD45")
    equal(ion.targetName, "TeeHee3")
    equal(ion.outcome, "hit")
    equal(ion.count, 7)
    equal(fixture:entity("ISD45").disposition, "enemy")

    assert(
      fixture.scraper.handleCombatFragment(
        "Turbolaser fire from Imperial-II Class Star Destroyer 'ISD45' hits Victory-II Class Star Destroyer"
      )
    )
    assert(fixture.scraper.handleCombatFragment("'TeeHee3'. [x7]"))
    local turbolaser = fixture:lastSnapshot().metadata.combatEvent
    equal(turbolaser.weapon, "turbolaser")
    equal(turbolaser.sourceName, "ISD45")
    equal(turbolaser.targetName, "TeeHee3")
    equal(turbolaser.count, 7)

    assert(
      fixture.scraper.handleCombatFragment(
        "Imperial-II Class Star Destroyer 'ISD45' fires a heavy rocket towards Victory-II Class Star"
      )
    )
    assert(fixture.scraper.handleCombatFragment("Destroyer 'TeeHee3'. [x2]"))
    local rocket = fixture:lastSnapshot().metadata.combatEvent
    equal(rocket.type, "launch")
    equal(rocket.weapon, "rocket")
    equal(rocket.sourceName, "ISD45")
    equal(rocket.targetName, "TeeHee3")
    equal(rocket.count, 2)

    assert(
      fixture.scraper.handleCombatFragment(
        "An ion blast from Victory-II Class Star Destroyer 'TeeHee3' hits Imperial-II Class Star Destroyer"
      )
    )
    assert(fixture.scraper.handleCombatFragment("'ISD45'. [x4]"))
    local returnFire = fixture:lastSnapshot().metadata.combatEvent
    equal(returnFire.weapon, "ion")
    equal(returnFire.sourceName, "TeeHee3")
    equal(returnFire.targetName, "ISD45")
    equal(returnFire.outcome, "hit")
    equal(returnFire.count, 4)
    equal(fixture.scraper.combat.pendingLine, nil)
  end)

  it("publishes a destruction event and removes the exploded ship", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
Imperial-II Class Star Destroyer 'ISD45' -200 30 40
Victory-II Class Star Destroyer 'TeeHee3' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    fixture.scraper.combat.targetName = "ISD45"
    fixture.scraper.state.observer.target = "ISD45"
    fixture.scraper.state.metadata.combatTarget = "ISD45"
    fixture.scraper.state.metadata.combatTargets = {
      localTarget = { targetName = "ISD45" },
      wingTarget = { targetName = "TeeHee3" },
    }
    fixture.scraper.state.metadata.tacticalViews.remote = {
      entities = {
        { id = "isd45", name = "ISD45", kind = "ship", x = -200, y = 30, z = 40 },
      },
    }

    local snapshotsBefore = #fixture.snapshots
    assert(
      fixture.scraper.handleCombatFragment(
        "Imperial-II Class Star Destroyer 'ISD45' explodes in a blinding flash of"
      )
    )
    equal(#fixture.snapshots, snapshotsBefore)
    assert(fixture.scraper.handleCombatFragment("light!"))
    local snapshot = fixture:lastSnapshot()
    local event = snapshot.metadata.shipDestructionEvents[1]
    equal(event.id, 1)
    equal(event.phase, "destroyed")
    equal(event.shipName, "ISD45")
    equal(event.x, -200)
    equal(event.y, 30)
    equal(event.z, 40)
    equal(fixture:entity("ISD45"), nil)
    equal(#snapshot.metadata.tacticalViews.remote.entities, 0)
    equal(snapshot.metadata.combatTarget, nil)
    equal(snapshot.metadata.combatTargets.localTarget, nil)
    equal(snapshot.metadata.combatTargets.wingTarget.targetName, "TeeHee3")
    equal(fixture.scraper.combat.targetName, nil)

    -- A radar response that began before the explosion must not resurrect the
    -- contact when that stale capture finishes moments later.
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar",
        [[
Corellian System
Imperial-II Class Star Destroyer 'ISD45' -200 30 40
Victory-II Class Star Destroyer 'TeeHee3' 200 30 40
Your Coordinates: 20 30 40
]]
      )),
      "radar"
    ))
    equal(fixture:entity("ISD45"), nil)
  end)

  it("ignores lines without the destruction signature", function()
    local before = #fixture.snapshots
    equal(
      fixture.scraper.handleShipDestruction("Imperial-II Class Star Destroyer 'ISD45' is disabled."),
      false
    )
    equal(#fixture.snapshots, before)
  end)

  it("deduplicates immediate and detailed missile launches", function()
    fixture.scraper.combat.targetName = "Wayfarer"
    assert(fixture.scraper.handleCombatLine("Missile launched."))
    local firstId = fixture:lastSnapshot().metadata.combatEvent.id
    assert(
      fixture.scraper.handleCombatLine(
        "A missile is launched toward Mark-I Assault Frigate 'Wayfarer' by your ship."
      )
    )
    equal(fixture:lastSnapshot().metadata.combatEvent.id, firstId)
  end)

  it("retains repeated hit counts and avoids duplicate explosion impacts", function()
    assert(
      fixture.scraper.handleCombatLine(
        "Your ship's missile hits Mark-I Assault Frigate 'Wayfarer' dead on! [x2]"
      )
    )
    local event = fixture:lastSnapshot().metadata.combatEvent
    equal(event.outcome, "hit")
    equal(event.count, 2)
    local firstId = event.id
    assert(
      fixture.scraper.handleCombatLine(
        "You see a large explosion as Mark-I Assault Frigate 'Wayfarer' is hit by a missile."
      )
    )
    equal(fixture:lastSnapshot().metadata.combatEvent.id, firstId)
  end)

  it("requests projectile radar after a live projectile summary", function()
    assert(fixture.scraper.startPolling({ initialDelaySeconds = 0.1 }))
    fixture.scraper.combat.projectileRadarRequestedAt = 0
    assert(
      fixture.scraper.handleProjectileSummary("1 projectiles, 0 incoming (See radar projectiles)")
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    equal(fixture:lastCommand().command, "radar projectiles")
    assert(fixture.scraper.active and fixture.scraper.active.sentCommand == "radar projectiles")
  end)

  it("deduplicates forced projectile reconciliation during impact bursts", function()
    assert(fixture.scraper.startPolling({ initialDelaySeconds = 0.1 }))
    fixture.scraper.combat.projectileRadarRequestedAt = 0
    assert(
      fixture.scraper.handleProjectileSummary("50 projectiles, 0 incoming (See radar projectiles)")
    )
    fixture:tick(fixture.scraper.getPollingState().timerId)
    local commandCount = #fixture.commands
    fixture.scraper.finishCapture("fixture")
    assert(
      fixture.scraper.handleCombatLine(
        "Your ship's rocket hits Mark-I Assault Frigate 'Wayfarer' dead on!"
      )
    )
    local reconcileTimer = fixture.scraper.combat.projectileReconcileTimerId
    assert(reconcileTimer and fixture.timers[reconcileTimer])
    assert(
      fixture.scraper.handleCombatLine(
        "Your ship's rocket hits Mark-I Assault Frigate 'Wayfarer' dead on!"
      )
    )
    equal(fixture.scraper.combat.projectileReconcileTimerId, reconcileTimer)
    fixture:tick(reconcileTimer)
    equal(#fixture.commands, commandCount)
  end)

  it("tracks identical projectiles with stable distinct identities", function()
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar projectiles",
        [[
Corellian System
A Heavy Rocket 100 0 0
A Heavy Rocket 200 0 0
Your Coordinates: 0 0 0
]]
      )),
      "radar projectiles"
    ))
    local ids = {}
    for _, entity in pairs(fixture.scraper.state.entities) do
      if entity.kind == "projectile" then
        ids[entity.x] = entity.id
      end
    end
    assert(ids[100] and ids[200] and ids[100] ~= ids[200])
    assert(fixture.scraper.applyResult(
      assert(fixture.parsers.parse(
        "radar projectiles",
        [[
Corellian System
A Heavy Rocket 105 0 0
A Heavy Rocket 195 0 0
Your Coordinates: 0 0 0
]]
      )),
      "radar projectiles"
    ))
    local moved = {}
    for _, entity in pairs(fixture.scraper.state.entities) do
      if entity.kind == "projectile" then
        moved[entity.x] = entity.id
      end
    end
    equal(moved[105], ids[100])
    equal(moved[195], ids[200])
  end)

  it("enables fast polling only for real combat activity", function()
    fixture.scraper.combat.targetName = "Wayfarer"
    fixture.scraper.combat.lastActivityAt = 0
    fixture.scraper.state.metadata.projectileCount = 0
    equal(fixture.scraper.isCombatPollingActive(os.time()), false)
    fixture.scraper.combat.lastActivityAt = os.time()
    equal(fixture.scraper.isCombatPollingActive(os.time()), true)
  end)
end)
