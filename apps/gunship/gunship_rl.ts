import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import type { TabularQSave } from '../../shared/rl/rl_types.js';
import type { GunshipAction, GunshipBody } from './gunship_physics.js';
import { altitudeMargin, ceilingMargin, GRAVITY, thrustEfficiency, WORLD_W } from './gunship_physics.js';

export type GunshipTarget = { x: number; y: number; kind: 'destroyer' | 'cruiser' | 'carrier' | 'battleship' | 'chaser' | 'diver' | 'mine' | 'submarine'; hp: number };
export type GunshipHazard = { x: number; y: number; vx: number; vy: number };
export type UpgradeContext = { offer: readonly string[]; level: number };
type Observation = { altitude: number; ceiling: number; fall: number; lift: number; aim: number; target: 'surface' | 'air' | 'none'; threat: number; danger: number };
export type GunshipAgentSave =
  | { version: 1; learner: TabularQSave; episodes: number }
  | { version: 2; learner: TabularQSave; upgrade: TabularQSave; episodes: number };

// Dedicated aim bucket for "the target is behind the nose-limit", so the agent can
// learn to stop aiming and fly instead of grinding against the +/-90 clamp.
const AIM_UNREACHABLE = 9;

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
    learningRate: .13,
    discount: .94,
    initialEpsilon: .18,
    minimumEpsilon: .035,
    maximumEpsilon: .3,
    epsilonDecay: .9994,
    // Episodes here are short (~46 decisions), so decay only sheds about .005 of
    // epsilon per episode. A boost any larger than that outruns it and pins
    // exploration at the ceiling forever — which reads on screen as a pilot that
    // never stops randomly flying into the sea.
    episodeEpsilonBoost: .002,
    episodeMaximumEpsilon: .2,
    terminalBlame: 0.7,
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
    // Upgrade picks happen a handful of times per episode, so this learner decays
    // even more slowly than the flight one and needs a correspondingly smaller boost.
    episodeEpsilonBoost: .004,
    episodeMaximumEpsilon: .35,
  });
  episodes = 0;
  private timer = 0;
  private current = ACTIONS[0];

  private pendingReward = 0;
  decide(ship: GunshipBody, targets: GunshipTarget[], hazards: GunshipHazard[], dt: number, reward: number): { action: GunshipAction; exploratory: boolean } {
    this.pendingReward += reward;
    this.timer -= dt;
    if (this.timer > 0) return { action: this.current, exploratory: false };
    this.timer = .12;
    const observation = observe(ship, targets, hazards);
    this.learner.observe(observation, this.pendingReward);
    this.pendingReward = 0;
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

// The world wraps horizontally, so the straight x difference is the wrong one to
// steer by whenever the seam is the shorter way round.
function wrappedDx(fromX: number, toX: number): number {
  let dx = toX - fromX;
  if (dx > WORLD_W / 2) dx -= WORLD_W;
  else if (dx < -WORLD_W / 2) dx += WORLD_W;
  return dx;
}
function observe(ship: GunshipBody, targets: GunshipTarget[], hazards: GunshipHazard[]): Observation {
  const target = targets.slice().sort((a, b) => Math.hypot(wrappedDx(ship.x, a.x), a.y - ship.y) - Math.hypot(wrappedDx(ship.x, b.x), b.y - ship.y))[0];
  const targetDx = target ? wrappedDx(ship.x, target.x) : 0;
  const aim = target ? normalize(Math.atan2(-(target.y - ship.y), targetDx) - ship.angle) : 0;
  const targetClass = !target ? 'none' : ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'].includes(target.kind) ? 'surface' : 'air';
  return { altitude: band(altitudeMargin(ship), [-20, 75, 180, 330]), ceiling: band(ceilingMargin(ship), [70, 210]), fall: band(ship.vy, [-20, 75, 180]), lift: band(liftRatio(ship), [0, .55, 1, 1.5]), aim: targetDx < 0 ? AIM_UNREACHABLE : band(aim, [-.45, -.1, .1, .45]), target: targetClass, threat: target ? band(Math.hypot(targetDx, target.y - ship.y), [160, 360]) : 2, danger: incomingDanger(ship, hazards) };
}
// Time-to-impact of the closest incoming shot, banded so the agent can finally learn to dodge what it is punished for.
function incomingDanger(ship: GunshipBody, hazards: GunshipHazard[]): number {
  let nearest = Infinity;
  for (const hazard of hazards) {
    const dx = wrappedDx(ship.x, hazard.x); const dy = hazard.y - ship.y;
    const closing = dx * hazard.vx + dy * hazard.vy; // negative when the shot moves toward the ship
    if (closing >= 0) continue;
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return band(nearest, [90, 220]);
}
function encode(o: Observation): string { return `${o.altitude}|${o.ceiling}|${o.fall}|${o.lift}|${o.aim}|${o.target}|${o.threat}|${o.danger}`; }
function encodeUpgrade(context: UpgradeContext): string { return `${context.offer.join(',')}|${Math.min(9, context.level >> 1)}`; }
// findIndex returns -1 for values above every cut, so the previous `+ 1` form
// labelled the topmost bucket 0 — the same label as the bottom-most one in every
// other reading of the scale. That made `fall >= 3` false exactly while the ship
// was plummeting fastest, so the climb prior never fired when it mattered.
// Whether full thrust at the current attitude actually beats gravity: sin(angle)
// scales thrust into lift, so the decisive threshold sits at 38-50 degrees
// depending on the airframe. Banding the raw angle buried that threshold inside a
// single bucket, leaving the agent unable to tell "nose too shallow to climb"
// from "nose steep enough to climb" — the one distinction the game is about.
function liftRatio(ship: GunshipBody): number {
  return Math.sin(ship.angle) * ship.thrust * thrustEfficiency(ship.y) / GRAVITY;
}
function band(value: number, cuts: readonly number[]): number {
  const index = cuts.findIndex((cut) => value < cut);
  return index < 0 ? cuts.length : index;
}
function normalize(value: number): number { return Math.atan2(Math.sin(value), Math.cos(value)); }
