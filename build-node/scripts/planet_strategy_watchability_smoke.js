"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const planet_strategy_watchability_js_1 = require("../shared/planet_strategy_watchability.js");
const empires = [
    { id: 0, name: 'Aster Union', collapsed: false, homeFactoryId: 'f0' },
    { id: 1, name: 'Red Meridian', collapsed: false, homeFactoryId: 'f1' },
];
const world = {
    time: 42,
    empires,
    planets: [
        { id: 'f0', label: 'Aster Forge', owner: 0, type: 'factory', stock: 8, structures: { factory: 1 }, stalled: false },
        { id: 'f1', label: 'Red Forge', owner: 1, type: 'factory', stock: 120, structures: { factory: 1 }, stalled: false },
    ],
    ships: [],
    oreFalloffStart: null,
};
const crisis = (0, planet_strategy_watchability_js_1.buildPlanetWatchState)(world);
assert_1.strict.equal(crisis.nextWatch.kind, 'factory_starvation');
assert_1.strict.match(crisis.nextWatch.detail, /Aster Forge/);
assert_1.strict.equal(crisis.causal[0]?.kind, 'factory_starvation');
assert_1.strict.match(crisis.causal[0]?.impact ?? '', /production/i);
world.ships = [{ kind: 'attacker', owner: 1, status: 'traveling', targetPlanetId: 'f0', fromPlanetId: 'f1', toPlanetId: 'f0' }];
world.planets[0].stock = 100;
const attack = (0, planet_strategy_watchability_js_1.buildPlanetWatchState)(world);
assert_1.strict.equal(attack.nextWatch.kind, 'incoming_attack');
assert_1.strict.match(attack.nextWatch.detail, /Red Meridian/);
world.ships = [];
world.oreFalloffStart = 40;
const falloff = (0, planet_strategy_watchability_js_1.buildPlanetWatchState)(world);
assert_1.strict.equal(falloff.nextWatch.kind, 'ore_falloff');
assert_1.strict.match(falloff.nextWatch.detail, /ore/i);
console.log('planet strategy watchability smoke passed');
