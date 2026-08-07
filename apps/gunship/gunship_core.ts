import { configureShip, type Airframe } from './gunship_airframes.js';
import { spawnWave, stepEnemies, type Enemy, type EnemyShot } from './gunship_enemies.js';
import { ceilingMargin, SEA_Y, stepPhysics, type GunshipAction, type GunshipBody } from './gunship_physics.js';
import { addXp, type GunshipRunProgress } from './gunship_progression.js';

const SURFACE_KINDS = ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'];

export type GunshipRewardWeights = {
  survival: number;
  ceiling: number;
  death: number;
  hpDeath: number;
  kill: number;
  hit: number;
  wave: number;
};

export const DEFAULT_GUNSHIP_REWARD_WEIGHTS: GunshipRewardWeights = {
  survival: .6,
  ceiling: .09,
  death: -16,
  hpDeath: -9,
  kill: 1,
  hit: -1.5,
  wave: 8,
};

export type GunshipCoreState = {
  ship: GunshipBody;
  enemies: Enemy[];
  enemyShots: EnemyShot[];
  bullets: EnemyShot[];
  run: GunshipRunProgress;
  airframe: Airframe;
  wave: number;
  nextId: number;
  missileCooldown: number;
  elapsed: number;
};

export type GunshipCoreOptions = {
  thrustResearch?: number;
  rewards?: GunshipRewardWeights;
  createWave?: (wave: number, nextId: number) => Enemy[];
};

export type GunshipCoreStepResult = {
  reward: number;
  finalReward: number | null;
  fell: boolean;
  kills: number;
  shots: number;
  shipHits: number;
  airHits: number;
  waveAdvanced: boolean;
};

export function stepGunshipCore(
  state: GunshipCoreState,
  action: GunshipAction,
  dt: number,
  options: GunshipCoreOptions = {},
): GunshipCoreStepResult {
  const rewards = options.rewards ?? DEFAULT_GUNSHIP_REWARD_WEIGHTS;
  const createWave = options.createWave ?? spawnWave;
  let reward = 0;
  let kills = 0;
  let shots = 0;
  let shipHits = 0;
  let airHits = 0;
  let waveAdvanced = false;

  state.elapsed += dt;
  configureShip(state.ship, state.run, state.airframe, options.thrustResearch ?? 0);
  stepPhysics(state.ship, action, dt);
  state.missileCooldown = Math.max(0, state.missileCooldown - dt);

  if (action.fire && state.ship.fireCooldown <= 0) {
    if (state.run.laser > 0) {
      const target = state.enemies.find((enemy) => Math.abs(
        Math.atan2(-(enemy.y - state.ship.y), enemy.x - state.ship.x) - state.ship.angle,
      ) < .13 && Math.hypot(enemy.x - state.ship.x, enemy.y - state.ship.y) < 950);
      if (target) {
        const damage = 11 * 1.2 ** state.run.damage;
        target.hp -= damage;
        if (target.kind === 'battleship') reward += damage * .03;
        state.bullets.push({
          x: target.x, y: target.y, vx: 0, vy: 0, life: .18,
          weapon: 'laser', originX: state.ship.x, originY: state.ship.y,
        });
        shots += 1;
      }
      state.ship.fireCooldown = .1 / (1.16 ** state.run.fireRate);
    } else {
      state.bullets.push({
        x: state.ship.x + Math.cos(state.ship.angle) * 28,
        y: state.ship.y - Math.sin(state.ship.angle) * 28,
        vx: Math.cos(state.ship.angle) * 610,
        vy: -Math.sin(state.ship.angle) * 610,
        life: 2.2,
        weapon: 'cannon',
      });
      shots += 1;
      state.ship.fireCooldown = .22 / (1.16 ** state.run.fireRate);
    }
  }

  if (action.fire && state.run.missile > 0 && state.missileCooldown <= 0) {
    const target = nearest(state.ship, state.enemies);
    if (target) {
      const dx = target.x - state.ship.x;
      const dy = target.y - state.ship.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      state.bullets.push({
        x: state.ship.x, y: state.ship.y,
        vx: dx / length * 300, vy: dy / length * 300,
        life: 3.2, weapon: 'missile',
      });
      shots += 1;
      state.missileCooldown = 2.4;
    }
  }

  stepEnemies(state.enemies, state.enemyShots, state.ship, dt, state.elapsed);
  moveShots(state.enemyShots, dt, state.enemies);
  moveShots(state.bullets, dt, state.enemies);

  for (let index = state.bullets.length - 1; index >= 0; index -= 1) {
    const bullet = state.bullets[index];
    const target = state.enemies.find((enemy) => (
      Math.hypot(enemy.x - bullet.x, enemy.y - bullet.y) < enemy.radius + 4
      && !(enemy.kind === 'submarine' && !enemy.surfaced)
    ));
    if (!target) continue;
    const surface = SURFACE_KINDS.includes(target.kind);
    if (surface) shipHits += 1;
    else airHits += 1;
    if (bullet.weapon !== 'laser') {
      const damage = (bullet.weapon === 'missile' ? 48 : surface ? 14 : 24)
        * 1.2 ** state.run.damage;
      target.hp -= damage;
      if (target.kind === 'battleship') reward += damage * .03;
    }
    state.bullets.splice(index, 1);
    if (target.hp > 0) continue;
    state.enemies.splice(state.enemies.indexOf(target), 1);
    kills += 1;
    const xp = target.kind === 'battleship' ? 12
      : target.kind === 'carrier' ? 7
      : surface ? 3 : 1;
    addXp(state.run, xp);
    reward += (target.kind === 'battleship' ? 18
      : target.kind === 'carrier' ? 10
      : surface ? 5 : 2) * rewards.kill;
  }

  for (let index = state.enemyShots.length - 1; index >= 0; index -= 1) {
    if (Math.hypot(state.enemyShots[index].x - state.ship.x, state.enemyShots[index].y - state.ship.y) >= 20) continue;
    state.ship.hp -= 10;
    state.enemyShots.splice(index, 1);
    reward += rewards.hit;
  }

  reward += dt * rewards.survival;
  if (ceilingMargin(state.ship) < 70) reward -= dt * rewards.ceiling;
  if (state.enemies.length === 0) {
    state.wave += 1;
    state.enemies = createWave(state.wave, state.nextId);
    state.nextId += state.enemies.length;
    reward += rewards.wave;
    waveAdvanced = true;
  }

  const fell = state.ship.y >= SEA_Y;
  const finalReward = fell ? rewards.death : state.ship.hp <= 0 ? rewards.hpDeath : null;
  if (finalReward !== null) reward += finalReward;
  return { reward, finalReward, fell, kills, shots, shipHits, airHits, waveAdvanced };
}

function nearest(ship: Pick<GunshipBody, 'x' | 'y'>, enemies: readonly Enemy[]): Enemy | undefined {
  return enemies.reduce<Enemy | undefined>((best, candidate) => (
    !best || Math.hypot(candidate.x - ship.x, candidate.y - ship.y)
      < Math.hypot(best.x - ship.x, best.y - ship.y)
      ? candidate : best
  ), undefined);
}

function moveShots(shots: EnemyShot[], dt: number, enemies: readonly Enemy[]): void {
  for (const shot of shots) {
    if (shot.weapon === 'missile') {
      const target = nearest(shot, enemies);
      if (target) {
        const dx = target.x - shot.x;
        const dy = target.y - shot.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        shot.vx += (dx / length * 390 - shot.vx) * Math.min(1, dt * 4);
        shot.vy += (dy / length * 390 - shot.vy) * Math.min(1, dt * 4);
      }
    }
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.life -= dt;
  }
  for (let index = shots.length - 1; index >= 0; index -= 1) {
    if (shots[index].life <= 0) shots.splice(index, 1);
  }
}
