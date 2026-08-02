import { TabularQAgent } from "../../shared/rl/tabular_q_agent.js";
import {
  readTabularQSave,
  writeTabularQSave,
} from "../../shared/rl/tabular_q_storage.js";

export type ZombieCombatAction =
  | "LOOT"
  | "EVADE"
  | "ATTACK"
  | "PATROL"
  | "BOOST";

const ACTIONS: readonly ZombieCombatAction[] = [
  "LOOT",
  "EVADE",
  "ATTACK",
  "PATROL",
  "BOOST",
];
const STORAGE_KEY = "zombie-q-table";

export class ZombieCombatAgent {
  private readonly learner = new TabularQAgent<string, ZombieCombatAction>({
    actions: ACTIONS,
    encodeState: (observation) => observation,
    learningRate: 0.2,
    discount: 0.92,
    initialEpsilon: 0.28,
    minimumEpsilon: 0.05,
    maximumEpsilon: 0.28,
    epsilonDecay: 0.9995,
    episodeEpsilonBoost: 0,
  });

  constructor() {
    const save = readTabularQSave(STORAGE_KEY, { fallbackEpsilon: 0.28 });
    if (save) this.learner.restore(save);
  }

  decide(observation: string): ZombieCombatAction {
    return this.learner.decide(observation).action;
  }

  learn(observation: string, reward: number): void {
    this.learner.observe(observation, reward);
    if (this.learner.trainingSteps % 30 === 0) this.save();
  }

  save(): void {
    writeTabularQSave(STORAGE_KEY, this.learner.serialize());
  }
}
