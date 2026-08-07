import { DroneBastionAgent } from './drone_bastion_agent.js';
import {
  applyBastionUpgrade,
  createDroneBastionState,
  observeDroneBastion,
  stepDroneBastion,
} from './drone_bastion_core.js';

export type DroneBastionEpisodeResult = {
  seed: number;
  wave: number;
  seconds: number;
  kills: number;
  reward: number;
  outcome: 'defeat' | 'timeout';
};

export function runDroneBastionEpisode(
  agent: DroneBastionAgent,
  seed: number,
  maxSeconds: number,
  dt = 0.05,
): DroneBastionEpisodeResult {
  const state = createDroneBastionState(1200, 760, seed);
  let reward = 0;
  while (state.episodeTime < maxSeconds && !state.gameOver) {
    const decision = agent.decide(observeDroneBastion(state), dt, reward);
    reward = stepDroneBastion(state, decision.action, dt).reward;
    if (state.pendingUpgrade) applyBastionUpgrade(state, agent.chooseUpgrade(state));
  }
  agent.finishEpisode(state.gameOver ? reward : 0);
  return {
    seed,
    wave: state.wave,
    seconds: state.episodeTime,
    kills: state.kills,
    reward: state.episodeReward,
    outcome: state.gameOver ? 'defeat' : 'timeout',
  };
}
