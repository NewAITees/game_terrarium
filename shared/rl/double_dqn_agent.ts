export type DoubleDqnDecision<Action> = {
  action: Action;
  actionIndex: number;
  exploratory: boolean;
  qValue: number;
};

export type DoubleDqnSave = {
  /**
   * v2 carries the optimiser choice and the input normaliser's running statistics. The statistics
   * are part of the policy, not of the training run: a model restored without them would normalise
   * its inputs differently from the network that was trained on them, which produces a plausible
   * agent that has quietly been fed a different observation space.
   */
  version: 2;
  optimizer: DqnOptimizer;
  normalize: boolean;
  normalizer?: { count: number; mean: number[]; m2: number[] };
  inputSize: number;
  hiddenSize: number;
  actionCount: number;
  online: NetworkWeights;
  target: NetworkWeights;
  epsilon: number;
  trainingSteps: number;
  gradientSteps: number;
};

type NetworkWeights = { input: number[]; hiddenBias: number[]; output: number[]; outputBias: number[] };

export type DqnOptimizer = 'sgd' | 'adam';

/**
 * Welford running mean and variance per input dimension.
 *
 * The encoded observations here are hand-scaled by whatever divisor suited each field, so their
 * variances differ by orders of magnitude; a single learning rate then means very different step
 * sizes per dimension. This is the cheap standard fix, and it is a declared variant rather than a
 * default so its effect is measured instead of assumed.
 */
type Normalizer = { count: number; mean: number[]; m2: number[] };
type Transition = { state: number[]; action: number; reward: number; next: number[]; terminal: boolean; allowed: number[] };

export type DoubleDqnConfig<Observation, Action> = {
  actions: readonly Action[];
  inputSize: number;
  encode: (observation: Observation) => readonly number[];
  allowedActionIndices?: (observation: Observation) => readonly number[];
  hiddenSize?: number;
  learningRate?: number;
  discount?: number;
  initialEpsilon?: number;
  minimumEpsilon?: number;
  epsilonDecay?: number;
  replayCapacity?: number;
  batchSize?: number;
  warmupSteps?: number;
  targetSyncSteps?: number;
  /** 'sgd' keeps the original per-sample update exactly; 'adam' accumulates the batch, then steps. */
  optimizer?: DqnOptimizer;
  /** Standardise encoded inputs with running statistics. */
  normalizeObservations?: boolean;
  random?: () => number;
};

/** Small dependency-free Double DQN for fixed-size terrarium observations and discrete actions. */
export class DoubleDqnAgent<Observation, Action> {
  private readonly actions: readonly Action[];
  private readonly inputSize: number;
  private readonly hiddenSize: number;
  private readonly encode: (observation: Observation) => readonly number[];
  private readonly allowed: (observation: Observation) => readonly number[];
  private readonly learningRate: number;
  private readonly discount: number;
  private readonly minimumEpsilon: number;
  private readonly epsilonDecay: number;
  private readonly replayCapacity: number;
  private readonly batchSize: number;
  private readonly warmupSteps: number;
  private readonly targetSyncSteps: number;
  private readonly random: () => number;
  private readonly optimizer: DqnOptimizer;
  private readonly normalize: boolean;
  private normalizer: Normalizer | null;
  private moments: { first: NetworkWeights; second: NetworkWeights; steps: number } | null;
  private online: NetworkWeights;
  private target: NetworkWeights;
  private replay: Transition[] = [];
  private replayCursor = 0;
  private previousState: number[] | null = null;
  private previousAction = 0;
  private evaluationMode = false;
  epsilon: number;
  trainingSteps = 0;
  gradientSteps = 0;

  constructor(config: DoubleDqnConfig<Observation, Action>) {
    if (!config.actions.length || config.inputSize < 1) throw new Error('DoubleDqnAgent needs actions and inputs');
    this.actions = config.actions;
    this.inputSize = config.inputSize;
    this.hiddenSize = config.hiddenSize ?? 64;
    this.encode = config.encode;
    this.allowed = config.allowedActionIndices ?? (() => this.actions.map((_, index) => index));
    this.learningRate = config.learningRate ?? 0.0005;
    this.discount = config.discount ?? 0.99;
    this.epsilon = config.initialEpsilon ?? 0.3;
    this.minimumEpsilon = config.minimumEpsilon ?? 0.03;
    this.epsilonDecay = config.epsilonDecay ?? 0.9998;
    this.replayCapacity = config.replayCapacity ?? 20_000;
    this.batchSize = config.batchSize ?? 32;
    this.warmupSteps = config.warmupSteps ?? 256;
    this.targetSyncSteps = config.targetSyncSteps ?? 500;
    this.random = config.random ?? Math.random;
    this.optimizer = config.optimizer ?? 'sgd';
    this.normalize = config.normalizeObservations ?? false;
    this.normalizer = this.normalize
      ? { count: 0, mean: Array(this.inputSize).fill(0), m2: Array(this.inputSize).fill(0) }
      : null;
    this.online = createNetwork(this.inputSize, this.hiddenSize, this.actions.length, this.random);
    this.target = cloneNetwork(this.online);
    this.moments = this.optimizer === 'adam'
      ? { first: zeroNetwork(this.online), second: zeroNetwork(this.online), steps: 0 }
      : null;
  }

  observe(observation: Observation, reward: number): void {
    const next = this.vector(observation);
    if (!this.evaluationMode && this.previousState) {
      this.push({ state: this.previousState, action: this.previousAction, reward, next, terminal: false, allowed: this.validAllowed(observation) });
      this.trainFromReplay();
    }
  }

  decide(observation: Observation): DoubleDqnDecision<Action> {
    const state = this.vector(observation);
    const values = predict(this.online, state, this.inputSize, this.hiddenSize, this.actions.length).output;
    const allowed = this.validAllowed(observation);
    const exploratory = !this.evaluationMode && this.random() < this.epsilon;
    const actionIndex = exploratory
      ? allowed[Math.floor(this.random() * allowed.length)]
      : argMax(values, allowed, this.random);
    if (!this.evaluationMode) {
      this.previousState = state;
      this.previousAction = actionIndex;
      this.trainingSteps += 1;
      this.epsilon = Math.max(this.minimumEpsilon, this.epsilon * this.epsilonDecay);
    }
    return { action: this.actions[actionIndex], actionIndex, exploratory, qValue: values[actionIndex] };
  }

  finishEpisode(finalReward: number): void {
    if (!this.evaluationMode && this.previousState) {
      this.push({ state: this.previousState, action: this.previousAction, reward: finalReward, next: this.previousState, terminal: true, allowed: [] });
      this.trainFromReplay();
    }
    this.previousState = null;
  }

  setEvaluationMode(enabled: boolean): void { this.evaluationMode = enabled; this.previousState = null; }
  get knownStates(): number { return this.replay.length; }

  serialize(): DoubleDqnSave {
    return {
      version: 2, inputSize: this.inputSize, hiddenSize: this.hiddenSize, actionCount: this.actions.length,
      online: cloneNetwork(this.online), target: cloneNetwork(this.target), epsilon: this.epsilon,
      trainingSteps: this.trainingSteps, gradientSteps: this.gradientSteps,
      optimizer: this.optimizer, normalize: this.normalize,
      normalizer: this.normalizer
        ? { count: this.normalizer.count, mean: [...this.normalizer.mean], m2: [...this.normalizer.m2] }
        : undefined,
    };
  }

  restore(save: DoubleDqnSave): void {
    // A network trained under a different optimiser is fine to load — the weights are the weights —
    // but one trained on differently normalised inputs is not the same policy at all.
    if (save.version !== 2 || save.normalize !== this.normalize
      || save.inputSize !== this.inputSize || save.hiddenSize !== this.hiddenSize
      || save.actionCount !== this.actions.length || !validNetwork(save.online, this.inputSize, this.hiddenSize, this.actions.length)
      || !validNetwork(save.target, this.inputSize, this.hiddenSize, this.actions.length)
      || !Number.isFinite(save.epsilon) || !Number.isFinite(save.trainingSteps)
      || !Number.isFinite(save.gradientSteps)) return;
    this.online = cloneNetwork(save.online);
    this.target = cloneNetwork(save.target);
    this.epsilon = Math.max(this.minimumEpsilon, Math.min(1, save.epsilon));
    this.trainingSteps = Math.max(0, Math.floor(save.trainingSteps));
    this.gradientSteps = Math.max(0, Math.floor(save.gradientSteps));
    if (this.normalizer && save.normalizer && save.normalizer.mean.length === this.inputSize
      && save.normalizer.m2.length === this.inputSize && Number.isFinite(save.normalizer.count)) {
      this.normalizer = { count: save.normalizer.count, mean: [...save.normalizer.mean], m2: [...save.normalizer.m2] };
    }
    this.previousState = null;
  }

  private vector(observation: Observation): number[] {
    const values = [...this.encode(observation)];
    if (values.length !== this.inputSize || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Double DQN expected ${this.inputSize} finite observation values`);
    }
    if (!this.normalizer) return values.map((value) => Math.max(-4, Math.min(4, value)));
    // Statistics only advance while learning: evaluation must not be able to move the observation
    // space it is being scored in.
    if (!this.evaluationMode) updateNormalizer(this.normalizer, values);
    return standardize(this.normalizer, values);
  }

  private validAllowed(observation: Observation): number[] {
    const allowed = [...new Set(this.allowed(observation))]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < this.actions.length);
    if (!allowed.length) throw new Error('Double DQN action mask must allow at least one action');
    return allowed;
  }

  private push(transition: Transition): void {
    if (this.replay.length < this.replayCapacity) this.replay.push(transition);
    else { this.replay[this.replayCursor] = transition; this.replayCursor = (this.replayCursor + 1) % this.replayCapacity; }
  }

  private trainFromReplay(): void {
    if (this.replay.length < this.warmupSteps) return;
    // The SGD path is left exactly as it was — same sampling, same per-sample update, same order —
    // so ledger rows measured before Adam existed remain comparable with rows measured after.
    const gradients = this.moments ? zeroNetwork(this.online) : null;
    for (let sample = 0; sample < this.batchSize; sample += 1) {
      const transition = this.replay[Math.floor(this.random() * this.replay.length)];
      const onlineNext = predict(this.online, transition.next, this.inputSize, this.hiddenSize, this.actions.length).output;
      const bestNext = transition.terminal ? 0 : argMax(onlineNext, transition.allowed, this.random);
      const targetNext = transition.terminal ? 0
        : predict(this.target, transition.next, this.inputSize, this.hiddenSize, this.actions.length).output[bestNext];
      const target = transition.reward + (transition.terminal ? 0 : this.discount * targetNext);
      if (gradients) {
        accumulateGradient(this.online, gradients, transition.state, transition.action, target,
          this.inputSize, this.hiddenSize, this.actions.length, 1 / this.batchSize);
      } else {
        trainOne(this.online, transition.state, transition.action, target,
          this.inputSize, this.hiddenSize, this.actions.length, this.learningRate / this.batchSize);
      }
    }
    if (gradients && this.moments) {
      this.moments.steps += 1;
      applyAdam(this.online, gradients, this.moments, this.learningRate);
    }
    this.gradientSteps += 1;
    if (this.gradientSteps % this.targetSyncSteps === 0) this.target = cloneNetwork(this.online);
  }
}

function createNetwork(inputs: number, hidden: number, outputs: number, random: () => number): NetworkWeights {
  const scale = Math.sqrt(2 / inputs);
  return {
    input: Array.from({ length: inputs * hidden }, () => (random() * 2 - 1) * scale),
    hiddenBias: Array(hidden).fill(0),
    output: Array.from({ length: hidden * outputs }, () => (random() * 2 - 1) * Math.sqrt(2 / hidden)),
    outputBias: Array(outputs).fill(0),
  };
}

function predict(weights: NetworkWeights, state: readonly number[], inputs: number, hidden: number, outputs: number) {
  const activation = Array<number>(hidden);
  for (let h = 0; h < hidden; h += 1) {
    let sum = weights.hiddenBias[h];
    for (let i = 0; i < inputs; i += 1) sum += state[i] * weights.input[i * hidden + h];
    activation[h] = Math.max(0, sum);
  }
  const output = Array<number>(outputs);
  for (let o = 0; o < outputs; o += 1) {
    let sum = weights.outputBias[o];
    for (let h = 0; h < hidden; h += 1) sum += activation[h] * weights.output[h * outputs + o];
    output[o] = sum;
  }
  return { activation, output };
}

function trainOne(weights: NetworkWeights, state: readonly number[], action: number, target: number,
  inputs: number, hidden: number, outputs: number, rate: number): void {
  const prediction = predict(weights, state, inputs, hidden, outputs);
  const error = Math.max(-10, Math.min(10, prediction.output[action] - target));
  const hiddenGradient = Array<number>(hidden);
  for (let h = 0; h < hidden; h += 1) hiddenGradient[h] = error * weights.output[h * outputs + action];
  for (let h = 0; h < hidden; h += 1) weights.output[h * outputs + action] -= rate * error * prediction.activation[h];
  weights.outputBias[action] -= rate * error;
  for (let h = 0; h < hidden; h += 1) {
    if (prediction.activation[h] <= 0) continue;
    const gradient = Math.max(-10, Math.min(10, hiddenGradient[h]));
    for (let i = 0; i < inputs; i += 1) weights.input[i * hidden + h] -= rate * gradient * state[i];
    weights.hiddenBias[h] -= rate * gradient;
  }
}

function argMax(values: readonly number[], allowed: readonly number[], random: () => number): number {
  let best = allowed[0];
  let ties = 1;
  for (let i = 1; i < allowed.length; i += 1) {
    const candidate = allowed[i];
    if (values[candidate] > values[best]) { best = candidate; ties = 1; }
    else if (values[candidate] === values[best] && random() < 1 / ++ties) best = candidate;
  }
  return best;
}

function cloneNetwork(weights: NetworkWeights): NetworkWeights {
  return { input: [...weights.input], hiddenBias: [...weights.hiddenBias], output: [...weights.output], outputBias: [...weights.outputBias] };
}

function validNetwork(weights: NetworkWeights, inputs: number, hidden: number, outputs: number): boolean {
  return weights.input?.length === inputs * hidden && weights.hiddenBias?.length === hidden
    && weights.output?.length === hidden * outputs && weights.outputBias?.length === outputs
    && [...weights.input, ...weights.hiddenBias, ...weights.output, ...weights.outputBias].every(Number.isFinite);
}

function zeroNetwork(shape: NetworkWeights): NetworkWeights {
  return {
    input: Array(shape.input.length).fill(0),
    hiddenBias: Array(shape.hiddenBias.length).fill(0),
    output: Array(shape.output.length).fill(0),
    outputBias: Array(shape.outputBias.length).fill(0),
  };
}

/** Same derivative as `trainOne`, but summed into a buffer so the batch can take one step. */
function accumulateGradient(weights: NetworkWeights, into: NetworkWeights, state: readonly number[],
  action: number, target: number, inputs: number, hidden: number, outputs: number, scale: number): void {
  const prediction = predict(weights, state, inputs, hidden, outputs);
  const error = Math.max(-10, Math.min(10, prediction.output[action] - target)) * scale;
  for (let h = 0; h < hidden; h += 1) {
    into.output[h * outputs + action] += error * prediction.activation[h];
    if (prediction.activation[h] <= 0) continue;
    const gradient = Math.max(-10, Math.min(10, error * weights.output[h * outputs + action]));
    for (let i = 0; i < inputs; i += 1) into.input[i * hidden + h] += gradient * state[i];
    into.hiddenBias[h] += gradient;
  }
  into.outputBias[action] += error;
}

const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPSILON = 1e-8;

function applyAdam(weights: NetworkWeights, gradients: NetworkWeights,
  moments: { first: NetworkWeights; second: NetworkWeights; steps: number }, rate: number): void {
  const correction1 = 1 - Math.pow(ADAM_BETA1, moments.steps);
  const correction2 = 1 - Math.pow(ADAM_BETA2, moments.steps);
  const keys = ['input', 'hiddenBias', 'output', 'outputBias'] as const;
  for (const key of keys) {
    const parameter = weights[key];
    const gradient = gradients[key];
    const first = moments.first[key];
    const second = moments.second[key];
    for (let index = 0; index < parameter.length; index += 1) {
      const g = gradient[index];
      first[index] = ADAM_BETA1 * first[index] + (1 - ADAM_BETA1) * g;
      second[index] = ADAM_BETA2 * second[index] + (1 - ADAM_BETA2) * g * g;
      parameter[index] -= rate * (first[index] / correction1) / (Math.sqrt(second[index] / correction2) + ADAM_EPSILON);
    }
  }
}

function updateNormalizer(normalizer: Normalizer, values: readonly number[]): void {
  normalizer.count += 1;
  for (let index = 0; index < values.length; index += 1) {
    const delta = values[index] - normalizer.mean[index];
    normalizer.mean[index] += delta / normalizer.count;
    normalizer.m2[index] += delta * (values[index] - normalizer.mean[index]);
  }
}

function standardize(normalizer: Normalizer, values: readonly number[]): number[] {
  // Below a couple of samples the variance estimate is meaningless, so fall back to the raw clip
  // rather than dividing by noise.
  if (normalizer.count < 2) return values.map((value) => Math.max(-4, Math.min(4, value)));
  return values.map((value, index) => {
    const variance = normalizer.m2[index] / (normalizer.count - 1);
    const scaled = (value - normalizer.mean[index]) / Math.sqrt(variance + 1e-8);
    return Math.max(-5, Math.min(5, scaled));
  });
}
