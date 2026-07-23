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

function fixture(updatedAt: string, data: number): ArenaSaveBundle {
  return {
    schemaVersion: 2,
    updatedAt,
    data,
    damageResearch: 2,
    hullResearch: 3,
  };
}

test('Arena save store round-trips permanent currency and research only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rl-arena-save-'));
  const store = new ArenaShooterSaveStore(root);
  await store.save(fixture('2026-07-23T00:00:00.000Z', 44));
  const loaded = await store.load();
  assert.equal(loaded?.data, 44);
  assert.equal(loaded?.damageResearch, 2);
  assert.equal(loaded?.hullResearch, 3);
});

test('Arena save store falls back to the previous valid checkpoint', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rl-arena-backup-'));
  const store = new ArenaShooterSaveStore(root);
  await store.save(fixture('2026-07-23T00:00:00.000Z', 20));
  await store.save(fixture('2026-07-23T00:01:00.000Z', 30));
  await fs.writeFile(path.join(root, 'rl-arena', 'profile.json'), '{"broken":true}', 'utf8');
  const loaded = await store.load();
  assert.equal(loaded?.data, 20);
});

test('Arena save store rejects an older checkpoint', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rl-arena-stale-'));
  const store = new ArenaShooterSaveStore(root);
  await store.save(fixture('2026-07-23T00:01:00.000Z', 44));
  await store.save(fixture('2026-07-23T00:00:00.000Z', 12));
  const loaded = await store.load();
  assert.equal(loaded?.data, 44);
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
