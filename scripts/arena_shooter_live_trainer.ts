import { QLearningAgent, type QLearningAgentSave } from '../apps/arena-shooter/arena_shooter_agent.js';
import { runArenaEpisode } from '../apps/arena-shooter/arena_shooter_episode.js';
import { createModelManifest, type ModelManifest } from '../shared/rl/model_manifest.js';
import { ModelFileStore } from './rl/model_file_store.js';

type LiveModel = { version: 1; revision: number; publishedAt: string; manifest?: ModelManifest; model?: QLearningAgentSave };
const compatibility = { gameId: 'arena-shooter', algorithm: 'tabular-q', modelVersion: 1, observationSchemaVersion: 1, rewardSchemaVersion: 1 } as const;
const store = new ModelFileStore<LiveModel>(process.cwd(), 'arena-shooter-live-model');
const args = new Map(process.argv.slice(2).map((token) => { const [key, value = ''] = token.replace(/^--/, '').split('='); return [key, value]; }));
const episodesPerBatch = Math.max(1, Number(args.get('episodes') ?? 40));
const cap = Math.max(1, Number(args.get('cap') ?? 180));
const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));

async function main(): Promise<void> {
  let bundle = await store.load((): LiveModel => ({ version: 1, revision: 0, publishedAt: new Date(0).toISOString() }));
  let agent = new QLearningAgent();
  if (bundle.version === 1 && bundle.model) agent.restore(bundle.model);
  console.log(`arena trainer: episodes=${episodesPerBatch}, cap=${cap}s, model=${bundle.revision}`);
  for (let batch = 0; batch < batches; batch += 1) {
    if (await store.consumeReset()) {
      agent = new QLearningAgent();
      bundle = { version: 1, revision: 0, publishedAt: new Date(0).toISOString() };
      console.log('learning reset accepted');
    }
    for (let episode = 0; episode < episodesPerBatch; episode += 1) {
      runArenaEpisode(agent, bundle.revision * episodesPerBatch + episode + 1, cap);
    }
    const revision = bundle.revision + 1;
    const publishedAt = new Date().toISOString();
    bundle = { version: 1, revision, publishedAt, manifest: createModelManifest(compatibility, { revision, trainingSteps: agent.trainingSteps, publishedAt }), model: agent.serialize() };
    await store.publish(bundle);
    console.log(`published model r${revision} (${publishedAt})`);
  }
}

void main();
