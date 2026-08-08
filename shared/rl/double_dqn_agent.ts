export type DoubleDqnDecision<Action> = {
  action: Action;
  actionIndex: number;
  exploratory: boolean;
  qValue: number;
};

export type DoubleDqnSave = {
  version: 1;
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
    this.online = createNetwork(this.inputSize, this.hiddenSize, this.actions.length, this.random);
    this.target = cloneNetwork(this.online);
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
      version: 1, inputSize: this.inputSize, hiddenSize: this.hiddenSize, actionCount: this.actions.length,
      online: cloneNetwork(this.online), target: cloneNetwork(this.target), epsilon: this.epsilon,
      trainingSteps: this.trainingSteps, gradientSteps: this.gradientSteps,
    };
  }

  restore(save: DoubleDqnSave): void {
    if (save.version !== 1 || save.inputSize !== this.inputSize || save.hiddenSize !== this.hiddenSize
      || save.actionCount !== this.actions.length || !validNetwork(save.online, this.inputSize, this.hiddenSize, this.actions.length)
      || !validNetwork(save.target, this.inputSize, this.hiddenSize, this.actions.length)
      || !Number.isFinite(save.epsilon) || !Number.isFinite(save.trainingSteps)
      || !Number.isFinite(save.gradientSteps)) return;
    this.online = cloneNetwork(save.online);
    this.target = cloneNetwork(save.target);
    this.epsilon = Math.max(this.minimumEpsilon, Math.min(1, save.epsilon));
    this.trainingSteps = Math.max(0, Math.floor(save.trainingSteps));
    this.gradientSteps = Math.max(0, Math.floor(save.gradientSteps));
    this.previousState = null;
  }

  private vector(observation: Observation): number[] {
    const values = [...this.encode(observation)];
    if (values.length !== this.inputSize || values.some((value) => !Number.isFinite(value))) {
      throw new Error(`Double DQN expected ${this.inputSize} finite observation values`);
    }
    return values.map((value) => Math.max(-4, Math.min(4, value)));
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
    for (let sample = 0; sample < this.batchSize; sample += 1) {
      const transition = this.replay[Math.floor(this.random() * this.replay.length)];
      const onlineNext = predict(this.online, transition.next, this.inputSize, this.hiddenSize, this.actions.length).output;
      const bestNext = transition.terminal ? 0 : argMax(onlineNext, transition.allowed, this.random);
      const targetNext = transition.terminal ? 0
        : predict(this.target, transition.next, this.inputSize, this.hiddenSize, this.actions.length).output[bestNext];
      trainOne(this.online, transition.state, transition.action,
        transition.reward + (transition.terminal ? 0 : this.discount * targetNext),
        this.inputSize, this.hiddenSize, this.actions.length, this.learningRate / this.batchSize);
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
