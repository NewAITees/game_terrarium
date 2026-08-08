import type { ExperimentSpec, RlSearchSpace } from '../../shared/rl/experiment_spec.js';

/**
 * Proposes the next configurations to try.
 *
 * Random search around the champion rather than a grid: the reward weights are continuous and most
 * of them do not matter, and a grid spends its whole budget resolving the ones that don't.
 *
 * Two biases are deliberate:
 *
 *  - **Weights are sampled multiplicatively, including towards zero.** Left to itself a search that
 *    only scales weights up drifts towards paying the agent for everything, because adding shaping
 *    is the cheapest way to move any number. Zero has to be reachable in one step for "this channel
 *    was never needed" to be a hypothesis the search can actually state.
 *  - **Difficulty is held fixed unless asked for.** Changing `environment` changes what the task
 *    *is*, so its task returns are not comparable with the champion's. Those runs belong on their
 *    own ladder, not in the same ranking.
 */

export type SamplerOptions = {
  /** Vary environment difficulty too. Off by default: it makes runs incomparable. */
  exploreEnvironment?: boolean;
  /** Probability of switching the observation encoding. */
  observationRate?: number;
  /** Probability of switching the action set. */
  actionRate?: number;
  /** Probability of perturbing learner hyper-parameters. */
  learnerRate?: number;
  /** Probability that a given reward weight is dropped to zero rather than scaled. */
  zeroRate?: number;
};

const LEARNER_RANGES: Record<string, { min: number; max: number }> = {
  learningRate: { min: .02, max: .4 },
  discount: { min: .8, max: .995 },
  initialEpsilon: { min: .05, max: .5 },
  minimumEpsilon: { min: .005, max: .12 },
  epsilonDecay: { min: .998, max: .99995 },
  terminalBlame: { min: 0, max: 1 },
};

export function proposeCandidate(
  champion: ExperimentSpec,
  space: RlSearchSpace,
  random: () => number,
  options: SamplerOptions = {},
): ExperimentSpec {
  const observationRate = options.observationRate ?? .25;
  const actionRate = options.actionRate ?? .25;
  const learnerRate = options.learnerRate ?? .4;
  const zeroRate = options.zeroRate ?? .12;

  const weights: Record<string, number> = { ...champion.reward.weights };
  for (const key of space.rewardWeights) {
    if (random() > .5) continue;
    const current = weights[key] ?? 0;
    // Sign-preserving: a penalty that flips to a bonus is a different game, not a tuned one.
    weights[key] = random() < zeroRate ? 0 : current * Math.exp((random() * 2 - 1) * .8);
  }

  const learner: Record<string, number> = { ...champion.learner } as Record<string, number>;
  if (random() < learnerRate) {
    const keys = Object.keys(LEARNER_RANGES);
    const key = keys[Math.floor(random() * keys.length)];
    const range = LEARNER_RANGES[key];
    learner[key] = range.min + random() * (range.max - range.min);
  }

  const environment: Record<string, number> = { ...champion.environment };
  if (options.exploreEnvironment && random() < .3) {
    const keys = Object.keys(space.environment);
    const key = keys[Math.floor(random() * keys.length)];
    const range = space.environment[key];
    environment[key] = range.min + random() * (range.max - range.min);
  }

  return {
    ...champion,
    observation: random() < observationRate ? pick(space.observations, random) : champion.observation,
    actions: random() < actionRate ? pick(space.actions, random) : champion.actions,
    reward: { mode: champion.reward.mode, weights },
    environment,
    learner,
  };
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}
