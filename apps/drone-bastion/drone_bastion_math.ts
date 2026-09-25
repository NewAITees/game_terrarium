import type { BastionDrone, BastionEnemy, BastionWall, DroneBastionState } from './drone_bastion_types.js';

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(target, current + maximumDelta);
  return Math.max(target, current - maximumDelta);
}

export function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

export function directionBand(angle: number): number {
  const normalized = (normalizeAngle(angle) + Math.PI) / (Math.PI * 2);
  return Math.min(7, Math.floor(normalized * 8));
}

export function cardinalSector(angle: number): number {
  const normalized = (angle + Math.PI * 2 + Math.PI / 4) % (Math.PI * 2);
  return Math.floor(normalized / (Math.PI / 2)) % 4;
}

export function octantSector(angle: number): number {
  const normalized = (normalizeAngle(angle) + Math.PI * 2 + Math.PI / 8) % (Math.PI * 2);
  return Math.floor(normalized / (Math.PI / 4)) % 8;
}

export function wrapIndex(value: number, length: number): number {
  return (value % length + length) % length;
}

export function capVelocity(drone: BastionDrone, maximum: number): void {
  const speed = Math.hypot(drone.vx, drone.vy);
  if (speed <= maximum) return;
  drone.vx *= maximum / speed;
  drone.vy *= maximum / speed;
}

export function rotateToward(current: number, target: number, maximum: number): number {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + clamp(delta, -maximum, maximum));
}

export function circleHitsRect(x: number, y: number, radius: number, wall: BastionWall): boolean {
  const nearestX = clamp(x, wall.x - wall.width / 2, wall.x + wall.width / 2);
  const nearestY = clamp(y, wall.y - wall.height / 2, wall.y + wall.height / 2);
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

export function nearestEnemy(
  state: DroneBastionState,
  x: number,
  y: number,
  maximum = Infinity,
  minimum = 0,
): BastionEnemy | null {
  let nearest: BastionEnemy | null = null;
  let best = maximum;
  for (const enemy of state.enemies) {
    const distance = Math.hypot(enemy.x - x, enemy.y - y);
    if (distance >= minimum && distance < best) {
      nearest = enemy;
      best = distance;
    }
  }
  return nearest;
}
