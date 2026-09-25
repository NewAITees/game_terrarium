import type { RewardBreakdown } from '../../shared/rl/runtime_types.js';

export type DroneKind = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';
export type DroneMode = 'controlled' | 'braking' | 'turret' | 'disabled';
export type DroneWeapon = 'missile' | 'mortar' | 'pierce' | 'ricochet' | 'arc';
export type DroneChassis = 'light_heli' | 'tank' | 'robot' | 'heavy_heli' | 'heavy_robot';

export type DroneAction = {
  label: string;
  thrust: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  brake: boolean;
  fire: boolean;
  switch: -1 | 0 | 1;
};

export type BastionDrone = {
  id: number;
  kind: DroneKind;
  mode: DroneMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  throttle: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  anchorTimer: number;
  respawnRemaining: number;
  powerLevel: number;
};

export type BastionEnemy = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  attackCooldown: number;
  kind: 'swarm' | 'brute';
};

export type BastionProjectile = {
  id: number;
  kind: Exclude<DroneWeapon, 'arc'>;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  maxLife: number;
  targetEnemyId: number | null;
  targetX: number;
  targetY: number;
  bounces: number;
  pierceRemaining: number;
  hitEnemyIds: number[];
};

export type BastionEffect = {
  kind: 'arc' | 'blast';
  x: number;
  y: number;
  angle: number;
  radius: number;
  life: number;
  maxLife: number;
};

export type BastionDamageNumber = {
  id: number;
  x: number;
  y: number;
  amount: number;
  target: 'enemy' | 'drone' | 'tower';
  life: number;
  maxLife: number;
};

export type BastionWall = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
};

/**
 * Every payment the learner can receive, as a knob rather than a literal.
 *
 * These are all tunable, so none of them may score a run — a configuration is compared on how long
 * the tower survives, which no weight here can reach. Kept on the state so the deep call chain that
 * awards damage and kills does not have to thread a weights argument through six functions.
 */
export type DroneBastionRewardWeights = {
  survival: number;
  switchCost: number;
  chip: number;
  kill: number;
  bruteKill: number;
  wallHit: number;
  droneHit: number;
  droneLost: number;
  towerDamage: number;
  wave: number;
  defeat: number;
};

export const DEFAULT_DRONE_BASTION_REWARD_WEIGHTS: DroneBastionRewardWeights = {
  survival: 0.018,
  switchCost: 0.04,
  chip: 0.16,
  kill: 2.2,
  bruteKill: 4.5,
  wallHit: 0.08,
  droneHit: 0.45,
  droneLost: 4,
  towerDamage: 0.22,
  wave: 8,
  defeat: 30,
};

export type DroneBastionState = {
  width: number;
  height: number;
  seed: number;
  rngState: number;
  elapsed: number;
  episode: number;
  episodeTime: number;
  score: number;
  kills: number;
  tower: { x: number; y: number; hp: number; maxHp: number; radius: number };
  drones: BastionDrone[];
  selectedDrone: number;
  enemies: BastionEnemy[];
  projectiles: BastionProjectile[];
  effects: BastionEffect[];
  damageNumbers: BastionDamageNumber[];
  walls: BastionWall[];
  wave: number;
  waveRemaining: number;
  waveSpawned: number;
  spawnTimer: number;
  waveCooldown: number;
  nextEnemyId: number;
  nextDroneId: number;
  nextProjectileId: number;
  nextDamageNumberId: number;
  gameOver: boolean;
  pendingUpgrade: boolean;
  lastUpgrade: string;
  lastReward: number;
  episodeReward: number;
  rewards: DroneBastionRewardWeights;
};

export type DroneBastionObservation = {
  towerHpBand: number;
  selectedKind: DroneKind;
  speedBand: number;
  aimSector: number;
  distanceBand: number;
  threatSector: number;
  threatBand: number;
  wallBand: number;
  droneCountBand: number;
  selectedHpBand: number;
  /**
   * Fixed 96-value observation for scalable policies:
   * tower threat 24, local threat 16, wall health 8, fleet slots 42, globals 6.
   * The tabular learner deliberately encodes only the coarse fields above.
   */
  dense: readonly number[];
};

export type DroneBastionStepResult = {
  /**
   * The learning signal by channel. `task` is defending the tower and staying alive; the rest is
   * shaping. Only the task outcome scores a run — see shared/rl/experiment_spec.ts.
   */
  reward: RewardBreakdown;
  towerDamage: number;
  hits: number;
  kills: number;
  waveAdvanced: boolean;
  switched: boolean;
};

export type WeaponResult = {
  hits: number;
  kills: number;
  reward: number;
};
