import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTopology } from '../shared/network-core';
import { buildNetworkDefenseLogicalEdges } from '../apps/network-defense/network_defense_logical_edges';
import { initializeNetworkDefenseSimulationState } from '../apps/network-defense/network_defense_simulation_setup';

test('builds render-free edges with matching endpoints and initialized speeds', () => {
  const topo = buildTopology(30, 42, 'smallworld', 28);
  const { edgeMap, allEdges } = buildNetworkDefenseLogicalEdges(topo);
  const expectedEdges = topo.treeEdges.length + topo.shortcutEdges.length;

  assert.equal(allEdges.length, expectedEdges);
  assert.equal(edgeMap.size, expectedEdges);
  for (const edge of allEdges) {
    const start = edge.curve.getPoint(0);
    const end = edge.curve.getPoint(1);
    assert.deepEqual([start.x, start.y, start.z], [edge.an.x, edge.an.y, edge.an.z]);
    assert.deepEqual([end.x, end.y, end.z], [edge.bn.x, edge.bn.y, edge.bn.z]);
  }

  const setup = initializeNetworkDefenseSimulationState({
    topo,
    edgeMap,
    allEdges,
    seed: 42,
    observerMode: false,
  });
  assert.equal(setup.game.wave, 1);
  assert.ok(allEdges.every((edge) => edge.length > 0));
  assert.ok(allEdges.every((edge) => edge.speedFactor > 0));
  assert.ok(topo.nodes.every((node: any) => node.mesh === undefined));
});
