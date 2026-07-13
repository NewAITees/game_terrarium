"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const planet_strategy_fleet_js_1 = require("../shared/planet_strategy_fleet.js");
const fleet = [{ kind: 'attacker', speed: 0.9 }, { kind: 'gunship', speed: 0.65 }, { kind: 'transport', speed: 1.2 }];
(0, planet_strategy_fleet_js_1.synchronizeFleetSpeed)(fleet);
assert_1.strict.equal(fleet[0].speed, 0.65);
assert_1.strict.equal(fleet[1].speed, 0.65);
assert_1.strict.equal(fleet[2].speed, 1.2);
const routeKey = (a, b) => [a, b].sort().join(':');
const empires = [{ id: 0, color: '#ff0000' }, { id: 1, color: '#00ff00' }];
const attackShip = { kind: 'attacker', status: 'traveling', targetPlanetId: 'b', fromPlanetId: 'a', toPlanetId: 'b', owner: 0 };
assert_1.strict.equal((0, planet_strategy_fleet_js_1.getActiveAttackRoutes)([attackShip], empires, routeKey).get('a:b')?.color, '#ff0000');
for (const status of ['launching', 'traveling', 'approaching', 'engaging'])
    assert_1.strict.equal((0, planet_strategy_fleet_js_1.getActiveAttackRoutes)([{ ...attackShip, status }], empires, routeKey).has('a:b'), true);
for (const status of ['orbiting', 'docked', 'loading', 'unloading'])
    assert_1.strict.equal((0, planet_strategy_fleet_js_1.getActiveAttackRoutes)([{ ...attackShip, status }], empires, routeKey).has('a:b'), false);
assert_1.strict.equal((0, planet_strategy_fleet_js_1.getActiveAttackRoutes)([{ ...attackShip, kind: 'transport' }], empires, routeKey).size, 0);
const contested = (0, planet_strategy_fleet_js_1.getActiveAttackRoutes)([attackShip, { ...attackShip, owner: 1 }, { ...attackShip, owner: 1 }], empires, routeKey);
assert_1.strict.deepEqual(contested.get('a:b'), { owner: 1, color: '#00ff00', shipCount: 2 });
console.log('planet strategy fleet smoke passed');
