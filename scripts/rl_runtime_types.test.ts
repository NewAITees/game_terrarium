import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createModelManifest,
  isCompatibleModelManifest,
} from '../shared/rl/model_manifest';
import { rewardBreakdown } from '../shared/rl/runtime_types';

const compatibility = {
  gameId: 'test-game',
  algorithm: 'tabular-q',
  modelVersion: 1,
  observationSchemaVersion: 2,
  rewardSchemaVersion: 3,
};

test('computes reward totals from independently logged components', () => {
  assert.deepEqual(rewardBreakdown({ task: 10, progress: 2, safety: -3, behavior: -0.5 }), {
    task: 10,
    progress: 2,
    safety: -3,
    behavior: -0.5,
    total: 8.5,
  });
});

test('creates and validates compatible model manifests', () => {
  const manifest = createModelManifest(compatibility, {
    revision: 4,
    trainingSteps: 120,
    publishedAt: '2026-08-06T00:00:00.000Z',
  });
  assert.equal(isCompatibleModelManifest(manifest, compatibility), true);
  assert.equal(isCompatibleModelManifest(manifest, { ...compatibility, observationSchemaVersion: 9 }), false);
  assert.equal(isCompatibleModelManifest({ ...manifest, publishedAt: 'invalid' }, compatibility), false);
});
