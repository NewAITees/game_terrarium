export const TABULAR_LEARNER_VARIANTS = [
  'tabular-1step',
  'tabular-3step',
  'tabular-5step',
] as const;

export type TabularLearnerVariant = (typeof TABULAR_LEARNER_VARIANTS)[number];

export function nStepForVariant(variant: TabularLearnerVariant): number {
  if (variant === 'tabular-3step') return 3;
  if (variant === 'tabular-5step') return 5;
  return 1;
}

/**
 * Double DQN variants.
 *
 * Adam and input normalisation are listed separately rather than folded into the default because a
 * naive DQN losing to a tabular agent would say nothing about function approximation and everything
 * about a plain SGD step on unnormalised inputs. Declaring them makes the confound measurable
 * instead of leaving it as an excuse.
 */
export const DQN_LEARNER_VARIANTS = [
  'double-dqn',
  'double-dqn-adam',
  'double-dqn-adam-norm',
] as const;

export type DqnLearnerVariant = (typeof DQN_LEARNER_VARIANTS)[number];

export function isDqnVariant(variant: string): variant is DqnLearnerVariant {
  return (DQN_LEARNER_VARIANTS as readonly string[]).includes(variant);
}

export function dqnTuningForVariant(variant: DqnLearnerVariant): { optimizer: 'sgd' | 'adam'; normalizeObservations: boolean } {
  if (variant === 'double-dqn-adam') return { optimizer: 'adam', normalizeObservations: false };
  if (variant === 'double-dqn-adam-norm') return { optimizer: 'adam', normalizeObservations: true };
  return { optimizer: 'sgd', normalizeObservations: false };
}
