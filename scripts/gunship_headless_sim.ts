import { GunshipAgent } from '../apps/gunship/gunship_rl.js';
import { AIRFRAMES, airframeById, configureShip, type AirframeId } from '../apps/gunship/gunship_airframes.js';
import { altitudeMargin, ceilingMargin, SEA_Y, stepPhysics, type GunshipBody } from '../apps/gunship/gunship_physics.js';
import { spawnWave, stepEnemies, type Enemy, type EnemyShot } from '../apps/gunship/gunship_enemies.js';
import { addXp, applyUpgrade, choicesFor, createRunProgress } from '../apps/gunship/gunship_progression.js';

/**
 * Headless mirror of the update loop in apps/gunship/gunship.ts, without the
 * canvas or the HUD. It exists to answer "is this thing actually learning?"
 * with a number instead of an impression, and to make hyperparameter changes
 * testable before they are shipped to a save file people are watching.
 *
 * Anything that changes reward, termination or the decision cadence in
 * gunship.ts must be mirrored here, or the numbers stop meaning anything.
 */

const DT = 1 / 60;
// Reward weights are the thing under test, so they are knobs rather than literals.
// Defaults mirror apps/gunship/gunship.ts exactly.
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
      extra.push({ ...base, id: base.id + 1000 * copy + seed, x: (base.x + copy * 311 + seed * 97) % 1180, y: 90 + ((base.y + copy * 137) % 420) });
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

const SURFACE_KINDS = ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'];

type EpisodeResult = { seconds: number; kills: number; wave: number; fell: boolean; reward: number };

// Mirrors moveShots() in apps/gunship/gunship.ts, which is not exported.
function moveShots(shots: EnemyShot[], dt: number, enemies: Enemy[]): void {
  for (const shot of shots) {
    if (shot.weapon === 'missile') {
      const target = enemies.slice().sort((a, b) => Math.hypot(a.x - shot.x, a.y - shot.y) - Math.hypot(b.x - shot.x, b.y - shot.y))[0];
      if (target) {
        const dx = target.x - shot.x; const dy = target.y - shot.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        shot.vx += (dx / length * 390 - shot.vx) * Math.min(1, dt * 4);
        shot.vy += (dy / length * 390 - shot.vy) * Math.min(1, dt * 4);
      }
    }
    shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.life -= dt;
  }
  for (let index = shots.length - 1; index >= 0; index -= 1) if (shots[index].life <= 0) shots.splice(index, 1);
}

function freshShip(maxHp: number): GunshipBody {
  return { x: 600, y: 260, vx: 0, vy: 0, angle: Math.PI / 2, hp: maxHp, maxHp, fireCooldown: 0, thrust: 0, turn: 0, thrustTurnK: 0, drag: 0 };
}

export function runEpisode(agent: GunshipAgent, airframeId: AirframeId, capSeconds: number, density: number): EpisodeResult {
  const airframe = airframeById(airframeId);
  const run = createRunProgress();
  const ship = freshShip(Math.round(airframe.maxHp * W.hp));
  let wave = 1;
  let nextId = 50;
  let enemies: Enemy[] = slowFire(capChasers(densify(spawnWave(wave, nextId), density, wave)));
  nextId += enemies.length;
  let enemyShots: EnemyShot[] = [];
  let bullets: EnemyShot[] = [];
  let episodeReward = 0;
  let lastReward = 0;
  let kills = 0;
  let elapsed = 0;
  let missileCooldown = 0;
  let upgradeRewardMark = 0;

  while (elapsed < capSeconds) {
    // Level-up resolves immediately here; the game gives a human 5s to override.
    if (run.pending > 0) {
      const offer = choicesFor(run);
      const slot = agent.decideUpgrade({ offer: offer.map((choice) => choice.id), level: run.level }, episodeReward - upgradeRewardMark);
      upgradeRewardMark = episodeReward;
      applyUpgrade(run, offer[Math.min(offer.length - 1, slot)]);
      continue;
    }
    const rewardStart = episodeReward;
    elapsed += DT;
    configureShip(ship, run, airframe, 0);
    const action = agent.decide(ship, enemies, enemyShots, DT, lastReward).action;
    stepPhysics(ship, action, DT);
    missileCooldown = Math.max(0, missileCooldown - DT);
    if (action.fire && ship.fireCooldown <= 0) {
      bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(ship.angle) * 610, vy: -Math.sin(ship.angle) * 610, life: 2.2, weapon: 'cannon' });
      ship.fireCooldown = .22 / (1.16 ** run.fireRate);
    }
    if (action.fire && run.missile > 0 && missileCooldown <= 0) {
      const target = enemies.slice().sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
      if (target) {
        const dx = target.x - ship.x; const dy = target.y - ship.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        bullets.push({ x: ship.x, y: ship.y, vx: dx / length * 300, vy: dy / length * 300, life: 3.2, weapon: 'missile' });
        missileCooldown = 2.4;
      }
    }
    stepEnemies(enemies, enemyShots, ship, DT);
    moveShots(enemyShots, DT, enemies);
    moveShots(bullets, DT, enemies);

    for (let index = bullets.length - 1; index >= 0; index -= 1) {
      const bullet = bullets[index];
      const target = enemies.find((enemy) => Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < enemy.radius + 4 && !(enemy.kind === 'submarine' && !enemy.surfaced));
      if (!target) continue;
      const surface = SURFACE_KINDS.includes(target.kind);
      const damage = (bullet.weapon === 'missile' ? 48 : surface ? 14 : 24) * 1.2 ** run.damage;
      target.hp -= damage;
      if (target.kind === 'battleship') episodeReward += damage * .03;
      bullets.splice(index, 1);
      if (target.hp > 0) continue;
      enemies.splice(enemies.indexOf(target), 1);
      kills += 1;
      addXp(run, target.kind === 'battleship' ? 12 : target.kind === 'carrier' ? 7 : surface ? 3 : 1);
      episodeReward += (target.kind === 'battleship' ? 18 : target.kind === 'carrier' ? 10 : surface ? 5 : 2) * W.kill;
    }
    for (let index = enemyShots.length - 1; index >= 0; index -= 1) {
      if (Math.hypot(enemyShots[index].x - ship.x, enemyShots[index].y - ship.y) >= 20) continue;
      ship.hp -= 10;
      enemyShots.splice(index, 1);
      episodeReward += W.hit;
    }

    episodeReward += DT * W.survival;
    if (ceilingMargin(ship) < 70) episodeReward -= DT * W.ceiling;
    if (enemies.length === 0) { wave += 1; enemies = slowFire(capChasers(densify(spawnWave(wave, nextId), density, wave))); nextId += enemies.length; episodeReward += W.wave; }

    if (ship.y >= SEA_Y || ship.hp <= 0) {
      const fell = ship.y >= SEA_Y;
      const finalReward = fell ? W.death : W.hpDeath;
      episodeReward += finalReward;
      agent.finishEpisode(finalReward);
      return { seconds: elapsed, kills, wave, fell, reward: episodeReward };
    }
    lastReward = episodeReward - rewardStart;
  }
  // Timed out rather than died: treat as a neutral cut so the cap cannot be farmed.
  agent.finishEpisode(0);
  return { seconds: elapsed, kills, wave, fell: false, reward: episodeReward };
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
    const results = runs[0];
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
