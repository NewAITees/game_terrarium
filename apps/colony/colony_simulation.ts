import type {
  ColonyAction,
  ColonyFaction,
  ColonyNode,
  ColonyPersonality,
  ColonyRule,
} from '../../shared/types/colony.js';

const SNAP_KEYS = [
  'territoryCount',
  'food',
  'material',
  'neutralNearby',
  'enemyNearby',
  'weakEnemyNearby',
  'richNeutralNearby',
  'weakOwnedNode',
  'baseStrength',
];

export function createColonySimulation(context: {
  cost: Record<ColonyAction, number>;
  decayByPersonality: Record<ColonyPersonality, number>;
  factions: ColonyFaction[];
  factionRules: Record<number, ColonyRule[]>;
  foodCap: number;
  map: { nodes: ColonyNode[] };
  neutralResist: number;
  logEvent: (text: string, type?: string) => void;
  performanceNow: () => number;
  spawnPulse: (fromNode: ColonyNode, toNode: ColonyNode, factionId: number) => void;
}) {
  function buildSnap(faction: ColonyFaction) {
    const owned = context.map.nodes.filter((node) => node.owner === faction.id);
    const borders = owned.flatMap((node) => node.neighbors).filter((node) => node.owner !== faction.id);
    return {
      territoryCount: owned.length,
      food: faction.food,
      material: faction.material,
      neutralNearby: borders.some((node) => node.owner === -1),
      enemyNearby: borders.some((node) => node.owner >= 0 && node.owner !== faction.id),
      weakEnemyNearby: borders.some((node) => node.owner >= 0 && node.owner !== faction.id && node.strength < 0.45),
      richNeutralNearby: borders.some((node) => node.owner === -1 && node.food > 22),
      weakOwnedNode: owned.some((node) => !node.isBase && node.strength < 0.55),
      baseStrength: faction.baseNode?.strength ?? 1,
    };
  }

  function evalCond(when: string | undefined, snap: Record<string, any>) {
    if (!when) return true;
    try {
      return !!new Function(...SNAP_KEYS, `return !!(${when});`)(...SNAP_KEYS.map((key) => snap[key]));
    } catch {
      return false;
    }
  }

  function largestCluster(factionId: number): ColonyNode[] {
    const owned = context.map.nodes.filter((node) => node.owner === factionId);
    if (!owned.length) return [];
    const visited = new Set();
    let largest: ColonyNode[] = [];
    for (const start of owned) {
      if (visited.has(start.id)) continue;
      const cluster: ColonyNode[] = [];
      const queue = [start];
      visited.add(start.id);
      while (queue.length) {
        const current = queue.shift() as ColonyNode;
        cluster.push(current);
        for (const neighbor of current.neighbors) {
          if (!visited.has(neighbor.id) && neighbor.owner === factionId) {
            visited.add(neighbor.id);
            queue.push(neighbor);
          }
        }
      }
      if (cluster.length > largest.length) largest = cluster;
    }
    return largest;
  }

  function dominanceMult(faction: ColonyFaction) {
    const pct = context.map.nodes.filter((node) => node.owner === faction.id).length / context.map.nodes.length;
    if (pct > 0.55) return 0.55;
    if (pct > 0.42) return 0.78;
    return 1.0;
  }

  function applyInfluence(faction: ColonyFaction, target: ColonyNode, power: number) {
    if (target.owner === faction.id) {
      target.strength = Math.min(1, target.strength + power);
      return;
    }
    target.strength = Math.max(0, target.strength - power);
    target.flashUntil = context.performanceNow() + 0.35;
    if (target.strength <= 0) {
      const prev = target.owner;
      const prevName = prev >= 0 ? context.factions[prev].name : 'neutral';
      if (prev >= 0) context.factions[prev].nodes = context.factions[prev].nodes.filter((node) => node.id !== target.id);
      target.owner = faction.id;
      target.strength = 0.22;
      faction.nodes.push(target);
      context.logEvent(`${faction.name} captured node ${target.id} from ${prevName}!`, 'capture');
      if (prev >= 0 && context.map.nodes.filter((node) => node.owner === prev).length === 0) {
        context.factions[prev].alive = false;
        context.logEvent(`★ ${context.factions[prev].name} ELIMINATED!`, 'eliminated');
      }
    }
  }

  function execAction(faction: ColonyFaction, action: ColonyAction) {
    if ((context.cost[action] ?? 0) > faction.food) return false;
    const owned = context.map.nodes.filter((node) => node.owner === faction.id);

    switch (action) {
      case 'expand': {
        const cluster = largestCluster(faction.id);
        const candidates = cluster.flatMap((node) => node.neighbors).filter((node) => node.owner === -1);
        if (!candidates.length) return false;
        const target = candidates.reduce((best, node) => node.food + node.material > best.food + best.material ? node : best);
        const source = cluster.find((node) => node.neighbors.includes(target)) ?? cluster[0];
        if (source) context.spawnPulse(source, target, faction.id);
        applyInfluence(faction, target, 0.32 * dominanceMult(faction));
        faction.food -= context.cost.expand;
        faction.intent = `expanding → [${target.id}]`;
        context.logEvent(`${faction.name}: expand → node ${target.id} (food+mat: ${Math.round(target.food + target.material)})`, `f${faction.id}`);
        return true;
      }
      case 'attack': {
        const cluster = largestCluster(faction.id);
        const candidates = cluster.flatMap((node) => node.neighbors).filter((node) => node.owner >= 0 && node.owner !== faction.id);
        if (!candidates.length) return false;
        const target = candidates.reduce((best, node) => node.strength < best.strength ? node : best);
        const source = cluster.find((node) => node.neighbors.includes(target)) ?? cluster[0];
        if (source) context.spawnPulse(source, target, faction.id);
        applyInfluence(faction, target, 0.33 * dominanceMult(faction));
        faction.food -= context.cost.attack;
        faction.intent = `raiding ${context.factions[target.owner]?.name} [${target.id}]`;
        context.logEvent(`${faction.name}: attack ${context.factions[target.owner]?.name} node ${target.id} (str: ${target.strength.toFixed(2)})`, `f${faction.id}`);
        return true;
      }
      case 'fortify': {
        const weak = owned.filter((node) => !node.isBase).sort((a, b) => a.strength - b.strength)[0];
        if (!weak) return false;
        weak.strength = Math.min(1, weak.strength + 0.32);
        faction.food -= context.cost.fortify;
        faction.intent = `fortifying [${weak.id}] (str: ${weak.strength.toFixed(2)})`;
        return true;
      }
      case 'gather': {
        const bonus = owned.length * 0.9;
        faction.food = Math.min(context.foodCap, faction.food + bonus);
        faction.material = Math.min(context.foodCap, faction.material + owned.length * 0.45);
        faction.intent = `gathering (${owned.length} nodes, +${bonus.toFixed(0)} food)`;
        return true;
      }
    }
    return false;
  }

  function tickFactions() {
    for (const faction of context.factions) {
      if (!faction.alive) continue;
      const snap = buildSnap(faction);
      let acted = false;
      for (const rule of context.factionRules[faction.id] ?? []) {
        if (!evalCond(rule.when, snap)) continue;
        if (execAction(faction, rule.action)) {
          acted = true;
          break;
        }
      }
      if (!acted) faction.intent = 'idle';
      const count = context.map.nodes.filter((node) => node.owner === faction.id).length;
      faction.food = Math.min(context.foodCap, faction.food + count * 0.7 + 0.4);
      faction.material = Math.min(context.foodCap, faction.material + count * 0.35 + 0.2);
    }
  }

  function decayStrength(dt: number) {
    for (const node of context.map.nodes) {
      if (node.isBase || node.owner === -1) continue;
      const personality = context.factions[node.owner]?.personality ?? 'builder';
      const rate = context.decayByPersonality[personality];
      node.strength = Math.max(0, node.strength - rate * dt);
      if (node.strength <= 0) {
        context.factions[node.owner].nodes = context.factions[node.owner].nodes.filter((owned) => owned.id !== node.id);
        node.owner = -1;
      }
    }
  }

  return {
    applyInfluence,
    buildSnap,
    decayStrength,
    dominanceMult,
    evalCond,
    execAction,
    largestCluster,
    tickFactions,
  };
}
