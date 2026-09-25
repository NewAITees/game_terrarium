import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { specHash, type ExperimentSpec, type RlGameAdapter } from '../shared/rl/experiment_spec.js';
import { buildLeaderboard, formatLeaderboard } from './rl/leaderboard.js';
import { ResearchLedger, type ResearchRow } from './rl/research_ledger.js';

const shipped: ExperimentSpec = {
  gameId: 'board-test', learnerVariant: 'tabular-1step', observation: 'full', actions: 'full',
  reward: { mode: 'shaped', weights: { kill: 1 } }, environment: { density: 1 }, learner: {},
  budget: { episodes: 100, capSeconds: 60, trainSeeds: 4, holdoutSeeds: 4, repeats: 2 },
};

const adapter: RlGameAdapter = {
  searchSpace: {
    gameId: 'board-test', learnerVariants: ['tabular-1step'], observations: ['full', 'minimal'], actions: ['full'],
    rewardModes: ['shaped'], rewardWeights: ['kill'], environment: { density: { min: 1, max: 4 } },
  },
  defaultSpec: () => shipped,
  environmentFingerprint: (_spec, seed) => String(seed),
  createSession: () => { throw new Error('not used'); },
};

function row(spec: ExperimentSpec, median: number, lower95: number, extra: Partial<ResearchRow> = {}): ResearchRow {
  const holdout = { count: 8, mean: median, median, lower95, upper95: median + 1, min: 0, max: median + 2 };
  return {
    schemaVersion: 1, id: specHash(spec), parent: null, createdAt: '2026-09-25T00:00:00.000Z', spec,
    holdout, training: { ...holdout, median: median + 3 }, channels: { task: 1, progress: 0, safety: 0, behavior: 0 },
    shapingShare: 0.25, trainingSteps: 10, knownStates: 5, wallSeconds: 1, ...extra,
  };
}

async function ledgerOf(rows: ResearchRow[]): Promise<ResearchLedger> {
  const dir = await mkdtemp(join(tmpdir(), 'rl-board-'));
  const path = join(dir, 'board-test.jsonl');
  await writeFile(path, rows.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
  const ledger = await ResearchLedger.open(path);
  await rm(dir, { recursive: true, force: true });
  return ledger;
}

test('rows from a different environment go to their own board and are never ranked against the shipped one', async () => {
  const easier: ExperimentSpec = { ...shipped, observation: 'minimal', environment: { density: 4 } };
  const board = buildLeaderboard(await ledgerOf([row(shipped, 10, 8), row(easier, 50, 45)]), adapter);
  assert.equal(board.boards.length, 2);
  assert.equal(board.boards[0].shipped, true);
  assert.deepEqual(board.boards[0].entries.map((entry) => entry.observation), ['full']);
  assert.equal(board.boards[0].entries[0].champion, true);
  assert.equal(board.boards[1].entries[0].champion, true);
});

test('rows within one environment are ranked by the hold-out lower bound', async () => {
  const minimal: ExperimentSpec = { ...shipped, observation: 'minimal' };
  const board = buildLeaderboard(await ledgerOf([row(shipped, 20, 5), row(minimal, 15, 12)]), adapter);
  assert.deepEqual(board.boards[0].entries.map((entry) => [entry.rank, entry.observation]), [[1, 'minimal'], [2, 'full']]);
});

test('a spec re-run at a larger budget appears once, with the larger-budget result', async () => {
  const longer: ExperimentSpec = { ...shipped, budget: { ...shipped.budget, episodes: 400 } };
  const board = buildLeaderboard(await ledgerOf([row(shipped, 10, 8), row(longer, 30, 25)]), adapter);
  assert.equal(board.boards[0].entries.length, 1);
  assert.equal(board.boards[0].entries[0].episodes, 400);
  assert.equal(board.boards[0].entries[0].holdoutMedian, 30);
});

test('failed rows are counted but never ranked, and untried combinations are listed', async () => {
  const failed = row({ ...shipped, observation: 'minimal' }, 99, 99, { error: 'boom' });
  const board = buildLeaderboard(await ledgerOf([row(shipped, 10, 8), failed]), adapter);
  assert.equal(board.failedRuns, 1);
  assert.equal(board.boards[0].entries.length, 1);
  assert.deepEqual(board.digest.untried, ['tabular-1step/minimal/full']);
  assert.match(formatLeaderboard(board), /untried in shipped environment/);
});

test('an empty ledger still prints the declared search space', async () => {
  const text = formatLeaderboard(buildLeaderboard(await ledgerOf([]), adapter));
  assert.match(text, /input {3}\(observation\): full, minimal/);
  assert.match(text, /no completed runs yet/);
});
