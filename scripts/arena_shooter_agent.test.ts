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
