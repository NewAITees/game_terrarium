import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import type { TabularQSave } from '../../shared/rl/rl_types.js';
import type { GunshipAction, GunshipBody } from './gunship_physics.js';
import { altitudeMargin, ceilingMargin } from './gunship_physics.js';

export type GunshipTarget = { x: number; y: number; kind: 'destroyer' | 'cruiser' | 'carrier' | 'battleship' | 'chaser' | 'diver' | 'mine' | 'submarine'; hp: number };
export type GunshipHazard = { x: number; y: number; vx: number; vy: number };
export type UpgradeContext = { offer: readonly string[]; level: number };
type Observation = { altitude: number; ceiling: number; fall: number; angle: number; aim: number; target: 'surface' | 'air' | 'none'; threat: number; danger: number };
export type GunshipAgentSave =
  | { version: 1; learner: TabularQSave; episodes: number }
  | { version: 2; learner: TabularQSave; upgrade: TabularQSave; episodes: number };

const ACTIONS: readonly GunshipAction[] = [
  { turn: 0, thrust: true, fire: false, label: 'CLIMB / HOLD' },
  { turn: 1, thrust: true, fire: false, label: 'CLIMB / TURN' },
  { turn: -1, thrust: true, fire: false, label: 'CLIMB / TURN' },
  { turn: 1, thrust: false, fire: false, label: 'NOSE-DOWN / AIM' },
  { turn: -1, thrust: false, fire: false, label: 'NOSE-DOWN / AIM' },
  { turn: 0, thrust: false, fire: false, label: 'COAST / AIM' },
  { turn: 0, thrust: false, fire: true, label: 'BURST / FIRE' },
  { turn: 1, thrust: false, fire: true, label: 'BURST / TRACK' },
  { turn: -1, thrust: false, fire: true, label: 'BURST / TRACK' },
] as const;

export class GunshipAgent {
  private readonly learner = new TabularQAgent<Observation, GunshipAction>({
    actions: ACTIONS,
    encodeState: encode,
    initialValues: seedValues,
    learningRate: .13,
    discount: .94,
    initialEpsilon: .18,
    minimumEpsilon: .035,
    maximumEpsilon: .3,
    epsilonDecay: .9994,
    episodeEpsilonBoost: .012,
    episodeMaximumEpsilon: .2,
  });
  // Level-up is its own learned policy: pick one of the three offered upgrades. Reward is the run performance earned
  // between consecutive picks, so the agent learns which builds pay off — not a fixed "always take slot 0".
  private readonly upgradeLearner = new TabularQAgent<UpgradeContext, number>({
    actions: [0, 1, 2],
    encodeState: encodeUpgrade,
    learningRate: .22,
    discount: .9,
    initialEpsilon: .3,
    minimumEpsilon: .05,
    maximumEpsilon: .45,
    epsilonDecay: .997,
    episodeEpsilonBoost: .03,
    episodeMaximumEpsilon: .35,
  });
  episodes = 0;
  private timer = 0;
  private current = ACTIONS[0];

  decide(ship: GunshipBody, targets: GunshipTarget[], hazards: GunshipHazard[], dt: number, reward: number): { action: GunshipAction; exploratory: boolean } {
    const observation = observe(ship, targets, hazards);
    this.learner.observe(observation, reward);
    this.timer -= dt;
    if (this.timer > 0) return { action: this.current, exploratory: false };
    this.timer = .12;
    const decision = this.learner.decide(observation);
    this.current = decision.action;
    return { action: decision.action, exploratory: decision.exploratory };
  }

  // Called when a level-up window resolves. `reward` is the return earned since the previous pick; returns the chosen slot.
  decideUpgrade(context: UpgradeContext, reward: number): number { this.upgradeLearner.observe(context, reward); return this.upgradeLearner.decide(context).actionIndex; }
  finishEpisode(finalReward: number): void { this.learner.finishEpisode(finalReward); this.upgradeLearner.finishEpisode(finalReward); this.episodes++; this.timer = 0; }
  serialize(): GunshipAgentSave { return { version: 2, learner: this.learner.serialize(), upgrade: this.upgradeLearner.serialize(), episodes: this.episodes }; }
  restore(save: GunshipAgentSave): void {
    if (!save) return;
    this.learner.restore(save.learner);
    if (save.version === 2 && save.upgrade) this.upgradeLearner.restore(save.upgrade);
    this.episodes = Math.max(0, save.episodes || 0);
  }
  get epsilon(): number { return this.learner.epsilon; }
  get steps(): number { return this.learner.trainingSteps; }
  get knownStates(): number { return this.learner.knownStates; }
  get upgradeEpsilon(): number { return this.upgradeLearner.epsilon; }
}

function observe(ship: GunshipBody, targets: GunshipTarget[], hazards: GunshipHazard[]): Observation {
  const target = targets.slice().sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
  const aim = target ? normalize(Math.atan2(-(target.y - ship.y), target.x - ship.x) - ship.angle) : 0;
  const targetClass = !target ? 'none' : ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'].includes(target.kind) ? 'surface' : 'air';
  return { altitude: band(altitudeMargin(ship), [-20, 75, 180, 330]), ceiling: band(ceilingMargin(ship), [70, 210]), fall: band(ship.vy, [-20, 75, 180]), angle: band(ship.angle, [-.7, .25, 1.1]), aim: band(aim, [-.45, -.1, .1, .45]), target: targetClass, threat: target ? band(Math.hypot(target.x - ship.x, target.y - ship.y), [160, 360]) : 2, danger: incomingDanger(ship, hazards) };
}
// Time-to-impact of the closest incoming shot, banded so the agent can finally learn to dodge what it is punished for.
function incomingDanger(ship: GunshipBody, hazards: GunshipHazard[]): number {
  let nearest = Infinity;
  for (const hazard of hazards) {
    const dx = hazard.x - ship.x; const dy = hazard.y - ship.y;
    const closing = dx * hazard.vx + dy * hazard.vy; // negative when the shot moves toward the ship
    if (closing >= 0) continue;
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return band(nearest, [90, 220]);
}
function encode(o: Observation): string { return `${o.altitude}|${o.ceiling}|${o.fall}|${o.angle}|${o.aim}|${o.target}|${o.threat}|${o.danger}`; }
function encodeUpgrade(context: UpgradeContext): string { return `${context.offer.join(',')}|${Math.min(9, context.level >> 1)}`; }
function band(value: number, cuts: readonly number[]): number { return cuts.findIndex((cut) => value < cut) + 1; }
function normalize(value: number): number { return Math.atan2(Math.sin(value), Math.cos(value)); }
function seedValues(o: Observation, count: number): readonly number[] {
  const values = Array<number>(count).fill(.02);
  if (o.altitude <= 1 || o.fall >= 3) { values[0] = 1.1; values[1] = .78; values[2] = .78; return values; }
  const left = o.aim < 2; const right = o.aim > 3;
  values[left ? 4 : right ? 3 : 5] = .48;
  if (o.aim === 2 || o.aim === 3) values[6] = .68;
  return values;
}
