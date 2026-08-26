import assert from 'node:assert/strict';
import test from 'node:test';
import { QLearningAgent } from '../apps/arena-shooter/arena_shooter_agent';
import { createArenaState, observeArena, stepArena } from '../apps/arena-shooter/arena_shooter_core';
import { getUpgradeChoices, createRunProgress } from '../apps/arena-shooter/arena_shooter_progression';

test('Arena evaluation playback cannot mutate the training model', () => {
  const state = createArenaState(800, 600);
  const agent = new QLearningAgent();
  agent.setEvaluationMode(true);
  const before = agent.serialize();
  const decision = agent.decide(observeArena(state), .2, 6);
  stepArena(state, decision.action, .2);
  agent.chooseUpgrade(state.ship.craftType, getUpgradeChoices(createRunProgress()), state.wave);
  agent.finishEpisode(-12);
  assert.deepEqual(agent.serialize(), before);
});

test('Arena migrates the legacy full-policy save but rejects it for another table shape', () => {
  const source = new QLearningAgent();
  const state = createArenaState(800, 600);
  source.decide(observeArena(state), .2, 0);
  const legacy = { ...source.serialize(), policyVersion: 2 as const, observation: undefined, actions: undefined };
  const migrated = new QLearningAgent();
  migrated.restore(legacy);
  assert.equal(migrated.trainingSteps, source.trainingSteps);
  const incompatible = new QLearningAgent({ observation: 'minimal' });
  incompatible.restore(legacy);
  assert.equal(incompatible.trainingSteps, 0);
  const incompatibleLearner = new QLearningAgent({ learnerVariant: 'tabular-3step' });
  incompatibleLearner.restore(legacy);
  assert.equal(incompatibleLearner.trainingSteps, 0);
});
