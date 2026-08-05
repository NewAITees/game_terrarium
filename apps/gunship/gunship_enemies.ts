import type { GunshipBody } from './gunship_physics.js';

export type Enemy = { id: number; kind: 'destroyer' | 'cruiser' | 'carrier' | 'battleship' | 'chaser' | 'diver' | 'mine' | 'submarine'; x: number; y: number; vx: number; hp: number; maxHp: number; cooldown: number; radius: number; surfaced?: boolean; phase?: number; wave: number };
export type EnemyShot = { x: number; y: number; vx: number; vy: number; life: number; weapon?: 'cannon' | 'missile' | 'laser' | 'flak' | 'explosive' | 'railgun'; originX?: number; originY?: number };

export type EncounterKind = 'AIR SWEEP' | 'SURFACE RAID' | 'MINE CORRIDOR' | 'CAPITAL HUNT';

export function encounterKindForWave(wave: number): EncounterKind {
  return (['AIR SWEEP', 'SURFACE RAID', 'MINE CORRIDOR', 'CAPITAL HUNT'] as const)[(Math.max(1, wave) - 1) % 4];
}

export function spawnWave(wave: number, id: number): Enemy[] {
  const encounter = encounterKindForWave(wave);
  const ships = encounter === 'SURFACE RAID' ? Math.min(3, 1 + Math.floor(wave / 3)) : encounter === 'CAPITAL HUNT' ? 2 : 1;
  const chasers = encounter === 'AIR SWEEP'
    ? Math.min(16, 8 + Math.floor(wave * 1.2))
    : encounter === 'MINE CORRIDOR'
      ? Math.min(7, 3 + Math.floor(wave * .45))
      : Math.min(10, 5 + Math.floor(wave * .7));
  const enemies: Enemy[] = [
    ...Array.from({ length: ships }, (_, index) => ({ id: id + index, kind: 'destroyer' as const, x: 660 + index * 1140, y: 735, vx: 54 + index * 15, hp: 65 + wave * 18, maxHp: 65 + wave * 18, cooldown: 1.05, radius: 43, wave })),
    ...Array.from({ length: chasers }, (_, index) => ({ id: id + ships + index, kind: 'chaser' as const, x: 450 + (index * 531) % 2790, y: 110 + (index % 5) * 95, vx: 0, hp: 22 + wave * 5, maxHp: 22 + wave * 5, cooldown: .8 + index * .08, radius: 17, wave })),
  ];
  if (wave >= 4 && (encounter === 'SURFACE RAID' || encounter === 'CAPITAL HUNT')) enemies.push({ id: id + 16, kind: 'cruiser', x: 2280, y: 728, vx: -33, hp: 155 + wave * 30, maxHp: 155 + wave * 30, cooldown: .82, radius: 58, wave });
  if (wave >= 8 && encounter === 'CAPITAL HUNT') enemies.push({ id: id + 17, kind: 'carrier', x: 990, y: 724, vx: 24, hp: 245 + wave * 42, maxHp: 245 + wave * 42, cooldown: .68, radius: 72, wave });
  if (wave >= 4 && (encounter === 'AIR SWEEP' || encounter === 'MINE CORRIDOR')) enemies.push({ id: id + 30, kind: 'diver', x: 540 + (wave * 393) % 2460, y: 62, vx: wave % 2 ? 138 : -138, hp: 42 + wave * 8, maxHp: 42 + wave * 8, cooldown: 1.15, radius: 20, wave });
  if (wave >= 3 && encounter === 'MINE CORRIDOR') enemies.push(...Array.from({ length: Math.min(4, 1 + Math.floor(wave / 3)) }, (_, index) => ({ id: id + 40 + index, kind: 'mine' as const, x: 750 + (wave * 291 + index * 630) % 2100, y: 180 + index * 80, vx: index % 2 ? -54 : 54, hp: 18 + wave * 4, maxHp: 18 + wave * 4, cooldown: .5, radius: 18, wave })));
  if (wave >= 6 && (encounter === 'SURFACE RAID' || encounter === 'CAPITAL HUNT')) enemies.push(...Array.from({ length: Math.min(2, 1 + Math.floor((wave - 6) / 6)) }, (_, index) => ({ id: id + 20 + index, kind: 'submarine' as const, x: 900 + (wave * 447 + index * 1080) % 1920, y: 812, vx: index % 2 ? -102 : 102, hp: 60 + wave * 16, maxHp: 60 + wave * 16, cooldown: 1.4, radius: 34, surfaced: false, phase: 3.2, wave })));
  if (wave >= 4 && encounter === 'CAPITAL HUNT') enemies.push({ id: id + 31, kind: 'battleship', x: 1800, y: 720, vx: 54, hp: 360 + wave * 75, maxHp: 360 + wave * 75, cooldown: .46, radius: 78, wave });
  return enemies;
}

export function stepEnemies(enemies: Enemy[], shots: EnemyShot[], ship: GunshipBody, dt: number): void {
  for (const enemy of enemies) {
    enemy.cooldown -= dt;
    if (['destroyer', 'cruiser', 'carrier', 'battleship'].includes(enemy.kind)) { enemy.x += enemy.vx * dt; if (enemy.x > 3540 - enemy.radius || enemy.x < enemy.radius) enemy.vx *= -1; }
    else if (enemy.kind === 'diver') { enemy.x += enemy.vx * dt; enemy.y += Math.max(-40, Math.min(110, (ship.y - enemy.y) * .18)) * dt; if (enemy.x > 3480 || enemy.x < 120) enemy.vx *= -1; enemy.y = Math.max(45, Math.min(360, enemy.y)); }
    else if (enemy.kind === 'mine') { enemy.x += enemy.vx * dt; enemy.y += Math.sin((enemy.id + performance.now() * .001) * .7) * 13 * dt; if (enemy.x > 3420 || enemy.x < 180) enemy.vx *= -1; if (Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 82) { ship.hp -= 16 * dt; } }
    else if (enemy.kind === 'submarine') { enemy.x += enemy.vx * dt; if (enemy.x > 3420 || enemy.x < 180) enemy.vx *= -1; enemy.phase = (enemy.phase ?? 0) - dt; if (enemy.phase <= 0) { enemy.surfaced = !enemy.surfaced; enemy.phase = enemy.surfaced ? 1.7 : 3.4; } enemy.y += ((enemy.surfaced ? 748 : 816) - enemy.y) * Math.min(1, dt * 3.2); }
    else { const toX = ship.x - enemy.x; const toY = ship.y - enemy.y; const dist = Math.max(1, Math.hypot(toX, toY)); const speed = Math.min(120, dist * 4); enemy.x += (toX / dist) * speed * dt; enemy.y += (toY / dist) * speed * dt; }
    // A submerged submarine cannot fire — it is only a threat, and only killable, in its brief surfaced window.
    if (enemy.cooldown <= 0 && enemy.kind !== 'mine' && !(enemy.kind === 'submarine' && !enemy.surfaced)) {
      enemy.cooldown = enemy.kind === 'battleship' ? .62 : enemy.kind === 'carrier' ? .74 : enemy.kind === 'cruiser' ? .9 : enemy.kind === 'destroyer' ? 1.2 : enemy.kind === 'diver' ? .95 : 1.65;
      const dx = ship.x - enemy.x; const dy = ship.y - enemy.y; const length = Math.max(1, Math.hypot(dx, dy));
      const speed = enemy.kind === 'battleship' ? 265 : enemy.kind === 'cruiser' || enemy.kind === 'carrier' ? 238 : enemy.kind === 'destroyer' ? 225 : 175;
      shots.push({ x: enemy.x, y: enemy.y, vx: dx / length * speed, vy: dy / length * speed, life: 4 });
      if (enemy.kind === 'battleship') shots.push({ x: enemy.x - 38, y: enemy.y - 10, vx: dx / length * speed + 35, vy: dy / length * speed - 20, life: 4 });
    }
  }
}
