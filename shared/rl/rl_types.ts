export type TabularDecision<Action> = {
  action: Action;
  actionIndex: number;
  exploratory: boolean;
  qValue: number;
};

export type TabularQSave = {
  version: 1;
  qTable: Array<[string, number[]]>;
  epsilon: number;
  trainingSteps: number;
};

export type TabularQConfig<Observation, Action> = {
  actions: readonly Action[];
  encodeState: (observation: Observation) => string;
  allowedActionIndices?: (observation: Observation) => readonly number[];
  initialValues?: (observation: Observation, actionCount: number) => readonly number[];
  learningRate?: number;
  discount?: number;
  initialEpsilon?: number;
  minimumEpsilon?: number;
  maximumEpsilon?: number;
  epsilonDecay?: number;
  episodeEpsilonBoost?: number;
  episodeMaximumEpsilon?: number;
  random?: () => number;
};
