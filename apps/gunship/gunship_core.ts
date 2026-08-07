import { configureShip, type Airframe } from './gunship_airframes.js';
import { spawnWave, stepEnemies, type Enemy, type EnemyShot } from './gunship_enemies.js';
import { ceilingMargin, SEA_Y, stepPhysics, type GunshipAction, type GunshipBody } from './gunship_physics.js';
import { addXp, type GunshipRunProgress } from './gunship_progression.js';
import { collectOrbs, spawnOrb, stepOrbs, type XpOrb } from './gunship_pickups.js';
import { applyWeaponRecoil, weaponCooldown, weaponDamage, weaponKind, weaponProfile, type WeaponKind } from './gunship_weapons.js';
import { comboMultiplier, createCombatState, registerKill, stepCombatState, type CombatState } from './gunship_combat.js';

const SURFACE_KINDS = ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'];
// WAVE progression is time-based so an unbeaten battleship can't strand the run forever; enemies
// remain wave-tagged (see gunship_enemies.ts) so the WAVE clear reward still lands whenever that
// batch dies, even late.
const WAVE_INTERVAL = 25;

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
  orbs: XpOrb[];
  run: GunshipRunProgress;
  airframe: Airframe;
  combat: CombatState;
  wave: number;
  waveTimer: number;
  waveRewardGiven: Set<number>;
  nextId: number;
  elapsed: number;
};

export function createGunshipCoreState(ship: GunshipBody, run: GunshipRunProgress, airframe: Airframe, nextId: number, enemies: Enemy[]): GunshipCoreState {
  return {
    ship, run, airframe, enemies,
    enemyShots: [], bullets: [], orbs: [],
    combat: createCombatState(),
    wave: 1, waveTimer: WAVE_INTERVAL, waveRewardGiven: new Set<number>(),
    nextId, elapsed: 0,
  };
}

export type GunshipCoreOptions = {
  thrustResearch?: number;
  rewards?: GunshipRewardWeights;
  createWave?: (wave: number, nextId: number) => Enemy[];
  simulationTime?: number;
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
  xpCollected: number;
  // Pure simulation data for the caller to turn into visuals — gunship_core has no UI dependency,
  // so effects (particles/banners/shake) are the entry point's job, driven off these events.
  firedWeapon: WeaponKind | null;
  impacts: { x: number; y: number; weapon: EnemyShot['weapon'] }[];
  killedEnemies: Enemy[];
  shipDamaged: boolean;
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
  let xpCollected = 0;
  let firedWeapon: WeaponKind | null = null;
  const impacts: { x: number; y: number; weapon: EnemyShot['weapon'] }[] = [];
  const killedEnemies: Enemy[] = [];
  let shipDamaged = false;

  state.elapsed += dt;
  configureShip(state.ship, state.run, state.airframe, options.thrustResearch ?? 0);
  stepPhysics(state.ship, action, dt);

  if (action.fire && state.ship.fireCooldown <= 0) {
    const fired = fireWeapon(state);
    reward += fired.reward;
    shots += fired.shots;
    firedWeapon = weaponKind(state.run);
    applyWeaponRecoil(state.ship, state.run, state.airframe.recoilScale);
  }

  stepEnemies(state.enemies, state.enemyShots, state.ship, dt, options.simulationTime);
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
    if (surface) shipHits += 1; else airHits += 1;
    if (bullet.weapon !== 'laser' && bullet.weapon !== 'railgun') {
      const damage = weaponDamage(state.run, bullet.weapon, surface);
      target.hp -= damage;
      if (target.kind === 'battleship') reward += damage * .03 * comboMultiplier(state.combat.combo);
    }
    const impactX = bullet.x; const impactY = bullet.y; const wasExplosive = bullet.weapon === 'explosive';
    impacts.push({ x: impactX, y: impactY, weapon: bullet.weapon ?? 'cannon' });
    state.bullets.splice(index, 1);
    const primary = resolveKill(state, target, surface, rewards);
    reward += primary.reward; kills += primary.kills; if (primary.killed) killedEnemies.push(primary.killed);
    if (wasExplosive) {
      const splashDamage = 12 * 1.2 ** state.run.damage * 1.15 ** (state.run.explosive - 1);
      for (const other of state.enemies.slice()) {
        if (other === target || Math.hypot(other.x - impactX, other.y - impactY) >= 60) continue;
        other.hp -= splashDamage;
        if (other.kind === 'battleship') reward += splashDamage * .03 * comboMultiplier(state.combat.combo);
        const splash = resolveKill(state, other, SURFACE_KINDS.includes(other.kind), rewards);
        reward += splash.reward; kills += splash.kills; if (splash.killed) killedEnemies.push(splash.killed);
      }
    }
  }

  for (let index = state.enemyShots.length - 1; index >= 0; index -= 1) {
    if (Math.hypot(state.enemyShots[index].x - state.ship.x, state.enemyShots[index].y - state.ship.y) >= 20) continue;
    state.ship.hp -= 10;
    shipDamaged = true;
    state.enemyShots.splice(index, 1);
    reward += rewards.hit;
  }

  stepCombatState(state.combat, state.ship, state.enemies, action.fire, dt, weaponProfile(state.run).recoveryDelay);
  stepOrbs(state.orbs, dt);
  const collected = collectOrbs(state.orbs, state.ship.x, state.ship.y);
  if (collected > 0) { addXp(state.run, collected); xpCollected = collected; }

  reward += dt * rewards.survival;
  if (ceilingMargin(state.ship) < 70) reward -= dt * rewards.ceiling;

  state.waveTimer -= dt;
  if (state.waveTimer <= 0) {
    state.wave += 1;
    state.waveTimer = WAVE_INTERVAL;
    const spawned = createWave(state.wave, state.nextId);
    state.nextId += spawned.length;
    state.enemies.push(...spawned);
    waveAdvanced = true;
  }

  const fell = state.ship.y >= SEA_Y;
  const finalReward = fell ? rewards.death : state.ship.hp <= 0 ? rewards.hpDeath : null;
  if (finalReward !== null) reward += finalReward;
  return { reward, finalReward, fell, kills, shots, shipHits, airHits, waveAdvanced, xpCollected, firedWeapon, impacts, killedEnemies, shipDamaged };
}

// Weapon families are mutually exclusive once run.weaponFamily locks in (see gunship_progression.ts);
// the un-picked default is the baseline cannon. Each family's own upgrade re-offers as a stacking
// power-up (1.15x per stack), so picking one still has room to grow instead of a single flat unlock.
function fireWeapon(state: GunshipCoreState): { reward: number; shots: number } {
  switch (state.run.weaponFamily) {
    case 'laser': return fireLaser(state);
    case 'missile': return fireMissile(state);
    case 'flak': return fireFlak(state);
    case 'explosive': return fireExplosive(state);
    case 'railgun': return fireRailgun(state);
    default: return fireCannon(state);
  }
}
function fireCannon(state: GunshipCoreState): { reward: number; shots: number } {
  const { ship } = state;
  state.bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(ship.angle) * 610, vy: -Math.sin(ship.angle) * 610, life: 2.2, weapon: 'cannon' });
  ship.fireCooldown = weaponCooldown(state.run);
  return { reward: 0, shots: 1 };
}
function fireLaser(state: GunshipCoreState): { reward: number; shots: number } {
  const { ship } = state;
  let reward = 0; let shots = 0;
  const target = state.enemies.find((enemy) => Math.abs(Math.atan2(-(enemy.y - ship.y), enemy.x - ship.x) - ship.angle) < .13 && Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 950);
  if (target) {
    const damage = 11 * 1.2 ** state.run.damage * 1.15 ** (state.run.laser - 1);
    target.hp -= damage;
    if (target.kind === 'battleship') reward += damage * .03 * comboMultiplier(state.combat.combo);
    state.bullets.push({ x: target.x, y: target.y, vx: 0, vy: 0, life: .18, weapon: 'laser', originX: ship.x, originY: ship.y });
    shots += 1;
  }
  ship.fireCooldown = weaponCooldown(state.run);
  return { reward, shots };
}
function fireMissile(state: GunshipCoreState): { reward: number; shots: number } {
  const { ship } = state;
  let shots = 0;
  const target = nearest(ship, state.enemies);
  if (target) {
    const dx = target.x - ship.x; const dy = target.y - ship.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    state.bullets.push({ x: ship.x, y: ship.y, vx: dx / length * 300, vy: dy / length * 300, life: 3.2, weapon: 'missile' });
    shots += 1;
  }
  ship.fireCooldown = weaponCooldown(state.run);
  return { reward: 0, shots };
}
function fireFlak(state: GunshipCoreState): { reward: number; shots: number } {
  const { ship } = state;
  const pellets = 5;
  for (let index = 0; index < pellets; index += 1) {
    const angle = ship.angle + (index - (pellets - 1) / 2) * .09;
    state.bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(angle) * 560, vy: -Math.sin(angle) * 560, life: .35, weapon: 'flak' });
  }
  ship.fireCooldown = weaponCooldown(state.run);
  return { reward: 0, shots: 1 };
}
function fireExplosive(state: GunshipCoreState): { reward: number; shots: number } {
  const { ship } = state;
  state.bullets.push({ x: ship.x + Math.cos(ship.angle) * 28, y: ship.y - Math.sin(ship.angle) * 28, vx: Math.cos(ship.angle) * 500, vy: -Math.sin(ship.angle) * 500, life: 2.4, weapon: 'explosive' });
  ship.fireCooldown = weaponCooldown(state.run);
  return { reward: 0, shots: 1 };
}
function fireRailgun(state: GunshipCoreState): { reward: number; shots: number } {
  const { ship } = state;
  let reward = 0;
  const cone = .1;
  const hits = state.enemies.filter((enemy) => Math.abs(Math.atan2(-(enemy.y - ship.y), enemy.x - ship.x) - ship.angle) < cone && Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 1400 && !(enemy.kind === 'submarine' && !enemy.surfaced));
  const damage = 30 * 1.2 ** state.run.damage * 1.15 ** (state.run.railgun - 1);
  for (const target of hits) {
    target.hp -= damage;
    if (target.kind === 'battleship') reward += damage * .03 * comboMultiplier(state.combat.combo);
    state.bullets.push({ x: target.x, y: target.y, vx: 0, vy: 0, life: .15, weapon: 'railgun', originX: ship.x, originY: ship.y });
  }
  ship.fireCooldown = weaponCooldown(state.run);
  return { reward, shots: 1 };
}

function resolveKill(state: GunshipCoreState, target: Enemy, surface: boolean, rewards: GunshipRewardWeights): { reward: number; kills: number; killed: Enemy | null } {
  if (target.hp > 0) return { reward: 0, kills: 0, killed: null };
  const index = state.enemies.indexOf(target);
  if (index < 0) return { reward: 0, kills: 0, killed: null };
  state.enemies.splice(index, 1);
  const xp = target.kind === 'battleship' ? 12 : target.kind === 'carrier' ? 7 : surface ? 3 : 1;
  const killReward = target.kind === 'battleship' ? 18 : target.kind === 'carrier' ? 10 : surface ? 5 : 2;
  let reward = killReward * rewards.kill * comboMultiplier(state.combat.combo);
  state.orbs.push(spawnOrb(target.x, target.y, Math.ceil(xp * comboMultiplier(state.combat.combo))));
  registerKill(state.combat);
  if (!state.waveRewardGiven.has(target.wave) && !state.enemies.some((enemy) => enemy.wave === target.wave)) {
    state.waveRewardGiven.add(target.wave);
    reward += rewards.wave;
  }
  return { reward, kills: 1, killed: target };
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
