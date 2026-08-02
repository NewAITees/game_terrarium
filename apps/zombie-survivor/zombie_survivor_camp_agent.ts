import { TabularQAgent } from "../../shared/rl/tabular_q_agent.js";
import { fixedWidthBand } from "../../shared/rl/discretize.js";
import {
  readTabularQSave,
  writeTabularQSave,
} from "../../shared/rl/tabular_q_storage.js";

export type CampAction =
  | "food"
  | "fuel"
  | "repair"
  | "upgrade"
  | "ammo"
  | "wait";

type CampObservation = {
  food: number;
  fuel: number;
  scrap: number;
  hp: number;
  ammo: number;
  weapon: number;
  wave: number;
  canFood: boolean;
  canFuel: boolean;
  canRepair: boolean;
  canUpgrade: boolean;
  canAmmo: boolean;
};

export type CampContext = {
  food: number;
  fuel: number;
  scrap: number;
  hp: number;
  ammo: number;
  maxAmmo: number;
  weaponKind: "melee" | "ranged" | "utility";
  upgradeCost: number;
  kills: number;
  wave: number;
};

const ACTIONS: readonly CampAction[] = [
  "food",
  "fuel",
  "repair",
  "upgrade",
  "ammo",
  "wait",
];
const STORAGE_KEY = "zombie-work-qtable-v1";

export class ZombieCampAgent {
  private readonly learner = new TabularQAgent<CampObservation, CampAction>({
    actions: ACTIONS,
    encodeState: encodeObservation,
    allowedActionIndices: allowedActions,
    learningRate: 0.2,
    discount: 0.9,
    initialEpsilon: 0.35,
    minimumEpsilon: 0.05,
    maximumEpsilon: 0.45,
    epsilonDecay: 0.995,
    episodeEpsilonBoost: 0.02,
    episodeMaximumEpsilon: 0.3,
  });
  private previous: Pick<CampContext, "kills" | "hp" | "wave"> | null = null;

  constructor() {
    const save = readTabularQSave(STORAGE_KEY, { fallbackEpsilon: 0.35 });
    if (save) this.learner.restore(save);
  }

  decide(context: CampContext): CampAction {
    const observation = observe(context);
    if (this.previous) {
      this.learner.observe(observation, this.rewardFor(context));
    }
    this.previous = {
      kills: context.kills,
      hp: context.hp,
      wave: context.wave,
    };
    return this.learner.decide(observation).action;
  }

  save(): void {
    writeTabularQSave(STORAGE_KEY, this.learner.serialize());
  }

  private rewardFor(context: CampContext): number {
    const previous = this.previous!;
    const reward = (context.kills - previous.kills) * 2 -
      (previous.hp - context.hp) * 0.12 +
      (context.wave - previous.wave) * 3;
    return Math.max(-20, Math.min(20, reward));
  }
}

function observe(context: CampContext): CampObservation {
  return {
    food: fixedWidthBand(context.food, 10, 3),
    fuel: fixedWidthBand(context.fuel, 10, 3),
    scrap: fixedWidthBand(context.scrap, 6, 3),
    hp: fixedWidthBand(context.hp, 25, 3),
    ammo: context.weaponKind === "melee" ? 0 : Math.min(
      3,
      Math.floor(context.ammo / Math.max(1, context.maxAmmo) * 4),
    ),
    weapon: context.weaponKind === "melee"
      ? 0
      : context.weaponKind === "utility"
      ? 2
      : 1,
    wave: Math.min(4, Math.floor((context.wave - 1) / 3)),
    canFood: context.fuel >= 2,
    canFuel: context.food >= 2,
    canRepair: context.scrap >= 6,
    canUpgrade: context.scrap >= context.upgradeCost,
    canAmmo: context.weaponKind !== "melee" && context.scrap >= 4,
  };
}

function allowedActions(observation: CampObservation): readonly number[] {
  return ACTIONS.map((action, index) => {
    if (action === "food" && !observation.canFood) return -1;
    if (action === "fuel" && !observation.canFuel) return -1;
    if (action === "repair" && !observation.canRepair) return -1;
    if (action === "upgrade" && !observation.canUpgrade) return -1;
    if (action === "ammo" && !observation.canAmmo) return -1;
    return index;
  }).filter((index) => index >= 0);
}

function encodeObservation(observation: CampObservation): string {
  return [
    observation.food,
    observation.fuel,
    observation.scrap,
    observation.hp,
    observation.ammo,
    observation.weapon,
    observation.wave,
  ].join("|");
}
