import assert from 'node:assert/strict';
import test from 'node:test';
import { DoubleDqnAgent } from '../shared/rl/double_dqn_agent.js';
import { mulberry32 } from '../shared/rl/random.js';

const actions = ['left', 'right'] as const;
const createAgent = (seed: number) => new DoubleDqnAgent<number[], typeof actions[number]>({
  actions,
  inputSize: 2,
  hiddenSize: 8,
  encode: (value) => value,
  batchSize: 4,
  warmupSteps: 4,
  targetSyncSteps: 2,
  random: mulberry32(seed),
});

test('Double DQN is deterministic with a seeded initialization, exploration, and replay stream', () => {
  const left = createAgent(71);
  const right = createAgent(71);
  for (let step = 0; step < 20; step += 1) {
    const observation = [step % 2, (step + 1) % 2];
    assert.deepEqual(left.decide(observation), right.decide(observation));
    left.observe(observation, step % 3 - 1);
    right.observe(observation, step % 3 - 1);
  }
  left.finishEpisode(-2);
  right.finishEpisode(-2);
  assert.deepEqual(left.serialize(), right.serialize());
  assert.ok(left.gradientSteps > 0);
});

test('Double DQN evaluation is greedy and cannot mutate its model', () => {
  const agent = createAgent(19);
  for (let step = 0; step < 8; step += 1) {
    agent.decide([step % 2, 1]);
    agent.observe([step % 2, 0], 1);
  }
  agent.setEvaluationMode(true);
  const before = agent.serialize();
  assert.equal(agent.decide([1, 0]).exploratory, false);
  agent.observe([0, 1], 100);
  agent.finishEpisode(100);
  assert.deepEqual(agent.serialize(), before);
});

test('Double DQN rejects model tensors with incompatible shapes', () => {
  const source = createAgent(5);
  source.decide([1, 0]);
  const save = source.serialize();
  const incompatible = new DoubleDqnAgent<number[], string>({
    actions: ['a', 'b', 'c'], inputSize: 2, hiddenSize: 8, encode: (value) => value, random: mulberry32(5),
  });
  incompatible.restore(save);
  assert.equal(incompatible.trainingSteps, 0);
});

test('Double DQN rejects non-finite checkpoint metadata', () => {
  const source = createAgent(8);
  source.decide([1, 0]);
  const corrupt = { ...source.serialize(), epsilon: Number.NaN };
  const restored = createAgent(9);
  restored.restore(corrupt);
  assert.equal(restored.trainingSteps, 0);
  assert.ok(Number.isFinite(restored.epsilon));
});
