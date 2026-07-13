import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateEscortCoverage,
  calculateEscortResult,
  getEscortMetaUpgradeCost,
  getEscortMetaValues,
  getEscortReclaimGold,
  normalizeEscortMeta,
} from '../game/escort_td_rules';

test('normalizes meta progress and derives its starting values', () => {
  const meta = normalizeEscortMeta({ startGoldLevel: 1.8, kingHpLevel: 2, unitLimitLevel: 99 });
  assert.deepEqual(meta, { startGoldLevel: 1, kingHpLevel: 2, unitLimitLevel: 20 });
  assert.deepEqual(getEscortMetaValues(meta), { startGold: 130, kingHpMax: 600, unitLimit: 26 });
  assert.equal(getEscortMetaUpgradeCost(0), 10);
  assert.equal(getEscortMetaUpgradeCost(1), 25);
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
