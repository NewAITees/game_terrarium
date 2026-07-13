import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateEscortCoverage,
  calculateEscortResult,
  getEscortDamageMultiplier,
  getEscortMetaMaxLevel,
  getEscortMetaUpgradeCost,
  getEscortMetaValues,
  getEscortReclaimGold,
  getEscortSpawnInterval,
  getEscortUnitPowerMultipliers,
  normalizeEscortMeta,
} from '../game/escort_td_rules';

test('normalizes meta progress and derives its starting values', () => {
  const meta = normalizeEscortMeta({ startGoldLevel: 1.8, kingHpLevel: 2, unitLimitLevel: 99 });
  assert.deepEqual(meta, {
    startGoldLevel: 1,
    kingHpLevel: 2,
    unitLimitLevel: 20,
    autoRestartLevel: 0,
    speedLevel: 0,
    pawnPowerLevel: 0,
    rookPowerLevel: 0,
    bishopPowerLevel: 0,
    knightPowerLevel: 0,
    queenPowerLevel: 0,
  });
  assert.deepEqual(getEscortMetaValues(meta), { startGold: 130, kingHpMax: 600, unitLimit: 26 });
  assert.equal(getEscortMetaUpgradeCost(0), 10);
  assert.equal(getEscortMetaUpgradeCost(1), 25);
});

test('speed progress is capped to the two unlock tiers', () => {
  assert.equal(normalizeEscortMeta({ speedLevel: 1 }).speedLevel, 1);
  assert.equal(normalizeEscortMeta({ speedLevel: 99 }).speedLevel, 2);
  assert.equal(normalizeEscortMeta({ autoRestartLevel: 99 }).autoRestartLevel, 1);
  assert.equal(getEscortMetaMaxLevel('autoRestartLevel'), 1);
  assert.equal(getEscortMetaMaxLevel('speedLevel'), 2);
});

test('coverage is a percentage of detected forward samples', () => {
  assert.equal(calculateEscortCoverage(8, (index) => index <= 5), 63);
  assert.equal(calculateEscortCoverage(0, () => false), 100);
});

test('run result rewards progress, enemy tiers, victory, and minimum chips', () => {
  assert.deepEqual(
    calculateEscortResult('failed', 40, { ground: 5, air: 2, siege: 1 }),
    { score: 412, chips: 4 },
  );
  assert.deepEqual(
    calculateEscortResult('cleared', 100, { ground: 0, air: 0, siege: 0 }),
    { score: 1500, chips: 15 },
  );
  assert.equal(calculateEscortResult('failed', 0, { ground: 0, air: 0, siege: 0 }).chips, 1);
});

test('reclaim returns 70 percent rounded down', () => {
  assert.equal(getEscortReclaimGold(90), 63);
  assert.equal(getEscortReclaimGold(40), 28);
});

test('spawn intervals tighten as the king advances', () => {
  assert.equal(getEscortSpawnInterval(0), 0.09);
  assert.ok(Math.abs(getEscortSpawnInterval(1) - 0.04) < Number.EPSILON);
  assert.ok(getEscortSpawnInterval(0.75) < getEscortSpawnInterval(0.25));
});

test('soft counters reward the intended unit without making targets immune', () => {
  assert.equal(getEscortDamageMultiplier('rook', 'ground'), 2.1);
  assert.equal(getEscortDamageMultiplier('bishop', 'siege'), 2.2);
  assert.equal(getEscortDamageMultiplier('pawn', 'air'), 2.1);
  assert.ok(getEscortDamageMultiplier('knight', 'air') > 0);
  assert.ok(getEscortDamageMultiplier('queen', 'siege') > 1);
});

test('unit power increases damage and range while reducing attack intervals', () => {
  assert.deepEqual(getEscortUnitPowerMultipliers(0), { dmgMul: 1, rangeMul: 1, fireRateMul: 1 });
  assert.deepEqual(getEscortUnitPowerMultipliers(3), { dmgMul: 1.6, rangeMul: 1.24, fireRateMul: 0.835 });
  assert.deepEqual(getEscortUnitPowerMultipliers(99), { dmgMul: 3, rangeMul: 1.8, fireRateMul: 0.45 });
});
