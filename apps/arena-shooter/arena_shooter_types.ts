import type { RewardBreakdown } from '../../shared/rl/runtime_types.js';

export type Vec2 = { x: number; y: number };

export type CraftType = 'interceptor' | 'strafer' | 'turret';
export type CraftPreference = CraftType | 'random';

export type Ship = Vec2 & {
  craftType: CraftType;
  vx: number;
  vy: number;
  angle: number;
  turretAngle: number;
  radius: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  invulnerability: number;
};

export type Enemy = Vec2 & {
  id: number;
  angle: number;
  radius: number;
  hp: number;
  speed: number;
  fireCooldown: number;
  kind: 'scout' | 'gunner' | 'brute';
};

export type Projectile = Vec2 & {
  vx: number;
  vy: number;
  radius: number;
  life: number;
  hostile: boolean;
  damage: number;
  kind: 'pulse' | 'missile' | 'ricochet' | 'enemy';
  bounces?: number;
  lastHitEnemyId?: number;
};

export type BeamEffect = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  points?: Vec2[];
  style: 'beam' | 'pulse' | 'wave';
  angle?: number;
  range?: number;
  arc?: number;
  width: number;
  life: number;
  maxLife: number;
};

export type TrailField = Vec2 & {
  radius: number;
  life: number;
  maxLife: number;
  damagePerSecond: number;
  tickCooldown: number;
};

export type DamageNumber = Vec2 & {
  amount: number;
  friendly: boolean;
  life: number;
  maxLife: number;
};

export type Particle = Vec2 & {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
};

export type ArenaAction = {
  thrust: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  strafe: -1 | 0 | 1;
  aimTurn: -1 | 0 | 1;
  fire: boolean;
  label: string;
};

export type ArenaObservation = {
  craftType: CraftType;
  dangerSector: number;
  targetSector: number;
  aimSector: number;
  projectileDangerSector: number;
  projectileDistanceBand: number;
  velocitySector: number;
  speedBand: number;
  edgeSector: number;
  edgeDistanceBand: number;
  edgeDistanceBands: readonly number[];
  pulseProjectileCount: number;
  pulseProjectileParity: 0 | 1;
  distanceBand: number;
  hpBand: number;
  enemyCountBand: number;
  hostileProjectileCountBand: number;
  canFire: boolean;
  sectorDistances: readonly number[];
  sectorProjectileDistances: readonly number[];
};

export type ArenaState = {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  craftPreference: CraftPreference;
  ship: Ship;
  enemies: Enemy[];
  projectiles: Projectile[];
  beams: BeamEffect[];
  trails: TrailField[];
  damageNumbers: DamageNumber[];
  particles: Particle[];
  elapsed: number;
  episode: number;
  episodeTime: number;
  score: number;
  kills: number;
  wave: number;
  waveTime: number;
  waveDuration: number;
  waveSpawned: number;
  waveTotal: number;
  nextEnemyId: number;
  spawnTimer: number;
  shake: number;
  lastReward: number;
  episodeReward: number;
  bestScore: number;
  missileCooldown: number;
  laserCooldown: number;
  ricochetCooldown: number;
  trailCooldown: number;
  novaCooldown: number;
  novaPulse: number;
  damageMultiplier: number;
  pulseLevel: number;
  fireRateLevel: number;
  projectileCountLevel: number;
  projectileSpeedLevel: number;
  projectileInterceptLevel: number;
  turretTurnLevel: number;
  missileLevel: number;
  novaLevel: number;
  laserLevel: number;
  ricochetLevel: number;
  trailLevel: number;
  rngState: number;
  rewards: ArenaRewardWeights;
};

/**
 * Every payment the learner can receive, as a knob rather than a literal.
 *
 * These were twenty numbers spread through `stepArena`, which meant the automated search could not
 * reach the reward at all — the one lever the no-hand-authored-policy rule actually encourages
 * moving. All of them are tunable, so none may score a run.
 */
export type ArenaRewardWeights = {
  survival: number;
  edgeLoiter: number;
  edgeApproach: number;
  boundaryHit: number;
  shotCost: number;
  kill: number;
  bruteKill: number;
  beamHit: number;
  beamIntercept: number;
  trailTick: number;
  projectileHit: number;
  shotIntercept: number;
  contactHit: number;
  projectileTaken: number;
};

export const DEFAULT_ARENA_REWARD_WEIGHTS: ArenaRewardWeights = {
  survival: 0.035,
  edgeLoiter: 0.12,
  edgeApproach: 0.02,
  boundaryHit: 0.8,
  shotCost: 0.006,
  kill: 3,
  bruteKill: 4.5,
  beamHit: 0.12,
  beamIntercept: 0.08,
  trailTick: 0.01,
  projectileHit: 0.18,
  shotIntercept: 0.12,
  contactHit: 2.2,
  projectileTaken: 1.6,
};

export type ArenaStepResult = {
  /**
   * The learning signal by channel. `task` is staying alive; the rest is shaping. Only the task
   * outcome scores a run — see shared/rl/experiment_spec.ts.
   */
  reward: RewardBreakdown;
  killedValues: number[];
  waveAdvanced: boolean;
};

/**
 * Observation variants. The encoded string is the Q-table's key, so this is not a display choice —
 * the shipped encoding carries nineteen fields including two sixteen-way sensor rings, which is a
 * very large state space for a tabular learner to visit. Whether it earns its size is a question
 * for measurement, so the smaller encodings are declared and left to the search to judge.
 */
export const ARENA_OBSERVATIONS = ['full', 'no-sensors', 'minimal'] as const;
export type ArenaObservationVariant = (typeof ARENA_OBSERVATIONS)[number];
