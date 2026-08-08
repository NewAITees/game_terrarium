import { QLearningAgent } from './arena_shooter_agent.js';
import {
  ACTIONS,
  createArenaState,
  observeArena,
  nextArenaRandom,
  resetEpisode,
  setCraftPreference,
  stepArena,
  type ArenaState,
  type CraftPreference,
  DEFAULT_ARENA_REWARD_WEIGHTS,
  type ArenaRewardWeights,
} from './arena_shooter_core.js';
import { rewardBreakdown, type RewardBreakdown } from '../../shared/rl/runtime_types.js';
import {
  addKillProgress,
  applyUpgrade,
  ascensionPower,
  createRunProgress,
  getUpgradeChoices,
  type ArenaMetaProgress,
  type ArenaRunProgress,
} from './arena_shooter_progression.js';

export type ArenaEpisodeResult = {
  seed: number;
  wave: number;
  seconds: number;
  kills: number;
  /** What the learner was paid, by channel. Every weight here is tunable, so none of it scores a run. */
  channels: RewardBreakdown;
  /**
   * The score: waves cleared, with the fraction of the episode cap survived as the tie-break.
   *
   * The three games needed three different scores, and the reason is the regime each one sits in.
   * Here the ship always dies well inside the cap, so hull remaining is always zero and waves alone
   * are nearly binary — time is the only thing that separates two runs. Drone Bastion is the mirror
   * image: nothing ever kills the tower inside the cap, so time saturates and the tower's condition
   * is what discriminates. Picking per game is not inconsistency; using one score everywhere would
   * mean ranking most configurations equal in at least one of them.
   */
  taskReturn: number;
  hpFraction: number;
  reward: number;
  outcome: 'defeat' | 'timeout';
  terminated: boolean;
  truncated: boolean;
};

export function applyArenaProgressToState(
  state: ArenaState,
  run: ArenaRunProgress,
  meta: Pick<ArenaMetaProgress, 'damageResearch' | 'hullResearch' | 'ascendium'>,
): void {
  state.pulseLevel = run.weapons.pulse;
  state.fireRateLevel = run.fireRateLevel;
  state.projectileCountLevel = run.projectileCountLevel;
  state.projectileSpeedLevel = run.projectileSpeedLevel;
  state.projectileInterceptLevel = run.projectileInterceptLevel;
  state.turretTurnLevel = run.turretTurnLevel;
  state.missileLevel = run.weapons.missile;
  state.novaLevel = run.weapons.nova;
  state.laserLevel = run.weapons.laser;
  state.ricochetLevel = run.weapons.ricochet;
  state.trailLevel = run.weapons.trail;
  state.damageMultiplier = 1.18 ** meta.damageResearch * ascensionPower(meta as ArenaMetaProgress);
  const maxHp = Math.round(100 * 1.2 ** meta.hullResearch);
  if (state.ship.maxHp !== maxHp) {
    const ratio = state.ship.hp / state.ship.maxHp;
    state.ship.maxHp = maxHp;
    state.ship.hp = Math.max(1, Math.round(maxHp * ratio));
  }
}

export function runArenaEpisode(
  agent: QLearningAgent,
  seed: number,
  maxSeconds: number,
  craftPreference: CraftPreference = 'random',
  dt = 1 / 60,
  rewards: ArenaRewardWeights = DEFAULT_ARENA_REWARD_WEIGHTS,
): ArenaEpisodeResult {
  // The seed drives `state.rngState`, which spawning and craft selection both consume, so two seeds
  // are two genuinely different episodes. (An older comment here claimed otherwise; it was stale,
  // and `verifyContract`'s environment fingerprint is what now keeps the claim honest.)
  const state = createArenaState(960, 540, rewards);
  state.rngState = seed | 0;
  setCraftPreference(state, craftPreference, false);
  resetEpisode(state);
  const run = createRunProgress();
  const meta = { damageResearch: 0, hullResearch: 0, ascendium: 0 };
  let elapsed = 0;
  let reward = 0;
  const totals = { task: 0, progress: 0, safety: 0, behavior: 0 };
  while (elapsed < maxSeconds && state.ship.hp > 0) {
    applyArenaProgressToState(state, run, meta);
    const decision = agent.decide(observeArena(state), dt, reward);
    const result = stepArena(state, decision.action, dt);
    totals.task += result.reward.task;
    totals.progress += result.reward.progress;
    totals.safety += result.reward.safety;
    totals.behavior += result.reward.behavior;
    reward = result.reward.total;
    for (const value of result.killedValues) addKillProgress(run, value, state.wave);
    while (run.pendingUpgrades > 0) {
      const choices = getUpgradeChoices(run, state.ship.craftType, () => nextArenaRandom(state));
      const selected = agent.chooseUpgrade(state.ship.craftType, choices, state.wave).choice;
      applyUpgrade(run, selected, () => {
        state.ship.hp = Math.min(state.ship.maxHp, state.ship.hp + state.ship.maxHp * .3);
      });
    }
    elapsed += dt;
  }
  const defeated = state.ship.hp <= 0;
  agent.finishEpisode(defeated ? reward - 12 : 0);
  return {
    seed,
    wave: state.wave,
    seconds: elapsed,
    kills: state.kills,
    channels: rewardBreakdown(totals),
    taskReturn: state.wave - 1 + elapsed / maxSeconds,
    hpFraction: Math.max(0, state.ship.hp) / state.ship.maxHp,
    reward: state.episodeReward,
    outcome: defeated ? 'defeat' : 'timeout',
    terminated: defeated,
    truncated: !defeated,
  };
}

/**
 * A fingerprint of the world a seed produces, sampled without a learned policy.
 *
 * Arena's opening is not fixed — the seed picks the craft and the first spawn positions — but the
 * interesting variation arrives over the first few seconds, so the probe holds one action and
 * records what turns up. Built from `createArenaState`/`stepArena` so it cannot keep passing after
 * the real environment stops varying.
 */
export function fingerprintArenaStart(
  seed: number,
  rewards: ArenaRewardWeights = DEFAULT_ARENA_REWARD_WEIGHTS,
  seconds = 6,
  dt = 1 / 60,
): string {
  const state = createArenaState(960, 540, rewards);
  state.rngState = seed | 0;
  setCraftPreference(state, 'random', false);
  resetEpisode(state);
  const idle = ACTIONS.find((action) => (
    action.thrust === 0 && action.turn === 0 && action.strafe === 0 && action.aimTurn === 0 && !action.fire
  )) ?? ACTIONS[0];
  const arrivals: string[] = [];
  const seen = new Set<number>();
  for (let step = 0; step < seconds / dt; step += 1) {
    stepArena(state, idle, dt);
    for (const enemy of state.enemies) {
      if (seen.has(enemy.id)) continue;
      seen.add(enemy.id);
      arrivals.push(`${enemy.kind}@${Math.round(enemy.x)},${Math.round(enemy.y)}`);
    }
  }
  return `${state.ship.craftType}#${arrivals.join('|')}`;
}
