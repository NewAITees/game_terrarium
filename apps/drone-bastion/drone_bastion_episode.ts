import { DRONE_BASTION_ACTIONS } from './drone_bastion_agent.js';
import {
  applyBastionUpgrade,
  createDroneBastionState,
  observeDroneBastion,
  stepDroneBastion,
  DEFAULT_DRONE_BASTION_REWARD_WEIGHTS,
  type DroneBastionRewardWeights,
} from './drone_bastion_core.js';
import { rewardBreakdown, type RewardBreakdown } from '../../shared/rl/runtime_types.js';

export type DroneBastionEpisodeResult = {
  seed: number;
  wave: number;
  seconds: number;
  kills: number;
  /** What the learner was paid, by channel. Every weight here is tunable, so none of it scores a run. */
  channels: RewardBreakdown;
  /**
   * The score: waves cleared, plus how much of the tower is left standing.
   *
   * Seconds survived was the obvious choice and it was wrong — nearly every configuration reaches
   * the episode cap intact, so the score saturated and ranked everything equal. Waves keep coming,
   * so clearing them faster keeps paying, and the tower fraction separates two runs that reached the
   * same wave in different shape. Neither term is reachable from a reward weight.
   */
  taskReturn: number;
  towerHpFraction: number;
  reward: number;
  outcome: 'defeat' | 'timeout';
  terminated: boolean;
  truncated: boolean;
};

export type DroneBastionEpisodeAgent = {
  decide(observation: ReturnType<typeof observeDroneBastion>, dt: number, reward: number): { action: typeof DRONE_BASTION_ACTIONS[number] };
  chooseUpgrade(state: ReturnType<typeof createDroneBastionState>): 'deploy' | 'upgrade';
  finishEpisode(finalReward: number): void;
};

export function runDroneBastionEpisode(
  agent: DroneBastionEpisodeAgent,
  seed: number,
  maxSeconds: number,
  dt = 0.05,
  rewards: DroneBastionRewardWeights = DEFAULT_DRONE_BASTION_REWARD_WEIGHTS,
): DroneBastionEpisodeResult {
  const state = createDroneBastionState(1200, 760, seed, rewards);
  const totals = { task: 0, progress: 0, safety: 0, behavior: 0 };
  let reward = 0;
  while (state.episodeTime < maxSeconds && !state.gameOver) {
    const decision = agent.decide(observeDroneBastion(state), dt, reward);
    const step = stepDroneBastion(state, decision.action, dt);
    totals.task += step.reward.task;
    totals.progress += step.reward.progress;
    totals.safety += step.reward.safety;
    totals.behavior += step.reward.behavior;
    reward = step.reward.total;
    if (state.pendingUpgrade) applyBastionUpgrade(state, agent.chooseUpgrade(state));
  }
  agent.finishEpisode(state.gameOver ? reward : 0);
  return {
    seed,
    wave: state.wave,
    seconds: state.episodeTime,
    kills: state.kills,
    channels: rewardBreakdown(totals),
    taskReturn: state.wave - 1 + state.tower.hp / state.tower.maxHp,
    towerHpFraction: state.tower.hp / state.tower.maxHp,
    reward: state.episodeReward,
    outcome: state.gameOver ? 'defeat' : 'timeout',
    terminated: state.gameOver,
    truncated: !state.gameOver,
  };
}

/**
 * A fingerprint of the world a seed produces, sampled without a learned policy.
 *
 * Unlike gunship, this game's opening position is fixed — tower, walls and drones are identical
 * every time — and the seed only shows up in what spawns and when. So the probe rolls the world
 * forward on a single held action and records the arrivals. The action is constant, so anything
 * that differs between two runs came from the seed.
 */
export function fingerprintDroneBastionStart(
  seed: number,
  rewards: DroneBastionRewardWeights = DEFAULT_DRONE_BASTION_REWARD_WEIGHTS,
  seconds = 8,
  dt = 0.05,
): string {
  const state = createDroneBastionState(1200, 760, seed, rewards);
  const coast = DRONE_BASTION_ACTIONS[0];
  const arrivals: string[] = [];
  const seen = new Set<number>();
  while (state.episodeTime < seconds && !state.gameOver) {
    stepDroneBastion(state, coast, dt);
    for (const enemy of state.enemies) {
      if (seen.has(enemy.id)) continue;
      seen.add(enemy.id);
      arrivals.push(`${enemy.kind}@${Math.round(enemy.x)},${Math.round(enemy.y)}`);
    }
  }
  return arrivals.join('|');
}
