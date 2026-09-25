import { CS, D4, GH, GW, ROAD } from './escort_td_config';
import type { CityData, GridPt, RoadRoute, SpawnPoints } from './escort_td_config';

export function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCity(width: number, height: number, seed: number): CityData {
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
  for (const road of roadRoutes) carveEscortRoute(g, road.points, rand);
  carvePlaza(g, start, 2);
  carvePlaza(g, end, 2);
  for (let i = 1; i < route.length - 1; i++) if (i % 2 === 1) carvePlaza(g, route[i], 1);
  return { g, width, height, start, end, route, roads: roadRoutes, spawnPoints: buildSpawnPoints(g, roadRoutes, width, height, rand) };
}

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

export function g2w(gx: number, gy: number): { x: number; z: number } {
  return { x: (gx - GW / 2 + 0.5) * CS, z: (gy - GH / 2 + 0.5) * CS };
}

export function w2gi(wx: number, wz: number): { gx: number; gy: number } {
  return { gx: Math.floor(wx / CS + GW / 2), gy: Math.floor(wz / CS + GH / 2) };
}

function buildMainRoute(start: GridPt, end: GridPt, width: number, height: number, rand: () => number): GridPt[] {
  const x1 = clampGrid(Math.floor(width * 0.18) + (rand() < 0.5 ? 0 : ROAD), 1, width - 2);
  const x2 = clampGrid(Math.floor(width * 0.44), 1, width - 2);
  const x3 = clampGrid(Math.floor(width * 0.68), 1, width - 2);
  const y1 = clampGrid(Math.floor(height * 0.20) + (rand() < 0.5 ? 0 : ROAD), 1, height - 2);
  const y2 = clampGrid(Math.floor(height * 0.44), 1, height - 2);
  const y3 = clampGrid(Math.floor(height * 0.69), 1, height - 2);
  return dedupeRoute([start, { x: start.x, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y2 }, { x: x2, y: y2 }, { x: x2, y: y3 }, { x: x3, y: y3 }, { x: end.x, y: y3 }, end]);
}

function carveEscortRoute(g: Uint8Array[], route: GridPt[], rand: () => number): void {
  for (let i = 0; i < route.length - 1; i++) carveManhattan(g, route[i], route[i + 1]);
  for (const point of route) if (rand() < 0.95) carvePlaza(g, point, 1);
  for (let y = 1; y < g.length - 1; y++) for (let x = 1; x < g[0].length - 1; x++) if (g[y][x] !== 0 && rand() < 0.03) g[y][x] = 0;
}

function carveManhattan(g: Uint8Array[], from: GridPt, to: GridPt): void {
  let x = from.x;
  let y = from.y;
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);
  carveCell(g, x, y);
  while (x !== to.x) { x += stepX; carveCell(g, x, y); }
  while (y !== to.y) { y += stepY; carveCell(g, x, y); }
}

function carvePlaza(g: Uint8Array[], center: GridPt, radius: number): void {
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) carveCell(g, center.x + dx, center.y + dy);
}

function carveCell(g: Uint8Array[], x: number, y: number): void {
  if (y < 0 || y >= g.length || x < 0 || x >= g[0].length) return;
  g[y][x] = 0;
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
  void mainRoute;
  const midX = clampGrid(Math.floor(width * 0.5), 1, width - 2);
  const leftX = clampGrid(Math.floor(width * 0.24), 1, width - 2);
  const rightX = clampGrid(Math.floor(width * 0.74), 1, width - 2);
  const topY = clampGrid(Math.floor(height * 0.20), 1, height - 2);
  const midY = clampGrid(Math.floor(height * 0.48), 1, height - 2);
  const lowY = clampGrid(Math.floor(height * 0.74), 1, height - 2);
  const innerX = clampGrid(Math.floor(width * 0.56), 1, width - 2);
  const innerY = clampGrid(Math.floor(height * 0.34), 1, height - 2);
  const routes: RoadRoute[] = [
    { kind: 'loop', points: dedupeRoute([{ x: clampGrid(leftX - ROAD, 0, width - 1), y: topY }, { x: clampGrid(midX - ROAD, 0, width - 1), y: topY }, { x: clampGrid(midX - ROAD, 0, width - 1), y: midY }, { x: clampGrid(leftX - ROAD, 0, width - 1), y: midY }, { x: clampGrid(leftX - ROAD, 0, width - 1), y: topY }]) },
    { kind: 'loop', points: dedupeRoute([{ x: clampGrid(midX + ROAD, 0, width - 1), y: innerY }, { x: clampGrid(rightX + ROAD, 0, width - 1), y: clampGrid(innerY - 1, 0, height - 1) }, { x: clampGrid(rightX + ROAD, 0, width - 1), y: lowY }, { x: clampGrid(midX + ROAD, 0, width - 1), y: clampGrid(lowY + 1, 0, height - 1) }, { x: clampGrid(midX + ROAD, 0, width - 1), y: innerY }]) },
    { kind: 'branch', points: dedupeRoute([{ x: leftX, y: midY }, { x: midX, y: midY }, { x: midX, y: lowY }]) },
    { kind: 'branch', points: dedupeRoute([{ x: innerX, y: innerY }, { x: innerX, y: midY }, { x: rightX, y: midY }]) },
  ];
  if (rand() < 0.5) routes.push({ kind: 'branch', points: dedupeRoute([{ x: clampGrid(leftX + ROAD, 0, width - 1), y: clampGrid(topY + ROAD, 0, height - 1) }, { x: innerX, y: clampGrid(topY + ROAD, 0, height - 1) }, { x: innerX, y: innerY }]) });
  else routes.push({ kind: 'branch', points: dedupeRoute([{ x: clampGrid(rightX - ROAD, 0, width - 1), y: clampGrid(midY - ROAD, 0, height - 1) }, { x: midX, y: clampGrid(midY - ROAD, 0, height - 1) }, { x: midX, y: clampGrid(lowY - ROAD, 0, height - 1) }]) });
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
        const key = `${x}:${y}`;
        if (!seen.has(key)) {
          seen.add(key);
          ground.push(pt);
          siege.push(pt);
        }
      }
    }
  }
  for (let i = 0; i < 6; i++) air.push({ x: clampGrid(Math.floor(width * (0.15 + i * 0.12)) + (rand() < 0.5 ? 0 : 1), 0, width - 1), y: clampGrid(Math.floor(height * (0.1 + (i % 3) * 0.35)), 0, height - 1) });
  return { ground, air, siege };
}

export function buildVipPath(route: GridPt[]): Array<{ x: number; z: number }> {
  const path: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = g2w(route[i].x, route[i].y);
    const b = g2w(route[i + 1].x, route[i + 1].y);
    const stepCount = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / (CS * 0.35)));
    for (let s = 0; s < stepCount; s++) {
      const t = s / stepCount;
      path.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  const last = route[route.length - 1];
  path.push(g2w(last.x, last.y));
  return path;
}

export function buildDetourVipPath(city: CityData, origin: GridPt, direct: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const directCells = direct.map((point) => w2gi(point.x, point.z));
  const candidates = city.roads.flatMap((road) => road.kind === 'main' ? [] : road.points);
  let waypoint: GridPt | null = null;
  let bestDistance = 0;
  for (const candidate of candidates) {
    if (candidate.x < 0 || candidate.x >= city.width || candidate.y < 0 || candidate.y >= city.height || city.g[candidate.y][candidate.x] !== 0) continue;
    const distance = Math.min(...directCells.map((cell) => Math.abs(cell.gx - candidate.x) + Math.abs(cell.gy - candidate.y)));
    if (distance > bestDistance) {
      waypoint = candidate;
      bestDistance = distance;
    }
  }
  if (!waypoint) return [];
  const first = findGridPath(city.g, city.width, city.height, origin, waypoint);
  const second = findGridPath(city.g, city.width, city.height, waypoint, city.end);
  if (!first.length || !second.length) return [];
  return buildVipPath([...first, ...second.slice(1)]);
}

export function findGridPath(grid: Uint8Array[], width: number, height: number, start: GridPt, end: GridPt): GridPt[] {
  const startKey = start.y * width + start.x;
  const endKey = end.y * width + end.x;
  const previous = new Int32Array(width * height).fill(-1);
  const queue = [startKey];
  previous[startKey] = startKey;
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    if (key === endKey) break;
    const x = key % width;
    const y = Math.floor(key / width);
    for (const [dx, dy] of D4) {
      const nx = x + dx;
      const ny = y + dy;
      const next = ny * width + nx;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height || grid[ny][nx] !== 0 || previous[next] >= 0) continue;
      previous[next] = key;
      queue.push(next);
    }
  }
  if (previous[endKey] < 0) return [];
  const path: GridPt[] = [];
  for (let key = endKey; key !== startKey; key = previous[key]) path.push({ x: key % width, y: Math.floor(key / width) });
  path.push(start);
  return path.reverse();
}

export function pathLength(path: Array<{ x: number; z: number }>): number {
  let length = 0;
  for (let index = 1; index < path.length; index++) length += Math.hypot(path[index].x - path[index - 1].x, path[index].z - path[index - 1].z);
  return Math.round(length);
}
