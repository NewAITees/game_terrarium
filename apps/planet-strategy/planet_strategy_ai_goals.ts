import type { EmpireDoctrine, PlanetStrategyPersonality } from '../../shared/types/planet_strategy.js';

export type PlanetStrategyAiGoal = 'expand' | 'pressure' | 'stabilize';

export interface PlanetStrategyGoalWeights {
  expand: number;
  pressure: number;
  stabilize: number;
}

const GOAL_LABELS: Record<PlanetStrategyAiGoal, string> = {
  expand: 'expansion',
  pressure: 'pressure',
  stabilize: 'stabilization',
};

const PERSONALITY_GOALS: Record<PlanetStrategyPersonality, PlanetStrategyGoalWeights> = {
  industrialist: { expand: 0.34, pressure: 0.12, stabilize: 0.54 },
  raider: { expand: 0.14, pressure: 0.62, stabilize: 0.24 },
  expansionist: { expand: 0.62, pressure: 0.16, stabilize: 0.22 },
  fortifier: { expand: 0.18, pressure: 0.12, stabilize: 0.7 },
};

export function baseGoalWeights(personality: PlanetStrategyPersonality, doctrine?: EmpireDoctrine): PlanetStrategyGoalWeights {
  const base = PERSONALITY_GOALS[personality];
  if (!doctrine) return { ...base };
  // Doctrine biases goals rather than issuing orders, keeping personality readable.
  return {
    expand: base.expand * (0.65 + doctrine.expansionBias * 0.7 + doctrine.riskTolerance * 0.25),
    pressure: base.pressure * (0.75 + doctrine.riskTolerance * 0.55),
    stabilize: base.stabilize * (0.65 + doctrine.logisticsBias * 0.5 + doctrine.stockpileBias * 0.45 + doctrine.repairPriority * 0.25),
  };
}

export function goalLabel(goal: PlanetStrategyAiGoal): string {
  return GOAL_LABELS[goal];
}

export function combineGoalWeights(base: PlanetStrategyGoalWeights, bonus: Partial<PlanetStrategyGoalWeights>): PlanetStrategyGoalWeights {
  return {
    expand: Math.max(0.02, (base.expand ?? 0) * (bonus.expand ?? 1)),
    pressure: Math.max(0.02, (base.pressure ?? 0) * (bonus.pressure ?? 1)),
    stabilize: Math.max(0.02, (base.stabilize ?? 0) * (bonus.stabilize ?? 1)),
  };
}

export function pickGoal(rng: () => number, weights: PlanetStrategyGoalWeights): PlanetStrategyAiGoal {
  const total = Math.max(weights.expand + weights.pressure + weights.stabilize, 0.0001);
  const roll = rng() * total;
  if (roll < weights.expand) return 'expand';
  if (roll < weights.expand + weights.pressure) return 'pressure';
  return 'stabilize';
}
