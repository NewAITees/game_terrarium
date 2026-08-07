import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelFileStore } from './rl/model_file_store';

test('publishes complete snapshots and consumes reset requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terrarium-model-store-'));
  const store = new ModelFileStore<{ revision: number }>(root, 'test-models');
  assert.deepEqual(await store.load(() => ({ revision: 0 })), { revision: 0 });

  await store.publish({ revision: 3 });
  assert.deepEqual(JSON.parse(await readFile(store.modelPath, 'utf8')), { revision: 3 });
  assert.deepEqual(await store.load(() => ({ revision: 0 })), { revision: 3 });

  await store.requestReset();
  assert.equal(await store.consumeReset(), true);
  assert.equal(await store.consumeReset(), false);
  assert.deepEqual(await store.load(() => ({ revision: 0 })), { revision: 0 });
});

test('rejects unsafe model file stems', () => {
  assert.throws(() => new ModelFileStore('/tmp', '../escape'), /lowercase kebab-case/);
});
