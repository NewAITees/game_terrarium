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
  learningRate?: number;
  discount?: number;
  initialEpsilon?: number;
  minimumEpsilon?: number;
  maximumEpsilon?: number;
  epsilonDecay?: number;
  episodeEpsilonBoost?: number;
  episodeMaximumEpsilon?: number;
  random?: () => number;
  /**
   * How much of the terminal reward also lands on the actions that were *not*
   * taken in the final state, as a fraction of `learningRate`.
   *
   * With the default 0, only the taken action is penalised, so `max Q` over that
   * state stays at its optimistic initial value and the terminal reward can never
   * lower it — which means it never propagates to the state before it. Raise this
   * for environments where the last state is genuinely unrecoverable whatever you
   * do (falling into the sea, hitting a wall), so the blame attaches to the
   * situation rather than to one arbitrary action.
   */
  terminalBlame?: number;
  /**
   * Upper bound on retained states. The terrarium runs for days at a time, so
   * an unbounded table is a slow memory leak. Least-recently-touched states are
   * evicted in batches once the cap is exceeded.
   */
  maximumStates?: number;
};
