import assert from 'node:assert/strict';
import test from 'node:test';
import { runDroneDqnComparison } from './drone_bastion_dqn_comparison.js';

test('Tabular and both Double DQN conditions use identical training and hold-out seeds', () => {
  const rows = runDroneDqnComparison(2, 2, 2, 31, 2);
  assert.deepEqual(rows.map((row) => row.condition), ['tabular-minimal', 'dqn-engineered', 'dqn-minimal']);
  for (const row of rows.slice(1)) {
    assert.deepEqual(row.trainSeeds, rows[0].trainSeeds);
    assert.deepEqual(row.holdoutSeeds, rows[0].holdoutSeeds);
    assert.equal(row.taskReturns.length, 4);
    assert.equal(row.repeats, 2);
    assert.ok(row.trainingSteps > 0);
  }
  assert.equal(rows[0].condition, 'tabular-minimal');
  assert.equal(rows[0].distribution.median, rows[0].medianTaskReturn);
});
