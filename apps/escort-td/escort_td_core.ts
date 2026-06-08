import * as THREE from 'three';

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
export const SPAWN_SEC = 10;
export const WAVE_BASE = 8;

export const VISION = {
  vip: CS * 2.0,
  pawn: CS * 5.0,
  rook: CS * 1.5,
  bishop: CS * 1.5,
  knight: CS * 1.5,
  queen: CS * 2.0,
} as const;

export type PieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';

export interface GridPt { x: number; y: number }
export interface Enemy { x: number; z: number; hp: number; speed: number; mesh: any; dead: boolean; hitFlash: number }
export interface Unit { type: PieceType; gx: number; gy: number; wx: number; wz: number; mesh: any; fireTimer: number }
export interface Effect { mesh: any; mat: any; life: number; maxLife: number; grow: boolean }

export interface PieceDef {
  cost: number;
  range: number;
  fireRate: number;
  dmg: number;
  aoe: number;
  color: number;
  emissive: number;
  makeGeo: () => any;
}

export const PIECE: Record<PieceType, PieceDef> = {
  pawn: {
    cost: 40, range: CS * 3.5, fireRate: 0.48, dmg: 14, aoe: 0,
    color: 0x40e0d0, emissive: 0x0a3535,
    makeGeo: () => new THREE.CylinderGeometry(CS * 0.27, CS * 0.31, CS * 0.48, 8),
  },
  rook: {
    cost: 80, range: CS * 6, fireRate: 1.0, dmg: 38, aoe: CS * 1.6,
    color: 0x8899cc, emissive: 0x111a33,
    makeGeo: () => new THREE.BoxGeometry(CS * 0.62, CS * 0.55, CS * 0.62),
  },
  bishop: {
    cost: 70, range: CS * 8, fireRate: 1.2, dmg: 45, aoe: 0,
    color: 0xcc77ee, emissive: 0x220033,
    makeGeo: () => new THREE.ConeGeometry(CS * 0.27, CS * 0.72, 8),
  },
  knight: {
    cost: 90, range: CS * 1.8, fireRate: 0.14, dmg: 6, aoe: 0,
    color: 0xdd9944, emissive: 0x331100,
    makeGeo: () => new THREE.BoxGeometry(CS * 0.52, CS * 0.62, CS * 0.42),
  },
  queen: {
    cost: 150, range: CS * 12, fireRate: 4.0, dmg: 160, aoe: CS * 3.2,
    color: 0xffe066, emissive: 0x554400,
    makeGeo: () => new THREE.SphereGeometry(CS * 0.34, 12, 8),
  },
};

export function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCity(width: number, height: number, seed: number) {
  const rand = mkRng(seed);
  const g: Uint8Array[] = Array.from({ length: height }, () => new Uint8Array(width));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x % ROAD !== 0 && y % ROAD !== 0) g[y][x] = rand() < 0.62 ? 1 : 0;
    }
  }
  const midY = Math.round(height / 2 / ROAD) * ROAD;
  g[midY][0] = 0;
  g[midY][width - 1] = 0;
  return { g, width, height, start: { x: 0, y: midY } as GridPt, end: { x: width - 1, y: midY } as GridPt };
}

export const D4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function bfsFlow(g: Uint8Array[], width: number, height: number, goalX: number, goalY: number): Int8Array {
  const inf = 0x7fffffff;
  const dist = new Int32Array(width * height).fill(inf);
  const flow = new Int8Array(width * height).fill(-1);
  dist[goalY * width + goalX] = 0;
  const q: number[] = [goalY * width + goalX];
  for (let head = 0; head < q.length; head++) {
    const idx = q[head];
    const x = idx % width;
    const y = (idx / width) | 0;
    const d = dist[idx];
    for (let di = 0; di < 4; di++) {
      const nx = x + D4[di][0];
      const ny = y + D4[di][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (g[ny][nx] === 1 || dist[ni] < inf) continue;
      dist[ni] = d + 1;
      q.push(ni);
    }
  }

  for (let i = 0; i < width * height; i++) {
    if (dist[i] === inf) continue;
    const x = i % width;
    const y = (i / width) | 0;
    let best = -1;
    let bestDist = dist[i];
    for (let di = 0; di < 4; di++) {
      const nx = x + D4[di][0];
      const ny = y + D4[di][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nextDist = dist[ny * width + nx];
      if (nextDist < bestDist) {
        bestDist = nextDist;
        best = di;
      }
    }
    flow[i] = best;
  }
  return flow;
}

export function g2w(gx: number, gy: number) {
  return new THREE.Vector3((gx - GW / 2 + 0.5) * CS, 0, (gy - GH / 2 + 0.5) * CS);
}

export function w2gi(wx: number, wz: number) {
  return {
    gx: Math.floor(wx / CS + GW / 2),
    gy: Math.floor(wz / CS + GH / 2),
  };
}
