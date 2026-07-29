import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';
import type { TabularQSave } from '../../shared/rl/rl_types.js';
import type { GunshipAction, GunshipBody } from './gunship_physics.js';
import { altitudeMargin } from './gunship_physics.js';

export type GunshipTarget = { x: number; y: number; kind: 'ship' | 'chaser' | 'diver' | 'mine' | 'dreadnought'; hp: number };
type Observation = { altitude: number; fall: number; angle: number; aim: number; target: 'surface' | 'air' | 'none'; threat: number };
export type GunshipAgentSave = { version: 1; learner: TabularQSave; episodes: number };

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
  episodes = 0;
  private timer = 0;
  private current = ACTIONS[0];

  decide(ship: GunshipBody, targets: GunshipTarget[], dt: number, reward: number): { action: GunshipAction; exploratory: boolean } {
    const observation = observe(ship, targets);
    this.learner.observe(observation, reward);
    this.timer -= dt;
    if (this.timer > 0) return { action: this.current, exploratory: false };
    this.timer = .12;
    const decision = this.learner.decide(observation);
    this.current = decision.action;
    return { action: decision.action, exploratory: decision.exploratory };
  }

  finishEpisode(finalReward: number): void { this.learner.finishEpisode(finalReward); this.episodes++; this.timer = 0; }
  serialize(): GunshipAgentSave { return { version: 1, learner: this.learner.serialize(), episodes: this.episodes }; }
  restore(save: GunshipAgentSave): void { if (save?.version !== 1) return; this.learner.restore(save.learner); this.episodes = Math.max(0, save.episodes || 0); }
  get epsilon(): number { return this.learner.epsilon; }
  get steps(): number { return this.learner.trainingSteps; }
  get knownStates(): number { return this.learner.knownStates; }
}

function observe(ship: GunshipBody, targets: GunshipTarget[]): Observation {
  const target = targets.slice().sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
  const aim = target ? normalize(Math.atan2(-(target.y - ship.y), target.x - ship.x) - ship.angle) : 0;
  const targetClass = !target ? 'none' : target.kind === 'ship' || target.kind === 'dreadnought' ? 'surface' : 'air';
  return { altitude: band(altitudeMargin(ship), [-20, 75, 180, 330]), fall: band(ship.vy, [-20, 75, 180]), angle: band(ship.angle, [-.7, .25, 1.1]), aim: band(aim, [-.45, -.1, .1, .45]), target: targetClass, threat: target ? band(Math.hypot(target.x - ship.x, target.y - ship.y), [160, 360]) : 2 };
}
function encode(o: Observation): string { return `${o.altitude}|${o.fall}|${o.angle}|${o.aim}|${o.target}|${o.threat}`; }
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
