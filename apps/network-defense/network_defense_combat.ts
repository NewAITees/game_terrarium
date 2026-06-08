import { Color, } from 'three';

export function spawnEnemy(context: any) {
  const { game, topo, rng, enemyFrontierTarget, enemyPackets, route, createPacket, adj } = context;
  if (game.gameOver || game.waveRemaining <= 0) return;
  game.waveSpawned++;
  const target = enemyFrontierTarget();
  const infected = topo.nodes.filter((node: any) => node.infection > 0.18);
  const adjacentInfected = infected.filter((node: any) => (adj.get(node.id) || []).includes(target));
  const source = adjacentInfected.length ? rng.pick(adjacentInfected) : context.perimeterNode();
  const waveBoost = Math.min(2.4, 1 + game.wave * 0.09);
  enemyPackets.push({
    mesh: createPacket(0xff3e2f, 0.55),
    path: route(source, target),
    seg: 0,
    t: 0,
    speed: 0.18 + rng.next() * 0.12 + game.wave * 0.006,
    damage: (9 + rng.next() * 8) * waveBoost,
  });
  game.waveRemaining--;
}

export function removePacket(context: any, list: any[], index: number) {
  const packet = list[index];
  context.scene.remove(packet.mesh);
  packet.mesh.geometry.dispose();
  packet.mesh.material.dispose();
  list.splice(index, 1);
}

export function spawnNormalTraffic(context: any) {
  const { topo, rng, normalPackets, route, createPacket } = context;
  const COLS = [0x38aaff, 0x44ffaa, 0xffffff, 0xFFD060, 0x88ddcc];
  const src = rng.pick(topo.nodes);
  const candidates = topo.nodes.filter((n: any) => n !== src);
  if (!candidates.length) return;
  const dst = rng.pick(candidates);
  const path = route(src, dst);
  if (path.length < 2) return;
  normalPackets.push({
    mesh: createPacket(COLS[rng.int(0, COLS.length - 1)], 0.32),
    path, seg: 0, t: rng.next(),
    speed: 0.35 + rng.next() * 0.3,
  });
}

export function spawnScanner(context: any) {
  const { game, scanPackets, topo, rng, safeRoute, createPacket } = context;
  if (game.gameOver || scanPackets.length >= 10) return;
  const dst = rng.pick(topo.nodes.filter((n: any) => !n.isServer));
  if (!dst) return;
  const path = safeRoute(topo.server, dst);
  if (path.length < 2) return;
  scanPackets.push({
    mesh: createPacket(0x33ddaa, 0.26),
    path, seg: 0,
    t: rng.next() * 0.2,
    speed: 0.20 + rng.next() * 0.10,
    scanPower: 0.014,
  });
}

export function updateScanPackets(context: any, dt: number) {
  const { scanPackets, enemyPackets, game, edgeMap, edgeKey, edgeTravelFactor, triggerFlash, normalPool, removePacket } = context;
  for (let i = scanPackets.length - 1; i >= 0; i--) {
    const packet = scanPackets[i];
    if (packet.seg >= packet.path.length - 1) {
      const dest = packet.path[packet.path.length - 1];
      if (dest) {
        dest.infection = Math.max(0, dest.infection - 0.03);
        dest.hp = Math.min(dest.maxHp, dest.hp + 4);
      }
      removePacket(scanPackets, i);
      continue;
    }

    const from = packet.path[packet.seg];
    const to = packet.path[packet.seg + 1];
    if (!from || from.infection > 0.85) { removePacket(scanPackets, i); continue; }
    if (from.infection > 0) {
      from.infection = Math.max(0, from.infection - dt * packet.scanPower);
    }

    const edge = edgeMap.get(edgeKey(from.id, to.id));
    if (!edge) { removePacket(scanPackets, i); continue; }

    for (let j = enemyPackets.length - 1; j >= 0; j--) {
      const enemy = enemyPackets[j];
      if (enemy.seg >= enemy.path.length - 1) continue;
      const ef = enemy.path[enemy.seg];
      const et = enemy.path[enemy.seg + 1];
      if (ef && et && edgeKey(ef.id, et.id) === edgeKey(from.id, to.id) && Math.random() < dt * 0.08) {
        game.kills++;
        game.score += 8 + game.wave * 2;
        game.credits = Math.min(999, game.credits + 6);
        triggerFlash(normalPool, from);
        removePacket(enemyPackets, j);
      }
    }

    packet.t += dt * packet.speed * edgeTravelFactor(edge);
    if (packet.t >= 1) { packet.t = 0; packet.seg++; }
    packet.mesh.position.copy(edge.curve.getPoint(edge.an === from ? packet.t : 1 - packet.t));
    edge.activeUntil = Math.max(edge.activeUntil, performance.now() / 1000 + 0.2);
  }
}

export function applyAttack(context: any, node: any, damage: number, now: number) {
  const { game, triggerFlash, attackPool, showEndOverlay, logEvent, setMessage } = context;
  if (!node || game.gameOver || node.rebootUntil > now) return;
  const serverBuffer = node.isServer ? 0.48 : 1;
  const shield = (node.hardenUntil > now ? 0.35 : 1) * serverBuffer;
  node.hp = Math.max(0, node.hp - damage * shield);
  node.infection = Math.min(1, node.infection + (damage / node.maxHp) * shield);
  node.targetedUntil = now + 0.8;
  triggerFlash(attackPool, node);
  if (node.isServer && node.hp <= 0) {
    showEndOverlay(false);
    logEvent('SERVER DOWN — game over', 'combat');
    setMessage('SERVER DOWN. Defense model halted.', true);
  } else if (node.isServer) {
    logEvent(`Enemy hit server  HP: ${Math.max(0, Math.round(node.hp))}/${node.maxHp}`, 'combat');
  }
}

export function applyDefense(context: any, node: any, repair: number) {
  const { game } = context;
  if (!node || node.isServer) return;
  node.hp = Math.min(node.maxHp, node.hp + repair * 0.3);
  const before = node.infection;
  node.infection = Math.max(0, node.infection - repair / 100);
  if (before > 0.08 && node.infection <= 0.08) {
    game.kills++;
    game.score += 35 + game.wave * 4;
    game.credits = Math.min(999, game.credits + 15);
  }
}

export function updatePackets(context: any, list: any[], dt: number, onArrive: (node: any, packet: any) => void) {
  const { edgeMap, edgeKey, edgeTravelFactor, game, firewalls, firewallKey, triggerFlash, normalPool, enemyPackets, removePacket } = context;
  for (let index = list.length - 1; index >= 0; index--) {
    const packet = list[index];
    if (packet.seg >= packet.path.length - 1) {
      onArrive(packet.path[packet.path.length - 1], packet);
      removePacket(list, index);
      continue;
    }
    const from = packet.path[packet.seg];
    const to = packet.path[packet.seg + 1];
    const edge = edgeMap.get(edgeKey(from.id, to.id));
    if (!edge) {
      removePacket(list, index);
      continue;
    }
    packet.t += dt * packet.speed * edgeTravelFactor(edge);
    if (packet.t >= 1) {
      packet.t = 0;
      packet.seg++;
    }
    if (list === enemyPackets && firewalls.has(firewallKey(edge))) {
      game.kills++;
      game.score += 20 + game.wave * 3;
      game.credits = Math.min(999, game.credits + 10);
      triggerFlash(normalPool, from);
      removePacket(list, index);
      continue;
    }
    packet.mesh.position.copy(edge.curve.getPoint(edge.an === from ? packet.t : 1 - packet.t));
    edge.activeUntil = Math.max(edge.activeUntil, performance.now() / 1000 + 0.35);
  }
}

export function setNodeColor(node: any, now: number) {
  const style = node.baseStyle;
  const base = new Color(style.color);
  const color = base.lerp(new Color(0xff2e24), node.infection);
  if (node.hardenUntil > now) color.lerp(new Color(0x80e8ff), 0.55);
  if (node.rebootUntil > now) color.set(0x566472);
  node.material.color.copy(color);
  node.material.emissive.copy(color).multiplyScalar(node.isServer ? 0.55 : 0.35);
  node.material.emissiveIntensity = node.targetedUntil > now ? 2.2 : style.emI;
  if (node.halo?.material) {
    node.halo.material.color.copy(color);
    node.halo.material.opacity = node.hardenUntil > now ? 0.13 : style.hOp + node.infection * 0.13;
  }
}

export function updateNodes(context: any, dt: number, now: number) {
  const { topo, adj, setNodeColor } = context;
  for (const node of topo.nodes) {
    if (node.rebootUntil > now) {
      node.infection = Math.max(0, node.infection - dt * 0.75);
      node.hp = Math.min(node.maxHp, node.hp + dt * 15);
    } else if (node.infection > 0.02 && !node.isServer) {
      node.infection = Math.min(1, node.infection + dt * 0.018);
      node.hp = Math.max(0, node.hp - dt * node.infection * 1.2);
    }
    if (!node.isServer && node.hp <= 0) node.infection = 1;
    setNodeColor(node, now);
  }

  for (const node of topo.nodes) {
    if (node.infection < 0.35 || node.rebootUntil > now) continue;
    for (const neighbor of adj.get(node.id) || []) {
      if (neighbor.isServer) continue;
      if (neighbor.hardenUntil > now || neighbor.rebootUntil > now) continue;
      neighbor.infection = Math.min(1, neighbor.infection + dt * node.infection * 0.018);
    }
  }
}

export function applyAgentArrival(context: any, agent: any, lastEdge: any, now: number) {
  const { game, edgeMap, edgeKey, deployFirewall, defensePackets, createPacket } = context;
  const target = agent.target;
  const eff = agent.effectMult ?? 1.0;
  switch (agent.arrivalAction) {
    case 'harden':
      target.hardenUntil = now + 8 + eff * 2;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(18 * eff));
      game.score += Math.round(6 * eff);
      break;
    case 'reboot':
      target.rebootUntil = now + 4.5 + eff * 1.5;
      target.infection = Math.max(0, target.infection - 0.55 * eff);
      game.score += Math.round(10 * eff);
      break;
    case 'rebootNeighbor': {
      const nb = agent._rebootTarget;
      if (nb) {
        nb.rebootUntil = now + 4.5 + eff * 1.5;
        nb.infection = Math.max(0, nb.infection - 0.55 * eff);
        game.score += Math.round(12 * eff);
        game.credits = Math.min(999, game.credits + 8);
      }
      agent._rebootTarget = null;
      break;
    }
    case 'repair':
    default: {
      const frontierEdge = agent.blockedTarget ? edgeMap.get(edgeKey(target.id, agent.blockedTarget.id)) : lastEdge;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(20 * eff));
      target.infection = Math.max(0, target.infection - (agent.blockedTarget ? 0.08 : 0.28) * eff);
      if (agent.blockedTarget || target.infection > 0.04) deployFirewall(frontierEdge, now);
      defensePackets.push({
        mesh: createPacket(0xa8f4ff, 0.38),
        path: agent.path,
        seg: 0, t: 0, speed: 0.68, repair: Math.round(18 * eff),
      });
      game.score += Math.round((agent.blockedTarget ? 12 : 8) * eff);
      break;
    }
  }
}
