import assert from 'node:assert/strict';
import test from 'node:test';
import { clearStoredPolicyModels } from '../shared/rl/model_reset.js';

test('policy reset preserves display settings and meta progression', () => {
  const values = new Map([
    ['gravity-gunship-q-interceptor', 'model'],
    ['gravity-gunship-q-v1', 'legacy-model'],
    ['gravity-gunship-meta-v1', '{"data":12,"thrustResearch":2}'],
    ['gravity-gunship-frame-v1', 'hoverer'],
  ]);
  const storage = { removeItem: (key: string) => { values.delete(key); } };
  clearStoredPolicyModels(storage, ['gravity-gunship-q-interceptor', 'gravity-gunship-q-v1']);
  assert.equal(values.has('gravity-gunship-q-interceptor'), false);
  assert.equal(values.has('gravity-gunship-q-v1'), false);
  assert.equal(values.get('gravity-gunship-meta-v1'), '{"data":12,"thrustResearch":2}');
  assert.equal(values.get('gravity-gunship-frame-v1'), 'hoverer');
});
