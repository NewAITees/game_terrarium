import type { EscortTdEnemyKind, EscortTdMetaProgress, EscortTdRunResult } from '../shared/types/escort_td.js';

export const ESCORT_META_MAX_LEVEL = 20;
export const ESCORT_META_BASE_GOLD = 100;
export const ESCORT_META_GOLD_PER_LEVEL = 30;
export const ESCORT_META_BASE_HP = 400;
export const ESCORT_META_HP_PER_LEVEL = 100;
export const ESCORT_META_BASE_UNIT_LIMIT = 6;

export function clampEscortMetaLevel(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(ESCORT_META_MAX_LEVEL, Math.floor(value ?? 0)));
}

export function normalizeEscortMeta(meta: Partial<EscortTdMetaProgress> = {}): EscortTdMetaProgress {
  return {
    startGoldLevel: clampEscortMetaLevel(meta.startGoldLevel),
    kingHpLevel: clampEscortMetaLevel(meta.kingHpLevel),
    unitLimitLevel: clampEscortMetaLevel(meta.unitLimitLevel),
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
