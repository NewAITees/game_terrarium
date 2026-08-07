import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runEvaluation, saveEvaluationReport } from './rl/evaluation_runner.js';

test('common evaluation runner preserves seeds and writes JSONL plus summary', async () => {
  const seeds = [11, 29, 47];
  const report = await runEvaluation({
    gameId: 'test-game',
    policyId: 'tabular-q',
    runEpisode: (seed, episode) => ({
      episode,
      seed,
      decisionSteps: seed,
      elapsedSeconds: 2,
      terminated: episode < 3,
      truncated: episode === 3,
      outcome: episode === 1 ? 'success' : episode === 2 ? 'failure' : 'timeout',
      taskReturn: episode,
      shapedReturn: episode * 2,
      values: { wave: episode + 1, score: seed },
    }),
  }, seeds);

  assert.deepEqual(report.summary.seeds, seeds);
  assert.equal(report.summary.successRate, 1 / 3);
  assert.equal(report.summary.averageTaskReturn, 2);
  assert.equal(report.summary.averageValues.wave, 3);

  const root = await mkdtemp(join(tmpdir(), 'rl-evaluation-'));
  try {
    const output = join(root, 'baseline.jsonl');
    await saveEvaluationReport(report, output);
    const rows = (await readFile(output, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const summary = JSON.parse(await readFile(join(root, 'baseline.summary.json'), 'utf8'));
    assert.deepEqual(rows.map((row) => row.seed), seeds);
    assert.equal(summary.gameId, 'test-game');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('common evaluation runner rejects ambiguous episode endings', async () => {
  await assert.rejects(() => runEvaluation({
    gameId: 'test-game',
    policyId: 'bad-policy',
    runEpisode: (seed, episode) => ({
      episode, seed, decisionSteps: 1, elapsedSeconds: 1,
      terminated: false, truncated: false, outcome: 'timeout',
      taskReturn: 0, shapedReturn: 0, values: {},
    }),
  }, [1]), /exactly one/);
});
