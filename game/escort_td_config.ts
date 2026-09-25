import type { EscortTdCommandMode, EscortTdEnemySnapshot, EscortTdPieceType, EscortTdUnitSnapshot } from '../shared/types/escort_td';

export const GW = 21;
export const GH = 17;
export const CS = 5;
export const ROAD = 4;
export const VIP_HP_MAX = 400;
export const VIP_SPEED = 6;
export const ENEMY_SPEED_BASE = 7;
export const ENEMY_HP_BASE = 28;
export const ENEMY_DMG = 20;
export const ENEMY_SEP_RADIUS = CS * 0.6;
export const ENEMY_SEP_FORCE = 3.5;
export const GOLD_KILL = 8;
export const START_GOLD = 100;
export const WAVE_BASE = 8;
export const SIEGE_BARRICADE_DAMAGE_PER_SECOND = 35;
export const GUARD_REFORM_SECONDS = 4;
export const ENEMY_GUARD_DAMAGE_PER_SECOND = 9;
export const VIP_VISION = CS * 2;
export const PAWN_VISION = CS * 5;
export const ADVANCE_COVERAGE_THRESHOLD = 65;

export const PIECE: Record<EscortTdPieceType, {
  cost: number; range: number; fireRate: number; dmg: number; aoe: number;
  attackShape: 'fan' | 'circle' | 'square'; attackWindup: number;
  projSpeed: number;  // units/sec (0 = instant laser)
  projHitR: number;   // hit detection radius
  projCount: number;  // how many projectiles per attack
  projSpread: number; // total fan spread in radians (0 = single direction)
}> = {
  pawn:   { cost: 40,  range: CS*3.5, fireRate: 0.48, dmg: 14,  aoe: 0,       attackShape: 'fan',    attackWindup: 0.08, projSpeed: CS*12, projHitR: CS*0.45, projCount: 3, projSpread: Math.PI/5 },
  rook:   { cost: 80,  range: CS*6,   fireRate: 1.0,  dmg: 38,  aoe: CS*1.6,  attackShape: 'circle', attackWindup: 0.78, projSpeed: CS*9,  projHitR: CS*0.4,  projCount: 1, projSpread: 0 },
  bishop: { cost: 70,  range: CS*8,   fireRate: 1.2,  dmg: 45,  aoe: 0,       attackShape: 'square', attackWindup: 0.72, projSpeed: CS*7,  projHitR: CS*0.55, projCount: 1, projSpread: 0 },
  knight: { cost: 90,  range: CS*1.8, fireRate: 0.14, dmg: 6,   aoe: 0,       attackShape: 'square', attackWindup: 0.03, projSpeed: CS*14, projHitR: CS*0.38, projCount: 5, projSpread: Math.PI/9 },
  queen:  { cost: 150, range: CS*12,  fireRate: 4.0,  dmg: 160, aoe: CS*3.2,  attackShape: 'square', attackWindup: 1.0,  projSpeed: 0,     projHitR: 0,       projCount: 0, projSpread: 0 },
};

export const UNIT_GUARD: Record<EscortTdPieceType, { speedMul: number; patrolRadius: number; interceptBias: number }> = {
  pawn: { speedMul: 2.4, patrolRadius: CS * 3.4, interceptBias: 1.2 },
  rook: { speedMul: 1.25, patrolRadius: CS * 2.1, interceptBias: 0.65 },
  bishop: { speedMul: 1.8, patrolRadius: CS * 3.0, interceptBias: 1.0 },
  knight: { speedMul: 2.7, patrolRadius: CS * 2.5, interceptBias: 1.55 },
  queen: { speedMul: 1.45, patrolRadius: CS * 3.7, interceptBias: 0.8 },
};

export const COMMAND_MODES: EscortTdCommandMode[] = ['balanced', 'ground', 'air', 'siege'];
export const D4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export type GridPt = { x: number; y: number };
export type RoadRoute = { kind: 'main' | 'loop' | 'branch'; points: GridPt[] };
export type SpawnPoints = { ground: GridPt[]; air: GridPt[]; siege: GridPt[] };
export type CityData = { width: number; height: number; g: Uint8Array[]; start: GridPt; end: GridPt; route: GridPt[]; roads: RoadRoute[]; spawnPoints: SpawnPoints };
export type Enemy = EscortTdEnemySnapshot & { dead: boolean; speed: number };
export type PendingAttack = { x: number; z: number; shape: 'fan' | 'circle' | 'square'; radius: number; facing: number; targetEnemyId: number | null };
export type Unit = EscortTdUnitSnapshot & { fireTimer: number; speedMul: number; windupTimer: number; patrolAngle: number; pendingAttack: PendingAttack | null };
export type Barricade = { id: number; gx: number; gy: number; hp: number; hpMax: number };
export type FlyingProjectile = {
  id: number; unitType: EscortTdPieceType;
  x: number; z: number;
  fromX: number; fromZ: number;
  dirX: number; dirZ: number;
  homingId: number | null; // enemy ID to track (Bishop only)
  targetX: number; targetZ: number;
  damage: number; aoeRadius: number; hitRadius: number; speed: number;
  maxRange: number; traveled: number;
};
