import { sameEnvironment, specHash, type RlGameAdapter, type RlSearchSpace } from '../../shared/rl/experiment_spec.js';
import { digestLedger, type LedgerDigest } from './ledger_digest.js';
import type { ResearchLedger, ResearchRow } from './research_ledger.js';

/**
 * The leaderboard, recomputed from the ledger every time it is read.
 *
 * Rows are only ranked against rows that ran in the same environment. A spec that turned the
 * difficulty down scores higher for a reason that has nothing to do with learning, so one table
 * across environments would crown whichever configuration found the easiest world.
 */

export type LeaderboardEntry = {
  rank: number;
  id: string;
  champion: boolean;
  holdoutMedian: number;
  lower95: number;
  upper95: number;
  /** Training median minus hold-out median. Large and positive means it fitted the seeds it saw. */
  overfitGap: number;
  shapingShare: number;
  learnerVariant: string;
  observation: string;
  actions: string;
  rewardMode: string;
  weights: Record<string, number>;
  episodes: number;
  repeats: number;
  knownStates: number;
  wallSeconds: number;
  modelFile: string | null;
  createdAt: string;
};

export type EnvironmentBoard = {
  /** Difficulty knobs plus the episode cap — everything that makes task returns comparable. */
  environment: Record<string, number>;
  capSeconds: number;
  /** True for the environment the game ships with. */
  shipped: boolean;
  entries: LeaderboardEntry[];
};

export type GameLeaderboard = {
  gameId: string;
  /** The three points (and the learner) this game lets a search vary. */
  searchSpace: RlSearchSpace;
  runs: number;
  failedRuns: number;
  boards: EnvironmentBoard[];
  /** Per-variant summaries and untried combinations, over the shipped environment only. */
  digest: LedgerDigest;
};

export function buildLeaderboard(ledger: ResearchLedger, adapter: RlGameAdapter): GameLeaderboard {
  const gameId = adapter.searchSpace.gameId;
  const shippedSpec = adapter.defaultSpec();
  const ranked = latestEvidencePerSpec(ledger.completed(gameId).filter((row) => row.holdout.count > 0));

  const groups: ResearchRow[][] = [];
  for (const row of ranked) {
    const group = groups.find((candidate) => sameEnvironment(candidate[0].spec, row.spec));
    if (group) group.push(row);
    else groups.push([row]);
  }

  const boards = groups.map((rows): EnvironmentBoard => {
    const reference = rows[0].spec;
    const champion = ledger.champion(gameId, reference);
    const entries = rows
      .slice()
      .sort((left, right) => right.holdout.lower95 - left.holdout.lower95 || right.holdout.median - left.holdout.median)
      .map((row, index) => toEntry(row, index + 1, row.id === champion?.id));
    return {
      environment: { ...reference.environment },
      capSeconds: reference.budget.capSeconds,
      shipped: sameEnvironment(reference, shippedSpec),
      entries,
    };
  });
  boards.sort((left, right) => Number(right.shipped) - Number(left.shipped) || right.entries.length - left.entries.length);

  const shippedRows = ranked.filter((row) => sameEnvironment(row.spec, shippedSpec));
  return {
    gameId,
    searchSpace: adapter.searchSpace,
    runs: ledger.completed(gameId).length,
    failedRuns: ledger.all.filter((row) => row.spec.gameId === gameId && row.error).length,
    boards,
    digest: digestLedger(gameId, shippedRows, adapter.searchSpace, ledger.champion(gameId, shippedSpec)),
  };
}

/**
 * One line per spec: the run with the most evidence behind it, and the newest when budgets tie.
 * A spec re-run at a larger budget is the same configuration measured more carefully, not a rival.
 */
function latestEvidencePerSpec(rows: readonly ResearchRow[]): ResearchRow[] {
  const byId = new Map<string, ResearchRow>();
  for (const row of rows) {
    const id = specHash(row.spec);
    const previous = byId.get(id);
    if (!previous || evidence(row) > evidence(previous)
      || (evidence(row) === evidence(previous) && row.createdAt > previous.createdAt)) {
      byId.set(id, row);
    }
  }
  return [...byId.values()];
}

function evidence(row: ResearchRow): number {
  return row.spec.budget.episodes * row.spec.budget.repeats;
}

function toEntry(row: ResearchRow, rank: number, champion: boolean): LeaderboardEntry {
  return {
    rank,
    id: row.id,
    champion,
    holdoutMedian: round(row.holdout.median),
    lower95: round(row.holdout.lower95),
    upper95: round(row.holdout.upper95),
    overfitGap: round(row.training.median - row.holdout.median),
    shapingShare: round(row.shapingShare),
    // Rows written before the learner became a searchable axis carry no variant. Say so rather than
    // guess: which learner produced them is exactly what cannot be recovered from the row.
    learnerVariant: row.spec.learnerVariant ?? '(unrecorded)',
    observation: row.spec.observation,
    actions: row.spec.actions,
    rewardMode: row.spec.reward.mode,
    weights: Object.fromEntries(Object.entries(row.spec.reward.weights).map(([key, value]) => [key, round(value)])),
    episodes: row.spec.budget.episodes,
    repeats: row.spec.budget.repeats,
    knownStates: row.knownStates,
    wallSeconds: Math.round(row.wallSeconds),
    modelFile: row.modelFile ?? null,
    createdAt: row.createdAt,
  };
}

export function formatLeaderboard(board: GameLeaderboard, limit = 20): string {
  const space = board.searchSpace;
  const lines = [
    `=== ${board.gameId} leaderboard (hold-out task return; units are ${board.gameId}'s own) ===`,
    `runs ${board.runs}${board.failedRuns ? `, failed ${board.failedRuns}` : ''}`,
    `  input   (observation): ${space.observations.join(', ')}`,
    `  output  (actions)    : ${space.actions.join(', ')}`,
    `  reward  (${space.rewardModes.join('/')}): ${space.rewardWeights.join(', ')}`,
    `  learner              : ${space.learnerVariants.join(', ')}`,
  ];
  if (!board.boards.length) {
    lines.push('', '(no completed runs yet — npm run research -- --game=' + board.gameId + ')');
  }
  for (const env of board.boards) {
    const knobs = Object.entries(env.environment).map(([key, value]) => `${key}=${round(value)}`).join(' ');
    lines.push('', `--- environment ${env.shipped ? '(shipped) ' : ''}cap=${env.capSeconds}s ${knobs}`.trimEnd());
    for (const entry of env.entries.slice(0, limit)) {
      lines.push(
        `${entry.champion ? '*' : ' '}${String(entry.rank).padStart(3)} ${entry.id}`
        + `  ${entry.holdoutMedian.toFixed(1).padStart(7)}`
        + `  95% ${entry.lower95.toFixed(1)}–${entry.upper95.toFixed(1)}`.padEnd(20)
        + `  learner=${entry.learnerVariant.padEnd(13)}`
        + ` obs=${entry.observation.padEnd(10)} act=${entry.actions.padEnd(12)}`
        + `  gap ${entry.overfitGap >= 0 ? '+' : ''}${entry.overfitGap.toFixed(1)}`
        + `  shaping ${(entry.shapingShare * 100).toFixed(0)}%`
        + `  ${entry.episodes}ep×${entry.repeats}`,
      );
    }
    if (env.entries.length > limit) lines.push(`  … ${env.entries.length - limit} more`);
  }
  if (board.digest.untried.length) {
    lines.push('', `untried in shipped environment (learner/observation/actions): ${board.digest.untried.length}`);
    for (const combination of board.digest.untried.slice(0, 12)) lines.push(`  ${combination}`);
    if (board.digest.untried.length > 12) lines.push(`  … ${board.digest.untried.length - 12} more`);
  }
  return lines.join('\n');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
