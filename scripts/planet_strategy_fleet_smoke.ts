import { strict as assert } from 'assert';
import { getActiveAttackRoutes, synchronizeFleetSpeed } from '../shared/planet_strategy_fleet.js';

const fleet = [{ kind: 'attacker', speed: 0.9 }, { kind: 'gunship', speed: 0.65 }, { kind: 'transport', speed: 1.2 }] as any[];
synchronizeFleetSpeed(fleet);
assert.equal(fleet[0].speed, 0.65);
assert.equal(fleet[1].speed, 0.65);
assert.equal(fleet[2].speed, 1.2);

const routeKey = (a: string, b: string): string => [a, b].sort().join(':');
const empires = [{ id: 0, color: '#ff0000' }, { id: 1, color: '#00ff00' }] as any[];
const attackShip = { kind: 'attacker', status: 'traveling', targetPlanetId: 'b', fromPlanetId: 'a', toPlanetId: 'b', owner: 0 };
assert.equal(getActiveAttackRoutes([attackShip] as any[], empires, routeKey).get('a:b')?.color, '#ff0000');
for (const status of ['launching', 'traveling', 'approaching', 'engaging']) assert.equal(getActiveAttackRoutes([{ ...attackShip, status }] as any[], empires, routeKey).has('a:b'), true);
for (const status of ['orbiting', 'docked', 'loading', 'unloading']) assert.equal(getActiveAttackRoutes([{ ...attackShip, status }] as any[], empires, routeKey).has('a:b'), false);
assert.equal(getActiveAttackRoutes([{ ...attackShip, kind: 'transport' }] as any[], empires, routeKey).size, 0);
const contested = getActiveAttackRoutes([attackShip, { ...attackShip, owner: 1 }, { ...attackShip, owner: 1 }] as any[], empires, routeKey);
assert.deepEqual(contested.get('a:b'), { owner: 1, color: '#00ff00', shipCount: 2 });
console.log('planet strategy fleet smoke passed');
