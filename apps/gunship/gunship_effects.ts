import type { Enemy } from './gunship_enemies.js';
import { SEA_Y, type GunshipBody } from './gunship_physics.js';
import type { WeaponKind } from './gunship_weapons.js';

export type EffectParticle = { kind: 'spark' | 'smoke' | 'debris' | 'splash'; x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string };
export type EffectBanner = { text: string; color: string; life: number; maxLife: number };
export type GunshipEffects = { particles: EffectParticle[]; banners: EffectBanner[]; shake: number; hitStop: number; lastCombo: number; wasRecovering: boolean };

export function createGunshipEffects(): GunshipEffects {
  return { particles: [], banners: [], shake: 0, hitStop: 0, lastCombo: 0, wasRecovering: false };
}

function particle(kind: EffectParticle['kind'], x: number, y: number, vx: number, vy: number, life: number, size: number, color: string): EffectParticle {
  return { kind, x, y, vx, vy, life, maxLife: life, size, color };
}

export function emitWeaponFire(effects: GunshipEffects, ship: GunshipBody, weapon: WeaponKind): void {
  const strength = weapon === 'railgun' ? 12 : weapon === 'explosive' ? 7 : weapon === 'flak' ? 5 : weapon === 'missile' ? 4 : 2;
  effects.shake = Math.max(effects.shake, strength);
  const count = weapon === 'railgun' ? 9 : weapon === 'flak' ? 6 : 3;
  for (let index = 0; index < count; index++) effects.particles.push(particle('spark', ship.x + Math.cos(ship.angle) * 30, ship.y - Math.sin(ship.angle) * 30, Math.cos(ship.angle) * (60 + index * 8), -Math.sin(ship.angle) * (60 + index * 8), .18, 2 + index % 3, weapon === 'railgun' ? '#f0c8ff' : '#ffe2a0'));
}

export function emitImpact(effects: GunshipEffects, x: number, y: number, weapon: WeaponKind): void {
  const count = weapon === 'explosive' ? 14 : weapon === 'railgun' ? 10 : 6;
  effects.shake = Math.max(effects.shake, weapon === 'explosive' ? 10 : 4);
  for (let index = 0; index < count; index++) { const angle = index / count * Math.PI * 2; effects.particles.push(particle('spark', x, y, Math.cos(angle) * (45 + index * 5), Math.sin(angle) * (45 + index * 5), .35, 2 + index % 3, weapon === 'laser' ? '#8feaff' : '#ffbd72')); }
}

export function emitKill(effects: GunshipEffects, enemy: Enemy): void {
  const capital = enemy.kind === 'battleship' || enemy.kind === 'carrier';
  const count = capital ? 24 : enemy.radius > 40 ? 14 : 8;
  effects.shake = Math.max(effects.shake, capital ? 18 : 8);
  if (capital) { effects.hitStop = Math.max(effects.hitStop, .09); effects.banners.push({ text: `${enemy.kind.toUpperCase()} DESTROYED`, color: '#ffd27a', life: 1.2, maxLife: 1.2 }); }
  for (let index = 0; index < count; index++) { const angle = index / count * Math.PI * 2; const speed = 35 + (index % 7) * 18; effects.particles.push(particle(index % 3 === 0 ? 'debris' : 'spark', enemy.x, enemy.y, Math.cos(angle) * speed + enemy.vx * .25, Math.sin(angle) * speed - 35, index % 3 === 0 ? 2.4 : .55, index % 3 === 0 ? 4 + index % 5 : 3, index % 3 === 0 ? '#586979' : '#ff9b5a')); }
  effects.particles.push(particle('smoke', enemy.x, enemy.y, 0, -18, 1.4, capital ? 32 : 18, '#26333b'));
}

export function emitShipDamage(effects: GunshipEffects, ship: GunshipBody): void {
  effects.shake = Math.max(effects.shake, 9);
  for (let index = 0; index < 7; index++) effects.particles.push(particle('spark', ship.x, ship.y, (index - 3) * 24, -70 + index * 16, .32, 2 + index % 3, '#ff7860'));
}

export function updateCombatFeedback(effects: GunshipEffects, combo: number, recovering: boolean): void {
  if (combo > effects.lastCombo) effects.banners.push({ text: `COMBO x${combo}`, color: '#ffd36b', life: .7, maxLife: .7 });
  else if (combo === 0 && effects.lastCombo > 1) effects.banners.push({ text: 'COMBO LOST', color: '#ff7868', life: .85, maxLife: .85 });
  if (recovering && !effects.wasRecovering) effects.banners.push({ text: 'REPAIR WINDOW', color: '#72ebd7', life: .8, maxLife: .8 });
  effects.lastCombo = combo;
  effects.wasRecovering = recovering;
}

export function stepGunshipEffects(effects: GunshipEffects, dt: number): void {
  effects.hitStop = Math.max(0, effects.hitStop - dt);
  effects.shake = Math.max(0, effects.shake - dt * 28);
  for (const entry of effects.banners) entry.life -= dt;
  for (let index = effects.banners.length - 1; index >= 0; index--) if (effects.banners[index].life <= 0) effects.banners.splice(index, 1);
  for (const entry of effects.particles) {
    entry.life -= dt;
    if (entry.kind === 'debris') entry.vy += 180 * dt;
    entry.x += entry.vx * dt; entry.y += entry.vy * dt;
    if (entry.kind === 'debris' && entry.y >= SEA_Y) { entry.kind = 'splash'; entry.y = SEA_Y; entry.vx *= .15; entry.vy = -35; entry.life = entry.maxLife = .45; entry.color = '#b8f1fa'; entry.size *= 1.7; }
  }
  for (let index = effects.particles.length - 1; index >= 0; index--) if (effects.particles[index].life <= 0) effects.particles.splice(index, 1);
}
