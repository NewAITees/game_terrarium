import {
  ACTIONS,
  encodeObservation,
  isActionAllowed,
  type ArenaAction,
  type ArenaObservation,
  type CraftType,
} from './arena_shooter_core.js';
import type { UpgradeChoice } from './arena_shooter_progression.js';

export type AgentDecision = {
  action: ArenaAction;
  actionIndex: number;
  exploratory: boolean;
  qValue: number;
};

export type QLearningAgentSave = {
  version: 1;
  qTable: Array<[string, number[]]>;
  upgradeValues?: Array<[string, number]>;
  epsilon: number;
  trainingSteps: number;
};

export class QLearningAgent {
  private readonly qTable = new Map<string, number[]>();
  private previousState: string | null = null;
  private previousAction = 0;
  private decision: AgentDecision = { action: ACTIONS[0], actionIndex: 0, exploratory: false, qValue: 0 };
  private decisionTimer = 0;
  private readonly upgradeValues = new Map<string, number>();
  private previousUpgradeKey: string | null = null;
  private upgradeReward = 0;
  readonly learningRate = 0.16;
  readonly discount = 0.92;
  epsilon = 0.2;
  trainingSteps = 0;

  decide(observation: ArenaObservation, dt: number, reward: number): AgentDecision {
    this.upgradeReward += reward;
    const stateKey = encodeObservation(observation);
    // Seed an unseen state with the checkpoint prior before the TD update reads it.
    this.valuesFor(stateKey, observation);
    this.updatePrevious(stateKey, observation, reward);
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return this.decision;
    this.decisionTimer = 0.09;

    const values = this.valuesFor(stateKey, observation);
    const allowed = ACTIONS
      .map((action, index) => isActionAllowed(observation.craftType, action) ? index : -1)
      .filter((index) => index >= 0);
    const exploratory = Math.random() < this.epsilon;
    const actionIndex = exploratory
      ? allowed[Math.floor(Math.random() * allowed.length)]
      : argMaxAllowed(values, allowed);
    this.decision = {
      action: ACTIONS[actionIndex],
      actionIndex,
      exploratory,
      qValue: values[actionIndex],
    };
    this.previousState = stateKey;
    this.previousAction = actionIndex;
    this.epsilon = Math.max(0.035, this.epsilon * 0.99994);
    this.trainingSteps += 1;
    return this.decision;
  }

  finishEpisode(finalReward: number): void {
    this.upgradeReward += finalReward;
    this.updateUpgradeValue();
    if (this.previousState) {
      const values = this.valuesFor(this.previousState);
      values[this.previousAction] += this.learningRate * (finalReward - values[this.previousAction]);
    }
    this.previousState = null;
    this.decisionTimer = 0;
    this.epsilon = Math.min(0.24, this.epsilon + 0.025);
  }

  get knownStates(): number {
    return this.qTable.size;
  }

  serialize(): QLearningAgentSave {
    return {
      version: 1,
      qTable: [...this.qTable.entries()].map(([key, values]) => [key, [...values]]),
      upgradeValues: [...this.upgradeValues.entries()],
      epsilon: this.epsilon,
      trainingSteps: this.trainingSteps,
    };
  }

  restore(save: QLearningAgentSave): void {
    if (save.version !== 1 || !Array.isArray(save.qTable)) return;
    this.qTable.clear();
    for (const [key, values] of save.qTable) {
      if (typeof key !== 'string' || values.length !== ACTIONS.length) continue;
      if (values.some((value) => !Number.isFinite(value))) continue;
      this.qTable.set(key, [...values]);
    }
    this.upgradeValues.clear();
    for (const [key, value] of save.upgradeValues ?? []) {
      if (typeof key === 'string' && Number.isFinite(value)) this.upgradeValues.set(key, value);
    }
    this.epsilon = clamp(save.epsilon, 0.035, 0.5);
    this.trainingSteps = Math.max(0, Math.floor(save.trainingSteps));
    this.previousState = null;
    this.decisionTimer = 0;
    this.previousUpgradeKey = null;
    this.upgradeReward = 0;
  }

  chooseUpgrade(
    craftType: CraftType,
    choices: readonly UpgradeChoice[],
    wave: number,
  ): { choice: UpgradeChoice; exploratory: boolean; value: number } {
    if (!choices.length) throw new Error('upgrade choices are required');
    this.updateUpgradeValue();
    const waveBand = Math.min(4, Math.floor((wave - 1) / 5));
    const keys = choices.map((choice) => `${craftType}:${waveBand}:${choice.id}`);
    const exploratory = Math.random() < this.epsilon;
    let selectedIndex = 0;
    if (exploratory) {
      selectedIndex = Math.floor(Math.random() * choices.length);
    } else {
      for (let index = 1; index < choices.length; index += 1) {
        if ((this.upgradeValues.get(keys[index]) ?? 0) > (this.upgradeValues.get(keys[selectedIndex]) ?? 0)) {
          selectedIndex = index;
        }
      }
    }
    this.previousUpgradeKey = keys[selectedIndex];
    this.upgradeReward = 0;
    return {
      choice: choices[selectedIndex],
      exploratory,
      value: this.upgradeValues.get(keys[selectedIndex]) ?? 0,
    };
  }

  private updatePrevious(nextState: string, observation: ArenaObservation, reward: number): void {
    if (!this.previousState) return;
    const previousValues = this.valuesFor(this.previousState);
    const nextValues = this.valuesFor(nextState);
    const allowed = ACTIONS
      .map((action, index) => isActionAllowed(observation.craftType, action) ? index : -1)
      .filter((index) => index >= 0);
    const future = nextValues[argMaxAllowed(nextValues, allowed)];
    const current = previousValues[this.previousAction];
    previousValues[this.previousAction] = current
      + this.learningRate * (reward + this.discount * future - current);
  }

  private valuesFor(key: string, observation?: ArenaObservation): number[] {
    const existing = this.qTable.get(key);
    if (existing) return existing;
    const values = Array<number>(ACTIONS.length).fill(0);
    // A small prior prevents the first episodes from being entirely random.
    if (observation) {
      const aim = observation.aimSector;
      if (aim === 0) {
        values[6] = 0.7;
        values[7] = observation.distanceBand > 0 ? 0.8 : 0.25;
      } else if (observation.craftType === 'turret') {
        values[aim <= 8 ? 14 : 13] = 0.72;
        values[aim <= 8 ? 16 : 15] = 0.48;
      } else if (aim <= 8) {
        values[3] = 0.62;
        values[5] = 0.46;
      } else {
        values[2] = 0.62;
        values[4] = 0.46;
      }
      if (observation.projectileDistanceBand === 0 && observation.craftType === 'strafer') {
        values[observation.projectileDangerSector <= 4 ? 9 : 10] = 0.9;
      } else if (observation.projectileDistanceBand === 0) {
        const evadeIndex = observation.projectileDangerSector <= 4 ? 4 : 5;
        values[evadeIndex] = 0.86;
      }
      if (observation.edgeDistanceBand === 0) {
        if (observation.edgeSector === 0) values[1] = 0.82;
        else if (observation.edgeSector <= 3) values[2] = 0.82;
        else if (observation.edgeSector >= 5) values[3] = 0.82;
        else values[0] = 0.82;
      }
      if (observation.distanceBand === 0 || observation.hpBand === 0) values[8] = 0.65;
    }
    this.qTable.set(key, values);
    return values;
  }

  private updateUpgradeValue(): void {
    if (!this.previousUpgradeKey) return;
    const current = this.upgradeValues.get(this.previousUpgradeKey) ?? 0;
    const normalizedReward = Math.max(-20, Math.min(20, this.upgradeReward));
    this.upgradeValues.set(
      this.previousUpgradeKey,
      current + this.learningRate * (normalizedReward - current),
    );
    this.previousUpgradeKey = null;
    this.upgradeReward = 0;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
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
