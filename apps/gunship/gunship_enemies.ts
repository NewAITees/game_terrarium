import type { GunshipBody } from './gunship_physics.js';

export type Enemy = { id: number; kind: 'destroyer' | 'cruiser' | 'carrier' | 'battleship' | 'chaser' | 'diver' | 'mine' | 'submarine'; x: number; y: number; vx: number; hp: number; maxHp: number; cooldown: number; radius: number; surfaced?: boolean; phase?: number };
export type EnemyShot = { x: number; y: number; vx: number; vy: number; life: number; weapon?: 'cannon' | 'missile' | 'laser'; originX?: number; originY?: number };

export function spawnWave(wave: number, id: number): Enemy[] {
  const ships = wave < 3 ? 1 : Math.min(3, 1 + Math.floor(wave / 3));
  // The craft can only fire within +/-90 degrees of its nose, so a thin sky leaves
  // it with nothing legally aimable for most of a run. Measured at 6000 episodes,
  // this density is where survival AND kills both climb; going denser (10x) starts
  // eating the survival curve.
  const chasers = Math.min(16, 6 + Math.floor(wave * 1.4));
  const enemies: Enemy[] = [
    ...Array.from({ length: ships }, (_, index) => ({ id: id + index, kind: 'destroyer' as const, x: 220 + index * 380, y: 735, vx: 18 + index * 5, hp: 65 + wave * 18, maxHp: 65 + wave * 18, cooldown: 1.05, radius: 43 })),
    ...Array.from({ length: chasers }, (_, index) => ({ id: id + ships + index, kind: 'chaser' as const, x: 150 + (index * 177) % 930, y: 110 + (index % 5) * 95, vx: 0, hp: 22 + wave * 5, maxHp: 22 + wave * 5, cooldown: .8 + index * .08, radius: 17 })),
  ];
  if (wave >= 4) enemies.push({ id: id + 16, kind: 'cruiser', x: 760, y: 728, vx: -11, hp: 155 + wave * 30, maxHp: 155 + wave * 30, cooldown: .82, radius: 58 });
  if (wave >= 8) enemies.push({ id: id + 17, kind: 'carrier', x: 330, y: 724, vx: 8, hp: 245 + wave * 42, maxHp: 245 + wave * 42, cooldown: .68, radius: 72 });
  if (wave >= 4) enemies.push({ id: id + 30, kind: 'diver', x: 180 + (wave * 131) % 820, y: 62, vx: wave % 2 ? 46 : -46, hp: 42 + wave * 8, maxHp: 42 + wave * 8, cooldown: 1.15, radius: 20 });
  if (wave >= 3) enemies.push(...Array.from({ length: Math.min(3, Math.floor(wave / 3)) }, (_, index) => ({ id: id + 40 + index, kind: 'mine' as const, x: 250 + (wave * 97 + index * 280) % 700, y: 210 + index * 95, vx: index % 2 ? -18 : 18, hp: 18 + wave * 4, maxHp: 18 + wave * 4, cooldown: .5, radius: 18 })));
  if (wave >= 6) enemies.push(...Array.from({ length: Math.min(2, 1 + Math.floor((wave - 6) / 6)) }, (_, index) => ({ id: id + 20 + index, kind: 'submarine' as const, x: 300 + (wave * 149 + index * 360) % 640, y: 812, vx: index % 2 ? -34 : 34, hp: 60 + wave * 16, maxHp: 60 + wave * 16, cooldown: 1.4, radius: 34, surfaced: false, phase: 3.2 })));
  if (wave > 0 && wave % 5 === 0) enemies.push({ id: id + 31, kind: 'battleship', x: 600, y: 720, vx: 18, hp: 360 + wave * 75, maxHp: 360 + wave * 75, cooldown: .46, radius: 78 });
  return enemies;
}

export function stepEnemies(enemies: Enemy[], shots: EnemyShot[], ship: GunshipBody, dt: number): void {
  for (const enemy of enemies) {
    enemy.cooldown -= dt;
    if (['destroyer', 'cruiser', 'carrier', 'battleship'].includes(enemy.kind)) { enemy.x += enemy.vx * dt; if (enemy.x > 1180 - enemy.radius || enemy.x < enemy.radius) enemy.vx *= -1; }
    else if (enemy.kind === 'diver') { enemy.x += enemy.vx * dt; enemy.y += Math.max(-40, Math.min(110, (ship.y - enemy.y) * .18)) * dt; if (enemy.x > 1160 || enemy.x < 40) enemy.vx *= -1; enemy.y = Math.max(45, Math.min(360, enemy.y)); }
    else if (enemy.kind === 'mine') { enemy.x += enemy.vx * dt; enemy.y += Math.sin((enemy.id + performance.now() * .001) * .7) * 13 * dt; if (enemy.x > 1140 || enemy.x < 60) enemy.vx *= -1; if (Math.hypot(enemy.x - ship.x, enemy.y - ship.y) < 82) { ship.hp -= 16 * dt; } }
    else if (enemy.kind === 'submarine') { enemy.x += enemy.vx * dt; if (enemy.x > 1140 || enemy.x < 60) enemy.vx *= -1; enemy.phase = (enemy.phase ?? 0) - dt; if (enemy.phase <= 0) { enemy.surfaced = !enemy.surfaced; enemy.phase = enemy.surfaced ? 1.7 : 3.4; } enemy.y += ((enemy.surfaced ? 748 : 816) - enemy.y) * Math.min(1, dt * 3.2); }
    else { enemy.x += Math.sign(ship.x - enemy.x) * 40 * dt; enemy.y += Math.sign(ship.y - enemy.y) * 18 * dt; }
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
