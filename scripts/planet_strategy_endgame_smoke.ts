import { strict as assert } from 'assert';
import { createPlanetStrategyCombatRuntime } from '../apps/planet-strategy/planet_strategy_combat.js';
import { createPlanetStrategyBootstrap } from '../apps/planet-strategy/planet_strategy_bootstrap.js';
import { createPlanetStrategyMatchRuntime } from '../apps/planet-strategy/planet_strategy_match.js';
import { pickStableGoal } from '../apps/planet-strategy/planet_strategy_ai_goals.js';
import { buildPlanetWatchState } from '../shared/planet_strategy_watchability.js';

const bootstrap = createPlanetStrategyBootstrap({
  colors: ['#fff', '#f00', '#0f0'],
  distance3d: (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  personalities: [
    { key: 'expansionist', summary: 'test' },
    { key: 'fortifier', summary: 'test' },
    { key: 'industrialist', summary: 'test' },
  ],
  rng: () => 0.5,
  victoryMode: 'conquest',
});
assert.equal(bootstrap.world.victoryMode, 'conquest', 'bootstrap must retain the requested victory mode');

const ships = Array.from({ length: 8 }, (_, index) => ({ id: `s${index}`, owner: 0, kind: 'attacker', status: 'docked', homePlanetId: 'a', speed: 1, position: { x: 0, y: 0, z: 0 } }));
const world: any = { time: 20, victoryMode: 'conquest', empires: [{ id: 0, name: 'Aster Union', goal: 'pressure', collapsed: false }], ships, missiles: [], planets: [
  { id: 'a', label: 'Aster', owner: 0, x: 0, y: 0, z: 0 }, { id: 'b', label: 'Red', owner: 1, x: 80, y: 0, z: 0 }, { id: 'c', label: 'Verdant', owner: 2, x: 120, y: 0, z: 0 },
] };
const combat = createPlanetStrategyCombatRuntime({ world, getPlanet: (id: string) => world.planets.find((planet: any) => planet.id === id), distance3d: (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), rng: () => 0.1, touchRoute: () => {}, logEvent: () => {}, maybeLog: () => {} });
combat.decideAttacks();
const launched = world.ships.filter((ship: any) => ship.status === 'launching');
assert.equal(new Set(launched.map((ship: any) => ship.id)).size, launched.length);
assert.equal(new Set(launched.map((ship: any) => ship.targetPlanetId)).size, 2);
assert.equal(buildPlanetWatchState(world).nextWatch.kind, 'split_front');

const seeded = [0.1, 0.4, 0.6, 0.2];
const first: any = { goal: 'stabilize', aiOpportunityUntil: 0 };
const second: any = { goal: 'stabilize', aiOpportunityUntil: 0 };
const makeRng = () => { let i = 0; return () => seeded[i++ % seeded.length]; };
assert.equal(pickStableGoal(first, { time: 30 }, makeRng(), { expand: 1, pressure: 1, stabilize: 1 }), pickStableGoal(second, { time: 30 }, makeRng(), { expand: 1, pressure: 1, stabilize: 1 }));
assert.equal(pickStableGoal(first, { time: 31 }, makeRng(), { expand: 1, pressure: 1, stabilize: 1 }), first.goal);
assert.equal(world.victoryMode, 'conquest');

const modeWorld: any = { ...world, time: 999, gameOver: false, oreFalloffStart: null, routes: new Map(), finalScores: [], finalSummary: '', finalDetail: '', endReason: null, winnerId: null,
  empires: [{ id: 0, name: 'Aster Union', collapsed: false, delivered: 0, producedShips: 0 }, { id: 1, name: 'Red Meridian', collapsed: false, delivered: 0, producedShips: 0 }],
  planets: [{ id: 'a', owner: 0 }, { id: 'b', owner: 1 }], ships: [] };
const match = createPlanetStrategyMatchRuntime({ world: modeWorld, getPlanet: () => null, logEvent: () => {}, maybeLog: () => {}, rendererView: {}, ui: { update: () => {}, log: () => {} }, matchEndSeconds: 480, matchForceEndSeconds: 600, tieBreakDelta: 0, factoryStallCollapseSeconds: 90 });
match.evaluateMatchState();
assert.equal(modeWorld.gameOver, false, 'conquest mode must ignore the score race timer');
modeWorld.empires[1].collapsed = true;
match.evaluateMatchState();
assert.equal(modeWorld.gameOver, true, 'conquest mode ends when one empire remains');
console.log('planet strategy endgame smoke passed');
