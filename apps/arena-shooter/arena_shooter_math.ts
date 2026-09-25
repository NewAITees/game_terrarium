import type { Ship, Vec2 } from './arena_shooter_types.js';

export const TAU = Math.PI * 2;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function distanceSq(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

export function normalizeAngle(angle: number): number {
  return (angle % TAU + TAU) % TAU;
}

export function angleToSector(angle: number): number {
  return Math.floor((normalizeAngle(angle) + Math.PI / 8) / (Math.PI / 4)) % 8;
}

export function angleToFineSector(angle: number): number {
  return Math.floor((normalizeAngle(angle) + Math.PI / 16) / (Math.PI / 8)) % 16;
}

export function pulseProjectileCount(level: number): number {
  return Math.min(5, 1 + Math.floor((level + 1) / 2));
}

export function attackAngle(ship: Ship): number {
  return ship.craftType === 'turret' ? ship.turretAngle : ship.angle;
}
