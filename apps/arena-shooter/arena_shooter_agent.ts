import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import type { TabularDecision, TabularQSave } from '../../shared/rl/rl_types.js';
import {
  ACTIONS,
  encodeObservation,
  isActionAllowed,
  type ArenaAction,
  type ArenaObservation,
  type CraftType,
} from './arena_shooter_core.js';
import type { UpgradeChoice } from './arena_shooter_progression.js';

export type AgentDecision = TabularDecision<ArenaAction>;

export type QLearningAgentSave = TabularQSave & {
  upgradeValues?: Array<[string, number]>;
};

export class QLearningAgent {
  private readonly learner = new TabularQAgent<ArenaObservation, ArenaAction>({
    actions: ACTIONS,
    encodeState: encodeObservation,
    allowedActionIndices: (observation) => ACTIONS
      .map((action, index) => isActionAllowed(observation.craftType, action) ? index : -1)
      .filter((index) => index >= 0),
    initialValues: arenaInitialValues,
    learningRate: 0.16,
    discount: 0.92,
    initialEpsilon: 0.2,
    minimumEpsilon: 0.035,
    maximumEpsilon: 0.5,
    epsilonDecay: 0.99994,
    episodeEpsilonBoost: 0.025,
    episodeMaximumEpsilon: 0.24,
  });
  private decision: AgentDecision = {
    action: ACTIONS[0],
    actionIndex: 0,
    exploratory: false,
    qValue: 0,
  };
  private decisionTimer = 0;
  private readonly upgradeValues = new Map<string, number>();
  private previousUpgradeKey: string | null = null;
  private upgradeReward = 0;

  get learningRate(): number {
    return this.learner.learningRate;
  }

  get discount(): number {
    return this.learner.discount;
  }

  get epsilon(): number {
    return this.learner.epsilon;
  }

  get trainingSteps(): number {
    return this.learner.trainingSteps;
  }

  get knownStates(): number {
    return this.learner.knownStates;
  }

  decide(observation: ArenaObservation, dt: number, reward: number): AgentDecision {
    this.upgradeReward += reward;
    this.learner.observe(observation, reward);
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return this.decision;
    this.decisionTimer = 0.09;
    this.decision = this.learner.decide(observation);
    return this.decision;
  }

  finishEpisode(finalReward: number): void {
    this.upgradeReward += finalReward;
    this.updateUpgradeValue();
    this.learner.finishEpisode(finalReward);
    this.decisionTimer = 0;
  }

  serialize(): QLearningAgentSave {
    return {
      ...this.learner.serialize(),
      upgradeValues: [...this.upgradeValues.entries()],
    };
  }

  restore(save: QLearningAgentSave): void {
    this.learner.restore(save);
    this.upgradeValues.clear();
    for (const [key, value] of save.upgradeValues ?? []) {
      if (typeof key === 'string' && Number.isFinite(value)) this.upgradeValues.set(key, value);
    }
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

function arenaInitialValues(observation: ArenaObservation, actionCount: number): readonly number[] {
  const values = Array<number>(actionCount).fill(0);
  // Arena-specific priors keep the first episodes watchable without making
  // craft knowledge part of the reusable learner.
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
  return values;
}
