import { AIRFRAMES, type AirframeId } from '../apps/gunship/gunship_airframes.js';
import { GunshipAgent, type GunshipAgentSave } from '../apps/gunship/gunship_rl.js';
import { createModelManifest, type ModelManifest } from '../shared/rl/model_manifest.js';
import { runEpisode } from './gunship_headless_sim.js';
import { ModelFileStore } from './rl/model_file_store.js';

type LiveModels = {
  version: 1;
  revision: number;
  publishedAt: string;
  manifest?: ModelManifest;
  models: Partial<Record<AirframeId, GunshipAgentSave>>;
};
const compatibility = {
  gameId: 'gunship',
  algorithm: 'tabular-q',
  modelVersion: 5,
  observationSchemaVersion: 1,
  rewardSchemaVersion: 1,
} as const;
const store = new ModelFileStore<LiveModels>(process.cwd(), 'gunship-live-models');
const args = new Map(process.argv.slice(2).map((token) => { const [key, value = ''] = token.replace(/^--/, '').split('='); return [key, value]; }));
const batch = Math.max(1, Number(args.get('batch') ?? 100));
const cap = Math.max(1, Number(args.get('cap') ?? 120));
const density = Math.max(1, Number(args.get('density') ?? 1));
const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));

async function load(): Promise<LiveModels> { const value = await store.load(() => ({ version: 1, revision: 0, publishedAt: new Date(0).toISOString(), models: {} })); return value?.version === 1 && value.models ? value : { version: 1, revision: 0, publishedAt: new Date(0).toISOString(), models: {} }; }
async function publish(value: LiveModels): Promise<void> { const revision = value.revision + 1; const publishedAt = new Date().toISOString(); const trainingSteps = Object.values(value.models).reduce((sum, model) => sum + (model?.learner.trainingSteps ?? 0), 0); const next = { ...value, revision, publishedAt, manifest: createModelManifest(compatibility, { revision, trainingSteps, publishedAt }) }; await store.publish(next); Object.assign(value, next); }
async function main(): Promise<void> { const models = await load(); const agents = new Map<AirframeId, GunshipAgent>(); for (const frame of AIRFRAMES) { const agent = new GunshipAgent(); const save = models.models[frame.id]; if (save) agent.restore(save); agents.set(frame.id, agent); } console.log(`gunship trainer: batch=${batch}, cap=${cap}s, models=${models.revision}`); for (let completed = 0; completed < batches; completed += 1) { if (await store.consumeReset()) { models.models = {}; models.revision = 0; for (const frame of AIRFRAMES) agents.set(frame.id, new GunshipAgent()); console.log('learning reset accepted'); } for (const frame of AIRFRAMES) { const agent = agents.get(frame.id)!; for (let episode = 0; episode < batch; episode += 1) runEpisode(agent, frame.id, cap, density); models.models[frame.id] = agent.serialize(); } await publish(models); console.log(`published model r${models.revision} (${models.publishedAt})`); } }
void main();
