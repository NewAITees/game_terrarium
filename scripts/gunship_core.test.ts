import assert from 'node:assert/strict';
import test from 'node:test';
import { airframeById } from '../apps/gunship/gunship_airframes';
import { stepGunshipCore, type GunshipCoreState } from '../apps/gunship/gunship_core';
import { spawnWave } from '../apps/gunship/gunship_enemies';
import type { GunshipAction, GunshipBody } from '../apps/gunship/gunship_physics';
import { createRunProgress } from '../apps/gunship/gunship_progression';
import { GunshipAgent } from '../apps/gunship/gunship_rl';

const actions: readonly GunshipAction[] = [
  { turn: 0, thrust: true, fire: false, label: 'climb' },
  { turn: 1, thrust: true, fire: true, label: 'track' },
  { turn: -1, thrust: false, fire: true, label: 'burst' },
  { turn: 0, thrust: false, fire: false, label: 'coast' },
];

test('the shared Gunship core is deterministic for identical state and actions', () => {
  const left = createState();
  const right = createState();
  const leftResults = [];
  const rightResults = [];

  for (let index = 0; index < 360; index += 1) {
    const action = actions[index % actions.length];
    leftResults.push(stepGunshipCore(left, action, 1 / 60));
    rightResults.push(stepGunshipCore(right, action, 1 / 60));
  }

  assert.deepEqual(rightResults, leftResults);
  assert.deepEqual(right, left);
});

test('the shared Gunship core owns reward and terminal results', () => {
  const state = createState();
  state.ship.y = 900;
  const result = stepGunshipCore(state, actions[0], 1 / 60);
  assert.equal(result.fell, true);
  assert.equal(result.finalReward, -16);
  assert.ok(result.reward < -15);
});

test('Gunship evaluation mode never changes its serialized training model', () => {
  const state = createState();
  const agent = new GunshipAgent();
  agent.setEvaluationMode(true);
  const before = agent.serialize();
  const decision = agent.decide(state.ship, state.enemies, state.enemyShots, 1 / 60, 3);
  stepGunshipCore(state, decision.action, 1 / 60);
  agent.decideUpgrade({ offer: ['thrust', 'turn', 'damage'], level: 2 }, 8);
  agent.finishEpisode(-16);
  assert.deepEqual(agent.serialize(), before);
});

function createState(): GunshipCoreState {
  const airframe = airframeById('interceptor');
  const ship: GunshipBody = {
    x: 600,
    y: 260,
    vx: 0,
    vy: 0,
    angle: Math.PI / 2,
    hp: airframe.maxHp,
    maxHp: airframe.maxHp,
    fireCooldown: 0,
    thrust: airframe.thrust,
    turn: airframe.turn,
    thrustTurnK: airframe.thrustTurnK,
    drag: airframe.drag,
  };
  const enemies = spawnWave(1, 50);
  return {
    ship,
    enemies,
    enemyShots: [],
    bullets: [],
    run: createRunProgress(),
    airframe,
    wave: 1,
    nextId: 50 + enemies.length,
    missileCooldown: 0,
    elapsed: 0,
  };
}
