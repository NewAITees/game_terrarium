import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TrainerStatusStore } from './rl/trainer_status_store.js';

test('trainer status reports running, stopped, and stale failure states', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trainer-status-'));
  try {
    const store = new TrainerStatusStore(root, 'test-game');
    assert.equal((await store.read()).state, 'stopped');
    await store.publish({ state: 'running', pid: 42, startedAt: new Date().toISOString() });
    assert.equal((await store.read()).state, 'running');
    await store.publish({ state: 'running', pid: 42, heartbeatAt: new Date(0).toISOString() });
    assert.equal((await store.read()).state, 'failed');
    await store.publish({ state: 'stopped', exitCode: 0, stoppedAt: new Date().toISOString() });
    assert.equal((await store.read()).state, 'stopped');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
