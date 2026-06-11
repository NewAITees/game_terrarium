/**
 * WASM bridge for network-core topology computations.
 * Call initWasm() once (e.g. at app startup) to load the WASM module.
 * After init, buildTopologyFast / findShortestPathFast replace the pure-TS versions.
 * Falls back silently to the TS implementations if WASM is unavailable.
 */

import {
  buildTopology as buildTopologyTS,
  findShortestPath as findShortestPathTS,
  buildAdj as buildAdjTS,
  edgeKey,
} from './network-core-topology.js';

interface WasmModule {
  default: () => Promise<unknown>;
  buildTopology: (total: number, seed: number, mode: string, rewirePct: number) => any;
  buildAdjFlat: (nodeCount: number, edgePairs: Uint32Array) => Uint32Array;
  findShortestPath: (from: number, to: number, adjFlat: Uint32Array, parentFlat: BigInt64Array) => Uint32Array;
}

let wasmMod: WasmModule | null = null;

export async function initWasm(): Promise<boolean> {
  if (wasmMod) return true;
  try {
    // Dynamic import from the URL where Express serves the wasm glue JS.
    // The .wasm file is fetched relative to this URL automatically by wasm-bindgen.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — served at runtime by Express, not resolvable at compile time
    const mod = await import('/_vendor/wasm/network_core_wasm.js') as WasmModule;
    await (mod as any).default();   // wasm-bindgen init()
    wasmMod = mod;
    return true;
  } catch {
    return false;
  }
}

export function isWasmReady(): boolean {
  return wasmMod !== null;
}

// ── buildTopology ─────────────────────────────────────────────────────────────
// Returns the same object shape as the TS version:
//   { nodes, treeEdges, shortcutEdges, lnodes, server }
// nodes[i].parent and nodes[i].children are object references, not IDs.

export function buildTopologyFast(
  total: number,
  seed: number,
  mode = 'tree',
  rewirePct = 0,
) {
  if (!wasmMod) {
    return buildTopologyTS(total, seed, mode, rewirePct);
  }

  const raw = wasmMod.buildTopology(total, seed, mode, rewirePct);

  // Reconstitute object graph from serialized data (O(n) in JS)
  const nodes: any[] = raw.nodes.map((n: any) => ({
    id: n.id,
    layer: n.layer,
    x: n.x,
    y: n.y,
    z: n.z,
    isServer: n.isServer,
    parent: null as any,
    children: [] as any[],
  }));

  for (const n of raw.nodes as any[]) {
    if (n.parent != null) {
      nodes[n.id].parent = nodes[n.parent];
    }
    nodes[n.id].children = n.children.map((cid: number) => nodes[cid]);
  }

  const treeEdges = raw.treeEdges.map((e: any) => ({ a: nodes[e.a], b: nodes[e.b] }));
  const shortcutEdges = raw.shortcutEdges.map((e: any) => ({ a: nodes[e.a], b: nodes[e.b] }));
  const server = nodes[raw.server];

  const lnodes: any = { core: [], dist: [], acc: [], term: [] };
  for (const n of nodes) lnodes[n.layer].push(n);

  return { nodes, treeEdges, shortcutEdges, lnodes, server };
}

// ── findShortestPath ──────────────────────────────────────────────────────────
// Same signature as the TS version: (from, to, adj) → node[]

export function findShortestPathFast(
  from: any,
  to: any,
  adj: Map<number, any[]>,
): any[] {
  if (!wasmMod) {
    return findShortestPathTS(from, to, adj);
  }

  const nodeCount = adj.size;

  // Build flat adjacency representation for WASM
  const adjFlat = wasmMod.buildAdjFlat(
    nodeCount,
    (() => {
      const pairs: number[] = [];
      const seen = new Set<string>();
      for (const [id, neighbors] of adj) {
        for (const nb of neighbors) {
          const k = edgeKey(id, nb.id);
          if (!seen.has(k)) {
            seen.add(k);
            pairs.push(id, nb.id);
          }
        }
      }
      return new Uint32Array(pairs);
    })(),
  );

  // Build parent array: parent[i] = parent id or -1
  // adj keys are node IDs; we need to find parent for each node.
  // We infer parents from the node objects in the adj map.
  const parentFlat = new BigInt64Array(nodeCount).fill(-1n);
  for (const [, neighbors] of adj) {
    for (const nb of neighbors) {
      if (nb.parent != null) {
        parentFlat[nb.id] = BigInt(nb.parent.id);
      }
    }
  }

  const pathIds = wasmMod.findShortestPath(from.id, to.id, adjFlat, parentFlat);
  if (!pathIds.length) return [from];

  // Convert IDs back to node objects via adj map
  const nodeById = new Map<number, any>();
  for (const [id, neighbors] of adj) {
    if (!nodeById.has(id)) {
      // find a node object for this id from its neighbors' parent links
      nodeById.set(id, { id });  // placeholder; replaced below
    }
    for (const nb of neighbors) {
      nodeById.set(nb.id, nb);
    }
  }
  // Patch placeholders using neighbor data
  for (const [id, node] of nodeById) {
    if (Object.keys(node).length === 1) {
      // only has 'id' — try to get a real object from neighbors
      for (const [, neighbors] of adj) {
        const real = neighbors.find((n: any) => n.id === id);
        if (real) { nodeById.set(id, real); break; }
      }
    }
  }

  return Array.from(pathIds).map((id: number) => nodeById.get(id) ?? { id });
}

// ── Re-export TS fallbacks under original names ───────────────────────────────
export { buildAdjTS as buildAdj };
