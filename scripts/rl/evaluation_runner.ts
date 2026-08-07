import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EpisodeMetrics } from '../../shared/rl/runtime_types.js';

export type EvaluationAdapter = {
  gameId: string;
  policyId: string;
  runEpisode(seed: number, episode: number): Promise<EpisodeMetrics> | EpisodeMetrics;
};

export type EvaluationSummary = {
  gameId: string;
  policyId: string;
  seeds: number[];
  episodes: number;
  successRate: number;
  failureRate: number;
  timeoutRate: number;
  averageTaskReturn: number;
  averageShapedReturn: number;
  averageDecisionSteps: number;
  simulatedSeconds: number;
  wallSeconds: number;
  averageValues: Record<string, number>;
};

export type EvaluationReport = {
  schemaVersion: 1;
  createdAt: string;
  summary: EvaluationSummary;
  episodes: EpisodeMetrics[];
};

export async function runEvaluation(
  adapter: EvaluationAdapter,
  seeds: readonly number[],
): Promise<EvaluationReport> {
  if (!seeds.length) throw new Error('evaluation requires at least one seed');
  const startedAt = performance.now();
  const episodes: EpisodeMetrics[] = [];
  for (let index = 0; index < seeds.length; index += 1) {
    const metric = await adapter.runEpisode(seeds[index], index + 1);
    validateEpisode(metric, seeds[index], index + 1);
    episodes.push(metric);
  }
  const wallSeconds = (performance.now() - startedAt) / 1000;
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    summary: summarizeEvaluation(adapter, seeds, episodes, wallSeconds),
    episodes,
  };
}

export async function saveEvaluationReport(
  report: EvaluationReport,
  jsonlPath: string,
): Promise<void> {
  const summaryPath = jsonlPath.replace(/\.jsonl$/i, '') + '.summary.json';
  await mkdir(dirname(jsonlPath), { recursive: true });
  const rows = report.episodes.map((episode) => JSON.stringify({
    schemaVersion: report.schemaVersion,
    createdAt: report.createdAt,
    gameId: report.summary.gameId,
    policyId: report.summary.policyId,
    ...episode,
  }));
  await writeFile(jsonlPath, `${rows.join('\n')}\n`, 'utf8');
  await writeFile(summaryPath, `${JSON.stringify(report.summary, null, 2)}\n`, 'utf8');
}

function summarizeEvaluation(
  adapter: EvaluationAdapter,
  seeds: readonly number[],
  episodes: readonly EpisodeMetrics[],
  wallSeconds: number,
): EvaluationSummary {
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  const valueKeys = [...new Set(episodes.flatMap((episode) => Object.keys(episode.values)))].sort();
  return {
    gameId: adapter.gameId,
    policyId: adapter.policyId,
    seeds: [...seeds],
    episodes: episodes.length,
    successRate: episodes.filter((episode) => episode.outcome === 'success').length / episodes.length,
    failureRate: episodes.filter((episode) => episode.outcome === 'failure').length / episodes.length,
    timeoutRate: episodes.filter((episode) => episode.outcome === 'timeout').length / episodes.length,
    averageTaskReturn: mean(episodes.map((episode) => episode.taskReturn)),
    averageShapedReturn: mean(episodes.map((episode) => episode.shapedReturn)),
    averageDecisionSteps: mean(episodes.map((episode) => episode.decisionSteps)),
    simulatedSeconds: episodes.reduce((sum, episode) => sum + episode.elapsedSeconds, 0),
    wallSeconds,
    averageValues: Object.fromEntries(valueKeys.map((key) => [
      key,
      mean(episodes.map((episode) => episode.values[key] ?? 0)),
    ])),
  };
}

function validateEpisode(metric: EpisodeMetrics, seed: number, episode: number): void {
  if (metric.seed !== seed || metric.episode !== episode) {
    throw new Error(`evaluation adapter changed identity: expected episode ${episode}, seed ${seed}`);
  }
  if (metric.terminated === metric.truncated) {
    throw new Error(`episode ${episode} must be exactly one of terminated or truncated`);
  }
  if (metric.outcome === 'timeout' && !metric.truncated) {
    throw new Error(`timeout episode ${episode} must be truncated`);
  }
  if (metric.outcome !== 'timeout' && !metric.terminated) {
    throw new Error(`completed episode ${episode} must be terminated`);
  }
}
