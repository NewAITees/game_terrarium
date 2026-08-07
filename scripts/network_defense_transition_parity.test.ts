import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTopology, edgeKey } from '../shared/network-core';
import { createAgent, createPacket, updateAgents } from '../apps/network-defense/network_defense_agents';
import { removePacket, updateNodes, updatePackets } from '../apps/network-defense/network_defense_combat';
import { deployFirewall, firewallKey, updateFirewalls } from '../apps/network-defense/network_defense_firewalls';
import { buildNetworkDefenseLogicalEdges } from '../apps/network-defense/network_defense_logical_edges';
import { initializeNetworkDefenseSimulationState } from '../apps/network-defense/network_defense_simulation_setup';
import {
  nullNetworkDefenseVisualAdapter,
  type NetworkDefenseVisualAdapter,
} from '../apps/network-defense/network_defense_visual_adapter';

function recordingVisualAdapter(): NetworkDefenseVisualAdapter {
  return {
    createPacket: (color, radius) => ({ kind: 'packet', color, radius, position: null }),
    createAgent: (rank, position) => ({ kind: 'agent', rank, position: { ...position }, rotations: 0 }),
    move: (handle, position) => {
      if (handle) handle.position = { x: position.x, y: position.y, z: position.z };
    },
    rotateAgent: (handle) => { if (handle) handle.rotations += 1; },
    destroyPacket: (handle) => { if (handle) handle.destroyed = true; },
    createFirewall: () => ({ kind: 'firewall', updates: 0 }),
    updateFirewall: (handle) => { if (handle) handle.updates += 1; },
    destroyFirewall: (handle) => { if (handle) handle.destroyed = true; },
    updateNode: (node) => { node.visualUpdates = (node.visualUpdates ?? 0) + 1; },
  };
}

function createFixture(visuals: NetworkDefenseVisualAdapter) {
  const topo = buildTopology(30, 7357, 'smallworld', 28);
  const { edgeMap, allEdges } = buildNetworkDefenseLogicalEdges(topo);
  const simulation = initializeNetworkDefenseSimulationState({
    topo,
    edgeMap,
    allEdges,
    seed: 7357,
    observerMode: false,
  });
  return { ...simulation, visuals };
}

function advanceFixture(fixture: ReturnType<typeof createFixture>) {
  const { allEdges, edgeMap, firewalls, game, topo, visuals } = fixture;
  const edge = allEdges[0];
  const packet = {
    mesh: createPacket({ visuals }, 0xff0000, 0.5),
    path: [edge.an, edge.bn],
    seg: 0,
    t: 0.2,
    speed: 0.4,
  };
  const packets = [packet];
  const remove = (list: any[], index: number) => removePacket({ visuals }, list, index);
  updatePackets({
    edgeMap,
    edgeKey,
    edgeTravelFactor: () => 1,
    game,
    firewalls,
    firewallKey: (candidate: any) => firewallKey(candidate, edgeKey),
    triggerFlash: () => {},
    normalPool: [],
    enemyPackets: [],
    removePacket: remove,
    visuals,
  }, packets, 0.25, () => {});

  topo.nodes[1].infection = 0.4;
  topo.nodes[1].hp = 70;
  updateNodes({ topo, adj: fixture.adj, visuals }, 0.25, 4);

  deployFirewall({ edge, now: 4, firewalls, visuals, edgeKey });
  updateFirewalls({ firewalls, visuals, now: 4.25 });

  const agent: any = createAgent({ visuals, topo, agents: [] }, 'junior', 0);
  agent.state = 'moving';
  agent.path = [edge.an, edge.bn];
  agent.target = edge.bn;
  agent.moveSpeed = 0.4;
  updateAgents({
    agents: [agent],
    edgeMap,
    game,
    topo,
    edgeKey,
    edgeTravelFactor: () => 1,
    assignAgent: () => {},
    applyAgentArrival: () => {},
    idleAtSpot: () => {},
    teleportHome: () => {},
    visuals,
  }, 0.25, 4.25);

  return {
    packet: { seg: packet.seg, t: packet.t },
    node: { hp: topo.nodes[1].hp, infection: topo.nodes[1].infection },
    firewall: [...firewalls.values()].map((item) => ({ edge: edgeKey(item.edge.an.id, item.edge.bn.id), until: item.until })),
    agent: { state: agent.state, seg: agent.seg, t: agent.t, currentNode: agent.currentNode.id, target: agent.target.id },
    game: { score: game.score, kills: game.kills, credits: game.credits },
  };
}

test('visual and headless adapters produce identical fixed-seed transitions', () => {
  const visualState = advanceFixture(createFixture(recordingVisualAdapter()));
  const headlessState = advanceFixture(createFixture(nullNetworkDefenseVisualAdapter));
  assert.deepEqual(headlessState, visualState);
});
