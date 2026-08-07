import { DroneBastionAgent, type DroneBastionAgentSave } from '../apps/drone-bastion/drone_bastion_agent.js';
import { runDroneBastionEpisode } from '../apps/drone-bastion/drone_bastion_episode.js';
import { createModelManifest, type ModelManifest } from '../shared/rl/model_manifest.js';
import { ModelFileStore } from './rl/model_file_store.js';

type LiveModel = {
  version: 1;
  revision: number;
  publishedAt: string;
  manifest?: ModelManifest;
  model?: DroneBastionAgentSave;
};

const compatibility = {
  gameId: 'drone-bastion',
  algorithm: 'tabular-q',
  modelVersion: 1,
  observationSchemaVersion: 1,
  rewardSchemaVersion: 1,
} as const;
const store = new ModelFileStore<LiveModel>(process.cwd(), 'drone-bastion-live-model');
const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const episodesPerBatch = Math.max(1, Number(args.get('episodes') ?? 40));
const cap = Math.max(1, Number(args.get('cap') ?? 300));
const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));

async function main(): Promise<void> {
  let bundle = await store.load((): LiveModel => ({
    version: 1,
    revision: 0,
    publishedAt: new Date(0).toISOString(),
  }));
  let agent = new DroneBastionAgent();
  if (bundle.version === 1 && bundle.model) agent.restore(bundle.model);
  console.log(`drone bastion trainer: episodes=${episodesPerBatch}, cap=${cap}s, model=${bundle.revision}`);
  for (let batch = 0; batch < batches; batch += 1) {
    if (await store.consumeReset()) {
      agent = new DroneBastionAgent();
      bundle = { version: 1, revision: 0, publishedAt: new Date(0).toISOString() };
      console.log('learning reset accepted');
    }
    for (let episode = 0; episode < episodesPerBatch; episode += 1) {
      runDroneBastionEpisode(agent, bundle.revision * episodesPerBatch + episode + 1, cap);
    }
    const revision = bundle.revision + 1;
    const publishedAt = new Date().toISOString();
    bundle = {
      version: 1,
      revision,
      publishedAt,
      manifest: createModelManifest(compatibility, {
        revision,
        trainingSteps: agent.trainingSteps,
        publishedAt,
      }),
      model: agent.serialize(),
    };
    await store.publish(bundle);
    console.log(`published model r${revision} (${publishedAt})`);
  }
}

void main();
