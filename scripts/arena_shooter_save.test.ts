import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArenaShooterSaveStore, type ArenaSaveBundle } from '../game/arena_shooter_save_store';
import {
  DEFAULT_META,
  ascend,
  ascensionPower,
  canAscend,
} from '../apps/arena-shooter/arena_shooter_progression';

function fixture(wave: number, data: number): ArenaSaveBundle {
  return {
    schemaVersion: 1,
    updatedAt: '2026-07-23T00:00:00.000Z',
    meta: { data },
    run: { level: 4 },
    agent: { version: 1, qTable: [] },
    episode: 3,
    wave,
    waveTime: 2,
    score: 1200,
    kills: 8,
  };
}

test('Arena save store round-trips split profile, run, and model files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rl-arena-save-'));
  const store = new ArenaShooterSaveStore(root);
  await store.save(fixture(12, 44));
  const loaded = await store.load();
  assert.equal(loaded?.wave, 12);
  assert.deepEqual(loaded?.meta, { data: 44 });
  assert.deepEqual(loaded?.agent, { version: 1, qTable: [] });
});

test('Arena save store falls back to the previous valid checkpoint', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rl-arena-backup-'));
  const store = new ArenaShooterSaveStore(root);
  await store.save(fixture(10, 20));
  await store.save(fixture(11, 30));
  await fs.writeFile(path.join(root, 'rl-arena', 'run.json'), '{"broken":true}', 'utf8');
  const loaded = await store.load();
  assert.equal(loaded?.wave, 10);
  assert.equal(loaded?.score, 1200);
});

test('Ascension unlocks at wave 25 and compounds permanent combat power', () => {
  const meta = { ...DEFAULT_META };
  assert.equal(canAscend(24), false);
  assert.equal(canAscend(25), true);
  const before = ascensionPower(meta);
  assert.equal(ascend(meta, 25), 1);
  assert.equal(meta.ascensions, 1);
  assert.ok(ascensionPower(meta) > before);
});
