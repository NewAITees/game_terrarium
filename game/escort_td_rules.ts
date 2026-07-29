import type { EscortTdEnemyKind, EscortTdMetaProgress, EscortTdPieceType, EscortTdRunResult } from '../shared/types/escort_td.js';

export const ESCORT_META_MAX_LEVEL = 20;
export const ESCORT_META_BASE_GOLD = 100;
export const ESCORT_META_GOLD_PER_LEVEL = 30;
export const ESCORT_META_BASE_HP = 400;
export const ESCORT_META_HP_PER_LEVEL = 100;
export const ESCORT_META_BASE_UNIT_LIMIT = 6;
export const ESCORT_META_MAX_SPEED_LEVEL = 2;
export const ESCORT_META_MAX_AUTO_RESTART_LEVEL = 1;
export const ESCORT_UNIT_POWER_MAX_LEVEL = 10;

const UNIT_POWER_KEYS: Array<keyof EscortTdMetaProgress> = [
  'pawnPowerLevel', 'rookPowerLevel', 'bishopPowerLevel', 'knightPowerLevel', 'queenPowerLevel',
];

export function clampEscortMetaLevel(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(ESCORT_META_MAX_LEVEL, Math.floor(value ?? 0)));
}

export function normalizeEscortMeta(meta: Partial<EscortTdMetaProgress> = {}): EscortTdMetaProgress {
  return {
    startGoldLevel: clampEscortMetaLevel(meta.startGoldLevel),
    kingHpLevel: clampEscortMetaLevel(meta.kingHpLevel),
    unitLimitLevel: clampEscortMetaLevel(meta.unitLimitLevel),
    autoRestartLevel: Math.min(ESCORT_META_MAX_AUTO_RESTART_LEVEL, clampEscortMetaLevel(meta.autoRestartLevel)),
    speedLevel: Math.min(ESCORT_META_MAX_SPEED_LEVEL, clampEscortMetaLevel(meta.speedLevel)),
    pawnPowerLevel: Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, clampEscortMetaLevel(meta.pawnPowerLevel)),
    rookPowerLevel: Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, clampEscortMetaLevel(meta.rookPowerLevel)),
    bishopPowerLevel: Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, clampEscortMetaLevel(meta.bishopPowerLevel)),
    knightPowerLevel: Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, clampEscortMetaLevel(meta.knightPowerLevel)),
    queenPowerLevel: Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, clampEscortMetaLevel(meta.queenPowerLevel)),
  };
}

export function getEscortMetaValues(meta: EscortTdMetaProgress): { startGold: number; kingHpMax: number; unitLimit: number } {
  return {
    startGold: ESCORT_META_BASE_GOLD + meta.startGoldLevel * ESCORT_META_GOLD_PER_LEVEL,
    kingHpMax: ESCORT_META_BASE_HP + meta.kingHpLevel * ESCORT_META_HP_PER_LEVEL,
    unitLimit: ESCORT_META_BASE_UNIT_LIMIT + meta.unitLimitLevel,
  };
}

export function getEscortMetaUpgradeCost(level: number): number {
  return Math.floor(10 * 2.5 ** clampEscortMetaLevel(level));
}

export function getEscortMetaMaxLevel(key: keyof EscortTdMetaProgress): number {
  if (key === 'autoRestartLevel') return ESCORT_META_MAX_AUTO_RESTART_LEVEL;
  if (key === 'speedLevel') return ESCORT_META_MAX_SPEED_LEVEL;
  if (UNIT_POWER_KEYS.includes(key)) return ESCORT_UNIT_POWER_MAX_LEVEL;
  return ESCORT_META_MAX_LEVEL;
}

// Unit power cost: flat x2 curve, starts cheap for early access
export function getEscortUnitPowerUpgradeCost(level: number): number {
  return Math.floor(12 * 2 ** Math.max(0, Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, Math.floor(level))));
}

export function getEscortUpgradeCostByKey(key: keyof EscortTdMetaProgress, level: number): number {
  if (UNIT_POWER_KEYS.includes(key)) return getEscortUnitPowerUpgradeCost(level);
  return getEscortMetaUpgradeCost(level);
}

// Per-level multipliers for unit power upgrades
export function getEscortUnitPowerMultipliers(level: number): { dmgMul: number; rangeMul: number; fireRateMul: number } {
  const l = Math.max(0, Math.min(ESCORT_UNIT_POWER_MAX_LEVEL, level));
  return {
    dmgMul: 1 + l * 0.20,
    rangeMul: 1 + l * 0.08,
    fireRateMul: Math.max(0.45, 1 - l * 0.055),
  };
}

export function calculateEscortCoverage(sampleCount: number, isDetected: (sampleIndex: number) => boolean): number {
  if (sampleCount <= 0) return 100;
  let covered = 0;
  for (let index = 1; index <= sampleCount; index++) {
    if (isDetected(index)) covered += 1;
  }
  return Math.round((covered / sampleCount) * 100);
}

export function calculateEscortResult(
  outcome: EscortTdRunResult['outcome'],
  progressPercent: number,
  kills: Record<EscortTdEnemyKind, number>,
): Pick<EscortTdRunResult, 'score' | 'chips'> {
  const killScore = kills.ground + kills.air * 2 + kills.siege * 3;
  const score = Math.floor((progressPercent * 10 + killScore) * (outcome === 'cleared' ? 1.5 : 1));
  return { score, chips: Math.max(1, Math.floor(score / 100)) };
}

export function getEscortReclaimGold(cost: number): number {
  return Math.floor((cost * 7) / 10);
}

export function getEscortSpawnInterval(progress: number): number {
  const normalized = Math.max(0, Math.min(1, progress));
  return Math.max(0.025, 0.09 - normalized * 0.05);
}

// Soft counters keep every enemy killable while rewarding the intended formations.
export function getEscortDamageMultiplier(attacker: EscortTdPieceType, target: EscortTdEnemyKind): number {
  const multipliers: Record<EscortTdPieceType, Record<EscortTdEnemyKind, number>> = {
    pawn: { ground: 0.8, siege: 0.65, air: 2.1 },
    rook: { ground: 2.1, siege: 0.9, air: 0.65 },
    bishop: { ground: 1.1, siege: 2.2, air: 0.75 },
    knight: { ground: 1.8, siege: 1.15, air: 0.5 },
    queen: { ground: 1.35, siege: 1.5, air: 1.9 },
  };
  return multipliers[attacker][target];
}

// Mortar fire can barrage a known approach corridor without a tracked target.
export function canEscortUnitAttackTarget(type: EscortTdPieceType, isDetected: boolean): boolean {
  return isDetected || type === 'rook';
}
