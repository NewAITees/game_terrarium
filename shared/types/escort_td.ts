export type EscortTdCommandMode = 'balanced' | 'ground' | 'air' | 'siege';
export type EscortTdPieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';
export type EscortTdEnemyKind = 'ground' | 'air' | 'siege';
export type EscortTdRallyRole = 'left' | 'right' | 'rear';
export type EscortTdRallyPoint = { forward: number; side: number };
export type EscortTdRouteChoice = { remainingSeconds: number; options: Array<{ id: 'direct' | 'detour'; label: string; distance: number }> };

export type EscortTdMetaProgress = {
  startGoldLevel: number;
  kingHpLevel: number;
  unitLimitLevel: number;
  autoRestartLevel: number;
  speedLevel: number;
  pawnPowerLevel: number;
  rookPowerLevel: number;
  bishopPowerLevel: number;
  knightPowerLevel: number;
  queenPowerLevel: number;
};

export type EscortTdKingSnapshot = {
  x: number;
  z: number;
  hp: number;
  hpMax: number;
  nextX: number;
  nextZ: number;
  paused: boolean;
  coveragePercent: number;
  advanceBlocked: boolean;
  forcedAdvance: boolean;
};

export type EscortTdUnitSnapshot = {
  id: number;
  type: EscortTdPieceType;
  gx: number;
  gy: number;
  wx: number;
  wz: number;
  moveFacing: number;
  aimFacing: number;
  patrolRadius: number;
  deployed: boolean;
  hp: number;
  hpMax: number;
  respawnTimer: number;
};

export type EscortTdBarricadeSnapshot = {
  id: number;
  gx: number;
  gy: number;
  hp: number;
  hpMax: number;
};

export type EscortTdApproachPathSnapshot = {
  kind: EscortTdEnemyKind;
  points: Array<{ x: number; z: number }>;
};

export type EscortTdEnemySnapshot = {
  id: number;
  kind: EscortTdEnemyKind;
  x: number;
  z: number;
  hp: number;
  bobPhase: number;
  hitFlash: number;
};

export type EscortTdCountsSnapshot = {
  pawn: number;
  rook: number;
  bishop: number;
  knight: number;
  queen: number;
  ground: number;
  air: number;
  siege: number;
};

export type EscortTdRunResult = {
  outcome: 'failed' | 'cleared';
  progressPercent: number;
  kills: Record<EscortTdEnemyKind, number>;
  score: number;
  chips: number;
};

// Flying projectile tracked by the server
export type EscortTdProjectileSnapshot = {
  id: number;
  unitType: EscortTdPieceType;
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  targetX: number;
  targetZ: number;
  dirX: number;
  dirZ: number;
  speed: number;
};

// Instant-hit laser beam (Queen only) — drained each snapshot
export type EscortTdLaserEvent = {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  aoeRadius: number;
};

export type EscortTdStateSnapshot = {
  page: 'escort_td';
  updatedAt: string;
  citySeed: number;
  wave: number;
  gold: number;
  commandMode: EscortTdCommandMode;
  timeScale: 0 | 1 | 2 | 4;
  rallyPoints: Record<EscortTdRallyRole, EscortTdRallyPoint>;
  routeChoice: EscortTdRouteChoice | null;
  meta: EscortTdMetaProgress;
  progressPercent: number;
  king: EscortTdKingSnapshot;
  units: EscortTdUnitSnapshot[];
  barricades: EscortTdBarricadeSnapshot[];
  approachPaths: EscortTdApproachPathSnapshot[];
  enemies: EscortTdEnemySnapshot[];
  counts: EscortTdCountsSnapshot;
  projectiles: EscortTdProjectileSnapshot[];
  laserEvents: EscortTdLaserEvent[];
  result: EscortTdRunResult | null;
  over: boolean;
  won: boolean;
};

export type EscortTdAction =
  | { action: 'deploy' }
  | { action: 'toggle_pause' }
  | { action: 'toggle_force_advance' }
  | { action: 'set_speed'; speed: 0 | 1 | 2 | 4 }
  | { action: 'set_rally'; role: EscortTdRallyRole; forward: number; side: number }
  | { action: 'choose_route'; route: 'direct' | 'detour' }
  | { action: 'set_command_mode'; mode: EscortTdCommandMode }
  | { action: 'place_unit'; gx: number; gy: number; type: EscortTdPieceType }
  | { action: 'place_barricade'; gx: number; gy: number }
  | { action: 'reclaim_at'; gx: number; gy: number }
  | { action: 'restart'; meta: EscortTdMetaProgress };
