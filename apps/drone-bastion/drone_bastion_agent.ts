import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import { nStepForVariant, type TabularLearnerVariant } from '../../shared/rl/learner_variant.js';
import type { TabularDecision, TabularQSave } from '../../shared/rl/rl_types.js';
import {
  encodeDroneBastionObservation,
  type DroneAction,
  type DroneBastionObservation,
  type DroneBastionState,
} from './drone_bastion_core.js';

/**
 * Observation variants. The encoded string is the Q-table's key, so these are not presentation
 * choices — each one defines a different policy over a differently sized state space. Gunship's
 * measured result was that the smallest encoding generalised best; whether that holds for a game
 * with a fleet to manage is exactly the sort of question the search exists to answer.
 */
export const DRONE_BASTION_OBSERVATIONS = ['shipped', 'minimal', 'engineered'] as const;
export type DroneBastionObservationVariant = (typeof DRONE_BASTION_OBSERVATIONS)[number];

/** Action variants. Each changes the Q-table's width, so tables are not interchangeable. */
export const DRONE_BASTION_ACTION_SETS = ['full', 'no-switch', 'always-fire'] as const;
export type DroneBastionActionVariant = (typeof DRONE_BASTION_ACTION_SETS)[number];

export type DroneBastionPolicySpec = {
  learnerVariant: TabularLearnerVariant;
  observation: DroneBastionObservationVariant;
  actions: DroneBastionActionVariant;
  learner: Partial<DroneBastionLearnerOverrides>;
  random?: () => number;
};

export type DroneBastionLearnerOverrides = {
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

export const DEFAULT_DRONE_BASTION_POLICY_SPEC: DroneBastionPolicySpec = {
  learnerVariant: 'tabular-1step',
  observation: 'shipped',
  actions: 'full',
  learner: {},
};

export const DRONE_BASTION_ACTIONS: readonly DroneAction[] = [
  { label: 'COAST', thrust: 0, turn: 0, brake: false, fire: false, switch: 0 },
  { label: 'THRUST', thrust: 1, turn: 0, brake: false, fire: false, switch: 0 },
  { label: 'REVERSE', thrust: -1, turn: 0, brake: false, fire: false, switch: 0 },
  { label: 'TURN LEFT', thrust: 0, turn: -1, brake: false, fire: false, switch: 0 },
  { label: 'TURN RIGHT', thrust: 0, turn: 1, brake: false, fire: false, switch: 0 },
  { label: 'BRAKE', thrust: 0, turn: 0, brake: true, fire: false, switch: 0 },
  { label: 'FIRE', thrust: 0, turn: 0, brake: false, fire: true, switch: 0 },
  { label: 'ADVANCE + FIRE', thrust: 1, turn: 0, brake: false, fire: true, switch: 0 },
  { label: 'LEFT + FIRE', thrust: 0, turn: -1, brake: false, fire: true, switch: 0 },
  { label: 'RIGHT + FIRE', thrust: 0, turn: 1, brake: false, fire: true, switch: 0 },
  { label: 'BRAKE + FIRE', thrust: 0, turn: 0, brake: true, fire: true, switch: 0 },
  { label: 'SELECT NEXT', thrust: 0, turn: 0, brake: false, fire: false, switch: 1 },
  { label: 'SELECT PREV', thrust: 0, turn: 0, brake: false, fire: false, switch: -1 },
] as const;

export type DroneBastionAgentSave = {
  /**
   * v2 records the variant the table was built under. A table keyed by one encoding, or indexed by
   * one action set, is not stale under another — it is wrong, and wrong in a way that still produces
   * a plausible-looking agent. `restore` refuses the mismatch rather than trusting the caller.
   */
  version: 2;
  combat: TabularQSave;
  upgradeValues: Record<'deploy' | 'upgrade', number>;
  previousUpgrade?: 'deploy' | 'upgrade';
  observation: string;
  actions: string;
  learnerVariant?: string;
};

export type LegacyDroneBastionAgentSave = {
  version: 1;
  combat: TabularQSave;
  upgradeValues: Record<'deploy' | 'upgrade', number>;
  previousUpgrade?: 'deploy' | 'upgrade';
};

const ACTION_SETS: Record<DroneBastionActionVariant, readonly DroneAction[]> = {
  full: DRONE_BASTION_ACTIONS,
  // Fleet switching costs two columns in every state. This asks whether flying one drone well beats
  // spreading attention across the fleet.
  'no-switch': DRONE_BASTION_ACTIONS.filter((action) => action.switch === 0),
  // Guns always live, no fleet switching: the smallest set that can still manoeuvre and shoot.
  'always-fire': DRONE_BASTION_ACTIONS.filter((action) => action.switch === 0 && action.fire),
};

function encodeVariant(variant: DroneBastionObservationVariant, observation: DroneBastionObservation): string {
  const shipped = encodeDroneBastionObservation(observation);
  if (variant === 'shipped') return shipped;
  if (variant === 'engineered') {
    // The dense contract is exactly 96 normalized values. Quantization keeps the tabular key
    // stable and auditable while still exposing every engineered feature to the experiment.
    return observation.dense.map((value) => Math.max(0, Math.min(3, Math.floor(value * 4)))).join('');
  }
  const aimBand = observation.aimSector === 3 || observation.aimSector === 4 ? 1 : observation.aimSector < 3 ? 0 : 2;
  return `${observation.towerHpBand <= 1 ? 0 : 1}:${aimBand}:${Math.min(2, observation.distanceBand)}`;
}

export class DroneBastionAgent {
  readonly spec: DroneBastionPolicySpec;
  private readonly actions: readonly DroneAction[];
  private readonly learner: TabularQAgent<DroneBastionObservation, DroneAction>;
  private readonly random: () => number;
  private decisionTimer = 0;
  private currentDecision: TabularDecision<DroneAction>;

  constructor(spec: Partial<DroneBastionPolicySpec> = {}) {
    this.spec = { ...DEFAULT_DRONE_BASTION_POLICY_SPEC, ...spec, learner: spec.learner ?? {} };
    this.random = this.spec.random ?? Math.random;
    this.actions = ACTION_SETS[this.spec.actions];
    const variant = this.spec.observation;
    this.learner = new TabularQAgent<DroneBastionObservation, DroneAction>({
      actions: this.actions,
      encodeState: (observation) => encodeVariant(variant, observation),
      allowedActionIndices: (observation) => allowedDroneBastionActions(this.actions, observation),
      learningRate: 0.15,
      discount: 0.93,
      initialEpsilon: 0.24,
      minimumEpsilon: 0.03,
      maximumEpsilon: 0.5,
      epsilonDecay: 0.9997,
      episodeEpsilonBoost: 0.004,
      episodeMaximumEpsilon: 0.14,
      // Spread last so a search may override any of the above; whatever it omits keeps the shipped
      // value, which makes the default spec exactly today's agent.
      ...this.spec.learner,
      nStep: nStepForVariant(this.spec.learnerVariant),
      random: this.random,
    });
    this.currentDecision = { action: this.actions[0], actionIndex: 0, exploratory: false, qValue: 0 };
  }
  private upgradeValues = { deploy: 0, upgrade: 0 };
  private previousUpgrade: 'deploy' | 'upgrade' | undefined;
  private upgradeReward = 0;
  private combatReward = 0;
  private evaluationMode = false;

  decide(observation: DroneBastionObservation, dt: number, reward: number): TabularDecision<DroneAction> {
    this.upgradeReward += reward;
    this.combatReward += reward;
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return this.currentDecision;
    this.decisionTimer = 0.12;
    this.learner.observe(observation, this.combatReward);
    this.combatReward = 0;
    this.currentDecision = this.learner.decide(observation);
    return this.currentDecision;
  }

  chooseUpgrade(state: DroneBastionState): 'deploy' | 'upgrade' {
    if (!this.evaluationMode) this.updateUpgradeValue();
    const canDeploy = state.drones.length < 6;
    const exploratory = !this.evaluationMode && this.random() < this.learner.epsilon;
    const choice = canDeploy && (exploratory
      ? this.random() < 0.5
      : this.upgradeValues.deploy >= this.upgradeValues.upgrade)
      ? 'deploy'
      : 'upgrade';
    this.previousUpgrade = this.evaluationMode ? undefined : choice;
    this.upgradeReward = 0;
    return choice;
  }

  finishEpisode(finalReward: number): void {
    this.upgradeReward += finalReward;
    if (!this.evaluationMode) this.updateUpgradeValue();
    this.learner.finishEpisode(this.combatReward + finalReward);
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
    this.combatReward = 0;
    this.decisionTimer = 0;
  }

  serialize(): DroneBastionAgentSave {
    return {
      version: 2,
      combat: this.learner.serialize(),
      upgradeValues: { ...this.upgradeValues },
      previousUpgrade: this.previousUpgrade,
      observation: this.spec.observation,
      actions: this.spec.actions,
      learnerVariant: this.spec.learnerVariant,
    };
  }

  restore(save: DroneBastionAgentSave | LegacyDroneBastionAgentSave): void {
    if (save.version === 1) {
      // v1 was always the shipped observation and full action set.
      if (this.spec.observation !== 'shipped' || this.spec.actions !== 'full'
        || this.spec.learnerVariant !== 'tabular-1step') return;
    } else if (save.observation !== this.spec.observation || save.actions !== this.spec.actions
      || (save.learnerVariant ?? 'tabular-1step') !== this.spec.learnerVariant) return;
    this.learner.restore(save.combat);
    if (Number.isFinite(save.upgradeValues?.deploy)) this.upgradeValues.deploy = save.upgradeValues.deploy;
    if (Number.isFinite(save.upgradeValues?.upgrade)) this.upgradeValues.upgrade = save.upgradeValues.upgrade;
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
    this.combatReward = 0;
    this.decisionTimer = 0;
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

  setEvaluationMode(enabled: boolean): void {
    this.evaluationMode = enabled;
    this.learner.setEvaluationMode(enabled);
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
    this.combatReward = 0;
    this.decisionTimer = 0;
  }

  private updateUpgradeValue(): void {
    if (!this.previousUpgrade) return;
    const current = this.upgradeValues[this.previousUpgrade];
    const reward = Math.max(-25, Math.min(25, this.upgradeReward));
    this.upgradeValues[this.previousUpgrade] = current + 0.12 * (reward - current);
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
  }
}

export function allowedDroneBastionActions(
  actions: readonly DroneAction[],
  observation: DroneBastionObservation,
): readonly number[] {
  const allowed = actions
    .map((action, index) => (
      action.switch !== 0 && observation.droneCountBand === 0 ? -1 : index
    ))
    .filter((index) => index >= 0);
  // An empty mask is rejected by the learner, and an action set without switching can produce one
  // the moment the fleet is down to a single drone.
  return allowed.length ? allowed : actions.map((_, index) => index);
}
