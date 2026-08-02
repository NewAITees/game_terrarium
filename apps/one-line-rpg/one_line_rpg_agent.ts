import { TabularQAgent } from '../../shared/rl/tabular_q_agent.js';

export type OneLineAction = 'idle' | 'back' | 'forward' | 'jump' | 'guard' | 'light' | 'heavy' | 'special';
export type OneLineObservation = {
  distBand: number;
  kind: number;
  enemyPhase: number;
  selfPhase: number;
  inLight: number;
  inHeavy: number;
  hpBand: number;
  spBand: number;
  stamBand: number;
  incoming: number;
};
export type OneLineUpgradeAction = 'heal' | 'power' | 'focus';
export type OneLineUpgradeObservation = { hpBand: number; spBand: number; waveBand: number };

export const ONE_LINE_ACTIONS: readonly OneLineAction[] = ['idle', 'back', 'forward', 'jump', 'guard', 'light', 'heavy', 'special'];
export const ONE_LINE_ACTION_LABELS: Record<OneLineAction, string> = {
  idle: 'WAIT', back: 'BACKSTEP', forward: 'ADVANCE', jump: 'JUMP',
  guard: 'GUARD', light: 'LIGHT', heavy: 'HEAVY', special: 'SPECIAL',
};
export const ONE_LINE_UPGRADE_LABELS: Record<OneLineUpgradeAction, string> = {
  heal: '休息 +35HP', power: '火力 +3ATK', focus: '必殺 +40SP',
};

export const oneLineAgent = new TabularQAgent<OneLineObservation, OneLineAction>({
  actions: ONE_LINE_ACTIONS,
  learningRate: 0.18,
  discount: 0.93,
  initialEpsilon: 0.35,
  encodeState: (observation) => [
    observation.distBand, observation.kind, observation.enemyPhase, observation.selfPhase,
    observation.inLight, observation.inHeavy, observation.hpBand, observation.spBand,
    observation.stamBand, observation.incoming,
  ].join('|'),
  allowedActionIndices: (observation) => {
    const allowed = [0, 1, 2, 3, 4, 5];
    if (observation.stamBand > 0) allowed.push(6);
    if (observation.spBand >= 2) allowed.push(7);
    return allowed;
  },
});

export const oneLineUpgradeAgent = new TabularQAgent<OneLineUpgradeObservation, OneLineUpgradeAction>({
  actions: ['heal', 'power', 'focus'],
  learningRate: 0.25,
  discount: 0.85,
  initialEpsilon: 0.4,
  encodeState: (observation) => `${observation.hpBand}|${observation.spBand}|${observation.waveBand}`,
});
