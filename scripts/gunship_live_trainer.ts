import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AIRFRAMES, type AirframeId } from '../apps/gunship/gunship_airframes.js';
import { GunshipAgent, type GunshipAgentSave } from '../apps/gunship/gunship_rl.js';
import { createModelManifest, type ModelManifest } from '../shared/rl/model_manifest.js';
import { DEFAULT_GUNSHIP_ENVIRONMENT, runEpisode } from './gunship_headless_sim.js';
import { createSeedPlan, trainingSeed } from '../shared/rl/seed_plan.js';
import { holdoutSeed } from '../shared/rl/seed_plan.js';
import { ModelLifecycleStore } from './rl/model_lifecycle_store.js';
import { describe } from './rl/research_stats.js';

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
  modelVersion: 9,
  observationSchemaVersion: 1,
  rewardSchemaVersion: 1,
} as const;
const modelRoot = process.env.RL_MODEL_ROOT || process.cwd();
const store = new ModelLifecycleStore<LiveModels>(modelRoot, 'gunship-live-models');
const logsDir = join(modelRoot, 'logs');
const lockPath = join(logsDir, 'gunship-live-models.lock');
const args = new Map(process.argv.slice(2).map((token) => { const [key, value = ''] = token.replace(/^--/, '').split('='); return [key, value]; }));
const batch = Math.max(1, Number(args.get('batch') ?? 100));
const cap = Math.max(1, Number(args.get('cap') ?? 120));
const density = Math.max(1, Number(args.get('density') ?? 1));
const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));
const promotionEpisodes = Math.max(1, Number(args.get('promotionEpisodes') ?? 8));
// The live trainer runs for days, so it cycles a wide training range; the hold-out seeds it
// never touches are what offline evaluation scores the published model on.
const seeds = createSeedPlan(Math.max(1, Number(args.get('trainSeeds') ?? 256)), 32);
let episodesRun = 0;
const environment = { ...DEFAULT_GUNSHIP_ENVIRONMENT, capSeconds: cap, density };

async function acquireLock(): Promise<void> { await mkdir(logsDir, { recursive: true }); const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close(); }
const emptyModels = (): LiveModels => ({ version: 1, revision: 0, publishedAt: new Date(0).toISOString(), models: {} });
async function load(): Promise<LiveModels> {
  const champion = await store.loadChampion(emptyModels);
  const value = await store.loadTraining(() => champion);
  return value?.version === 1 && value.models ? value : emptyModels();
}
async function publishCandidate(value: LiveModels): Promise<boolean> {
  const revision = value.revision + 1;
  const publishedAt = new Date().toISOString();
  const trainingSteps = Object.values(value.models).reduce((sum, model) => sum + (model?.learner.trainingSteps ?? 0), 0);
  const returns: number[] = [];
  for (const frame of AIRFRAMES) {
    const save = value.models[frame.id];
    if (!save) continue;
    for (let episode = 0; episode < promotionEpisodes; episode += 1) {
      const evaluator = new GunshipAgent();
      evaluator.restore(save);
      evaluator.setEvaluationMode(true);
      returns.push(runEpisode(evaluator, frame.id, environment, holdoutSeed(seeds, episode)).taskReturn);
    }
  }
  const score = describe(returns);
  const next: LiveModels = {
    ...value,
    revision,
    publishedAt,
    manifest: createModelManifest(compatibility, {
      revision,
      trainingSteps,
      publishedAt,
      evaluation: { episodes: returns.length, values: { median: score.median, lower95: score.lower95, upper95: score.upper95 } },
    }),
  };
  await store.publishTraining(next);
  await store.stageCandidate(next);
  const promoted = await store.promoteCandidate((candidate, champion) => {
    if (!champion.manifest?.evaluation) return true;
    const candidateLower = candidate.manifest?.evaluation?.values.lower95 ?? Number.NEGATIVE_INFINITY;
    const championMedian = champion.manifest.evaluation.values.median ?? Number.POSITIVE_INFINITY;
    return candidateLower > championMedian;
  }, emptyModels);
  Object.assign(value, next);
  return promoted;
}

async function main(): Promise<void> {
  await acquireLock();
  try {
    const models = await load();
    const agents = new Map<AirframeId, GunshipAgent>();
    for (const frame of AIRFRAMES) { const agent = new GunshipAgent(); const save = models.models[frame.id]; if (save) agent.restore(save); agents.set(frame.id, agent); }
    console.log(`gunship trainer: batch=${batch}, cap=${cap}s, models=${models.revision}`);
    for (let completed = 0; completed < batches; completed += 1) {
      if (await store.consumeReset()) { models.models = {}; models.revision = 0; for (const frame of AIRFRAMES) agents.set(frame.id, new GunshipAgent()); console.log('learning reset accepted'); }
      for (const frame of AIRFRAMES) { const agent = agents.get(frame.id)!; for (let episode = 0; episode < batch; episode += 1) runEpisode(agent, frame.id, environment, trainingSeed(seeds, episodesRun++)); models.models[frame.id] = agent.serialize(); }
      const promoted = await publishCandidate(models);
      console.log(`${promoted ? 'promoted Champion' : 'kept Champion; staged Candidate'} r${models.revision} (${models.publishedAt})`);
    }
  } finally { await unlink(lockPath).catch(() => undefined); }
}
void main();
