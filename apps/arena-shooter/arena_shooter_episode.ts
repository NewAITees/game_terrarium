import { QLearningAgent } from './arena_shooter_agent.js';
import {
  createArenaState,
  observeArena,
  resetEpisode,
  setCraftPreference,
  stepArena,
  type ArenaState,
  type CraftPreference,
} from './arena_shooter_core.js';
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
  reward: number;
  outcome: 'defeat' | 'timeout';
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
): ArenaEpisodeResult {
  // Arena spawning is currently deterministic without consuming a seeded RNG;
  // the seed is retained in the contract for future initial-state variation.
  const state = createArenaState(960, 540);
  state.rngState = seed | 0;
  setCraftPreference(state, craftPreference, false);
  resetEpisode(state);
  const run = createRunProgress();
  const meta = { damageResearch: 0, hullResearch: 0, ascendium: 0 };
  let elapsed = 0;
  let reward = 0;
  while (elapsed < maxSeconds && state.ship.hp > 0) {
    applyArenaProgressToState(state, run, meta);
    const decision = agent.decide(observeArena(state), dt, reward);
    const result = stepArena(state, decision.action, dt);
    reward = result.reward;
    for (const value of result.killedValues) addKillProgress(run, value, state.wave);
    while (run.pendingUpgrades > 0) {
      const choices = getUpgradeChoices(run, state.ship.craftType);
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
    reward: state.episodeReward,
    outcome: defeated ? 'defeat' : 'timeout',
  };
}
