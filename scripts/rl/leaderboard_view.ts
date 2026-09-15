import { resolve } from 'node:path';
import { ResearchLedger } from './research_ledger.js';
import { resolveAdapter } from './research_adapters.js';

/**
 * The leaderboard as the player page shows it.
 *
 * Ranking is read from the append-only ledger rather than recomputed here, so the board a viewer
 * sees on death and the champion the search publishes are the same judgement. Rows are ordered by
 * the hold-out lower bound, which is the quantity promotion is decided on — ordering by the median
 * would put a lucky run above the incumbent that beat it.
 */

export type LeaderboardEntry = {
  id: string;
  rank: number;
  champion: boolean;
  holdoutMedian: number;
  lower95: number;
  upper95: number;
  learnerVariant: string;
  observation: string;
  actions: string;
  shapingShare: number;
  knownStates: number;
  episodes: number;
};

export type LeaderboardView = {
  gameId: string;
  runs: number;
  championId: string | null;
  entries: LeaderboardEntry[];
};

export async function readResearchLeaderboard(gameId: string, projectRoot: string, limit = 10): Promise<LeaderboardView> {
  const empty: LeaderboardView = { gameId, runs: 0, championId: null, entries: [] };
  let adapter;
  try { adapter = resolveAdapter(gameId); } catch { return empty; }

  const ledgerPath = resolve(projectRoot, 'logs', 'rl-research', `${gameId}.jsonl`);
  let ledger: ResearchLedger;
  // A game whose search has never been run has no ledger, which is an empty board and not an error.
  try { ledger = await ResearchLedger.open(ledgerPath); } catch { return empty; }

  const completed = ledger.completed(gameId);
  if (!completed.length) return empty;
  const champion = ledger.champion(gameId, adapter.defaultSpec());
  const ranked = completed.slice().sort((left, right) => right.holdout.lower95 - left.holdout.lower95);

  return {
    gameId,
    runs: completed.length,
    championId: champion?.id ?? null,
    entries: ranked.slice(0, limit).map((row, index) => ({
      id: row.id,
      rank: index + 1,
      champion: row.id === champion?.id,
      holdoutMedian: row.holdout.median,
      lower95: row.holdout.lower95,
      upper95: row.holdout.upper95,
      learnerVariant: row.spec.learnerVariant,
      observation: row.spec.observation,
      actions: row.spec.actions,
      shapingShare: row.shapingShare,
      knownStates: row.knownStates,
      episodes: row.spec.budget?.episodes ?? 0,
    })),
  };
}
