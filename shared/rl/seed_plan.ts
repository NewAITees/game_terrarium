/**
 * Training / hold-out seed separation, shared by every game's headless driver.
 *
 * An automated search over environment and reward knobs will happily run thousands of
 * configurations, so it *will* find one that suits whatever episodes it was scored on.
 * The only defence is that the seeds used to pick a winner are never the seeds it trained
 * on. Splitting them by construction here — rather than per game, by convention — is what
 * makes that guarantee checkable in one place.
 */

/** Hold-out seeds start here, far above any plausible training range, so the two can never overlap. */
export const HOLDOUT_SEED_BASE = 1_000_000;

export type SeedPlan = {
  readonly train: readonly number[];
  readonly holdout: readonly number[];
};

export function createSeedPlan(trainCount: number, holdoutCount: number, base = 1): SeedPlan {
  if (!Number.isInteger(trainCount) || trainCount < 1) throw new Error('trainCount must be a positive integer');
  if (!Number.isInteger(holdoutCount) || holdoutCount < 1) throw new Error('holdoutCount must be a positive integer');
  if (!Number.isInteger(base) || base < 1) throw new Error('seed base must be a positive integer');
  if (base + trainCount > HOLDOUT_SEED_BASE) throw new Error('training seed range would collide with the hold-out range');
  return {
    train: Array.from({ length: trainCount }, (_, index) => base + index),
    holdout: Array.from({ length: holdoutCount }, (_, index) => HOLDOUT_SEED_BASE + index),
  };
}

/** The seed for one training episode. Cycles, so episode count and seed count stay independent. */
export function trainingSeed(plan: SeedPlan, episode: number): number {
  return plan.train[episode % plan.train.length];
}

/** The seed for one evaluation episode, drawn only from the hold-out range. */
export function holdoutSeed(plan: SeedPlan, episode: number): number {
  return plan.holdout[episode % plan.holdout.length];
}

export function isHoldoutSeed(seed: number): boolean {
  return seed >= HOLDOUT_SEED_BASE;
}
