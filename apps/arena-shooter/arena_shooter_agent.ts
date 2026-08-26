import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import { nStepForVariant, type TabularLearnerVariant } from '../../shared/rl/learner_variant.js';
import { ValueBandit } from '../../shared/rl/value_bandit.js';
import type { TabularDecision, TabularQSave } from '../../shared/rl/rl_types.js';
import {
  ACTIONS,
  ARENA_OBSERVATIONS,
  encodeObservationVariant,
  isActionAllowed,
  type ArenaAction,
  type ArenaObservation,
  type ArenaObservationVariant,
  type CraftType,
} from './arena_shooter_core.js';

/** Action variants. The shipped set is the full 162-way product; each variant changes table width. */
export const ARENA_ACTION_SETS = ['full', 'no-strafe-aim', 'always-fire'] as const;
export type ArenaActionVariant = (typeof ARENA_ACTION_SETS)[number];

const ACTION_SETS: Record<ArenaActionVariant, readonly ArenaAction[]> = {
  full: ACTIONS,
  // Strafe and aim-turn are craft-specific and masked off for most craft anyway; without them the
  // table is 18 columns instead of 162.
  'no-strafe-aim': ACTIONS.filter((action) => action.strafe === 0 && action.aimTurn === 0),
  // Guns always live: nine movement choices and nothing else to learn.
  'always-fire': ACTIONS.filter((action) => action.strafe === 0 && action.aimTurn === 0 && action.fire),
};

export type ArenaPolicySpec = {
  learnerVariant: TabularLearnerVariant;
  observation: ArenaObservationVariant;
  actions: ArenaActionVariant;
  learner: Partial<ArenaLearnerOverrides>;
  random?: () => number;
};

export type ArenaLearnerOverrides = {
  learningRate: number;
  discount: number;
  initialEpsilon: number;
  minimumEpsilon: number;
  maximumEpsilon: number;
  epsilonDecay: number;
  episodeEpsilonBoost: number;
  episodeMaximumEpsilon: number;
  terminalBlame: number;
  maximumStates: number;
};

export const DEFAULT_ARENA_POLICY_SPEC: ArenaPolicySpec = {
  learnerVariant: 'tabular-1step', observation: 'full', actions: 'full', learner: {},
};
export { ARENA_OBSERVATIONS };
import type { UpgradeChoice } from './arena_shooter_progression.js';

export type AgentDecision = TabularDecision<ArenaAction>;

export type QLearningAgentSave = TabularQSave & {
  /**
   * v3 records the variant the table was built under. A table keyed by one encoding, or indexed by
   * one action set, is not stale under another — it is wrong while still looking plausible.
   */
  policyVersion?: 2 | 3;
  upgradeValues?: Array<[string, number]>;
  observation?: string;
  actions?: string;
  learnerVariant?: string;
};

export class QLearningAgent {
  readonly spec: ArenaPolicySpec;
  private readonly actions: readonly ArenaAction[];
  private readonly learner: TabularQAgent<ArenaObservation, ArenaAction>;
  private readonly random: () => number;
  private decision: AgentDecision;

  constructor(spec: Partial<ArenaPolicySpec> = {}) {
    this.spec = { ...DEFAULT_ARENA_POLICY_SPEC, ...spec, learner: spec.learner ?? {} };
    this.random = this.spec.random ?? Math.random;
    this.actions = ACTION_SETS[this.spec.actions];
    const variant = this.spec.observation;
    this.learner = new TabularQAgent<ArenaObservation, ArenaAction>({
      actions: this.actions,
      encodeState: (observation) => encodeObservationVariant(variant, observation),
      allowedActionIndices: (observation) => allowedArenaActions(this.actions, observation),
      learningRate: 0.16,
      discount: 0.92,
      initialEpsilon: 0.2,
      minimumEpsilon: 0.035,
      maximumEpsilon: 0.5,
      epsilonDecay: 0.99994,
      episodeEpsilonBoost: 0.025,
      episodeMaximumEpsilon: 0.24,
      // Spread last so a search may override any of the above; anything omitted keeps the shipped
      // value, which makes the default spec exactly today's agent.
      ...this.spec.learner,
      nStep: nStepForVariant(this.spec.learnerVariant),
      random: this.random,
    });
    this.decision = { action: this.actions[0], actionIndex: 0, exploratory: false, qValue: 0 };
  }

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
      policyVersion: 3,
      upgradeValues: this.upgradeBandit.entries(),
      observation: this.spec.observation,
      actions: this.spec.actions,
      learnerVariant: this.spec.learnerVariant,
    };
  }

  restore(save: QLearningAgentSave): void {
    if (save.policyVersion === 3) {
      if (save.observation !== this.spec.observation || save.actions !== this.spec.actions
        || (save.learnerVariant ?? 'tabular-1step') !== this.spec.learnerVariant) return;
    } else {
      // v2 and the pre-versioned prototype were always full/full.
      if (this.spec.observation !== 'full' || this.spec.actions !== 'full'
        || this.spec.learnerVariant !== 'tabular-1step') return;
    }
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
    const exploratory = !this.evaluationMode && this.random() < this.epsilon;
    const selectedKey = this.evaluationMode
      ? this.upgradeBandit.best(keys)
      : this.upgradeBandit.choose(keys, exploratory, this.random);
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

function allowedArenaActions(
  actions: readonly ArenaAction[],
  observation: ArenaObservation,
): readonly number[] {
  const allowed = actions
    .map((action, index) => isActionAllowed(observation.craftType, action) ? index : -1)
    .filter((index) => index >= 0);
  // The learner rejects an empty mask, and a reduced action set can legitimately contain nothing a
  // given craft may use.
  return allowed.length ? allowed : actions.map((_, index) => index);
}
