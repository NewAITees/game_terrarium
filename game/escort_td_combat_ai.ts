import type { EscortTdCommandMode, EscortTdEnemyKind, EscortTdPieceType } from '../shared/types/escort_td';
import { CS, PIECE, UNIT_GUARD } from './escort_td_config';
import type { Enemy, Unit } from './escort_td_config';

export function pickAutoPieceType(wave: number, gold: number, count: number): EscortTdPieceType {
  if (wave < 2) return count % 3 === 0 || gold < 80 ? 'pawn' : 'rook';
  if (wave < 4) return count % 5 === 0 ? 'bishop' : count % 2 === 0 ? 'rook' : 'pawn';
  if (wave < 7) return count % 6 === 0 ? 'knight' : count % 4 === 0 ? 'bishop' : 'rook';
  if (gold >= 150 && count % 7 === 0) return 'queen';
  if (count % 5 === 0) return 'knight';
  return count % 2 === 0 ? 'bishop' : 'pawn';
}

export function pickEnemyKind(): EscortTdEnemyKind {
  const roll = Math.random();
  if (roll < 0.52) return 'ground';
  if (roll < 0.78) return 'siege';
  return 'air';
}

export function moveEnemyToward(enemy: Enemy, tx: number, tz: number, dt: number, speedMul: number): void {
  const dx = tx - enemy.x;
  const dz = tz - enemy.z;
  const len = Math.hypot(dx, dz) || 1;
  enemy.x += (dx / len) * enemy.speed * speedMul * dt;
  enemy.z += (dz / len) * enemy.speed * speedMul * dt;
}

export function scoreEnemy(kind: EscortTdEnemyKind, dist2: number, mode: EscortTdCommandMode): number {
  if (mode === 'balanced') return dist2;
  const priority: Record<EscortTdEnemyKind, number> = {
    ground: mode === 'ground' ? 0 : mode === 'siege' ? 1 : 2,
    air: mode === 'air' ? 0 : mode === 'siege' ? 1 : 2,
    siege: mode === 'siege' ? 0 : mode === 'air' ? 1 : 2,
  };
  return priority[kind] * 1_000_000 + dist2;
}

export function pickInterceptTarget(unit: Unit, enemies: Enemy[], kingX: number, kingZ: number): Enemy | null {
  let best: Enemy | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const guard = UNIT_GUARD[unit.type];
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const dxKing = enemy.x - kingX;
    const dzKing = enemy.z - kingZ;
    const kingDist = Math.hypot(dxKing, dzKing);
    if (kingDist > CS * 8.5) continue;
    const dxUnit = enemy.x - unit.wx;
    const dzUnit = enemy.z - unit.wz;
    const unitDist = Math.hypot(dxUnit, dzUnit);
    const score = kingDist * 0.9 + unitDist * guard.interceptBias + (enemy.kind === 'siege' ? -2 : enemy.kind === 'air' ? 1.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

export function buildInterceptPoint(unit: Unit, enemy: Enemy, kingX: number, kingZ: number): { x: number; z: number } {
  const desiredDistance = Math.max(CS * 0.9, PIECE[unit.type].range * (unit.type === 'knight' ? 0.45 : unit.type === 'pawn' ? 0.7 : 0.82));
  const vx = enemy.x - kingX;
  const vz = enemy.z - kingZ;
  const len = Math.hypot(vx, vz) || 1;
  const anchorX = enemy.x - (vx / len) * desiredDistance;
  const anchorZ = enemy.z - (vz / len) * desiredDistance;
  const leash = CS * 5.2;
  const dx = anchorX - kingX;
  const dz = anchorZ - kingZ;
  const dist = Math.hypot(dx, dz);
  if (dist <= leash) return { x: anchorX, z: anchorZ };
  return { x: kingX + (dx / Math.max(dist, 0.001)) * leash, z: kingZ + (dz / Math.max(dist, 0.001)) * leash };
}

export function blendAngle(current: number, target: number, t: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isGroundGuard(type: EscortTdPieceType): boolean {
  return type === 'rook' || type === 'bishop' || type === 'knight';
}

export function guardHp(type: EscortTdPieceType): number {
  if (type === 'knight') return 150;
  if (type === 'rook') return 110;
  if (type === 'bishop') return 85;
  return 1;
}
