import { DoubleDqnAgent, type DoubleDqnSave } from '../../shared/rl/double_dqn_agent.js';
import type { DoubleDqnDecision } from '../../shared/rl/double_dqn_agent.js';
import { DRONE_BASTION_ACTIONS, allowedDroneBastionActions } from './drone_bastion_agent.js';
import type { DroneAction, DroneBastionObservation, DroneBastionState } from './drone_bastion_core.js';

export type DroneBastionDqnObservation = 'minimal' | 'engineered';
export type DroneBastionDqnSave = {
  version: 1;
  observation: DroneBastionDqnObservation;
  learner: DoubleDqnSave;
  upgradeValues: { deploy: number; upgrade: number };
};

/** Double DQN policy using the same 13 actions and decision cadence as the tabular policy. */
export class DroneBastionDqnAgent {
  private readonly learner: DoubleDqnAgent<DroneBastionObservation, DroneAction>;
  private decisionTimer = 0;
  private currentDecision: DoubleDqnDecision<DroneAction> = {
    action: DRONE_BASTION_ACTIONS[0], actionIndex: 0, exploratory: false, qValue: 0,
  };
  private combatReward = 0;
  private evaluationMode = false;
  private upgradeValues = { deploy: 0, upgrade: 0 };
  private previousUpgrade: 'deploy' | 'upgrade' | undefined;
  private upgradeReward = 0;
  private readonly random: () => number;
  readonly observation: DroneBastionDqnObservation;

  constructor(observation: DroneBastionDqnObservation = 'engineered', random?: () => number) {
    this.observation = observation;
    this.random = random ?? Math.random;
    this.learner = new DoubleDqnAgent({
      actions: DRONE_BASTION_ACTIONS,
      inputSize: 96,
      hiddenSize: 64,
      encode: (value) => vectorizeDroneBastionObservation(value, observation),
      allowedActionIndices: (value) => allowedDroneBastionActions(DRONE_BASTION_ACTIONS, value),
      learningRate: 0.0008,
      discount: 0.93,
      initialEpsilon: 0.24,
      minimumEpsilon: 0.03,
      epsilonDecay: 0.9997,
      replayCapacity: 20_000,
      batchSize: 16,
      warmupSteps: 128,
      targetSyncSteps: 400,
      random: this.random,
    });
  }

  decide(observation: DroneBastionObservation, dt: number, reward: number): DoubleDqnDecision<DroneAction> {
    this.combatReward += reward;
    this.upgradeReward += reward;
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
    this.learner.finishEpisode(this.combatReward + finalReward);
    this.upgradeReward += finalReward;
    if (!this.evaluationMode) this.updateUpgradeValue();
    this.combatReward = 0;
    this.decisionTimer = 0;
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
  }

  setEvaluationMode(enabled: boolean): void {
    this.evaluationMode = enabled;
    this.learner.setEvaluationMode(enabled);
    this.combatReward = 0;
    this.decisionTimer = 0;
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
  }

  get epsilon(): number { return this.learner.epsilon; }
  get trainingSteps(): number { return this.learner.trainingSteps; }
  get knownStates(): number { return this.learner.knownStates; }
  get gradientSteps(): number { return this.learner.gradientSteps; }

  serialize(): DroneBastionDqnSave {
    return { version: 1, observation: this.observation, learner: this.learner.serialize(), upgradeValues: { ...this.upgradeValues } };
  }

  restore(save: DroneBastionDqnSave): void {
    if (save.version !== 1 || save.observation !== this.observation) return;
    this.learner.restore(save.learner);
    if (Number.isFinite(save.upgradeValues?.deploy)) this.upgradeValues.deploy = save.upgradeValues.deploy;
    if (Number.isFinite(save.upgradeValues?.upgrade)) this.upgradeValues.upgrade = save.upgradeValues.upgrade;
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

export function vectorizeDroneBastionObservation(
  observation: DroneBastionObservation,
  variant: DroneBastionDqnObservation,
): readonly number[] {
  if (variant === 'engineered') return observation.dense;
  const values = Array<number>(96).fill(0);
  values[0] = observation.towerHpBand / 3;
  values[1] = observation.speedBand / 3;
  values[2] = observation.aimSector / 7;
  values[3] = observation.distanceBand / 3;
  values[4] = observation.threatSector / 3;
  values[5] = observation.threatBand / 3;
  values[6] = observation.wallBand / 3;
  values[7] = observation.droneCountBand / 4;
  values[8] = observation.selectedHpBand / 3;
  const kind = ['pawn', 'rook', 'bishop', 'knight', 'queen'].indexOf(observation.selectedKind);
  values[9 + Math.max(0, kind)] = 1;
  return values;
}
