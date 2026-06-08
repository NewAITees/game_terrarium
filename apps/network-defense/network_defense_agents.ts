import { Mesh,MeshBasicMaterial,OctahedronGeometry,SphereGeometry,Vector3, } from 'three';
import { edgeKey } from './network-core.js';
import { AGENT_COSTS, AGENT_RANKS, RANK_PROFILE, actionStats } from './network_defense_config.js';

export function safeRoute(context: any, from: any, to: any) {
  const { adj, isFriendlyPassable } = context;
  if (from === to) return [from];
  const visited = new Set([from.id]);
  const prev = new Map([[from.id, null]]);
  const queue = [from];

  while (queue.length) {
    const current = queue.shift();
    if (current === to) {
      const path = [];
      let node = to;
      while (node !== null) {
        path.unshift(node);
        node = prev.get(node.id);
      }
      return path;
    }

    for (const neighbor of adj.get(current.id) || []) {
      if (visited.has(neighbor.id) || !isFriendlyPassable(neighbor, to)) continue;
      visited.add(neighbor.id);
      prev.set(neighbor.id, current);
      queue.push(neighbor);
    }
  }
  return [];
}

export function safeStagingNode(context: any, target: any, from = context.topo.server) {
  const { adj } = context;
  const candidates = (adj.get(target.id) || [])
    .filter((node: any) => node.infection < 0.35 && !node.isServer)
    .map((node: any) => ({ node, path: safeRoute(context, from, node) }))
    .filter((item: any) => item.path.length > 1)
    .sort((a: any, b: any) => a.node.infection - b.node.infection || b.node.degree - a.node.degree);
  return candidates[0] || null;
}

export function createPacket(context: any, color: number, radius: number) {
  const mesh = new Mesh(
    new SphereGeometry(radius, 9, 9),
    new MeshBasicMaterial({ color })
  );
  context.scene.add(mesh);
  return mesh;
}

export function agentHomePosition(context: any, index = 1) {
  const { topo } = context;
  return new Vector3(topo.server.x + index * 2.6 - 2.6, topo.server.y + 8, topo.server.z);
}

export function createAgent(context: any, rank: any, index = context.agents.length) {
  const spec = AGENT_RANKS[rank];
  const mesh = new Mesh(
    new OctahedronGeometry(spec.size, 0),
    new MeshBasicMaterial({ color: spec.color })
  );
  mesh.position.copy(agentHomePosition(context, index));
  context.scene.add(mesh);
  return {
    mesh,
    index,
    rank,
    state: 'idle',
    cooldown: index * 0.45,
    path: [],
    seg: 0,
    t: 0,
    target: null,
    arrivalAction: 'repair',
    currentNode: context.topo.server,
  };
}

export function sendAgent(context: any, agent: any, target: any, blockedTarget = null) {
  let from = agent.currentNode ?? context.topo.server;
  let path = safeRoute(context, from, target);
  let actionTarget = target;
  if (path.length < 2) {
    const staging = safeStagingNode(context, target, from);
    if (!staging) return false;
    path = staging.path;
    actionTarget = staging.node;
  }
  if (path.length < 2) return false;
  const stats = actionStats(agent.rank, agent.actionKey ?? 'patrol');
  if (stats.cost > 0 && context.game.credits < stats.cost) return false;
  agent.moveSpeed = RANK_PROFILE[agent.rank].moveSpeed;
  agent.workDur = stats.dur;
  agent.workCost = stats.cost;
  agent.effectMult = stats.eff;
  agent.state = 'moving';
  agent.path = path;
  agent.seg = 0;
  agent.t = 0;
  agent.target = actionTarget;
  agent.blockedTarget = blockedTarget || (actionTarget === target ? null : target);
  return true;
}

export function patrolTarget(context: any) {
  const { topo, rng } = context;
  const candidates = topo.nodes
    .filter((node: any) => !node.isServer && node.infection < 0.25)
    .map((node: any) => ({ node, path: safeRoute(context, topo.server, node) }))
    .filter((item: any) => item.path.length > 1)
    .sort((a: any, b: any) => b.node.degree - a.node.degree || b.path.length - a.path.length);
  if (!candidates.length) return null;
  const top = candidates.slice(0, Math.min(8, candidates.length));
  return rng.pick(top).node;
}

export function idleAtSpot(context: any, agent: any) {
  agent.state = 'idle';
  agent.cooldown = 0.3 + context.rng.next() * 0.4;
  agent.path = [];
  agent.seg = 0;
  agent.t = 0;
  agent.target = null;
  agent.blockedTarget = null;
  agent.arrivalAction = 'repair';
}

export function teleportHome(context: any, agent: any) {
  agent.mesh.position.copy(agentHomePosition(context, agent.index));
  agent.currentNode = context.topo.server;
  agent.state = 'idle';
  agent.cooldown = 0.5 + context.rng.next() * 0.3;
  agent.path = [];
  agent.seg = 0;
  agent.t = 0;
  agent.target = null;
  agent.blockedTarget = null;
  agent.arrivalAction = 'repair';
}

export function buyAgent(context: any, rank: any) {
  const cost = AGENT_COSTS[rank];
  if (context.game.credits < cost) {
    context.setMessage(`Not enough credits for ${rank} agent. Need ${cost}cr.`, true);
    return;
  }
  context.game.credits -= cost;
  const agent = context.observerMode && context.rankPersonalities
    ? context.applyPersonalityToAgent(createAgent(context, rank, context.agents.length), context.rankPersonalities)
    : createAgent(context, rank, context.agents.length);
  context.agents.push(agent);
  context.setMessage(`${rank.toUpperCase()} agent deployed.`);
  context.logEvent(`Player: bought ${rank} agent (−${cost}cr)`, 'player');
}

export function updateAgents(context: any, dt: number, now: number) {
  const {
    agents,
    edgeMap,
    edgeTravelFactor,
    game,
    edgeKey: edgeKeyFn,
    assignAgent,
    applyAgentArrival,
    idleAtSpot: idleAtSpotFn,
    teleportHome: teleportHomeFn,
  } = context;
  for (const agent of agents) {
    agent.cooldown -= dt;
    agent.mesh.rotation.y += dt * 2.4;
    agent.mesh.rotation.z += dt * 1.7;

    if (agent.state === 'idle') {
      if (agent.cooldown <= 0) assignAgent(agent);
      continue;
    }

    if (agent.state === 'working') {
      agent.workTimer -= dt;
      agent.mesh.rotation.y += dt * 4.8;
      agent.mesh.rotation.z += dt * 3.5;
      if (agent.workTimer <= 0) {
        applyAgentArrival(agent, null, now);
        idleAtSpotFn(agent);
      }
      continue;
    }

    const from = agent.path[agent.seg];
    const to = agent.path[agent.seg + 1];
    if (!from || !to) { teleportHomeFn(agent); continue; }

    const edge = edgeMap.get(edgeKeyFn(from.id, to.id));
    if (!edge) { teleportHomeFn(agent); continue; }

    agent.t += dt * (agent.moveSpeed ?? 0.62) * edgeTravelFactor(edge);
    if (agent.t >= 1) {
      agent.t = 0;
      agent.seg++;
      if (agent.seg >= agent.path.length - 1) {
        agent.currentNode = agent.target;
        if ((agent.workCost ?? 0) > 0) {
          if (game.credits < agent.workCost) { idleAtSpotFn(agent); continue; }
          game.credits -= agent.workCost;
        }
        if ((agent.workDur ?? 0) > 0) {
          agent.state = 'working';
          agent.workTimer = agent.workDur;
        } else {
          applyAgentArrival(agent, edge, now);
          idleAtSpotFn(agent);
        }
        continue;
      }
    }

    agent.mesh.position.copy(edge.curve.getPoint(edge.an === from ? agent.t : 1 - agent.t));
    edge.activeUntil = Math.max(edge.activeUntil, now + 0.5);
  }
}
