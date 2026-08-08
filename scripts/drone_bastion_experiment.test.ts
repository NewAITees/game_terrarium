import assert from 'node:assert/strict';
import test from 'node:test';
import { createDroneBastionState, observeDroneBastion } from '../apps/drone-bastion/drone_bastion_core.js';
import { mulberry32 } from '../shared/rl/random.js';
import { validateSpec } from '../shared/rl/experiment_spec.js';
import {
  createDroneBastionAdapter,
  defaultDroneBastionSpec,
  DRONE_BASTION_SEARCH_SPACE,
  resolveDroneBastionRewards,
} from './rl/drone_bastion_experiment.js';

test('Drone Bastion exposes its fixed 96-value engineered observation', () => {
  const observation = observeDroneBastion(createDroneBastionState(1200, 760, 17));
  assert.equal(observation.dense.length, 96);
  assert.ok(observation.dense.every(Number.isFinite));
  validateSpec({ ...defaultDroneBastionSpec(), observation: 'minimal' }, DRONE_BASTION_SEARCH_SPACE);
  validateSpec({ ...defaultDroneBastionSpec(), observation: 'engineered' }, DRONE_BASTION_SEARCH_SPACE);
});

test('sparse Drone Bastion reward removes shaping and retains only terminal defeat', () => {
  const spec = {
    ...defaultDroneBastionSpec(),
    reward: { ...defaultDroneBastionSpec().reward, mode: 'sparse' as const },
  };
  const rewards = resolveDroneBastionRewards(spec);
  assert.equal(rewards.defeat, spec.reward.weights.defeat);
  assert.deepEqual(
    Object.entries(rewards).filter(([key]) => key !== 'defeat').map(([, value]) => value),
    Array(Object.keys(rewards).length - 1).fill(0),
  );
});

test('seeded Drone Bastion research sessions replay training and hold-out exactly', () => {
  const adapter = createDroneBastionAdapter();
  const spec = {
    ...defaultDroneBastionSpec(),
    observation: 'minimal',
    budget: { ...defaultDroneBastionSpec().budget, capSeconds: 3 },
  };
  const left = adapter.createSession(spec, mulberry32(991));
  const right = adapter.createSession(spec, mulberry32(991));
  assert.deepEqual(left.train(41), right.train(41));
  assert.deepEqual(left.evaluate(77), right.evaluate(77));
  assert.equal(left.trainingSteps, right.trainingSteps);
});

test('Drone Bastion declares both reward modes and rejects an undeclared one', () => {
  assert.deepEqual(DRONE_BASTION_SEARCH_SPACE.rewardModes, ['sparse', 'shaped']);
  assert.throws(
    () => validateSpec({ ...defaultDroneBastionSpec(), reward: { mode: 'mystery' as 'shaped', weights: {} } }, DRONE_BASTION_SEARCH_SPACE),
    /unknown reward mode/,
  );
});
