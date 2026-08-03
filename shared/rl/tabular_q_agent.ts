import type {
  TabularDecision,
  TabularQConfig,
  TabularQSave,
} from './rl_types.js';

/**
 * Roughly 45MB of table for a 17-action game, which a days-long always-on-top
 * session can sit at without crowding the rest of the app.
 */
const DEFAULT_MAXIMUM_STATES = 120_000;
const EVICTION_BATCH_RATIO = 0.1;

export class TabularQAgent<Observation, Action> {
  private readonly qTable = new Map<string, number[]>();
  private readonly actions: readonly Action[];
  private readonly encodeState: (observation: Observation) => string;
  private readonly allowedActionIndices: (observation: Observation) => readonly number[];
  private readonly minimumEpsilon: number;
  private readonly maximumEpsilon: number;
  private readonly epsilonDecay: number;
  private readonly episodeEpsilonBoost: number;
  private readonly episodeMaximumEpsilon: number;
  private readonly random: () => number;
  private readonly maximumStates: number;
  private readonly terminalBlame: number;
  private readonly touchedAt = new Map<string, number>();
  private touchClock = 0;
  private previousState: string | null = null;
  private previousAction = 0;
  private evaluationMode = false;

  readonly learningRate: number;
  readonly discount: number;
  epsilon: number;
  trainingSteps = 0;
  evictedStates = 0;

  constructor(config: TabularQConfig<Observation, Action>) {
    if (!config.actions.length) throw new Error('TabularQAgent requires at least one action');
    this.actions = config.actions;
    this.encodeState = config.encodeState;
    this.allowedActionIndices = config.allowedActionIndices
      ?? (() => this.actions.map((_, index) => index));
    this.learningRate = config.learningRate ?? 0.16;
    this.discount = config.discount ?? 0.92;
    this.epsilon = config.initialEpsilon ?? 0.2;
    this.minimumEpsilon = config.minimumEpsilon ?? 0.035;
    this.maximumEpsilon = config.maximumEpsilon ?? 0.5;
    this.epsilonDecay = config.epsilonDecay ?? 0.99994;
    this.episodeEpsilonBoost = config.episodeEpsilonBoost ?? 0.025;
    this.episodeMaximumEpsilon = config.episodeMaximumEpsilon ?? this.maximumEpsilon;
    this.random = config.random ?? Math.random;
    this.maximumStates = config.maximumStates ?? DEFAULT_MAXIMUM_STATES;
    this.terminalBlame = config.terminalBlame ?? 0;
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
      : argMaxAllowed(values, allowed, this.random);
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
      if (this.terminalBlame > 0) {
        // See `terminalBlame` in rl_types: without this the untried actions keep
        // their optimistic seed, `max Q` never drops, and the penalty stops here.
        const rate = this.learningRate * this.terminalBlame;
        for (let index = 0; index < values.length; index += 1) {
          if (index === this.previousAction) continue;
          values[index] += rate * (finalReward - values[index]);
        }
      }
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
    this.touchedAt.clear();
    this.touchClock = 0;
    // Saves written before the cap existed can be larger than it; keep the tail,
    // which is the most recently learned part of the table.
    const entries = save.qTable.slice(-this.maximumStates);
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, values] = entry;
      if (typeof key !== 'string' || !Array.isArray(values) || values.length !== this.actions.length) continue;
      if (values.some((value) => !Number.isFinite(value))) continue;
      this.qTable.set(key, [...values]);
      this.touchedAt.set(key, ++this.touchClock);
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
    if (existing) {
      if (!this.evaluationMode) this.touchedAt.set(key, ++this.touchClock);
      return existing;
    }
    // Deliberately no hand-authored seed hook. Priors set above the returns the
    // environment can actually pay pin the greedy policy to the rules that wrote
    // them, and the learner can never out-value its own initialisation. That is
    // exactly what stopped gunship from learning for its whole history.
    const values = Array<number>(this.actions.length).fill(0);
    if (!this.evaluationMode) {
      this.qTable.set(key, values);
      this.touchedAt.set(key, ++this.touchClock);
      this.evictColdStates();
    }
    return values;
  }

  /**
   * Drops the least-recently-touched states once the table exceeds its cap.
   * Evicting a batch keeps the O(n log n) scan rare enough to be amortized away,
   * and rarely-visited states are exactly the ones the policy leans on least.
   */
  private evictColdStates(): void {
    if (this.qTable.size <= this.maximumStates) return;
    const target = Math.max(1, Math.floor(this.maximumStates * EVICTION_BATCH_RATIO));
    const ranked = [...this.touchedAt.entries()].sort((left, right) => left[1] - right[1]);
    let removed = 0;
    for (const [key] of ranked) {
      if (removed >= target) break;
      // The in-flight state still owes an update; dropping it would lose that step.
      if (key === this.previousState) continue;
      this.qTable.delete(key);
      this.touchedAt.delete(key);
      removed += 1;
    }
    this.evictedStates += removed;
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
    if (!(Number.isInteger(this.maximumStates) && this.maximumStates > 0)) {
      throw new Error('maximumStates must be a positive integer');
    }
    if (!(this.terminalBlame >= 0 && this.terminalBlame <= 1)) {
      throw new Error('terminalBlame must be in the range [0, 1]');
    }
    this.epsilon = clamp(this.epsilon, this.minimumEpsilon, this.maximumEpsilon);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function argMaxAllowed(
  values: readonly number[],
  allowed: readonly number[],
  random: () => number = Math.random,
): number {
  let bestIndex = allowed[0];
  let ties = 1;
  for (let index = 1; index < allowed.length; index += 1) {
    const candidate = allowed[index];
    if (values[candidate] > values[bestIndex]) bestIndex = candidate;
    else if (values[candidate] === values[bestIndex]) {
      ties += 1;
      if (random() < 1 / ties) bestIndex = candidate;
    }
  }
  return bestIndex;
}
