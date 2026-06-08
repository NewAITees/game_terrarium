import type { NetworkDefenseNode } from '../../shared/types/network_defense.js';

export function enemyFrontierTarget(context: {
  adj: Map<string, NetworkDefenseNode[]>;
  topo: { nodes: NetworkDefenseNode[] };
  perimeterNode: () => NetworkDefenseNode;
  exposedServer: () => boolean;
  now: () => number;
}): NetworkDefenseNode {
  const infected = context.topo.nodes.filter((node) => node.infection > 0.18);
  if (!infected.length) return context.perimeterNode();

  const candidates = new Set<NetworkDefenseNode>();
  for (const node of infected) {
    for (const neighbor of context.adj.get(node.id) || []) {
      if (neighbor.rebootUntil > context.now()) continue;
      if (neighbor.isServer && !context.exposedServer()) continue;
      if (neighbor.infection < 0.72) candidates.add(neighbor);
    }
  }

  if (!candidates.size) return context.perimeterNode();
  return [...candidates].sort((a, b) => {
    if (a.isServer !== b.isServer) return a.isServer ? -1 : 1;
    return a.infection - b.infection || a.hp - b.hp;
  })[0];
}

export function isFriendlyPassable(node: NetworkDefenseNode, target: NetworkDefenseNode, now: number): boolean {
  if (node === target || node.isServer) return true;
  return node.infection < 0.35 && node.rebootUntil <= now;
}

export function safeRoute(context: {
  findSafeRoute: (helpers: any, from: NetworkDefenseNode, to: NetworkDefenseNode) => NetworkDefenseNode[] | null;
  adj: Map<string, NetworkDefenseNode[]>;
}, from: NetworkDefenseNode, to: NetworkDefenseNode): NetworkDefenseNode[] | null {
  return context.findSafeRoute({
    adj: context.adj,
    isFriendlyPassable: (node: NetworkDefenseNode, target: NetworkDefenseNode) =>
      isFriendlyPassable(node, target, performance.now() / 1000),
  }, from, to);
}

export function safeStagingNode(context: {
  adj: Map<string, NetworkDefenseNode[]>;
  topo: { server: NetworkDefenseNode };
  findSafeStagingNode: (helpers: any, target: NetworkDefenseNode, from: NetworkDefenseNode) => NetworkDefenseNode | null;
}, target: NetworkDefenseNode, from = context.topo.server): NetworkDefenseNode | null {
  return context.findSafeStagingNode({
    adj: context.adj,
    topo: context.topo,
    isFriendlyPassable: (node: NetworkDefenseNode, stageTarget: NetworkDefenseNode) =>
      isFriendlyPassable(node, stageTarget, performance.now() / 1000),
  }, target, from);
}
