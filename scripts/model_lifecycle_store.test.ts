import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ModelLifecycleStore } from './rl/model_lifecycle_store.js';

type Snapshot = { revision: number; score: number };
const empty = (): Snapshot => ({ revision: 0, score: Number.NEGATIVE_INFINITY });

test('training and candidate snapshots cannot replace Champion without promotion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rl-lifecycle-'));
  try {
    const store = new ModelLifecycleStore<Snapshot>(root, 'test-live-model');
    await store.publishTraining({ revision: 1, score: 4 });
    await store.stageCandidate({ revision: 1, score: 4 });
    assert.deepEqual(await store.loadChampion(empty), empty());
    assert.equal(await store.promoteCandidate((candidate, champion) => candidate.score > champion.score, empty), true);
    assert.deepEqual(await store.loadChampion(empty), { revision: 1, score: 4 });

    await store.stageCandidate({ revision: 2, score: 3 });
    assert.equal(await store.promoteCandidate((candidate, champion) => candidate.score > champion.score, empty), false);
    assert.deepEqual(await store.loadChampion(empty), { revision: 1, score: 4 });
    assert.equal(JSON.parse(await readFile(join(root, 'logs/test-live-model.json'), 'utf8')).revision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('model reset clears all lifecycle stages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rl-lifecycle-reset-'));
  try {
    const store = new ModelLifecycleStore<Snapshot>(root, 'test-live-model');
    await store.publishTraining({ revision: 1, score: 1 });
    await store.stageCandidate({ revision: 1, score: 1 });
    await store.promoteCandidate(() => true, empty);
    await store.requestReset();
    assert.equal(await store.consumeReset(), true);
    assert.deepEqual(await store.loadTraining(empty), empty());
    assert.deepEqual(await store.loadCandidate(empty), empty());
    assert.deepEqual(await store.loadChampion(empty), empty());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
