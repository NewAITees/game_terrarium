import type { RlSearchSpace } from '../../shared/rl/experiment_spec.js';
import type { ResearchRow } from './research_ledger.js';
import { mean, median } from './research_stats.js';

/**
 * Compresses the ledger into the evidence an outside proposer actually needs.
 *
 * A model asked to suggest the next experiment cannot be handed thousands of raw rows, and giving
 * it the champion alone teaches it nothing about what has already been ruled out. What it needs is
 * the shape of the search so far: which variants have been tried and how they did, which
 * combinations nobody has touched, and where results are suspiciously good on training seeds only.
 */

export type VariantSummary = {
  name: string;
  runs: number;
  bestHoldout: number;
  medianHoldout: number;
  /** Training median minus hold-out median. Large and positive means it fitted the seeds it saw. */
  overfitGap: number;
  medianStates: number;
};

export type LedgerDigest = {
  gameId: string;
  runs: number;
  searchSpace: RlSearchSpace;
  champion: { id: string; holdoutMedian: number; learnerVariant: string; observation: string; actions: string; weights: Record<string, number>; shapingShare: number } | null;
  learnerVariants: VariantSummary[];
  observations: VariantSummary[];
  actions: VariantSummary[];
  /** Declared combinations with no completed run yet. */
  untried: string[];
  top: { id: string; holdoutMedian: number; lower95: number; learnerVariant: string; observation: string; actions: string; shapingShare: number; weights: Record<string, number> }[];
};

export function digestLedger(gameId: string, rows: readonly ResearchRow[], space: RlSearchSpace, champion?: ResearchRow): LedgerDigest {
  const completed = rows.filter((row) => !row.error && row.holdout.count > 0);
  const tried = new Set(completed.map((row) => `${row.spec.learnerVariant}/${row.spec.observation}/${row.spec.actions}`));
  const untried: string[] = [];
  for (const learnerVariant of space.learnerVariants) {
    for (const observation of space.observations) {
      for (const actions of space.actions) {
        const key = `${learnerVariant}/${observation}/${actions}`;
        if (!tried.has(key)) untried.push(key);
      }
    }
  }
  return {
    gameId,
    runs: completed.length,
    searchSpace: space,
    champion: champion
      ? {
        id: champion.id,
        holdoutMedian: round(champion.holdout.median),
        learnerVariant: champion.spec.learnerVariant,
        observation: champion.spec.observation,
        actions: champion.spec.actions,
        weights: roundWeights(champion.spec.reward.weights),
        shapingShare: round(champion.shapingShare),
      }
      : null,
    learnerVariants: space.learnerVariants.map((name) => summarize(name, completed.filter((row) => row.spec.learnerVariant === name))),
    observations: space.observations.map((name) => summarize(name, completed.filter((row) => row.spec.observation === name))),
    actions: space.actions.map((name) => summarize(name, completed.filter((row) => row.spec.actions === name))),
    untried,
    top: completed
      .slice()
      .sort((left, right) => right.holdout.lower95 - left.holdout.lower95)
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        holdoutMedian: round(row.holdout.median),
        lower95: round(row.holdout.lower95),
        learnerVariant: row.spec.learnerVariant,
        observation: row.spec.observation,
        actions: row.spec.actions,
        shapingShare: round(row.shapingShare),
        weights: roundWeights(row.spec.reward.weights),
      })),
  };
}

function summarize(name: string, rows: readonly ResearchRow[]): VariantSummary {
  return {
    name,
    runs: rows.length,
    bestHoldout: rows.length ? round(Math.max(...rows.map((row) => row.holdout.median))) : 0,
    medianHoldout: round(median(rows.map((row) => row.holdout.median))),
    overfitGap: round(mean(rows.map((row) => row.training.median - row.holdout.median))),
    medianStates: Math.round(median(rows.map((row) => row.knownStates))),
  };
}

function roundWeights(weights: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value)]));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
