import type {
  TabularDecision,
  TabularQConfig,
  TabularQSave,
} from './rl_types.js';

export class TabularQAgent<Observation, Action> {
  private readonly qTable = new Map<string, number[]>();
  private readonly actions: readonly Action[];
  private readonly encodeState: (observation: Observation) => string;
  private readonly allowedActionIndices: (observation: Observation) => readonly number[];
  private readonly initialValues?: (observation: Observation, actionCount: number) => readonly number[];
  private readonly minimumEpsilon: number;
  private readonly maximumEpsilon: number;
  private readonly epsilonDecay: number;
  private readonly episodeEpsilonBoost: number;
  private readonly episodeMaximumEpsilon: number;
  private readonly random: () => number;
  private previousState: string | null = null;
  private previousAction = 0;
  private evaluationMode = false;

  readonly learningRate: number;
  readonly discount: number;
  epsilon: number;
  trainingSteps = 0;

  constructor(config: TabularQConfig<Observation, Action>) {
    if (!config.actions.length) throw new Error('TabularQAgent requires at least one action');
    this.actions = config.actions;
    this.encodeState = config.encodeState;
    this.allowedActionIndices = config.allowedActionIndices
      ?? (() => this.actions.map((_, index) => index));
    this.initialValues = config.initialValues;
    this.learningRate = config.learningRate ?? 0.16;
    this.discount = config.discount ?? 0.92;
    this.epsilon = config.initialEpsilon ?? 0.2;
    this.minimumEpsilon = config.minimumEpsilon ?? 0.035;
    this.maximumEpsilon = config.maximumEpsilon ?? 0.5;
    this.epsilonDecay = config.epsilonDecay ?? 0.99994;
    this.episodeEpsilonBoost = config.episodeEpsilonBoost ?? 0.025;
    this.episodeMaximumEpsilon = config.episodeMaximumEpsilon ?? this.maximumEpsilon;
    this.random = config.random ?? Math.random;
    this.validateConfig();
  }

  /**
   * Applies the reward for the previously selected action and prepares the
   * current state. Call this on every simulation step, even when the game
   * deliberately keeps the same action for several frames.
   */
  observe(observation: Observation, reward: number): void {
    const stateKey = this.encodeState(observation);
    this.valuesFor(stateKey, observation);
    if (this.evaluationMode) return;
    if (!this.previousState) return;
    const previousValues = this.valuesFor(this.previousState);
    const nextValues = this.valuesFor(stateKey, observation);
    const allowed = this.validAllowedIndices(observation);
    const future = nextValues[argMaxAllowed(nextValues, allowed)];
    const current = previousValues[this.previousAction];
    previousValues[this.previousAction] = current
      + this.learningRate * (reward + this.discount * future - current);
  }

  /**
   * Selects and records a new action. Environments own their decision cadence,
   * so they may call observe many times before requesting another decision.
   */
  decide(observation: Observation): TabularDecision<Action> {
    const stateKey = this.encodeState(observation);
    const values = this.valuesFor(stateKey, observation);
    const allowed = this.validAllowedIndices(observation);
    const exploratory = !this.evaluationMode && this.random() < this.epsilon;
    const actionIndex = exploratory
      ? allowed[Math.min(allowed.length - 1, Math.floor(this.random() * allowed.length))]
      : argMaxAllowed(values, allowed);
    const decision = {
      action: this.actions[actionIndex],
      actionIndex,
      exploratory,
      qValue: values[actionIndex],
    };
    if (!this.evaluationMode) {
      this.previousState = stateKey;
      this.previousAction = actionIndex;
      this.epsilon = Math.max(this.minimumEpsilon, this.epsilon * this.epsilonDecay);
      this.trainingSteps += 1;
    }
    return decision;
  }

  finishEpisode(finalReward: number): void {
    if (this.evaluationMode) {
      this.previousState = null;
      return;
    }
    if (this.previousState) {
      const values = this.valuesFor(this.previousState);
      values[this.previousAction] += this.learningRate * (finalReward - values[this.previousAction]);
    }
    this.previousState = null;
    this.epsilon = Math.min(this.episodeMaximumEpsilon, this.epsilon + this.episodeEpsilonBoost);
  }

  resetEpisode(): void {
    this.previousState = null;
  }

  setEvaluationMode(enabled: boolean): void {
    this.evaluationMode = enabled;
    this.previousState = null;
  }

  get knownStates(): number {
    return this.qTable.size;
  }

  serialize(): TabularQSave {
    return {
      version: 1,
      qTable: [...this.qTable.entries()].map(([key, values]) => [key, [...values]]),
      epsilon: this.epsilon,
      trainingSteps: this.trainingSteps,
    };
  }

  restore(save: TabularQSave): void {
    if (save.version !== 1 || !Array.isArray(save.qTable)) return;
    this.qTable.clear();
    for (const entry of save.qTable) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, values] = entry;
      if (typeof key !== 'string' || !Array.isArray(values) || values.length !== this.actions.length) continue;
      if (values.some((value) => !Number.isFinite(value))) continue;
      this.qTable.set(key, [...values]);
    }
    this.epsilon = clamp(save.epsilon, this.minimumEpsilon, this.maximumEpsilon);
    this.trainingSteps = Number.isFinite(save.trainingSteps)
      ? Math.max(0, Math.floor(save.trainingSteps))
      : 0;
    this.previousState = null;
  }

  valuesForState(observation: Observation): readonly number[] {
    return this.valuesFor(this.encodeState(observation), observation);
  }

  private valuesFor(key: string, observation?: Observation): number[] {
    const existing = this.qTable.get(key);
    if (existing) return existing;
    const seeded = observation && this.initialValues
      ? [...this.initialValues(observation, this.actions.length)]
      : Array<number>(this.actions.length).fill(0);
    const values = seeded.length === this.actions.length
      && seeded.every((value) => Number.isFinite(value))
      ? seeded
      : Array<number>(this.actions.length).fill(0);
    if (!this.evaluationMode) this.qTable.set(key, values);
    return values;
  }

  private validAllowedIndices(observation: Observation): readonly number[] {
    const allowed = [...new Set(this.allowedActionIndices(observation))]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < this.actions.length);
    if (!allowed.length) throw new Error('TabularQAgent action mask must allow at least one action');
    return allowed;
  }

  private validateConfig(): void {
    if (!(this.learningRate > 0 && this.learningRate <= 1)) {
      throw new Error('learningRate must be in the range (0, 1]');
    }
    if (!(this.discount >= 0 && this.discount <= 1)) {
      throw new Error('discount must be in the range [0, 1]');
    }
    if (!(this.minimumEpsilon >= 0 && this.minimumEpsilon <= this.maximumEpsilon)) {
      throw new Error('minimumEpsilon must not exceed maximumEpsilon');
    }
    if (!(this.episodeMaximumEpsilon >= this.minimumEpsilon
      && this.episodeMaximumEpsilon <= this.maximumEpsilon)) {
      throw new Error('episodeMaximumEpsilon must be within the epsilon range');
    }
    this.epsilon = clamp(this.epsilon, this.minimumEpsilon, this.maximumEpsilon);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function argMaxAllowed(values: readonly number[], allowed: readonly number[]): number {
  let bestIndex = allowed[0];
  for (let index = 1; index < allowed.length; index += 1) {
    const candidate = allowed[index];
    if (values[candidate] > values[bestIndex]) bestIndex = candidate;
  }
  return bestIndex;
}
