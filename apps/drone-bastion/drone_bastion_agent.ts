import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import type { TabularDecision, TabularQSave } from '../../shared/rl/rl_types.js';
import {
  encodeDroneBastionObservation,
  type DroneAction,
  type DroneBastionObservation,
  type DroneBastionState,
} from './drone_bastion_core.js';

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
  version: 1;
  combat: TabularQSave;
  upgradeValues: Record<'deploy' | 'upgrade', number>;
  previousUpgrade?: 'deploy' | 'upgrade';
};

export class DroneBastionAgent {
  private readonly learner = new TabularQAgent<DroneBastionObservation, DroneAction>({
    actions: DRONE_BASTION_ACTIONS,
    encodeState: encodeDroneBastionObservation,
    allowedActionIndices: (observation) => DRONE_BASTION_ACTIONS
      .map((action, index) => (
        action.switch !== 0 && observation.droneCountBand === 0 ? -1 : index
      ))
      .filter((index) => index >= 0),
    initialValues: initialBastionValues,
    learningRate: 0.15,
    discount: 0.93,
    initialEpsilon: 0.24,
    minimumEpsilon: 0.03,
    maximumEpsilon: 0.5,
    epsilonDecay: 0.9997,
    episodeEpsilonBoost: 0.004,
    episodeMaximumEpsilon: 0.14,
  });
  private decisionTimer = 0;
  private currentDecision: TabularDecision<DroneAction> = {
    action: DRONE_BASTION_ACTIONS[0],
    actionIndex: 0,
    exploratory: false,
    qValue: 0,
  };
  private upgradeValues = { deploy: 0, upgrade: 0 };
  private previousUpgrade: 'deploy' | 'upgrade' | undefined;
  private upgradeReward = 0;
  private combatReward = 0;

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
    this.updateUpgradeValue();
    const canDeploy = state.drones.length < 6;
    const exploratory = Math.random() < this.learner.epsilon;
    const choice = canDeploy && (exploratory
      ? Math.random() < 0.5
      : this.upgradeValues.deploy >= this.upgradeValues.upgrade)
      ? 'deploy'
      : 'upgrade';
    this.previousUpgrade = choice;
    this.upgradeReward = 0;
    return choice;
  }

  finishEpisode(finalReward: number): void {
    this.upgradeReward += finalReward;
    this.updateUpgradeValue();
    this.learner.finishEpisode(this.combatReward + finalReward);
    this.combatReward = 0;
    this.decisionTimer = 0;
  }

  serialize(): DroneBastionAgentSave {
    return {
      version: 1,
      combat: this.learner.serialize(),
      upgradeValues: { ...this.upgradeValues },
      previousUpgrade: this.previousUpgrade,
    };
  }

  restore(save: DroneBastionAgentSave): void {
    if (save.version !== 1) return;
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

  private updateUpgradeValue(): void {
    if (!this.previousUpgrade) return;
    const current = this.upgradeValues[this.previousUpgrade];
    const reward = Math.max(-25, Math.min(25, this.upgradeReward));
    this.upgradeValues[this.previousUpgrade] = current + 0.12 * (reward - current);
    this.previousUpgrade = undefined;
    this.upgradeReward = 0;
  }
}

function initialBastionValues(
  observation: DroneBastionObservation,
  actionCount: number,
): readonly number[] {
  const values = Array<number>(actionCount).fill(0);
  values[0] = 0.04;
  const aligned = observation.aimSector === 3 || observation.aimSector === 4;
  if (aligned) {
    values[6] = observation.distanceBand <= 2 ? 0.72 : 0.22;
    values[7] = observation.distanceBand >= 2 ? 0.58 : 0.28;
  } else if (observation.aimSector < 4) {
    values[3] = 0.48;
    values[8] = 0.55;
  } else {
    values[4] = 0.48;
    values[9] = 0.55;
  }
  if (
    observation.speedBand >= 2
    && ['rook', 'bishop', 'queen'].includes(observation.selectedKind)
  ) {
    values[5] = observation.selectedKind === 'queen' ? 0.78 : 0.62;
  }
  if (observation.towerHpBand <= 1 && observation.droneCountBand > 0) {
    values[11] = 0.32;
    values[12] = 0.32;
  }
  return values;
}
