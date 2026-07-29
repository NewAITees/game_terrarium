import type { GunshipBody } from './gunship_physics.js';

export type Enemy = { id: number; kind: 'ship' | 'chaser' | 'diver' | 'mine' | 'dreadnought' | 'submarine'; x: number; y: number; vx: number; hp: number; maxHp: number; cooldown: number; radius: number; surfaced?: boolean; phase?: number };
export type EnemyShot = { x: number; y: number; vx: number; vy: number; life: number; weapon?: 'cannon' | 'missile' | 'laser'; originX?: number; originY?: number };

export function spawnWave(wave: number, id: number): Enemy[] {
  const ships = wave < 3 ? 1 : Math.min(3, 1 + Math.floor(wave / 3));
  const chasers = Math.min(6, 1 + Math.floor(wave * .7));
  const enemies: Enemy[] = [
    ...Array.from({ length: ships }, (_, index) => ({ id: id + index, kind: 'ship' as const, x: 220 + index * 380, y: 735, vx: 12 + index * 4, hp: 80 + wave * 22, maxHp: 80 + wave * 22, cooldown: 1.2, radius: 43 })),
    ...Array.from({ length: chasers }, (_, index) => ({ id: id + ships + index, kind: 'chaser' as const, x: 150 + (index * 177) % 930, y: 155 + (index % 3) * 115, vx: 0, hp: 22 + wave * 5, maxHp: 22 + wave * 5, cooldown: .8 + index * .08, radius: 17 })),
  ];
  if (wave >= 4) enemies.push({ id: id + 30, kind: 'diver', x: 180 + (wave * 131) % 820, y: 62, vx: wave % 2 ? 46 : -46, hp: 42 + wave * 8, maxHp: 42 + wave * 8, cooldown: 1.15, radius: 20 });
  if (wave >= 3) enemies.push(...Array.from({ length: Math.min(3, Math.floor(wave / 3)) }, (_, index) => ({ id: id + 40 + index, kind: 'mine' as const, x: 250 + (wave * 97 + index * 280) % 700, y: 210 + index * 95, vx: index % 2 ? -18 : 18, hp: 18 + wave * 4, maxHp: 18 + wave * 4, cooldown: .5, radius: 18 })));
  if (wave >= 6) enemies.push(...Array.from({ length: Math.min(2, 1 + Math.floor((wave - 6) / 6)) }, (_, index) => ({ id: id + 20 + index, kind: 'submarine' as const, x: 300 + (wave * 149 + index * 360) % 640, y: 812, vx: index % 2 ? -34 : 34, hp: 60 + wave * 16, maxHp: 60 + wave * 16, cooldown: 1.4, radius: 34, surfaced: false, phase: 3.2 })));
  if (wave > 0 && wave % 5 === 0) enemies.push({ id: id + 31, kind: 'dreadnought', x: 600, y: 720, vx: 18, hp: 360 + wave * 75, maxHp: 360 + wave * 75, cooldown: .46, radius: 78 });
  return enemies;
}

export function stepEnemies(enemies: Enemy[], shots: EnemyShot[], ship: GunshipBody, dt: number): void {
  for (const enemy of enemies) {
    enemy.cooldown -= dt;
    if (enemy.kind === 'ship' || enemy.kind === 'dreadnought') { enemy.x += enemy.vx * dt; if (enemy.x > 1180 - enemy.radius || enemy.x < enemy.radius) enemy.vx *= -1; }
    else if (enemy.kind === 'diver') { enemy.x += enemy.vx * dt; enemy.y += Math.max(-40, Math.min(110, (ship.y - enemy.y) * .18)) * dt; if (enemy.x > 1160 || enemy.x < 40) enemy.vx *= -1; enemy.y = Math.max(45, Math.min(360, enemy.y)); }
    else if (enemy.kind === 'mine') { enemy.x += enemy.vx * dt; enemy.y += Math.sin((enemy.id + performance.now() * .001) * .7) * 13 * dt; if (enemy.x > 1140 || enemy.x < 60) enemy.vx *= -1; if (Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 82) { ship.hp -= 16 * dt; } }
    else if (enemy.kind === 'submarine') { enemy.x += enemy.vx * dt; if (enemy.x > 1140 || enemy.x < 60) enemy.vx *= -1; enemy.phase = (enemy.phase ?? 0) - dt; if (enemy.phase <= 0) { enemy.surfaced = !enemy.surfaced; enemy.phase = enemy.surfaced ? 1.7 : 3.4; } enemy.y += ((enemy.surfaced ? 748 : 816) - enemy.y) * Math.min(1, dt * 3.2); }
    else { enemy.x += Math.sign(ship.x - enemy.x) * 40 * dt; enemy.y += Math.sign(ship.y - enemy.y) * 18 * dt; }
    // A submerged submarine cannot fire — it is only a threat, and only killable, in its brief surfaced window.
    if (enemy.cooldown <= 0 && enemy.kind !== 'mine' && !(enemy.kind === 'submarine' && !enemy.surfaced)) {
      enemy.cooldown = enemy.kind === 'dreadnought' ? .62 : enemy.kind === 'ship' ? 1.35 : enemy.kind === 'diver' ? .95 : 1.65;
      const dx = ship.x - enemy.x; const dy = ship.y - enemy.y; const length = Math.max(1, Math.hypot(dx, dy));
      const speed = enemy.kind === 'dreadnought' ? 265 : enemy.kind === 'ship' ? 225 : 175;
      shots.push({ x: enemy.x, y: enemy.y, vx: dx / length * speed, vy: dy / length * speed, life: 4 });
      if (enemy.kind === 'dreadnought') shots.push({ x: enemy.x - 38, y: enemy.y - 10, vx: dx / length * speed + 35, vy: dy / length * speed - 20, life: 4 });
    }
  }
}
