local h = require("harness")
local Fixture = require("mudlet_fixture")
local describe, it, equal = h.describe, h.it, h.equal
local fixture

h.before_each(function()
  fixture = Fixture.new()
  fixture.scraper.setInSpace(true, "fixture")
  assert(fixture.scraper.applyResult(assert(fixture.parsers.parse("radar", [[
Corellian System
YT-1300 'Wayfarer' 200 30 40
Your Coordinates: 20 30 40
]])), "radar"))
end)
h.after_each(function() fixture:close() end)

describe("scraper combat telemetry", function()
  it("marks ships targeting the observer as enemies", function()
    assert(fixture.scraper.handleIncomingTargeting(
      "You are being targeted by Mark-I Assault Frigate 'Wayfarer'."))
    equal(fixture:entity("Wayfarer").disposition, "enemy")
    equal(fixture.scraper.pendingCommandKind, nil)
  end)

  it("issues only installed weapon commands for fire all", function()
    fixture.scraper.state.observer.weapons = {
      autoblasters = 5, laserCannons = 1, turbolasers = 0, ionCannons = 2,
      maximumMissiles = 10, maximumTorpedoes = 0, maximumRockets = 0,
      maximumPulses = 0, missileTubes = 2,
    }
    fixture.scraper.state.observer.hasWeapons = true
    fixture.scraper.combat.targetName = "Wayfarer"
    local before = #fixture.commands
    assert(fixture.intentHandlers.fire_weapon({weapon = "all"}, {id = "fire-all"}))
    equal(#fixture.commands, before + 4)
    equal(fixture.commands[before + 1].command, "fire autoblaster")
    equal(fixture.commands[before + 4].command, "fire missile")
  end)

  it("publishes launch, impact, and charged events independently", function()
    fixture.scraper.combat.targetName = "Wayfarer"
    assert(fixture.scraper.handleCombatLine("1 ion cannons fired..."))
    equal(fixture:lastSnapshot().metadata.combatEvent.type, "launch")
    equal(fixture:lastSnapshot().metadata.combatEvent.weapon, "ion")
    assert(fixture.scraper.handleCombatLine(
      "Your ship's ion cannons fire at Mark-I Assault Frigate 'Wayfarer' but miss."))
    equal(fixture:lastSnapshot().metadata.combatEvent.outcome, "miss")
    assert(fixture.scraper.handleCombatLine("Ion cannons fully charged."))
    equal(fixture:lastSnapshot().metadata.combatEvent.type, "charged")
  end)

  it("deduplicates immediate and detailed missile launches", function()
    fixture.scraper.combat.targetName = "Wayfarer"
    assert(fixture.scraper.handleCombatLine("Missile launched."))
    local firstId = fixture:lastSnapshot().metadata.combatEvent.id
    assert(fixture.scraper.handleCombatLine(
      "A missile is launched toward Mark-I Assault Frigate 'Wayfarer' by your ship."))
    equal(fixture:lastSnapshot().metadata.combatEvent.id, firstId)
  end)

  it("retains repeated hit counts and avoids duplicate explosion impacts", function()
    assert(fixture.scraper.handleCombatLine(
      "Your ship's missile hits Mark-I Assault Frigate 'Wayfarer' dead on! [x2]"))
    local event = fixture:lastSnapshot().metadata.combatEvent
    equal(event.outcome, "hit")
    equal(event.count, 2)
    local firstId = event.id
    assert(fixture.scraper.handleCombatLine(
      "You see a large explosion as Mark-I Assault Frigate 'Wayfarer' is hit by a missile."))
    equal(fixture:lastSnapshot().metadata.combatEvent.id, firstId)
  end)

  it("requests projectile radar after a live projectile summary", function()
    fixture.scraper.combat.projectileRadarRequestedAt = 0
    assert(fixture.scraper.handleProjectileSummary(
      "1 projectiles, 0 incoming (See radar projectiles)"))
    equal(fixture:lastCommand().command, "radar projectiles")
    assert(fixture.scraper.active and fixture.scraper.active.sentCommand == "radar projectiles")
  end)

  it("tracks identical projectiles with stable distinct identities", function()
    assert(fixture.scraper.applyResult(assert(fixture.parsers.parse("radar projectiles", [[
Corellian System
A Heavy Rocket 100 0 0
A Heavy Rocket 200 0 0
Your Coordinates: 0 0 0
]])), "radar projectiles"))
    local ids = {}
    for _, entity in pairs(fixture.scraper.state.entities) do
      if entity.kind == "projectile" then ids[entity.x] = entity.id end
    end
    assert(ids[100] and ids[200] and ids[100] ~= ids[200])
    assert(fixture.scraper.applyResult(assert(fixture.parsers.parse("radar projectiles", [[
Corellian System
A Heavy Rocket 105 0 0
A Heavy Rocket 195 0 0
Your Coordinates: 0 0 0
]])), "radar projectiles"))
    local moved = {}
    for _, entity in pairs(fixture.scraper.state.entities) do
      if entity.kind == "projectile" then moved[entity.x] = entity.id end
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
