import { fork, type ChildProcess } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { mulberry32 } from '../../shared/rl/random.js';
import { specHash, validateSpec, type ExperimentSpec, type RlSearchSpace } from '../../shared/rl/experiment_spec.js';
import { proposeCandidate } from './candidate_sampler.js';
import { parseProposals } from './proposal_schema.js';
import { resolveAdapter } from './research_adapters.js';
import { ResearchLedger, type ResearchRow } from './research_ledger.js';
import { verifyContract } from './research_contract.js';
import { beats } from './research_stats.js';

/**
 * The search loop: propose configurations, run them in parallel, record everything, keep the
 * champion honest.
 *
 * The budget is counted in episodes, never in wall time. Measured here, a configuration that
 * survives longer takes longer to evaluate — the best gunship variant costs six times the wall
 * clock of the worst — so any scheme that halves on elapsed time systematically prunes exactly the
 * configurations it is supposed to find.
 */

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const gameId = args.get('game') || 'gunship';
const ledgerPath = resolve(args.get('ledger') || `logs/rl-research/${gameId}.jsonl`);
const queuePath = resolve(args.get('queue') || `logs/rl-research/${gameId}.queue.jsonl`);
const candidates = Number(args.get('candidates') ?? 24);
const concurrency = Math.max(1, Number(args.get('concurrency') ?? Math.max(1, cpus().length - 1)));
const episodes = Number(args.get('episodes') ?? 0);
const repeats = Number(args.get('repeats') ?? 0);
const evaluationEpisodes = Number(args.get('evaluate') ?? 24);
const searchSeed = Number(args.get('seed') ?? 1);
const exploreEnvironment = args.has('explore-environment');
const workerPath = join(__dirname, 'research_worker.js');

async function main(): Promise<void> {
  const adapter = resolveAdapter(gameId);

  // Checked before anything is written, every run. The search is meant to be extended from outside,
  // so the loop's stability cannot rest on whoever extended it having been careful.
  const violations = verifyContract(adapter);
  if (violations.length) {
    console.error(`refusing to run: ${violations.length} contract violation(s)`);
    for (const violation of violations) console.error(`  [${violation.check}] ${violation.detail}`);
    process.exitCode = 1;
    return;
  }

  const ledger = await ResearchLedger.open(ledgerPath);
  const random = mulberry32(searchSeed);

  const baseline = withBudget(adapter.defaultSpec());
  const queue: { spec: ExperimentSpec; parent: string | null }[] = [];

  // The shipped configuration is the incumbent, so it has to be on the board before anything can
  // be said to beat it. Without this the first candidate wins by default.
  if (!ledger.has(baseline)) queue.push({ spec: baseline, parent: null });

  let champion = ledger.champion(gameId, baseline);
  const championSpec = champion?.spec ?? baseline;

  // Proposals from the outer loop go first: they are the only hypotheses in the queue that the
  // sampler could not have reached on its own, and they have already passed the same validation.
  for (const spec of await readQueue(adapter.searchSpace, championSpec)) {
    if (queue.length >= candidates || ledger.has(spec)) continue;
    if (queue.some((entry) => specHash(entry.spec) === specHash(spec))) continue;
    queue.push({ spec: withBudget(spec), parent: champion?.id ?? null });
  }
  if (queue.length) console.log(`${queue.length} spec(s) from the advisor queue`);
  let attempts = 0;
  while (queue.length < candidates && attempts < candidates * 20) {
    attempts += 1;
    const spec = withBudget(proposeCandidate(championSpec, adapter.searchSpace, random, { exploreEnvironment }));
    try {
      validateSpec(spec, adapter.searchSpace);
    } catch {
      continue;
    }
    const id = specHash(spec);
    if (ledger.has(spec) || queue.some((entry) => specHash(entry.spec) === id)) continue;
    queue.push({ spec, parent: champion?.id ?? null });
  }

  console.log(`auto-research ${gameId}: ${queue.length} specs, ${concurrency} workers, ledger ${ledgerPath}`);
  if (champion) console.log(`champion ${champion.id}: hold-out median ${champion.holdout.median.toFixed(1)} (95% ${champion.holdout.lower95.toFixed(1)}–${champion.holdout.upper95.toFixed(1)})`);

  let completed = 0;
  await pool(queue, concurrency, async (entry) => {
    const row = await runInWorker(entry.spec, entry.parent);
    await ledger.append(row);
    completed += 1;
    report(row, completed, queue.length, champion);
    if (!row.error && !row.spec.diagnostic && (!champion || beats(row.holdout, champion.holdout))) {
      champion = row;
      console.log(`  ↑ new champion ${row.id}`);
    }
  });

  const finalChampion = ledger.champion(gameId, baseline);
  console.log(`\n=== leaderboard (hold-out task return; units are ${gameId}'s own) ===`);
  for (const row of leaderboard(ledger)) {
    const marker = row.id === finalChampion?.id ? '*' : ' ';
    console.log(
      `${marker} ${row.id}  ${row.holdout.median.toFixed(1).padStart(7)}`
      + `  95% ${row.holdout.lower95.toFixed(1)}–${row.holdout.upper95.toFixed(1)}`.padEnd(20)
      + `  obs=${row.spec.observation.padEnd(8)} act=${row.spec.actions.padEnd(11)}`
      + `  shaping ${(row.shapingShare * 100).toFixed(0)}%`
      + `  ${row.wallSeconds.toFixed(0)}s`,
    );
  }
}

function leaderboard(ledger: ResearchLedger): ResearchRow[] {
  return ledger.completed(gameId)
    .slice()
    .sort((left, right) => right.holdout.lower95 - left.holdout.lower95)
    .slice(0, 20);
}

function report(row: ResearchRow, completed: number, total: number, champion: ResearchRow | undefined): void {
  if (row.error) {
    console.log(`[${completed}/${total}] ${row.id} failed: ${row.error}`);
    return;
  }
  const delta = champion ? row.holdout.median - champion.holdout.median : 0;
  console.log(
    `[${completed}/${total}] ${row.id}`
    + ` hold-out ${row.holdout.median.toFixed(1)} (95% ${row.holdout.lower95.toFixed(1)}–${row.holdout.upper95.toFixed(1)})`
    + `${champion ? ` ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : ''}`
    + ` train ${row.training.median.toFixed(1)}  states ${row.knownStates}`
    + `  obs=${row.spec.observation} act=${row.spec.actions}  ${row.wallSeconds.toFixed(0)}s`,
  );
}

/**
 * Specs written by the advisor. Re-validated here rather than trusted from the file: the queue is
 * an untrusted input written by a model, and it is cheaper to re-check than to reason about who
 * checked it last.
 */
async function readQueue(space: RlSearchSpace, baseline: ExperimentSpec): Promise<ExperimentSpec[]> {
  const text = await readFile(queuePath, 'utf8').catch(() => '');
  const specs: ExperimentSpec[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parsed = parseProposals(`{"kind":"spec","spec":${line},"rationale":""}`, space, baseline);
    for (const proposal of parsed.accepted) if (proposal.kind === 'spec') specs.push(proposal.spec);
    for (const failure of parsed.rejected) console.warn(`  queue entry rejected: ${failure.reason}`);
  }
  if (specs.length) await rm(queuePath, { force: true });
  return specs;
}

/** Budget is a run-time decision, not part of the spec's identity — see `specHash`. */
function withBudget(spec: ExperimentSpec): ExperimentSpec {
  if (!episodes && !repeats) return spec;
  return {
    ...spec,
    budget: {
      ...spec.budget,
      episodes: episodes || spec.budget.episodes,
      repeats: repeats || spec.budget.repeats,
    },
  };
}

function runInWorker(spec: ExperimentSpec, parent: string | null): Promise<ResearchRow> {
  return new Promise((settle) => {
    const child: ChildProcess = fork(workerPath, [], { stdio: 'inherit' });
    const fail = (message: string): void => {
      child.kill();
      settle(errorRow(spec, parent, message));
    };
    child.on('message', (result: { ok: boolean; row?: ResearchRow; error?: string }) => {
      child.kill();
      settle(result.ok && result.row ? result.row : errorRow(spec, parent, result.error ?? 'worker returned no row'));
    });
    child.on('error', (error) => fail(error.message));
    child.on('exit', (code) => { if (code) fail(`worker exited with code ${code}`); });
    child.send({ spec, parent, evaluationEpisodes });
  });
}

function errorRow(spec: ExperimentSpec, parent: string | null, error: string): ResearchRow {
  const empty = { count: 0, mean: 0, median: 0, lower95: 0, upper95: 0, min: 0, max: 0 };
  return {
    schemaVersion: 1,
    id: specHash(spec),
    parent,
    createdAt: new Date().toISOString(),
    spec,
    holdout: empty,
    training: empty,
    channels: { task: 0, progress: 0, safety: 0, behavior: 0 },
    shapingShare: 0,
    trainingSteps: 0,
    knownStates: 0,
    wallSeconds: 0,
    error,
  };
}

async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await run(items[index]);
    }
  });
  await Promise.all(workers);
}

void main();
