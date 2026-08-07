import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { QLearningAgent, type QLearningAgentSave } from '../apps/arena-shooter/arena_shooter_agent.js';
import { runArenaEpisode } from '../apps/arena-shooter/arena_shooter_episode.js';
import { DroneBastionAgent, type DroneBastionAgentSave } from '../apps/drone-bastion/drone_bastion_agent.js';
import { runDroneBastionEpisode } from '../apps/drone-bastion/drone_bastion_episode.js';
import type { AirframeId } from '../apps/gunship/gunship_airframes.js';
import { GunshipAgent, type GunshipAgentSave } from '../apps/gunship/gunship_rl.js';
import type { NetworkDefenseRlSave } from '../apps/network-defense/network_defense_rl.js';
import type { ModelManifest } from '../shared/rl/model_manifest.js';
import type { EpisodeMetrics } from '../shared/rl/runtime_types.js';
import { runEpisode } from './gunship_headless_sim.js';
import { runNetworkDefenseEpisode } from './network_defense_headless_sim.js';
import { runEvaluation, saveEvaluationReport, type EvaluationAdapter } from './rl/evaluation_runner.js';

type ModelBundle<Model> = {
  revision?: number;
  manifest?: ModelManifest;
  model?: Model;
};

type GunshipBundle = Omit<ModelBundle<never>, 'model'> & {
  models?: Partial<Record<AirframeId, GunshipAgentSave>>;
};

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const modelRoot = resolve(args.get('model-root') || process.env.RL_MODEL_ROOT || process.cwd());
const outputRoot = resolve(args.get('output') || 'logs/rl-baselines');
const capSeconds = Math.max(1, Number(args.get('cap') || 120));
const seeds = parseSeeds(args.get('seeds') || '101,211,307,401,503,601,701,809');

async function main(): Promise<void> {
  const adapters = await createAdapters();
  for (const adapter of adapters) {
    const report = await runEvaluation(adapter, seeds);
    const output = resolve(outputRoot, `${adapter.gameId}.jsonl`);
    await saveEvaluationReport(report, output);
    const summary = report.summary;
    console.log(
      `${adapter.gameId.padEnd(16)} episodes=${summary.episodes} success=${percent(summary.successRate)}`
      + ` failure=${percent(summary.failureRate)} timeout=${percent(summary.timeoutRate)}`
      + ` reward=${summary.averageShapedReturn.toFixed(2)} wall=${summary.wallSeconds.toFixed(2)}s`,
    );
  }
  console.log(`baseline reports saved to ${outputRoot}`);
}

async function createAdapters(): Promise<EvaluationAdapter[]> {
  const arenaBundle = await loadBundle<ModelBundle<QLearningAgentSave>>('arena-shooter-live-model.json');
  const droneBundle = await loadBundle<ModelBundle<DroneBastionAgentSave>>('drone-bastion-live-model.json');
  const gunshipBundle = await loadBundle<GunshipBundle>('gunship-live-models.json');
  const networkBundle = await loadBundle<ModelBundle<NetworkDefenseRlSave>>('network-defense-live-model.json');
  return [
    arenaAdapter(arenaBundle),
    droneAdapter(droneBundle),
    gunshipAdapter(gunshipBundle, 'interceptor'),
    networkAdapter(networkBundle),
  ];
}

function arenaAdapter(bundle: ModelBundle<QLearningAgentSave>): EvaluationAdapter {
  return {
    gameId: 'arena-shooter',
    policyId: policyId(bundle),
    runEpisode(seed, episode): EpisodeMetrics {
      const agent = new QLearningAgent();
      if (bundle.model) agent.restore(bundle.model);
      agent.setEvaluationMode(true);
      const result = runArenaEpisode(agent, seed, capSeconds);
      return metric(episode, result.seed, result.seconds, result.terminated, result.truncated,
        result.outcome === 'timeout' ? 'timeout' : 'failure', result.reward, result.reward,
        { wave: result.wave, kills: result.kills, score: result.reward, trainingSteps: bundle.manifest?.trainingSteps ?? agent.trainingSteps },
        Math.ceil(result.seconds / 0.09));
    },
  };
}

function droneAdapter(bundle: ModelBundle<DroneBastionAgentSave>): EvaluationAdapter {
  return {
    gameId: 'drone-bastion',
    policyId: policyId(bundle),
    runEpisode(seed, episode): EpisodeMetrics {
      const agent = new DroneBastionAgent();
      if (bundle.model) agent.restore(bundle.model);
      agent.setEvaluationMode(true);
      const result = runDroneBastionEpisode(agent, seed, capSeconds);
      return metric(episode, result.seed, result.seconds, result.terminated, result.truncated,
        result.outcome === 'timeout' ? 'timeout' : 'failure', result.reward, result.reward,
        { wave: result.wave, kills: result.kills, score: result.reward, trainingSteps: bundle.manifest?.trainingSteps ?? agent.trainingSteps },
        Math.ceil(result.seconds / 0.12));
    },
  };
}

function gunshipAdapter(bundle: GunshipBundle, airframeId: AirframeId): EvaluationAdapter {
  return {
    gameId: 'gunship',
    policyId: `${policyId(bundle)}/${airframeId}`,
    runEpisode(seed, episode): EpisodeMetrics {
      const agent = new GunshipAgent();
      const save = bundle.models?.[airframeId];
      if (save) agent.restore(save);
      agent.setEvaluationMode(true);
      const result = runEpisode(agent, airframeId, capSeconds, 1, seed);
      return metric(episode, seed, result.seconds, result.terminated, result.truncated,
        result.truncated ? 'timeout' : 'failure', result.reward, result.reward,
        { wave: result.wave, kills: result.kills, score: result.reward, fell: result.fell ? 1 : 0, trainingSteps: bundle.manifest?.trainingSteps ?? agent.steps },
        Math.ceil(result.seconds / 0.12));
    },
  };
}

function networkAdapter(bundle: ModelBundle<NetworkDefenseRlSave>): EvaluationAdapter {
  return {
    gameId: 'network-defense',
    policyId: policyId(bundle),
    async runEpisode(seed, episode): Promise<EpisodeMetrics> {
      const result = await runNetworkDefenseEpisode(episode, seed, capSeconds, 'rl', bundle.model, true);
      const outcome = result.outcome === 'victory' ? 'success' : result.outcome === 'defeat' ? 'failure' : 'timeout';
      return metric(episode, seed, result.elapsed, result.terminated, result.truncated, outcome,
        result.outcome === 'victory' ? 1 : result.outcome === 'defeat' ? -1 : 0, result.score,
        { wave: result.wave, kills: result.kills, score: result.score, serverHp: result.serverHp, trainingSteps: bundle.manifest?.trainingSteps ?? result.trainingSteps },
        result.trainingSteps);
    },
  };
}

function metric(
  episode: number,
  seed: number,
  elapsedSeconds: number,
  terminated: boolean,
  truncated: boolean,
  outcome: EpisodeMetrics['outcome'],
  taskReturn: number,
  shapedReturn: number,
  values: Record<string, number>,
  decisionSteps: number,
): EpisodeMetrics {
  return { episode, seed, decisionSteps, elapsedSeconds, terminated, truncated, outcome, taskReturn, shapedReturn, values };
}

async function loadBundle<T>(filename: string): Promise<T> {
  try {
    return JSON.parse(await readFile(resolve(modelRoot, 'logs', filename), 'utf8')) as T;
  } catch {
    return {} as T;
  }
}

function policyId(bundle: { revision?: number; manifest?: ModelManifest }): string {
  return bundle.manifest ? `${bundle.manifest.algorithm}@r${bundle.manifest.revision}` : 'tabular-q@untrained';
}

function parseSeeds(value: string): number[] {
  const parsed = value.split(',').map(Number).filter((seed) => Number.isInteger(seed));
  if (!parsed.length) throw new Error('provide at least one integer with --seeds=1,2,3');
  return parsed;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
