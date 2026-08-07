import type { NetworkDefenseRlSave } from '../apps/network-defense/network_defense_rl.js';
import { runNetworkDefenseEpisode } from './network_defense_headless_sim.js';
import { createModelManifest, type ModelManifest } from '../shared/rl/model_manifest.js';
import { ModelFileStore } from './rl/model_file_store.js';

type LiveModel = {
  version: 1;
  revision: number;
  publishedAt: string;
  manifest?: ModelManifest;
  model?: NetworkDefenseRlSave;
};

const compatibility = {
  gameId: 'network-defense',
  algorithm: 'ranked-tabular-q',
  modelVersion: 1,
  observationSchemaVersion: 1,
  rewardSchemaVersion: 1,
} as const;
const store = new ModelFileStore<LiveModel>(process.env.RL_MODEL_ROOT || process.cwd(), 'network-defense-live-model');
const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const episodesPerBatch = Math.max(1, Number(args.get('episodes') ?? 20));
const cap = Math.max(1, Number(args.get('cap') ?? 300));
const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));

async function main(): Promise<void> {
  let bundle = await store.load((): LiveModel => ({
    version: 1,
    revision: 0,
    publishedAt: new Date(0).toISOString(),
  }));
  let model = bundle.version === 1 ? bundle.model : undefined;
  console.log(`network defense trainer: episodes=${episodesPerBatch}, cap=${cap}s, model=${bundle.revision}`);
  for (let batch = 0; batch < batches; batch += 1) {
    if (await store.consumeReset()) {
      model = undefined;
      bundle = { version: 1, revision: 0, publishedAt: new Date(0).toISOString() };
      console.log('learning reset accepted');
    }
    let trainingSteps = 0;
    for (let episode = 0; episode < episodesPerBatch; episode += 1) {
      const seed = bundle.revision * episodesPerBatch + episode + 1;
      const result = await runNetworkDefenseEpisode(episode + 1, seed, cap, 'rl', model);
      model = result.model;
      trainingSteps = result.trainingSteps;
    }
    const revision = bundle.revision + 1;
    const publishedAt = new Date().toISOString();
    bundle = {
      version: 1,
      revision,
      publishedAt,
      manifest: createModelManifest(compatibility, { revision, trainingSteps, publishedAt }),
      model,
    };
    await store.publish(bundle);
    console.log(`published model r${revision} (${trainingSteps} steps)`);
  }
}

void main();
