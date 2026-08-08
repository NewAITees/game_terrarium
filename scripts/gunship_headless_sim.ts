import { GunshipAgent, type GunshipActionVariant, type GunshipObservationVariant } from '../apps/gunship/gunship_rl.js';
import { AIRFRAMES, airframeById, type AirframeId } from '../apps/gunship/gunship_airframes.js';
import type { GunshipBody } from '../apps/gunship/gunship_physics.js';
import { spawnWave, type Enemy } from '../apps/gunship/gunship_enemies.js';
import { applyUpgrade, choicesFor, createRunProgress } from '../apps/gunship/gunship_progression.js';
import { weaponKind } from '../apps/gunship/gunship_weapons.js';
import {
  createGunshipCoreState,
  stepGunshipCore,
  type GunshipCoreState,
  type GunshipRewardWeights,
} from '../apps/gunship/gunship_core.js';
import { createSeedPlan, holdoutSeed, trainingSeed } from '../shared/rl/seed_plan.js';
import { rewardBreakdown, type RewardBreakdown } from '../shared/rl/runtime_types.js';
import { mulberry32 } from '../shared/rl/random.js';

/**
 * Headless driver for the same gunship_core used by the Electron player. It owns training cadence
 * and experiment knobs (density, cap, reward weights), but every rule that decides what happens on
 * a tick — physics, weapons, wave timing, rewards — lives in gunship_core and is never reimplemented
 * here. Anything that changes those rules changes both the live game and this trainer for free.
 */

const DT = 1 / 60;

/**
 * Everything about the episode that is not the policy. Passed per call rather than held in a
 * module global, because an automated search runs many configurations and a shared mutable knob
 * would silently leak one experiment's difficulty into another's.
 */
export type GunshipEnvironmentSpec = {
  capSeconds: number;
  density: number;
  hp: number;
  fireRate: number;
  maxChasers: number;
  rewards: GunshipRewardWeights;
};

// Defaults mirror apps/gunship/gunship_core.ts's DEFAULT_GUNSHIP_REWARD_WEIGHTS exactly.
export const DEFAULT_GUNSHIP_ENVIRONMENT: GunshipEnvironmentSpec = {
  capSeconds: 120,
  density: 1,
  hp: 1,
  fireRate: 1,
  maxChasers: 0,
  rewards: { survival: .6, ceiling: .09, death: -16, hpDeath: -9, kill: 1, hit: -1.5, wave: 8 },
};

// The craft can only shoot within +/-90 degrees of straight ahead, so with a
// near-empty sky most of its life is spent with nothing it can legally aim at.
// --density=N multiplies the airborne opposition to test that balance lever.
function densify(enemies: Enemy[], density: number, seed: number): Enemy[] {
  if (density <= 1) return enemies;
  const chasers = enemies.filter((enemy) => enemy.kind === 'chaser');
  const extra: Enemy[] = [];
  for (let copy = 1; copy < density; copy += 1) {
    for (const base of chasers) {
      extra.push({ ...base, id: base.id + 1000 * copy + seed, x: (base.x + copy * 311 + seed * 97) % 3540, y: 90 + ((base.y + copy * 137) % 420) });
    }
  }
  return [...enemies, ...extra];
}

// spawnWave now fields 7-16 chasers so the craft always has something aimable.
// --maxChasers isolates how much of the survival ceiling that density costs.
function capChasers(enemies: Enemy[], maxChasers: number): Enemy[] {
  if (maxChasers <= 0) return enemies;
  let kept = 0;
  return enemies.filter((enemy) => enemy.kind !== 'chaser' || ++kept <= maxChasers);
}

function slowFire(enemies: Enemy[], fireRate: number): Enemy[] {
  if (fireRate === 1) return enemies;
  for (const enemy of enemies) enemy.cooldown /= fireRate;
  return enemies;
}

function shapeWave(enemies: Enemy[], environment: GunshipEnvironmentSpec, seed: number): Enemy[] {
  const random = mulberry32(seed);
  const shaped = slowFire(capChasers(densify(enemies, environment.density, seed), environment.maxChasers), environment.fireRate);
  // Enemy ids are identity only; spawnWave positions do not otherwise consume them. Apply a small,
  // deterministic layout permutation here so train/hold-out seeds describe genuinely different
  // episodes without changing enemy counts or difficulty.
  for (const enemy of shaped) {
    enemy.x = 120 + ((enemy.x - 120 + Math.floor(random() * 3180)) % 3300);
    if (!['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'].includes(enemy.kind)) {
      enemy.y = Math.max(55, Math.min(650, enemy.y + (random() * 2 - 1) * 90));
    }
    enemy.cooldown *= .8 + random() * .4;
  }
  return shaped;
}

export type GunshipEpisodeResult = {
  seed: number;
  seconds: number;
  kills: number;
  wave: number;
  fell: boolean;
  /** What the learner was paid, by channel. Every weight here is tunable, so none of it can score a run. */
  channels: RewardBreakdown;
  /**
   * The score. Seconds survived — no weight, no knob, nothing an experiment can turn up.
   * A reward search is compared on this and never on `channels`.
   */
  taskReturn: number;
  terminated: boolean;
  truncated: boolean;
};

function freshShip(maxHp: number, seed: number): GunshipBody {
  const random = mulberry32(seed ^ 0xa511e9b3);
  return {
    x: 1350 + random() * 900,
    y: 235 + random() * 50,
    vx: (random() * 2 - 1) * 18,
    vy: (random() * 2 - 1) * 12,
    angle: Math.PI / 2 + (random() * 2 - 1) * .1,
    hp: maxHp,
    maxHp,
    fireCooldown: 0,
    thrust: 0,
    turn: 0,
    thrustTurnK: 0,
    drag: 0,
  };
}

/**
 * The world a seed produces, before anything acts in it. Shared by `runEpisode` and the contract's
 * environment fingerprint so the two can never drift: a check that builds its own copy of the
 * starting state would keep passing after the real one stopped varying.
 */
export function episodeStart(airframeId: AirframeId, environment: GunshipEnvironmentSpec, seed: number): { nextId: number; ship: GunshipBody; enemies: Enemy[] } {
  const airframe = airframeById(airframeId);
  const nextId = 50 + seed * 1000;
  return {
    nextId,
    ship: freshShip(Math.round(airframe.maxHp * environment.hp), seed),
    enemies: shapeWave(spawnWave(1, nextId), environment, seed),
  };
}

/** A stable summary of that world: positions and timings, with the identity-only ids left out. */
export function fingerprintEpisodeStart(airframeId: AirframeId, environment: GunshipEnvironmentSpec, seed: number): string {
  const { ship, enemies } = episodeStart(airframeId, environment, seed);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return JSON.stringify([
    [round(ship.x), round(ship.y), round(ship.vx), round(ship.vy), round(ship.angle)],
    enemies.map((enemy) => [enemy.kind, round(enemy.x), round(enemy.y), round(enemy.cooldown)]),
  ]);
}

// `seed` is deliberately required: defaulting it is how every episode silently ran the same
// wave layout, which trains and scores on one map and calls the result a learning curve.
export function runEpisode(agent: GunshipAgent, airframeId: AirframeId, environment: GunshipEnvironmentSpec, seed: number): GunshipEpisodeResult {
  const { capSeconds } = environment;
  const airframe = airframeById(airframeId);
  const { nextId, ship, enemies: initialEnemies } = episodeStart(airframeId, environment, seed);
  const state: GunshipCoreState = createGunshipCoreState(
    ship,
    createRunProgress(),
    airframe,
    nextId + initialEnemies.length,
    initialEnemies,
  );
  const totals = { task: 0, progress: 0, safety: 0, behavior: 0 };
  let episodeReward = 0;
  let lastReward = 0;
  let kills = 0;
  let upgradeRewardMark = 0;
  const rewards = environment.rewards;
  const createWave = (wave: number, id: number): Enemy[] => shapeWave(spawnWave(wave, id), environment, seed ^ Math.imul(wave, 0x9e3779b1));

  while (state.elapsed < capSeconds) {
    // Level-up resolves immediately here; the game gives a human 5s to override.
    if (state.run.pending > 0) {
      const offer = choicesFor(state.run);
      const slot = agent.decideUpgrade({ offer: offer.map((choice) => choice.id), level: state.run.level }, episodeReward - upgradeRewardMark);
      upgradeRewardMark = episodeReward;
      applyUpgrade(state.run, offer[Math.min(offer.length - 1, slot)]);
      continue;
    }
    const tactical = { weapon: weaponKind(state.run), recoveryDelay: state.combat.recoveryDelay };
    const action = agent.decide(state.ship, state.enemies, state.enemyShots, state.orbs, tactical, DT, lastReward).action;
    const result = stepGunshipCore(state, action, DT, { rewards, createWave, simulationTime: state.elapsed });
    totals.task += result.reward.task;
    totals.progress += result.reward.progress;
    totals.safety += result.reward.safety;
    totals.behavior += result.reward.behavior;
    episodeReward += result.reward.total;
    kills += result.kills;
    if (result.finalReward !== null) {
      agent.finishEpisode(result.finalReward);
      return { seed, seconds: state.elapsed, kills, wave: state.wave, fell: result.fell, channels: rewardBreakdown(totals), taskReturn: state.elapsed, terminated: true, truncated: false };
    }
    lastReward = result.reward.total;
  }
  // Timed out rather than died: treat as a neutral cut so the cap cannot be farmed.
  agent.finishEpisode(0);
  return { seed, seconds: state.elapsed, kills, wave: state.wave, fell: false, channels: rewardBreakdown(totals), taskReturn: state.elapsed, terminated: false, truncated: true };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function main(): void {
  const args = new Map(process.argv.slice(2).map((token) => {
    const [key, value = ''] = token.replace(/^--/, '').split('=');
    return [key, value];
  }));
  const episodes = Number(args.get('episodes') ?? 400);
  const bucket = Number(args.get('bucket') ?? 50);
  const number = (key: string, fallback: number): number => {
    const override = args.get(key);
    return override === undefined || override === '' ? fallback : Number(override);
  };
  const base = DEFAULT_GUNSHIP_ENVIRONMENT;
  const environment: GunshipEnvironmentSpec = {
    capSeconds: number('cap', base.capSeconds),
    density: number('density', base.density),
    hp: number('hp', base.hp),
    fireRate: number('fireRate', base.fireRate),
    maxChasers: number('maxChasers', base.maxChasers),
    rewards: {
      survival: number('survival', base.rewards.survival),
      ceiling: number('ceiling', base.rewards.ceiling),
      death: number('death', base.rewards.death),
      hpDeath: number('hpDeath', base.rewards.hpDeath),
      kill: number('kill', base.rewards.kill),
      hit: number('hit', base.rewards.hit),
      wave: number('wave', base.rewards.wave),
    },
  };
  const policy = {
    observation: (args.get('observation') || 'full') as GunshipObservationVariant,
    actions: (args.get('actions') || 'full') as GunshipActionVariant,
  };
  const requested = args.get('airframe');
  const airframes: AirframeId[] = requested
    ? [requested as AirframeId]
    : AIRFRAMES.map((frame) => frame.id);

  const repeats = Number(args.get('repeats') ?? 1);
  // Training cycles --trainSeeds distinct layouts; greedy evaluation only ever sees the
  // hold-out range, so a reward tweak cannot be scored on the maps it was fitted to.
  const seeds = createSeedPlan(Number(args.get('trainSeeds') ?? 64), Number(args.get('holdoutSeeds') ?? 32));

  for (const airframeId of airframes) {
    // One agent's curve is mostly noise at this episode count, so average the
    // per-block medians over independent agents before reading any trend.
    const runs: GunshipEpisodeResult[][] = [];
    const agents: GunshipAgent[] = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const agent = new GunshipAgent(policy);
      agents.push(agent);
      const single: GunshipEpisodeResult[] = [];
      for (let episode = 0; episode < episodes; episode += 1) {
        single.push(runEpisode(agent, airframeId, environment, trainingSeed(seeds, episode)));
      }
      runs.push(single);
    }
    const blockMedian = (start: number): number => mean(runs.map((run) => median(run.slice(start, start + bucket).map((entry) => entry.seconds))));
    const blockKills = (start: number): number => mean(runs.map((run) => mean(run.slice(start, start + bucket).map((entry) => entry.kills))));
    const blockFalls = (start: number): number => mean(runs.map((run) => run.slice(start, start + bucket).filter((entry) => entry.fell).length / Math.min(bucket, run.length - start)));

    console.log(`\n=== ${airframeId} (${episodes} episodes x ${repeats} agents, obs=${policy.observation} actions=${policy.actions}) ===`);
    console.log('  block          median   falls   kills/ep');
    const starts: number[] = [];
    for (let start = 0; start < episodes; start += bucket) starts.push(start);
    for (const start of starts) {
      console.log(
        `  ${String(start + 1).padStart(5)}-${String(Math.min(episodes, start + bucket)).padEnd(6)} `
        + `${blockMedian(start).toFixed(2).padStart(8)}s`
        + `${`${(blockFalls(start) * 100).toFixed(0)}%`.padStart(8)}`
        + `${blockKills(start).toFixed(2).padStart(11)}`,
      );
    }
    // How much of the learner's pay is shaping rather than the objective. A reward search that
    // drifts towards a high shaping share is buying its numbers, not learning the task.
    const finalBlock = runs.flatMap((run) => run.slice(starts[starts.length - 1]));
    const channel = (pick: (entry: GunshipEpisodeResult) => number): number => mean(finalBlock.map(pick));
    const task = channel((entry) => entry.channels.task);
    const progress = channel((entry) => entry.channels.progress);
    const safety = channel((entry) => entry.channels.safety);
    const behavior = channel((entry) => entry.channels.behavior);
    const magnitude = Math.abs(task) + Math.abs(progress) + Math.abs(safety) + Math.abs(behavior);
    console.log(`  reward mix (final block): task ${task.toFixed(1)}  progress ${progress.toFixed(1)}`
      + `  safety ${safety.toFixed(1)}  behavior ${behavior.toFixed(1)}`
      + `  shaping share ${magnitude ? ((magnitude - Math.abs(task)) / magnitude * 100).toFixed(0) : '0'}%`);

    const evaluate = Number(args.get('evaluate') ?? 0);
    if (evaluate > 0) {
      const evalSeconds: number[] = [];
      let evalKills = 0;
      for (const agent of agents) {
        agent.setEvaluationMode(true);
        for (let episode = 0; episode < evaluate; episode += 1) {
          const outcome = runEpisode(agent, airframeId, environment, holdoutSeed(seeds, episode));
          evalSeconds.push(outcome.taskReturn);
          evalKills += outcome.kills;
        }
        agent.setEvaluationMode(false);
      }
      console.log(`  greedy evaluation on ${seeds.holdout.length} held-out seeds (${evaluate} eps x ${agents.length} agents, no exploration):`
        + ` median ${median(evalSeconds).toFixed(1)}s  mean ${mean(evalSeconds).toFixed(1)}s`
        + `  best ${Math.max(...evalSeconds).toFixed(1)}s`
        + `  >=120s ${(evalSeconds.filter((v) => v >= 120).length / evalSeconds.length * 100).toFixed(0)}%`
        + `  kills/ep ${(evalKills / evalSeconds.length).toFixed(2)}`);
    }
    const first = blockMedian(starts[0]);
    const last = blockMedian(starts[starts.length - 1]);
    console.log(`  learning delta: ${last - first >= 0 ? '+' : ''}${(last - first).toFixed(2)}s median (${first.toFixed(2)}s -> ${last.toFixed(2)}s)`);
  }
}

if (require.main === module) main();
