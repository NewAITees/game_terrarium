import { GunshipAgent } from '../apps/gunship/gunship_rl.js';
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

/**
 * Headless driver for the same gunship_core used by the Electron player. It owns training cadence
 * and experiment knobs (density, cap, reward weights), but every rule that decides what happens on
 * a tick — physics, weapons, wave timing, rewards — lives in gunship_core and is never reimplemented
 * here. Anything that changes those rules changes both the live game and this trainer for free.
 */

const DT = 1 / 60;
// Reward weights are the thing under test, so they are knobs rather than literals.
// Defaults mirror apps/gunship/gunship_core.ts's DEFAULT_GUNSHIP_REWARD_WEIGHTS exactly.
const W = { hp: 1, fireRate: 1, maxChasers: 0, survival: .6, ceiling: .09, death: -16, hpDeath: -9, kill: 1, hit: -1.5, wave: 8 };
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
function capChasers(enemies: Enemy[]): Enemy[] {
  if (W.maxChasers <= 0) return enemies;
  let kept = 0;
  return enemies.filter((enemy) => enemy.kind !== 'chaser' || ++kept <= W.maxChasers);
}

function slowFire(enemies: Enemy[]): Enemy[] {
  if (W.fireRate === 1) return enemies;
  for (const enemy of enemies) enemy.cooldown /= W.fireRate;
  return enemies;
}

type EpisodeResult = { seconds: number; kills: number; wave: number; fell: boolean; reward: number };

function freshShip(maxHp: number): GunshipBody {
  return { x: 1800, y: 260, vx: 0, vy: 0, angle: Math.PI / 2, hp: maxHp, maxHp, fireCooldown: 0, thrust: 0, turn: 0, thrustTurnK: 0, drag: 0 };
}

export function runEpisode(agent: GunshipAgent, airframeId: AirframeId, capSeconds: number, density: number): EpisodeResult {
  const airframe = airframeById(airframeId);
  const nextId = 50;
  const initialEnemies = slowFire(capChasers(densify(spawnWave(1, nextId), density, 1)));
  const state: GunshipCoreState = createGunshipCoreState(
    freshShip(Math.round(airframe.maxHp * W.hp)),
    createRunProgress(),
    airframe,
    nextId + initialEnemies.length,
    initialEnemies,
  );
  let episodeReward = 0;
  let lastReward = 0;
  let kills = 0;
  let upgradeRewardMark = 0;
  const rewards: GunshipRewardWeights = {
    survival: W.survival,
    ceiling: W.ceiling,
    death: W.death,
    hpDeath: W.hpDeath,
    kill: W.kill,
    hit: W.hit,
    wave: W.wave,
  };
  const createWave = (wave: number, id: number): Enemy[] => (
    slowFire(capChasers(densify(spawnWave(wave, id), density, wave)))
  );

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
    episodeReward += result.reward;
    kills += result.kills;
    if (result.finalReward !== null) {
      agent.finishEpisode(result.finalReward);
      return { seconds: state.elapsed, kills, wave: state.wave, fell: result.fell, reward: episodeReward };
    }
    lastReward = result.reward;
  }
  // Timed out rather than died: treat as a neutral cut so the cap cannot be farmed.
  agent.finishEpisode(0);
  return { seconds: state.elapsed, kills, wave: state.wave, fell: false, reward: episodeReward };
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
  const capSeconds = Number(args.get('cap') ?? 120);
  const bucket = Number(args.get('bucket') ?? 50);
  const density = Number(args.get('density') ?? 1);
  for (const key of Object.keys(W) as (keyof typeof W)[]) {
    const override = args.get(key);
    if (override !== undefined && override !== '') W[key] = Number(override);
  }
  const requested = args.get('airframe');
  const airframes: AirframeId[] = requested
    ? [requested as AirframeId]
    : AIRFRAMES.map((frame) => frame.id);

  const repeats = Number(args.get('repeats') ?? 1);

  for (const airframeId of airframes) {
    // One agent's curve is mostly noise at this episode count, so average the
    // per-block medians over independent agents before reading any trend.
    const runs: EpisodeResult[][] = [];
    const agents: GunshipAgent[] = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const agent = new GunshipAgent();
      agents.push(agent);
      const single: EpisodeResult[] = [];
      for (let episode = 0; episode < episodes; episode += 1) single.push(runEpisode(agent, airframeId, capSeconds, density));
      runs.push(single);
    }
    const blockMedian = (start: number): number => mean(runs.map((run) => median(run.slice(start, start + bucket).map((entry) => entry.seconds))));
    const blockKills = (start: number): number => mean(runs.map((run) => mean(run.slice(start, start + bucket).map((entry) => entry.kills))));
    const blockFalls = (start: number): number => mean(runs.map((run) => run.slice(start, start + bucket).filter((entry) => entry.fell).length / Math.min(bucket, run.length - start)));

    console.log(`\n=== ${airframeId} (${episodes} episodes x ${repeats} agents) ===`);
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
    const evaluate = Number(args.get('evaluate') ?? 0);
    if (evaluate > 0) {
      const evalSeconds: number[] = [];
      let evalKills = 0;
      for (const agent of agents) {
        agent.setEvaluationMode(true);
        for (let episode = 0; episode < evaluate; episode += 1) {
          const outcome = runEpisode(agent, airframeId, capSeconds, density);
          evalSeconds.push(outcome.seconds);
          evalKills += outcome.kills;
        }
        agent.setEvaluationMode(false);
      }
      console.log(`  greedy evaluation (${evaluate} eps x ${agents.length} agents, no exploration):`
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
