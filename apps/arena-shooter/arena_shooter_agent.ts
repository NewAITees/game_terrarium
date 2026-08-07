import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import { ValueBandit } from '../../shared/rl/value_bandit.js';
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
    allowedActionIndices: allowedArenaActions,
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
  private readonly upgradeBandit = new ValueBandit<string>();
  private evaluationMode = false;

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
    if (!this.evaluationMode) this.upgradeBandit.addReward(reward);
    this.learner.observe(observation, reward);
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return this.decision;
    this.decisionTimer = 0.09;
    this.decision = this.learner.decide(observation);
    return this.decision;
  }

  finishEpisode(finalReward: number): void {
    if (!this.evaluationMode) this.upgradeBandit.finish(finalReward, this.learningRate, 20);
    this.learner.finishEpisode(finalReward);
    this.decisionTimer = 0;
  }

  serialize(): QLearningAgentSave {
    return {
      ...this.learner.serialize(),
      upgradeValues: this.upgradeBandit.entries(),
    };
  }

  restore(save: QLearningAgentSave): void {
    this.learner.restore(save);
    this.upgradeBandit.restore((save.upgradeValues ?? []).filter((entry): entry is [string, number] => (
      typeof entry[0] === 'string' && Number.isFinite(entry[1])
    )));
    this.decisionTimer = 0;
  }

  chooseUpgrade(
    craftType: CraftType,
    choices: readonly UpgradeChoice[],
    wave: number,
  ): { choice: UpgradeChoice; exploratory: boolean; value: number } {
    if (!choices.length) throw new Error('upgrade choices are required');
    const waveBand = Math.min(4, Math.floor((wave - 1) / 5));
    const keys = choices.map((choice) => `${craftType}:${waveBand}:${choice.id}`);
    const exploratory = !this.evaluationMode && Math.random() < this.epsilon;
    const selectedKey = this.evaluationMode
      ? this.upgradeBandit.best(keys)
      : this.upgradeBandit.choose(keys, exploratory);
    const selectedIndex = keys.indexOf(selectedKey);
    return {
      choice: choices[selectedIndex],
      exploratory,
      value: this.upgradeBandit.value(selectedKey),
    };
  }

  setEvaluationMode(enabled: boolean): void {
    this.evaluationMode = enabled;
    this.learner.setEvaluationMode(enabled);
    this.decisionTimer = 0;
  }

}

function allowedArenaActions(observation: ArenaObservation): readonly number[] {
  return ACTIONS
    .map((action, index) => isActionAllowed(observation.craftType, action) ? index : -1)
    .filter((index) => index >= 0);
}
