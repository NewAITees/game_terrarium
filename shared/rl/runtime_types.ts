export type ObservationMode = 'raw' | 'engineered' | 'minimal';
export type RewardMode = 'sparse' | 'shaped';

export type RewardBreakdown = {
  task: number;
  progress: number;
  safety: number;
  behavior: number;
  total: number;
};

export type RlTransition<Observation, Action> = {
  state: Observation;
  action: Action;
  reward: RewardBreakdown;
  nextState: Observation;
  terminated: boolean;
  truncated: boolean;
  nextAllowedActionIndices?: readonly number[];
};

export type RlStepResult<Observation, Metrics = Record<string, number>> = {
  observation: Observation;
  reward: RewardBreakdown;
  terminated: boolean;
  truncated: boolean;
  metrics: Metrics;
};

export interface RlEnvironment<Observation, Action, Metrics = Record<string, number>> {
  reset(seed: number): Observation;
  observe(mode: ObservationMode): Observation;
  validActionIndices(): readonly number[];
  step(action: Action): RlStepResult<Observation, Metrics>;
}

export interface RlPolicy<Observation, Action, Save> {
  decide(observation: Observation): { action: Action; exploratory: boolean };
  observe(observation: Observation, reward: number): void;
  finishEpisode(finalReward: number): void;
  setEvaluationMode(enabled: boolean): void;
  serialize(): Save;
  restore(save: Save): void;
}

export type EpisodeMetrics = {
  episode: number;
  seed: number;
  decisionSteps: number;
  elapsedSeconds: number;
  outcome: 'success' | 'failure' | 'timeout';
  taskReturn: number;
  shapedReturn: number;
  values: Record<string, number>;
};

export function rewardBreakdown(
  parts: Omit<RewardBreakdown, 'total'>,
): RewardBreakdown {
  return {
    ...parts,
    total: parts.task + parts.progress + parts.safety + parts.behavior,
  };
}
