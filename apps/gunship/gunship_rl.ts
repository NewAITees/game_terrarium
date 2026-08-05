import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import { thresholdBand } from '../../shared/rl/discretize.js';
import type { TabularQSave } from '../../shared/rl/rl_types.js';
import type { GunshipAction, GunshipBody } from './gunship_physics.js';
import { altitudeMargin, ceilingMargin, GRAVITY, thrustEfficiency, WORLD_W } from './gunship_physics.js';
import type { WeaponKind } from './gunship_weapons.js';

export type GunshipTarget = { x: number; y: number; kind: 'destroyer' | 'cruiser' | 'carrier' | 'battleship' | 'chaser' | 'diver' | 'mine' | 'submarine'; hp: number };
export type GunshipHazard = { x: number; y: number; vx: number; vy: number };
export type GunshipOrb = { x: number; y: number };
export type GunshipTacticalContext = { weapon: WeaponKind; recoveryDelay: number };
export type UpgradeContext = { offer: readonly string[]; level: number };
type Observation = { altitude: number; ceiling: number; fall: number; lift: number; aim: number; target: 'surface' | 'air' | 'none'; threat: number; danger: number; xpAim: number; xpDist: number; weapon: WeaponKind; recovery: number };
export type GunshipAgentSave =
  | { version: 1; learner: TabularQSave; episodes: number }
  | { version: 2; learner: TabularQSave; upgrade: TabularQSave; episodes: number }
  | { version: 3; learner: TabularQSave; upgrade: TabularQSave; episodes: number }
  | { version: 4; learner: TabularQSave; upgrade: TabularQSave; episodes: number }
  | { version: 5; learner: TabularQSave; upgrade: TabularQSave; episodes: number }
  | { version: 6; learner: TabularQSave; upgrade: TabularQSave; episodes: number }
  | { version: 7; learner: TabularQSave; upgrade: TabularQSave; episodes: number }
  | { version: 8; learner: TabularQSave; upgrade: TabularQSave; episodes: number };

// Sentinel buckets for "no orb currently exists" — distinct from any real banded value,
// so the agent can tell "nothing to collect" apart from "there is one, but it's far/behind".
const NO_ORB_AIM = 5;
const NO_ORB_DIST = 3;

// 0.12s beat 0.2 / 0.3 / 0.45 in a 6000-episode sweep: a longer hold also holds
// each exploratory mistake longer, and in a gravity game that is fatal.
const ACTIONS: readonly GunshipAction[] = [
  { turn: 0, thrust: true, fire: false, label: 'CLIMB / HOLD' },
  { turn: 1, thrust: true, fire: false, label: 'CLIMB / TURN' },
  { turn: -1, thrust: true, fire: false, label: 'CLIMB / TURN' },
  { turn: 0, thrust: true, fire: true, label: 'CLIMB / FIRE' },
  { turn: 1, thrust: true, fire: true, label: 'CLIMB / TRACK' },
  { turn: -1, thrust: true, fire: true, label: 'CLIMB / TRACK' },
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
  decide(ship: GunshipBody, targets: GunshipTarget[], hazards: GunshipHazard[], orbs: readonly GunshipOrb[], tactical: GunshipTacticalContext, dt: number, reward: number): { action: GunshipAction; exploratory: boolean } {
    this.pendingReward += reward;
    this.timer -= dt;
    if (this.timer > 0) return { action: this.current, exploratory: false };
    this.timer = .12;
    const observation = observe(ship, targets, hazards, orbs, tactical);
    this.learner.observe(observation, this.pendingReward);
    this.pendingReward = 0;
    const decision = this.learner.decide(observation);
    this.current = decision.action;
    return { action: decision.action, exploratory: decision.exploratory };
  }

  // Called when a level-up window resolves. `reward` is the return earned since the previous pick; returns the chosen slot.
  decideUpgrade(context: UpgradeContext, reward: number): number { this.upgradeLearner.observe(context, reward); return this.upgradeLearner.decide(context).actionIndex; }
  finishEpisode(finalReward: number): void { this.learner.finishEpisode(finalReward); this.upgradeLearner.finishEpisode(finalReward); this.episodes++; this.timer = 0; }
  serialize(): GunshipAgentSave { return { version: 8, learner: this.learner.serialize(), upgrade: this.upgradeLearner.serialize(), episodes: this.episodes }; }
  restore(save: GunshipAgentSave): void {
    // v8 drops the AIM_UNREACHABLE sentinel now that the craft can turn and thrust through a full
    // 360° (see stepPhysics) — a target to world-left is no longer categorically unreachable, so the
    // bucket that used to override it with "impossible" was actively wrong. v7 adds weapon/recovery
    // state. v6 adds the xp-orb observation (xpAim/xpDist), changing the state key shape. v5 changes
    // the reward contract for battleship damage. v4 adds thrust-and-fire actions, changing every
    // Q-table action index. v3 redefined what the state key means (attitude became a lift ratio, the
    // aim bands gained an unreachable bucket, band() stopped wrapping its top bucket).
    // Older tables use the same key shape for different situations, so replaying
    // them would poison the new policy rather than give it a head start.
    if (!save || save.version !== 8) return;
    this.learner.restore(save.learner);
    if (save.upgrade) this.upgradeLearner.restore(save.upgrade);
    this.episodes = Math.max(0, save.episodes || 0);
  }
  // Greedy playback of what the policy actually knows, with exploration and
  // learning switched off. Training medians include random actions and therefore
  // understate the learned behaviour.
  setEvaluationMode(enabled: boolean): void { this.learner.setEvaluationMode(enabled); this.upgradeLearner.setEvaluationMode(enabled); this.timer = 0; }
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
function observe(ship: GunshipBody, targets: GunshipTarget[], hazards: GunshipHazard[], orbs: readonly GunshipOrb[], tactical: GunshipTacticalContext): Observation {
  const target = nearestTarget(ship, targets);
  const targetDx = target ? wrappedDx(ship.x, target.x) : 0;
  const aim = target ? normalize(Math.atan2(-(target.y - ship.y), targetDx) - ship.angle) : 0;
  const orb = nearestOrb(ship, orbs);
  const orbDx = orb ? wrappedDx(ship.x, orb.x) : 0;
  const orbAim = orb ? normalize(Math.atan2(-(orb.y - ship.y), orbDx) - ship.angle) : 0;
  return {
    altitude: thresholdBand(altitudeMargin(ship), [-20, 75, 180, 330]),
    ceiling: thresholdBand(ceilingMargin(ship), [70, 210]),
    fall: thresholdBand(ship.vy, [-20, 75, 180]),
    lift: thresholdBand(liftRatio(ship), [0, .55, 1, 1.5]),
    aim: thresholdBand(aim, [-.45, -.1, .1, .45]),
    target: classifyTarget(target),
    threat: target ? thresholdBand(targetDistance(ship, target), [160, 360]) : 2,
    danger: incomingDanger(ship, hazards),
    xpAim: orb ? thresholdBand(orbAim, [-.45, -.1, .1, .45]) : NO_ORB_AIM,
    xpDist: orb ? thresholdBand(Math.hypot(orbDx, orb.y - ship.y), [80, 250]) : NO_ORB_DIST,
    weapon: tactical.weapon,
    recovery: thresholdBand(tactical.recoveryDelay, [.2, 1, 1.8]),
  };
}

function nearestOrb(ship: GunshipBody, orbs: readonly GunshipOrb[]): GunshipOrb | undefined {
  return orbs.reduce<GunshipOrb | undefined>((nearest, candidate) => (
    !nearest || orbDistance(ship, candidate) < orbDistance(ship, nearest) ? candidate : nearest
  ), undefined);
}
function orbDistance(ship: GunshipBody, orb: GunshipOrb): number { return Math.hypot(wrappedDx(ship.x, orb.x), orb.y - ship.y); }

function nearestTarget(ship: GunshipBody, targets: readonly GunshipTarget[]): GunshipTarget | undefined {
  return targets.reduce<GunshipTarget | undefined>((nearest, candidate) => (
    !nearest || targetDistance(ship, candidate) < targetDistance(ship, nearest)
      ? candidate
      : nearest
  ), undefined);
}

function targetDistance(ship: GunshipBody, target: Pick<GunshipTarget, 'x' | 'y'>): number {
  return Math.hypot(wrappedDx(ship.x, target.x), target.y - ship.y);
}

function classifyTarget(target: GunshipTarget | undefined): Observation['target'] {
  if (!target) return 'none';
  return ['destroyer', 'cruiser', 'carrier', 'battleship', 'submarine'].includes(target.kind)
    ? 'surface'
    : 'air';
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
  return thresholdBand(nearest, [90, 220]);
}
function encode(o: Observation): string { return `${o.altitude}|${o.ceiling}|${o.fall}|${o.lift}|${o.aim}|${o.target}|${o.threat}|${o.danger}|${o.xpAim}|${o.xpDist}|${o.weapon}|${o.recovery}`; }
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
function normalize(value: number): number { return Math.atan2(Math.sin(value), Math.cos(value)); }
