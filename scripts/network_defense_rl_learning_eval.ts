import {
  runNetworkDefenseEpisode,
} from './network_defense_headless_sim';
import type { NetworkDefenseRlSave } from '../apps/network-defense/network_defense_rl';

type EvaluationSummary = {
  episodes: number;
  victories: number;
  defeats: number;
  timeouts: number;
  averageWave: number;
  averageSurvival: number;
  averageScore: number;
  averageServerHp: number;
};

async function evaluate(
  seeds: readonly number[],
  maxSeconds: number,
  model?: NetworkDefenseRlSave,
): Promise<EvaluationSummary> {
  const results = [];
  for (let index = 0; index < seeds.length; index += 1) {
    results.push(await runNetworkDefenseEpisode(
      index + 1,
      seeds[index],
      maxSeconds,
      'rl',
      model,
      true,
    ));
  }
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0)
    / Math.max(1, values.length);
  return {
    episodes: results.length,
    victories: results.filter((result) => result.outcome === 'victory').length,
    defeats: results.filter((result) => result.outcome === 'defeat').length,
    timeouts: results.filter((result) => result.outcome === 'timeout').length,
    averageWave: average(results.map((result) => result.wave)),
    averageSurvival: average(results.map((result) => result.elapsed)),
    averageScore: average(results.map((result) => result.score)),
    averageServerHp: average(results.map((result) => result.serverHp)),
  };
}

async function train(
  episodes: number,
  seedStart: number,
  maxSeconds: number,
): Promise<NetworkDefenseRlSave> {
  let model: NetworkDefenseRlSave | undefined;
  for (let index = 0; index < episodes; index += 1) {
    const result = await runNetworkDefenseEpisode(
      index + 1,
      seedStart + index,
      maxSeconds,
      'rl',
      model,
    );
    model = result.model;
  }
  if (!model) throw new Error('training did not produce a model');
  return model;
}

async function main(): Promise<void> {
  const evaluationSeeds = Array.from({ length: 20 }, (_, index) => 700 + index);
  const maxSeconds = 300;
  const trainingEpisodes = 300;
  const baseline = await evaluate(evaluationSeeds, maxSeconds);
  const trainedModel = await train(trainingEpisodes, 1000, maxSeconds);
  const trained = await evaluate(evaluationSeeds, maxSeconds, trainedModel);
  const trainingSteps = Object.values(trainedModel.policies)
    .reduce((sum, policy) => sum + policy.trainingSteps, 0);
  const knownStates = Object.values(trainedModel.policies)
    .reduce((sum, policy) => sum + policy.qTable.length, 0);
  console.log(JSON.stringify({
    evaluationSeeds,
    trainingEpisodes,
    trainingSteps,
    knownStates,
    baseline,
    trained,
    delta: {
      victories: trained.victories - baseline.victories,
      defeats: trained.defeats - baseline.defeats,
      averageWave: trained.averageWave - baseline.averageWave,
      averageSurvival: trained.averageSurvival - baseline.averageSurvival,
      averageScore: trained.averageScore - baseline.averageScore,
      averageServerHp: trained.averageServerHp - baseline.averageServerHp,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
