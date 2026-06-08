import * as THREE from 'three';

export class RNG {
  s: number;
  constructor(s: number) { this.s = ((s || Math.random() * 2 ** 32) ^ 0xDEADBEEF) >>> 0; }
  next() { let x = this.s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; return (this.s = x >>> 0) / 0x100000000; }
  range(a: number, b: number) { return a + this.next() * (b - a); }
  int(a: number, b: number) { return a + (this.next() * (b - a + 1) | 0); }
  pick<T>(arr: T[]): T { return arr[this.next() * arr.length | 0]; }
}

export const LAYERS = ['core', 'dist', 'acc', 'term'] as const;
export const YL = { core: 36, dist: 20, acc: 4, term: -16 };

export function layerCounts(n: number) {
  const core = 1;
  const dist = Math.max(2, Math.min(4, Math.floor(n * 0.10)));
  const acc = Math.max(3, Math.min(10, Math.floor(n * 0.25)));
  return { core, dist, acc, term: Math.max(1, n - core - dist - acc) };
}

export function edgeKey(a: number, b: number) { return `${Math.min(a, b)}-${Math.max(a, b)}`; }

export function assignRadialPositions(lnodes: any, rng: RNG) {
  const radius = { dist: 27, acc: 56, term: 86 };
  const jitter = { dist: 2, acc: 3, term: 4 };
  const leafCounts = new Map();

  function leafCount(node: any): number {
    if (leafCounts.has(node.id)) return leafCounts.get(node.id);
    const value = node.children.length ? node.children.reduce((sum: number, child: any) => sum + leafCount(child), 0) : 1;
    leafCounts.set(node.id, value);
    return value;
  }

  function assignArc(node: any, lo: number, hi: number): void {
    node._a = (lo + hi) / 2;
    if (!node.children.length) return;
    const total = node.children.reduce((sum: number, child: any) => sum + leafCount(child), 0);
    let angle = lo;
    for (const child of node.children) {
      const arc = (leafCount(child) / total) * (hi - lo);
      assignArc(child, angle, angle + arc);
      angle += arc;
    }
  }

  for (const node of lnodes.core) {
    node.x = rng.range(-2, 2);
    node.z = rng.range(-2, 2);
    node._a = 0;
    assignArc(node, 0, Math.PI * 2);
  }
  for (const layer of ['dist', 'acc', 'term']) {
    for (const node of lnodes[layer]) {
      const r = radius[layer] + rng.range(-jitter[layer], jitter[layer]);
      node.x = Math.cos(node._a) * r;
      node.z = Math.sin(node._a) * r;
    }
  }
}

export function buildTopology(total: number, seed: number, mode = 'tree', rewirePct = 0) {
  const rng = new RNG(seed);
  const counts = layerCounts(total);
  const spread = Math.max(110, counts.term * 14);
  const nodes: any[] = [];
  const lnodes: any = {};

  for (const layer of LAYERS) {
    const count = counts[layer];
    lnodes[layer] = [];
    for (let i = 0; i < count; i++) {
      const x = ((i + 1) / (count + 1) - 0.5) * spread + rng.range(-4, 4);
      const z = rng.range(-12, 12);
      const node = { id: nodes.length, layer, x, z, y: YL[layer], parent: null, children: [], isServer: false };
      nodes.push(node);
      lnodes[layer].push(node);
    }
  }

  const terms = lnodes.term;
  const server = terms.reduce((best: any, node: any) => Math.abs(node.x) < Math.abs(best.x) ? node : best);
  server.isServer = true;

  const accNodes = lnodes.acc;
  const srvSwitch = accNodes.reduce((best: any, node: any) => Math.abs(node.x - server.x) < Math.abs(best.x - server.x) ? node : best);
  const freeAcc = accNodes.filter((node: any) => node !== srvSwitch);

  const treeEdges: any[] = [];
  for (let li = 1; li < LAYERS.length - 1; li++) {
    const parents = lnodes[LAYERS[li - 1]];
    const children = lnodes[LAYERS[li]];
    for (const child of children) {
      const parent = parents.reduce((best: any, node: any) => Math.abs(node.x - child.x) < Math.abs(best.x - child.x) ? node : best);
      child.parent = parent;
      parent.children.push(child);
      treeEdges.push({ a: parent, b: child });
    }
    for (const parent of parents) {
      if (parent.children.length) continue;
      const child = rng.pick(children);
      parent.children.push(child);
      treeEdges.push({ a: parent, b: child });
    }
  }

  server.parent = srvSwitch;
  srvSwitch.children.push(server);
  treeEdges.push({ a: srvSwitch, b: server });
  const otherTerms = terms.filter((node: any) => !node.isServer);
  for (const node of otherTerms) {
    const pool = freeAcc.length ? freeAcc : accNodes;
    const parent = pool.reduce((best: any, candidate: any) => Math.abs(candidate.x - node.x) < Math.abs(best.x - node.x) ? candidate : best);
    node.parent = parent;
    parent.children.push(node);
    treeEdges.push({ a: parent, b: node });
  }
  for (const parent of freeAcc) {
    if (parent.children.length) continue;
    const child = rng.pick(otherTerms);
    if (!child) continue;
    parent.children.push(child);
    treeEdges.push({ a: parent, b: child });
  }

  assignRadialPositions(lnodes, rng);

  const shortcutEdges: any[] = [];
  if (mode === 'smallworld' && rewirePct > 0) {
    const existing = new Set(treeEdges.map((edge) => edgeKey(edge.a.id, edge.b.id)));
    const k = Math.max(1, Math.round(nodes.length * rewirePct / 100));
    let added = 0;
    let attempts = 0;
    while (added < k && attempts < k * 30) {
      attempts++;
      const u = rng.pick(nodes);
      const v = rng.pick(nodes);
      if (u === v || u.layer === 'core' || u.layer === 'term' || v.layer === 'core' || v.layer === 'term') continue;
      const key = edgeKey(u.id, v.id);
      if (existing.has(key)) continue;
      existing.add(key);
      shortcutEdges.push({ a: u, b: v });
      added++;
    }
  }

  return { nodes, treeEdges, shortcutEdges, lnodes, server };
}

export function findTreePath(from: any, to: any) {
  const pathA = [];
  let node = from;
  while (node) { pathA.push(node); node = node.parent; }
  const pathB = [];
  node = to;
  while (node) { pathB.push(node); node = node.parent; }
  const setA = new Set(pathA);
  let ia = pathA.length - 1;
  let ib = 0;
  for (let i = 0; i < pathB.length; i++) {
    if (!setA.has(pathB[i])) continue;
    ia = pathA.indexOf(pathB[i]);
    ib = i;
    break;
  }
  return [...pathA.slice(0, ia + 1), ...pathB.slice(0, ib).reverse()];
}

export function buildAdj(nodes: any[], edgeMap: Map<string, any>) {
  const adj = new Map();
  for (const node of nodes) adj.set(node.id, []);
  for (const [, edge] of edgeMap) {
    adj.get(edge.an.id).push(edge.bn);
    adj.get(edge.bn.id).push(edge.an);
  }
  return adj;
}

export function findShortestPath(from: any, to: any, adj: Map<number, any[]>) {
  if (from === to) return [from];
  const visited = new Set([from.id]);
  const prev = new Map([[from.id, null]]);
  const queue = [from];
  while (queue.length) {
    const curr = queue.shift();
    if (curr === to) {
      const path = [];
      let node = to;
      while (node !== null) {
        path.unshift(node);
        node = prev.get(node.id);
      }
      return path;
    }
    for (const nb of (adj.get(curr.id) || [])) {
      if (visited.has(nb.id)) continue;
      visited.add(nb.id);
      prev.set(nb.id, curr);
      queue.push(nb);
    }
  }
  return findTreePath(from, to);
}

export const STYLE = {
  core: { color: 0x3B8BD4, em: 0x0d2d55, emI: 1.4, geo: () => new THREE.TorusGeometry(4, 1.1, 12, 26), halo: 10, hOp: .06, rx: .18, rz: .10 },
  dist: { color: 0x1D9E75, em: 0x073d2c, emI: 1.3, geo: () => new THREE.TorusGeometry(2.6, .72, 10, 20), halo: 6.5, hOp: .05, rx: .22, rz: .14 },
  acc: { color: 0xBA7517, em: 0x4a2c06, emI: 1.1, geo: () => new THREE.BoxGeometry(4.8, .85, 2.6), halo: 5, hOp: .04 },
  term: { color: 0xb4c8de, em: 0x2a3c50, emI: 1.2, geo: () => new THREE.ConeGeometry(1.0, 2.5, 6), halo: 3.2, hOp: .04, ry: .28 },
  server: { color: 0xFFD060, em: 0x7a4a00, emI: 1.8, geo: () => new THREE.CylinderGeometry(1.9, 2.3, 5.5, 10), halo: 9, hOp: .07, ry: .12 },
};
