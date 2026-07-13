import assert from 'node:assert/strict';
import test from 'node:test';
import { createColonySimulation } from '../apps/colony/colony_simulation';
import { clamp, averageNeighbors } from '../apps/network-ecosystem/network_ecosystem_ecology';
import { buildObserverSummary } from '../apps/network-defense/network_defense_observer_mode';
import { buildRuleSnapshot, evalRuleCondition } from '../apps/network-defense/network_defense_rules';
import { baseGoalWeights, pickGoal } from '../apps/planet-strategy/planet_strategy_ai_goals';

test('AI Colony simulation gathers resources for owned territory', () => {
  const base: any = { id: 0, owner: 0, strength: 1, food: 5, material: 5, isBase: true, neighbors: [] };
  const faction: any = { id: 0, name: 'Verdant', personality: 'builder', food: 10, material: 0, nodes: [base], baseNode: base, alive: true, intent: '' };
  const simulation = createColonySimulation({
    cost: { expand: 2, attack: 2, fortify: 2, gather: 0 },
    decayByPersonality: { builder: 0, raider: 0, hoarder: 0 },
    factions: [faction], factionRules: {}, foodCap: 100, map: { nodes: [base] }, neutralResist: 0,
    logEvent: () => {}, performanceNow: () => 0, spawnPulse: () => {},
  });
  assert.equal(simulation.execAction(faction, 'gather'), true);
  assert.equal(faction.food, 10.9);
  assert.equal(faction.material, 0.45);
});

test('Network Defense builds rule snapshots and evaluates threshold rules', () => {
  const server = { id: 0, infection: 0, hp: 80 };
  const infected = { id: 1, infection: 0.6, hp: 90 };
  const snapshot = buildRuleSnapshot({ now: 1, adj: new Map([[0, [infected]]]), topo: { server, nodes: [server, infected] }, agents: [{ rank: 'senior' }], enemyPackets: [{}, {}], firewalls: new Map([[1, {}]]), game: { rule: 'contain', wave: 3, credits: 120 } });
  assert.equal(snapshot.hottestInfection, 0.6);
  assert.equal(evalRuleCondition({ enemyCount: 2, serverHpBelow: 90, waveGte: 3 }, snapshot), true);
  assert.equal(evalRuleCondition('hottestInfection > 0.5 && seniorCount === 1', snapshot), true);
});

test('Network Ecosystem clamps values and averages neighboring ecology', () => {
  const node = { id: 1 };
  const neighbors = [{ threat: 0.2 }, { threat: 0.6 }];
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(averageNeighbors(node, new Map([[1, neighbors]]), 'threat'), 0.4);
});

test('AI Planet Strategy goal selection respects personality weights', () => {
  const weights = baseGoalWeights('raider');
  assert.equal(pickGoal(() => 0.2, weights), 'pressure');
  assert.equal(pickGoal(() => 0.99, weights), 'stabilize');
});

test('Network Defense observer summary highlights critical server pressure', () => {
  const server = { id: 0, isServer: true, hp: 65, maxHp: 100, infection: 0, layer: 'core' };
  const topo = { server, nodes: [server, { id: 1, isServer: false, hp: 100, maxHp: 100, infection: 0.2, layer: 'acc' }] };
  assert.match(buildObserverSummary(topo, [], []).text, /server core/i);
});
