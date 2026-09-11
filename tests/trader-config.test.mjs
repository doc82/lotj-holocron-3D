import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePath,
  readTraderConfig,
  shipValidation,
  upsertShip,
  removeShip,
  upsertPad,
  padForPlanet,
} from "../renderer/src/features/trader/traderConfig.ts";
import { calculateCargoRoutes } from "../renderer/src/domain/cargoRoutes.ts";
const ship = {
  id: "ship-1",
  name: "BlueSkies",
  capacity: 4500,
  enterPath: ["n", "u"],
  exitPath: ["d", "s"],
};
const empty = () => ({ ships: [], pads: [], routes: [] });

test("ship setup validates capacity, unique names and usable access paths", () => {
  assert.deepEqual(parsePath("N, N   u"), ["n", "n", "u"]);
  assert.equal(shipValidation(ship, []), null);
  for (const capacity of [0, -1, 1.5, NaN, Infinity])
    assert.ok(shipValidation({ ...ship, capacity }, []));
  assert.ok(shipValidation({ ...ship, enterPath: ["say hi"] }, []));
  assert.ok(shipValidation({ ...ship, id: "other", name: "blueskies" }, [ship]));
  assert.equal(shipValidation({ ...ship, capacity: 5000 }, [ship]), null);
});

test("editing a ship retains its selection without duplicating it", () => {
  let config = upsertShip(empty(), ship);
  config = upsertShip(config, { ...ship, capacity: 5000 });
  assert.equal(config.ships.length, 1);
  assert.equal(config.ships[0].capacity, 5000);
  assert.equal(config.selectedShipId, ship.id);
});

test("removing a ship preserves saved routes and clears their ship association", () => {
  const config = removeShip(
    {
      ...empty(),
      ships: [ship],
      selectedShipId: ship.id,
      routes: [{ id: "route-1", shipId: ship.id }],
    },
    ship.id,
  );
  assert.equal(config.selectedShipId, undefined);
  assert.equal(config.routes.length, 1);
  assert.equal(config.routes[0].shipId, undefined);
});

test("secret pads match planets case-insensitively and replace their previous location on edit", () => {
  let config = upsertPad(empty(), { planet: " Naboo ", pad: " Hidden Garden " });
  config = upsertPad(config, { planet: "naboo", pad: "Garden Two" });
  assert.equal(config.pads.length, 1);
  assert.equal(padForPlanet(config.pads, "NABOO").pad, "Garden Two");
  config = upsertPad(config, { planet: "Bespin", pad: "Platform Six" }, "naboo");
  assert.equal(padForPlanet(config.pads, "Naboo"), undefined);
  assert.equal(padForPlanet(config.pads, "Bespin").pad, "Platform Six");
});

test("stored config recovers old routes and ignores malformed entries", () => {
  const [route] = calculateCargoRoutes(
    [
      { name: "Corellia", resources: { Food: 1 } },
      { name: "Coruscant", resources: { Food: 10 } },
    ],
    [{ from: "Corellia", to: "Coruscant", status: "passable" }],
    { cargoCapacity: ship.capacity, maxJumpsPerLeg: 1 },
  );
  const config = readTraderConfig({
    ships: [null, {}, ship],
    pads: [null, { planet: "Corellia", pad: "Secret" }],
    routes: [{}, route],
    selectedShipId: "missing",
  });
  assert.equal(config.ships.length, 1);
  assert.equal(config.selectedShipId, ship.id);
  assert.equal(config.routes.length, 1);
  assert.equal(config.routes[0].name, "Corellia to Coruscant");
  assert.ok(config.routes[0].id);
  assert.deepEqual(readTraderConfig(JSON.parse(JSON.stringify(config))), config);
  assert.deepEqual(readTraderConfig({ ships: "invalid", pads: 3 }), {
    ...empty(),
    selectedShipId: undefined,
  });
});

test("route avoidance also excludes intermediate transit planets", () => {
  const planets = [
    { name: "Corellia", resources: { Food: 1 } },
    { name: "Lorrd", governedBy: "Closed", resources: {} },
    { name: "Wroona", resources: { Food: 10 } },
  ];
  const edges = [
    { from: "Corellia", to: "Wroona", status: "no_route" },
    { from: "Corellia", to: "Ereopha", status: "no_route" },
    { from: "Corellia", to: "Lorrd", status: "passable" },
    { from: "Lorrd", to: "Wroona", status: "passable" },
  ];
  for (const restrictions of [
    { avoidedPlanets: new Set(["lorrd"]) },
    { excludedClans: new Set(["closed"]) },
  ])
    assert.deepEqual(
      calculateCargoRoutes(planets, edges, {
        cargoCapacity: 4500,
        maxJumpsPerLeg: 3,
        ...restrictions,
      }),
      [],
    );
});

test("legacy ships without a capacity remain available to edit", () => {
  const config = readTraderConfig({ ships: [{ ...ship, capacity: 0 }] });
  assert.equal(config.ships.length, 1);
  assert.equal(config.ships[0].capacity, 0);
  assert.ok(shipValidation(config.ships[0], config.ships));
});
