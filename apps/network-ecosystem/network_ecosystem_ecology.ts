import * as THREE from 'three';
import { edgeKey } from './network-core.js';
import type { EcosystemRuntimeContext } from '../../shared/types/network_ecosystem.js';

export function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function averageNeighbors(node: any, adj: Map<number, any[]>, key: 'resource' | 'threat' | 'immune' | 'carnivore'): number {
  const neighbors = adj.get(node.id) || [];
  if (!neighbors.length) return 0;
  return neighbors.reduce((sum, neighbor) => sum + neighbor[key], 0) / neighbors.length;
}

export function seedCarnivore(context: EcosystemRuntimeContext, force = false): boolean {
  const { topo, adj, rng } = context;
  const candidates = topo.nodes
    .filter((node: any) => node.resource > 0.45 && (node.threat > 0.18 || averageNeighbors(node, adj, 'threat') > 0.16))
    .sort((a: any, b: any) => (
      b.resource + averageNeighbors(b, adj, 'threat') + b.threat * 0.55 - b.carnivore * 0.8
    ) - (
      a.resource + averageNeighbors(a, adj, 'threat') + a.threat * 0.55 - a.carnivore * 0.8
    ));
  if (!candidates.length) return false;
  const node = rng.pick(candidates.slice(0, Math.min(6, candidates.length)));
  node.carnivore = clamp(node.carnivore + (force ? 0.12 : 0.05 + rng.next() * 0.07));
  node.resource = clamp(node.resource - 0.06);
  return true;
}

export function seedThreat(context: EcosystemRuntimeContext): void {
  const { topo, adj, rng } = context;
  const candidates = topo.nodes
    .filter((node: any) => node.resource > 0.5 && node.threat < 0.35)
    .sort((a: any, b: any) => (
      b.resource - b.threat * 0.5 + b.carnivore * 0.28 - averageNeighbors(b, adj, 'threat') * 0.25
    ) - (
      a.resource - a.threat * 0.5 + a.carnivore * 0.28 - averageNeighbors(a, adj, 'threat') * 0.25
    ));
  const node = candidates.length ? rng.pick(candidates.slice(0, Math.min(8, candidates.length))) : rng.pick(topo.nodes);
  node.threat = clamp(node.threat + 0.12 + rng.next() * 0.1);
  node.resource = clamp(node.resource - 0.04);
}

export function primeInitialEcology(context: EcosystemRuntimeContext): void {
  const { topo } = context;
  const avgThreat = topo.nodes.reduce((sum: number, node: any) => sum + node.threat, 0) / topo.nodes.length;
  const avgCarnivore = topo.nodes.reduce((sum: number, node: any) => sum + node.carnivore, 0) / topo.nodes.length;
  if (avgThreat < 0.06) {
    seedThreat(context);
    seedThreat(context);
    seedThreat(context);
  }
  if (avgCarnivore < 0.02) {
    seedCarnivore(context, true);
    seedCarnivore(context, true);
    seedCarnivore(context, true);
  }
}

export function updateEcology(context: EcosystemRuntimeContext, dt: number): void {
  const { topo, adj } = context;
  const next = new Map();
  for (const node of topo.nodes) {
    const neighborThreat = averageNeighbors(node, adj, 'threat');
    const neighborImmune = averageNeighbors(node, adj, 'immune');
    const neighborResource = averageNeighbors(node, adj, 'resource');
    const neighborCarnivore = averageNeighbors(node, adj, 'carnivore');
    const crowding = Math.max(0, node.threat + node.immune + node.carnivore - 1.05);
    const threatBirth = (0.07 + neighborThreat * 0.38 + node.carnivore * 0.12) * (0.45 + node.resource * 0.35);
    const immuneBirth = (node.threat * 0.4 + neighborThreat * neighborImmune * 0.22) * (0.45 + node.resource);
    const immuneDecay = node.immune * (0.1 + Math.max(0, 0.22 - node.threat - neighborThreat) * 0.34);
    const immuneSuppression = node.immune * (0.42 + neighborImmune * 0.16);
    const preyPressure = node.threat + neighborThreat * 0.65;
    const carnivoreBirth = preyPressure * (0.08 + node.carnivore * 0.12 + neighborCarnivore * 0.22) * node.resource;
    const starvation = node.carnivore * (0.025 + Math.max(0, 0.16 - preyPressure) * 0.08 + Math.max(0, node.carnivore - 0.28) * 0.9);
    const predation = node.carnivore * (0.06 + neighborCarnivore * 0.03);
    const resourceRecovery = 0.14 + neighborResource * 0.08;

    next.set(node, {
      threat: clamp(node.threat + dt * (threatBirth - immuneSuppression - predation - 0.012 - crowding * 0.18)),
      immune: clamp(node.immune + dt * (immuneBirth - immuneDecay - crowding * 0.12)),
      carnivore: clamp(node.carnivore + dt * (carnivoreBirth - starvation - crowding * 0.16)),
      resource: clamp(node.resource + dt * (resourceRecovery - node.threat * 0.3 - node.immune * 0.08 - node.carnivore * 0.12)),
    });
  }

  for (const [node, state] of next) {
    node.threat = state.threat;
    node.immune = state.immune;
    node.carnivore = state.carnivore;
    node.resource = state.resource;
  }
}

export function spawnPulse(context: EcosystemRuntimeContext): void {
  const { topo, adj, rng, edgeMap, scene, pulses } = context;
  const active = topo.nodes.filter((node: any) => node.threat > 0.05 || node.immune > 0.1 || node.carnivore > 0.05);
  if (!active.length || pulses.length > 48) return;
  const source = rng.pick(active);
  const neighbors = adj.get(source.id) || [];
  if (!neighbors.length) return;
  const target = rng.pick(neighbors);
  const pulseType = source.carnivore > source.threat && source.carnivore > source.immune ? 'carnivore' : source.threat > source.immune ? 'threat' : 'immune';
  const edge = edgeMap.get(edgeKey(source.id, target.id));
  if (!edge) return;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(pulseType === 'threat' ? 0.48 : pulseType === 'carnivore' ? 0.54 : 0.42, 8, 8),
    new THREE.MeshBasicMaterial({ color: pulseType === 'threat' ? 0xff684d : pulseType === 'carnivore' ? 0xffd35a : 0x77eaff }),
  );
  scene.add(mesh);
  pulses.push({ mesh, edge, from: source, t: 0, speed: 0.45 + rng.next() * 0.35, pulseType });
}

export function updatePulses(context: EcosystemRuntimeContext, dt: number, now: number): void {
  const { game, pulses, scene, rng } = context;
  game.nextPulse -= dt;
  if (game.nextPulse <= 0) {
    spawnPulse(context);
    game.nextPulse = 0.045 + rng.next() * 0.075;
  }

  for (let index = pulses.length - 1; index >= 0; index--) {
    const pulse = pulses[index];
    pulse.t += dt * pulse.speed;
    if (pulse.t >= 1) {
      scene.remove(pulse.mesh);
      pulse.mesh.geometry.dispose();
      pulse.mesh.material.dispose();
      pulses.splice(index, 1);
      continue;
    }
    pulse.mesh.position.copy(pulse.edge.curve.getPoint(pulse.edge.an === pulse.from ? pulse.t : 1 - pulse.t));
    pulse.edge.activeUntil = Math.max(pulse.edge.activeUntil, now + 0.25);
  }
}

export function updateCarnivoreSpawns(context: EcosystemRuntimeContext, dt: number): void {
  const { topo, adj, game, rng } = context;
  game.nextCarnivore -= dt;
  if (game.nextCarnivore > 0) return;

  const totalCarnivore = topo.nodes.reduce((sum: number, node: any) => sum + node.carnivore, 0);
  const totalThreat = topo.nodes.reduce((sum: number, node: any) => sum + node.threat, 0);
  const maxThreat = topo.nodes.reduce((max: number, node: any) => Math.max(max, node.threat, averageNeighbors(node, adj, 'threat')), 0);
  const avgCarnivore = totalCarnivore / topo.nodes.length;
  const avgThreat = totalThreat / topo.nodes.length;
  const force = avgCarnivore < 0.05 && maxThreat > 0.16;
  const spawned = (maxThreat > 0.08 || avgThreat > 0.06) && avgCarnivore < 0.24 ? seedCarnivore(context, force) : false;
  game.nextCarnivore = spawned ? 1.6 + rng.next() * 1.8 : 0.9 + rng.next() * 1.2;
}

export function updateStressSpawns(context: EcosystemRuntimeContext, dt: number): void {
  const { topo, game, rng } = context;
  game.nextStress -= dt;
  if (game.nextStress > 0) return;

  const totals = topo.nodes.reduce((acc: { threat: number; carnivore: number }, node: any) => {
    acc.threat += node.threat;
    acc.carnivore += node.carnivore;
    return acc;
  }, { threat: 0, carnivore: 0 });
  const avgThreat = totals.threat / topo.nodes.length;
  const avgCarnivore = totals.carnivore / topo.nodes.length;
  if (avgThreat < 0.22 && avgCarnivore < 0.48) {
    seedThreat(context);
    if (avgThreat < 0.12) seedThreat(context);
  }
  game.nextStress = 2.2 + rng.next() * 2.8;
}
