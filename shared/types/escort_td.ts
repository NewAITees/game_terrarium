export type EscortTdCommandMode = 'balanced' | 'ground' | 'air' | 'siege';
export type EscortTdPieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';
export type EscortTdEnemyKind = 'ground' | 'air' | 'siege';

export type EscortTdKingSnapshot = {
  x: number;
  z: number;
  hp: number;
  hpMax: number;
  paused: boolean;
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

export type EscortTdStateSnapshot = {
  page: 'escort_td';
  updatedAt: string;
  citySeed: number;
  wave: number;
  gold: number;
  commandMode: EscortTdCommandMode;
  king: EscortTdKingSnapshot;
  units: EscortTdUnitSnapshot[];
  enemies: EscortTdEnemySnapshot[];
  counts: EscortTdCountsSnapshot;
  over: boolean;
  won: boolean;
};

export type EscortTdAction =
  | { action: 'deploy' }
  | { action: 'toggle_pause' }
  | { action: 'set_command_mode'; mode: EscortTdCommandMode };
