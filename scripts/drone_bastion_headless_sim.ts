import assert from 'node:assert/strict';
import { DroneBastionAgent } from '../apps/drone-bastion/drone_bastion_agent';
import {
  applyBastionUpgrade,
  createDroneBastionState,
  observeDroneBastion,
  resetDroneBastionEpisode,
  stepDroneBastion,
} from '../apps/drone-bastion/drone_bastion_core';

const agent = new DroneBastionAgent();
const state = createDroneBastionState(1200, 760, 77);
const dt = 0.05;
const minutesArgument = process.argv.indexOf('--minutes');
const simulatedMinutes = minutesArgument >= 0
  ? Math.max(1, Number(process.argv[minutesArgument + 1]) || 12)
  : 12;
let reward = 0;
let episodes = 0;
let upgrades = 0;
const episodeResults: Array<{ wave: number; seconds: number; kills: number; reward: number }> = [];

for (let step = 0; step < simulatedMinutes * 60 / dt; step += 1) {
  const decision = agent.decide(observeDroneBastion(state), dt, reward);
  const result = stepDroneBastion(state, decision.action, dt);
  reward = result.reward;
  if (state.pendingUpgrade) {
    applyBastionUpgrade(state, agent.chooseUpgrade(state));
    upgrades += 1;
  }
  if (state.gameOver) {
    episodeResults.push({
      wave: state.wave,
      seconds: state.episodeTime,
      kills: state.kills,
      reward: state.episodeReward,
    });
    agent.finishEpisode(reward);
    resetDroneBastionEpisode(state);
    episodes += 1;
    reward = 0;
  }
}

assert.ok(agent.trainingSteps > 1000, 'agent should make many combat decisions');
assert.ok(agent.knownStates > 20, 'agent should encounter varied defense states');
assert.ok(state.nextEnemyId > 1, 'waves should spawn enemies');
assert.ok(Number.isFinite(state.episodeReward), 'episode reward should remain finite');

const save = agent.serialize();
const restored = new DroneBastionAgent();
restored.restore(save);
assert.equal(restored.trainingSteps, agent.trainingSteps);
assert.equal(restored.knownStates, agent.knownStates);

const windowSize = Math.max(1, Math.min(10, Math.floor(episodeResults.length / 3)));
const summarize = (results: typeof episodeResults) => ({
  episodes: results.length,
  averageWave: average(results.map((result) => result.wave)),
  averageSeconds: average(results.map((result) => result.seconds)),
  averageKills: average(results.map((result) => result.kills)),
  averageReward: average(results.map((result) => result.reward)),
});

console.log(JSON.stringify({
  simulatedMinutes,
  episodes,
  upgrades,
  currentWave: state.wave,
  score: state.score,
  towerHp: Math.round(state.tower.hp),
  fleet: state.drones.length,
  trainingSteps: agent.trainingSteps,
  knownStates: agent.knownStates,
  epsilon: Number(agent.epsilon.toFixed(4)),
  early: summarize(episodeResults.slice(0, windowSize)),
  late: summarize(episodeResults.slice(-windowSize)),
}));

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
