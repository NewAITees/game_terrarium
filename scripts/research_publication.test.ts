import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExperimentSpec, RlGameAdapter } from '../shared/rl/experiment_spec.js';
import { runSpec } from './rl/research_runner.js';
import { createGunshipAdapter } from './rl/gunship_experiment.js';
import { createArenaShooterAdapter } from './rl/arena_shooter_experiment.js';
import { createDroneBastionAdapter } from './rl/drone_bastion_experiment.js';
import { modelArtifactName } from './rl/model_artifact.js';

const spec: ExperimentSpec = {
  gameId: 'publication-test', observation: 'minimal', actions: 'full',
  reward: { mode: 'shaped', weights: {} }, environment: {}, learner: {},
  budget: { episodes: 1, capSeconds: 1, trainSeeds: 1, holdoutSeeds: 1, repeats: 2 },
};

test('publication artifact is predetermined repeat zero rather than the best hold-out repeat', () => {
  let repeat = 0;
  const adapter: RlGameAdapter = {
    searchSpace: {
      gameId: spec.gameId, observations: ['minimal'], actions: ['full'], rewardModes: ['shaped'],
      rewardWeights: [], environment: {},
    },
    defaultSpec: () => spec,
    environmentFingerprint: (_candidate, seed) => String(seed),
    createSession: () => {
      const ownRepeat = repeat++;
      return {
        train: (seed) => outcome(seed, ownRepeat),
        // Repeat one is deliberately much better. It still must not be selected using hold-out.
        evaluate: (seed) => outcome(seed, ownRepeat * 100),
        serialize: () => ({ repeat: ownRepeat }),
        trainingSteps: 1,
        knownStates: 1,
      };
    },
  };
  const result = runSpec(adapter, spec, null, { evaluationEpisodes: 1 });
  assert.deepEqual(result.model, { repeat: 0 });
  assert.equal(result.row.holdout.max, 100);
});

test('live publication bundles carry compatible manifests and Gunship preserves other airframes', () => {
  const publishedAt = '2026-08-08T00:00:00.000Z';
  const metadata = { publishedAt, trainingSteps: 321 };

  const gunship = createGunshipAdapter().livePublication!;
  const gunshipBundle = gunship.bundle({ pilot: 'new' }, 8, metadata, {
    revision: 7, models: { bomber: { pilot: 'keep' } },
  }) as any;
  assert.deepEqual(gunshipBundle.models.bomber, { pilot: 'keep' });
  assert.deepEqual(gunshipBundle.models.interceptor, { pilot: 'new' });
  assert.equal(gunshipBundle.manifest.modelVersion, 9);
  assert.equal(gunshipBundle.manifest.trainingSteps, 321);

  const arena = createArenaShooterAdapter().livePublication!;
  assert.equal((arena.bundle({}, 2, metadata, {}) as any).manifest.modelVersion, 3);
  const drone = createDroneBastionAdapter().livePublication!;
  assert.equal((drone.bundle({}, 2, metadata, {}) as any).manifest.modelVersion, 2);
});

test('model artifact names keep repeated budgets and ledger rows distinct', () => {
  const base = {
    schemaVersion: 1 as const,
    id: 'same-spec', parent: null, createdAt: '2026-08-08T01:02:03.000Z', spec,
    holdout: { count: 1, mean: 1, median: 1, lower95: 1, upper95: 1, min: 1, max: 1 },
    training: { count: 1, mean: 1, median: 1, lower95: 1, upper95: 1, min: 1, max: 1 },
    channels: { task: 0, progress: 0, safety: 0, behavior: 0 }, shapingShare: 0,
    trainingSteps: 1, knownStates: 1, wallSeconds: 1,
  };
  const longer = { ...base, spec: { ...spec, budget: { ...spec.budget, episodes: 20 } } };
  assert.notEqual(modelArtifactName(base), modelArtifactName(longer));
});

function outcome(seed: number, taskReturn: number) {
  return {
    seed, taskReturn, channels: { task: 0, progress: 0, safety: 0, behavior: 0, total: 0 },
    terminated: false, truncated: true, values: {},
  };
}
