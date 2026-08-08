import { createSeedPlan, holdoutSeed, trainingSeed } from '../../shared/rl/seed_plan.js';
import { repeatRandom } from '../../shared/rl/random.js';
import { specHash, validateSpec, type ExperimentSpec, type RlGameAdapter } from '../../shared/rl/experiment_spec.js';
import type { ResearchRow } from './research_ledger.js';
import { describe, mean } from './research_stats.js';

/**
 * Runs one spec end to end and produces the row that goes in the ledger.
 *
 * The order matters and is not negotiable: every repeat trains only on training seeds, and is then
 * evaluated greedily only on hold-out seeds. Nothing that happens during evaluation is allowed to
 * reach the model, and nothing the model trained on is allowed to reach the score.
 */

export type RunResult = {
  row: ResearchRow;
  /**
   * The trained model from the predetermined first repeat.
   *
   * Hold-out seeds judge the configuration, never select which stochastic training run ships. Using
   * the best hold-out repeat here would spend the hold-out set twice and publish an optimistically
   * selected model. Repeat zero is fixed before any outcome exists, so it remains auditable.
   */
  model: unknown;
};

export type RunOptions = {
  /** Hold-out episodes per repeat. */
  evaluationEpisodes?: number;
  /** Called after each repeat, for progress reporting on long runs. */
  onRepeat?: (repeat: number, repeats: number) => void;
};

export function runSpec(
  adapter: RlGameAdapter,
  spec: ExperimentSpec,
  parent: string | null,
  options: RunOptions = {},
): RunResult {
  validateSpec(spec, adapter.searchSpace);
  const id = specHash(spec);
  const evaluationEpisodes = options.evaluationEpisodes ?? 24;
  const seeds = createSeedPlan(spec.budget.trainSeeds, spec.budget.holdoutSeeds);
  const startedAt = performance.now();

  const holdoutReturns: number[] = [];
  const trainingReturns: number[] = [];
  const channelTotals = { task: 0, progress: 0, safety: 0, behavior: 0 };
  let channelEpisodes = 0;
  let trainingSteps = 0;
  let knownStates = 0;
  let publicationModel: unknown = null;

  for (let repeat = 0; repeat < spec.budget.repeats; repeat += 1) {
    // Independent agents, but a stream derived from (spec, repeat) rather than Math.random, so this
    // exact row can be reproduced from the ledger alone.
    const session = adapter.createSession(spec, repeatRandom(id, repeat));
    for (let episode = 0; episode < spec.budget.episodes; episode += 1) {
      const outcome = session.train(trainingSeed(seeds, episode));
      // Only the final tenth counts as "what this configuration learned"; the early episodes are
      // the agent being bad on purpose and would drag every configuration towards the same number.
      if (episode >= spec.budget.episodes * .9) {
        trainingReturns.push(outcome.taskReturn);
        channelTotals.task += outcome.channels.task;
        channelTotals.progress += outcome.channels.progress;
        channelTotals.safety += outcome.channels.safety;
        channelTotals.behavior += outcome.channels.behavior;
        channelEpisodes += 1;
      }
    }
    const repeatReturns: number[] = [];
    for (let episode = 0; episode < evaluationEpisodes; episode += 1) {
      repeatReturns.push(session.evaluate(holdoutSeed(seeds, episode)).taskReturn);
    }
    holdoutReturns.push(...repeatReturns);
    if (repeat === 0) publicationModel = session.serialize();
    trainingSteps += session.trainingSteps;
    knownStates += session.knownStates;
    options.onRepeat?.(repeat + 1, spec.budget.repeats);
  }

  const channels = {
    task: channelEpisodes ? channelTotals.task / channelEpisodes : 0,
    progress: channelEpisodes ? channelTotals.progress / channelEpisodes : 0,
    safety: channelEpisodes ? channelTotals.safety / channelEpisodes : 0,
    behavior: channelEpisodes ? channelTotals.behavior / channelEpisodes : 0,
  };
  const magnitude = Math.abs(channels.task) + Math.abs(channels.progress) + Math.abs(channels.safety) + Math.abs(channels.behavior);

  return {
    model: publicationModel,
    row: {
    schemaVersion: 1,
    id,
    parent,
    createdAt: new Date().toISOString(),
    spec,
    holdout: describe(holdoutReturns),
    training: describe(trainingReturns),
    channels,
    shapingShare: magnitude ? (magnitude - Math.abs(channels.task)) / magnitude : 0,
    trainingSteps,
    knownStates: Math.round(mean([knownStates / Math.max(1, spec.budget.repeats)])),
    wallSeconds: (performance.now() - startedAt) / 1000,
    },
  };
}
