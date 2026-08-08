import assert from 'node:assert/strict';
import test from 'node:test';
import { DroneBastionDqnAgent, vectorizeDroneBastionObservation } from '../apps/drone-bastion/drone_bastion_dqn_agent.js';
import { createDroneBastionState, observeDroneBastion } from '../apps/drone-bastion/drone_bastion_core.js';
import { runDroneBastionEpisode } from '../apps/drone-bastion/drone_bastion_episode.js';
import { mulberry32 } from '../shared/rl/random.js';

test('Drone DQN keeps both observation variants at 96 finite values', () => {
  const observation = observeDroneBastion(createDroneBastionState(1200, 760, 3));
  for (const variant of ['minimal', 'engineered'] as const) {
    const vector = vectorizeDroneBastionObservation(observation, variant);
    assert.equal(vector.length, 96);
    assert.ok(vector.every(Number.isFinite));
  }
});

test('Drone Double DQN runs the same core episode and preserves evaluation models', () => {
  const agent = new DroneBastionDqnAgent('engineered', mulberry32(81));
  const training = runDroneBastionEpisode(agent, 12, 3);
  assert.ok(training.seconds >= 3);
  assert.ok(agent.trainingSteps > 0);
  const before = agent.serialize();
  agent.setEvaluationMode(true);
  runDroneBastionEpisode(agent, 900, 3);
  assert.deepEqual(agent.serialize(), before);
});
