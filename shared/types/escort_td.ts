export type EscortTdCommandMode = 'balanced' | 'ground' | 'air' | 'siege';
export type EscortTdPieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';
export type EscortTdEnemyKind = 'ground' | 'air' | 'siege';

export type EscortTdMetaProgress = {
  startGoldLevel: number;
  kingHpLevel: number;
  unitLimitLevel: number;
};

export type EscortTdKingSnapshot = {
  x: number;
  z: number;
  hp: number;
  hpMax: number;
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
};

export type EscortTdBarricadeSnapshot = {
  id: number;
  gx: number;
  gy: number;
  hp: number;
  hpMax: number;
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

export type EscortTdStateSnapshot = {
  page: 'escort_td';
  updatedAt: string;
  citySeed: number;
  wave: number;
  gold: number;
  commandMode: EscortTdCommandMode;
  meta: EscortTdMetaProgress;
  progressPercent: number;
  king: EscortTdKingSnapshot;
  units: EscortTdUnitSnapshot[];
  barricades: EscortTdBarricadeSnapshot[];
  enemies: EscortTdEnemySnapshot[];
  counts: EscortTdCountsSnapshot;
  result: EscortTdRunResult | null;
  over: boolean;
  won: boolean;
};

export type EscortTdAction =
  | { action: 'deploy' }
  | { action: 'toggle_pause' }
  | { action: 'toggle_force_advance' }
  | { action: 'set_command_mode'; mode: EscortTdCommandMode }
  | { action: 'place_unit'; gx: number; gy: number; type: EscortTdPieceType }
  | { action: 'place_barricade'; gx: number; gy: number }
  | { action: 'reclaim_at'; gx: number; gy: number }
  | { action: 'restart'; meta: EscortTdMetaProgress };
