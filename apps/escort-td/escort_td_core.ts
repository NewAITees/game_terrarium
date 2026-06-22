import { BoxGeometry,ConeGeometry,CylinderGeometry,SphereGeometry,Vector3, } from 'three';

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
export type AttackShape = 'fan' | 'circle' | 'square';
export type CommandMode = 'balanced' | 'ground' | 'air' | 'siege';
export const COMMAND_MODES: CommandMode[] = ['balanced', 'ground', 'air', 'siege'];
export const COMMAND_MODE_LABEL: Record<CommandMode, string> = {
  balanced: 'BALANCED',
  ground: 'GROUND',
  air: 'AIR',
  siege: 'SIEGE',
};

export interface GridPt { x: number; y: number }
export type EnemyKind = 'ground' | 'air' | 'siege';

export interface Enemy { x: number; z: number; hp: number; speed: number; mesh: any; dead: boolean; hitFlash: number; kind: EnemyKind; bobPhase: number }
export interface PendingAttack { x: number; z: number; shape: AttackShape; radius: number; color: number; remaining: number; facing: number }
export interface Unit { type: PieceType; gx: number; gy: number; wx: number; wz: number; mesh: any; fireTimer: number; progress: number; speedMul: number; formationOffset: number; windupTimer: number; pendingAttack: PendingAttack | null; facing: number }
export interface Effect { mesh: any; mat: any; life: number; maxLife: number; grow: boolean }
export interface RoadRoute { kind: 'main' | 'loop' | 'branch'; points: GridPt[] }
export interface SpawnPoints { ground: GridPt[]; air: GridPt[]; siege: GridPt[] }

export interface PieceDef {
  cost: number;
  range: number;
  fireRate: number;
  dmg: number;
  aoe: number;
  color: number;
  emissive: number;
  attackShape: AttackShape;
  attackWindup: number;
  makeGeo: () => any;
}

export const PIECE: Record<PieceType, PieceDef> = {
  pawn: {
    cost: 40, range: CS * 3.5, fireRate: 0.48, dmg: 14, aoe: 0,
    color: 0x40e0d0, emissive: 0x0a3535,
    attackShape: 'fan', attackWindup: 0.08,
    makeGeo: () => new CylinderGeometry(CS * 0.27, CS * 0.31, CS * 0.48, 8),
  },
  rook: {
    cost: 80, range: CS * 6, fireRate: 1.0, dmg: 38, aoe: CS * 1.6,
    color: 0x8899cc, emissive: 0x111a33,
    attackShape: 'circle', attackWindup: 0.78,
    makeGeo: () => new BoxGeometry(CS * 0.62, CS * 0.55, CS * 0.62),
  },
  bishop: {
    cost: 70, range: CS * 8, fireRate: 1.2, dmg: 45, aoe: 0,
    color: 0xcc77ee, emissive: 0x220033,
    attackShape: 'square', attackWindup: 0.72,
    makeGeo: () => new ConeGeometry(CS * 0.27, CS * 0.72, 8),
  },
  knight: {
    cost: 90, range: CS * 1.8, fireRate: 0.14, dmg: 6, aoe: 0,
    color: 0xdd9944, emissive: 0x331100,
    attackShape: 'square', attackWindup: 0.03,
    makeGeo: () => new BoxGeometry(CS * 0.52, CS * 0.62, CS * 0.42),
  },
  queen: {
    cost: 150, range: CS * 12, fireRate: 4.0, dmg: 160, aoe: CS * 3.2,
    color: 0xffe066, emissive: 0x554400,
    attackShape: 'square', attackWindup: 1.0,
    makeGeo: () => new SphereGeometry(CS * 0.34, 12, 8),
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
  const g: Uint8Array[] = Array.from({ length: height }, () => new Uint8Array(width).fill(1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x % ROAD !== 0 && y % ROAD !== 0) g[y][x] = rand() < 0.62 ? 1 : 0;
    }
  }

  const cornerPairs: [GridPt, GridPt][] = [
    [{ x: 0, y: 0 }, { x: width - 1, y: height - 1 }],
    [{ x: width - 1, y: 0 }, { x: 0, y: height - 1 }],
  ];
  const [start, end] = cornerPairs[(rand() * cornerPairs.length) | 0];
  const route = buildMainRoute(start, end, width, height, rand);
  const roads = buildRoadNetwork(route, width, height, rand);
  const roadRoutes: RoadRoute[] = [{ kind: 'main', points: route }, ...roads];

  for (const road of roadRoutes) {
    carveEscortRoute(g, road.points, rand);
  }
  carvePlaza(g, start, 2);
  carvePlaza(g, end, 2);
  for (let i = 1; i < route.length - 1; i++) {
    if (i % 2 === 1) carvePlaza(g, route[i], 1);
  }

  const spawnPoints = buildSpawnPoints(g, roadRoutes, width, height, rand);

  return { g, width, height, start, end, route, roads: roadRoutes, spawnPoints };
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
  return new Vector3((gx - GW / 2 + 0.5) * CS, 0, (gy - GH / 2 + 0.5) * CS);
}

export function w2gi(wx: number, wz: number) {
  return {
    gx: Math.floor(wx / CS + GW / 2),
    gy: Math.floor(wz / CS + GH / 2),
  };
}

function buildMainRoute(start: GridPt, end: GridPt, width: number, height: number, rand: () => number): GridPt[] {
  const x1 = clampGrid(Math.floor(width * 0.18) + (rand() < 0.5 ? 0 : ROAD), 1, width - 2);
  const x2 = clampGrid(Math.floor(width * 0.44), 1, width - 2);
  const x3 = clampGrid(Math.floor(width * 0.68), 1, width - 2);
  const y1 = clampGrid(Math.floor(height * 0.20) + (rand() < 0.5 ? 0 : ROAD), 1, height - 2);
  const y2 = clampGrid(Math.floor(height * 0.44), 1, height - 2);
  const y3 = clampGrid(Math.floor(height * 0.69), 1, height - 2);
  const route = [
    start,
    { x: start.x, y: y1 },
    { x: x1, y: y1 },
    { x: x1, y: y2 },
    { x: x2, y: y2 },
    { x: x2, y: y3 },
    { x: x3, y: y3 },
    { x: end.x, y: y3 },
    end,
  ];
  return dedupeRoute(route);
}

function carveEscortRoute(g: Uint8Array[], route: GridPt[], rand: () => number): void {
  for (let i = 0; i < route.length - 1; i++) {
    carveManhattan(g, route[i], route[i + 1]);
  }
  for (const point of route) {
    if (rand() < 0.95) carvePlaza(g, point, 1);
  }
  for (let y = 1; y < g.length - 1; y++) {
    for (let x = 1; x < g[0].length - 1; x++) {
      if (g[y][x] === 0) continue;
      if (rand() < 0.03) g[y][x] = 0;
    }
  }
}

function carveManhattan(g: Uint8Array[], from: GridPt, to: GridPt): void {
  let x = from.x;
  let y = from.y;
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  carveCell(g, x, y);

  while (x !== to.x) {
    x += stepX;
    carveCell(g, x, y);
  }
  while (y !== to.y) {
    y += stepY;
    carveCell(g, x, y);
  }
}

function carvePlaza(g: Uint8Array[], center: GridPt, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      carveCell(g, center.x + dx, center.y + dy);
    }
  }
}

function carveCell(g: Uint8Array[], x: number, y: number): void {
  if (y < 0 || y >= g.length) return;
  if (x < 0 || x >= g[0].length) return;
  g[y][x] = 0;
}

function pickDifferent(values: number[], banned: number[], rand: () => number): number {
  const pool = values.filter((value) => !banned.includes(value));
  if (!pool.length) return values[(rand() * values.length) | 0];
  return pool[(rand() * pool.length) | 0];
}

function dedupeRoute(points: GridPt[]): GridPt[] {
  const route: GridPt[] = [];
  for (const point of points) {
    const last = route[route.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) route.push(point);
  }
  return route;
}

function clampGrid(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildRoadNetwork(mainRoute: GridPt[], width: number, height: number, rand: () => number): RoadRoute[] {
  const midX = clampGrid(Math.floor(width * 0.5), 1, width - 2);
  const leftX = clampGrid(Math.floor(width * 0.24), 1, width - 2);
  const rightX = clampGrid(Math.floor(width * 0.74), 1, width - 2);
  const topY = clampGrid(Math.floor(height * 0.20), 1, height - 2);
  const midY = clampGrid(Math.floor(height * 0.48), 1, height - 2);
  const lowY = clampGrid(Math.floor(height * 0.74), 1, height - 2);
  const innerX = clampGrid(Math.floor(width * 0.56), 1, width - 2);
  const innerY = clampGrid(Math.floor(height * 0.34), 1, height - 2);

  const routes: RoadRoute[] = [
    {
      kind: 'loop',
      points: dedupeRoute([
        { x: clampGrid(leftX - ROAD, 0, width - 1), y: topY },
        { x: clampGrid(midX - ROAD, 0, width - 1), y: topY },
        { x: clampGrid(midX - ROAD, 0, width - 1), y: midY },
        { x: clampGrid(leftX - ROAD, 0, width - 1), y: midY },
        { x: clampGrid(leftX - ROAD, 0, width - 1), y: topY },
      ]),
    },
    {
      kind: 'loop',
      points: dedupeRoute([
        { x: clampGrid(midX + ROAD, 0, width - 1), y: innerY },
        { x: clampGrid(rightX + ROAD, 0, width - 1), y: clampGrid(innerY - 1, 0, height - 1) },
        { x: clampGrid(rightX + ROAD, 0, width - 1), y: lowY },
        { x: clampGrid(midX + ROAD, 0, width - 1), y: clampGrid(lowY + 1, 0, height - 1) },
        { x: clampGrid(midX + ROAD, 0, width - 1), y: innerY },
      ]),
    },
    {
      kind: 'branch',
      points: dedupeRoute([
        { x: leftX, y: midY },
        { x: midX, y: midY },
        { x: midX, y: lowY },
      ]),
    },
    {
      kind: 'branch',
      points: dedupeRoute([
        { x: innerX, y: innerY },
        { x: innerX, y: midY },
        { x: rightX, y: midY },
      ]),
    },
  ];

    if (rand() < 0.5) {
      routes.push({
        kind: 'branch',
        points: dedupeRoute([
        { x: clampGrid(leftX + ROAD, 0, width - 1), y: clampGrid(topY + ROAD, 0, height - 1) },
        { x: innerX, y: clampGrid(topY + ROAD, 0, height - 1) },
        { x: innerX, y: innerY },
        ]),
      });
    } else {
      routes.push({
        kind: 'branch',
        points: dedupeRoute([
        { x: clampGrid(rightX - ROAD, 0, width - 1), y: clampGrid(midY - ROAD, 0, height - 1) },
        { x: midX, y: clampGrid(midY - ROAD, 0, height - 1) },
        { x: midX, y: clampGrid(lowY - ROAD, 0, height - 1) },
        ]),
      });
    }

  return routes;
}

function buildSpawnPoints(g: Uint8Array[], roads: RoadRoute[], width: number, height: number, rand: () => number): SpawnPoints {
  const ground: GridPt[] = [];
  const air: GridPt[] = [];
  const siege: GridPt[] = [];
  const seen = new Set<string>();

  for (const road of roads) {
    for (const pt of [road.points[0], road.points[road.points.length - 1]]) {
      if (!pt) continue;
      const key = `${pt.x}:${pt.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ground.push(pt);
      siege.push(pt);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (g[y][x] !== 0) continue;
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) {
        const pt = { x, y };
        const key = `${pt.x}:${pt.y}`;
        if (!seen.has(key)) {
          seen.add(key);
          ground.push(pt);
          siege.push(pt);
        }
      }
    }
  }

  for (let i = 0; i < 6; i++) {
    air.push({
      x: clampGrid(Math.floor(width * (0.15 + i * 0.12)) + (rand() < 0.5 ? 0 : 1), 0, width - 1),
      y: clampGrid(Math.floor(height * (0.1 + (i % 3) * 0.35)), 0, height - 1),
    });
  }

  return { ground, air, siege };
}
