import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedPlan, holdoutSeed, isHoldoutSeed, trainingSeed } from '../shared/rl/seed_plan.js';

test('training and hold-out seeds can never overlap', () => {
  const plan = createSeedPlan(256, 32);
  const train = new Set(plan.train);
  assert.equal(plan.holdout.some((seed) => train.has(seed)), false);
  assert.equal(plan.train.every((seed) => !isHoldoutSeed(seed)), true);
  assert.equal(plan.holdout.every(isHoldoutSeed), true);
});

test('a training range that would reach the hold-out base is rejected', () => {
  assert.throws(() => createSeedPlan(1_000_000, 8), /collide/);
  assert.throws(() => createSeedPlan(0, 8), /positive integer/);
});

test('seeds cycle so episode count and seed count stay independent', () => {
  const plan = createSeedPlan(4, 2);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((episode) => trainingSeed(plan, episode)), [1, 2, 3, 4, 1, 2]);
  assert.deepEqual([0, 1, 2].map((episode) => holdoutSeed(plan, episode)), [1_000_000, 1_000_001, 1_000_000]);
});
