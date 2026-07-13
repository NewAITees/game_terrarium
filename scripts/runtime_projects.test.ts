import assert from 'node:assert/strict';
import test from 'node:test';
import { CityTrafficRuntime } from '../game/city_traffic_runtime';
import { MossRuntime } from '../game/moss_runtime';
import { NetworkSmallWorldRuntime } from '../game/network_smallworld_runtime';
import { SubmarineCablesRuntime } from '../game/submarine_cables_runtime';
import { SubmarineNetwork3DRuntime } from '../game/submarine_network_3d_runtime';

test('City Traffic initializes a complete, bounded traffic simulation', () => {
  const state = new CityTrafficRuntime(42).getSnapshot();
  assert.equal(state.page, 'city_traffic');
  assert.equal(state.cars.length, state.config.carCount);
  assert.equal(state.intersections.length, state.roads.length ** 2);
  assert.ok(state.cars.every((car) => car.baseSpeed >= state.config.speedMin && car.baseSpeed <= state.config.speedMax));
});

test('MOSS creates connected traffic with the requested node and packet counts', () => {
  const state = new MossRuntime({ seed: 42, nodeCount: 8, packetCount: 6 }).getSnapshot();
  assert.equal(state.page, 'moss');
  assert.equal(state.nodeCount, 8);
  assert.equal(state.packetCount, 6);
  assert.ok(state.edgeCount >= state.nodeCount - 1);
  assert.equal(Object.values(state.typeCounts).reduce((sum, count) => sum + count, 0), state.nodeCount);
  assert.ok(state.packets.every((packet) => packet.startId !== packet.endId));
});

test('Network Small World creates packets on valid topology edges', () => {
  const state = new NetworkSmallWorldRuntime({ total: 20, seed: 42, packetCount: 8 }).getSnapshot();
  const nodeIds = new Set(state.nodes.map((node) => node.id));
  assert.equal(state.page, 'network_smallworld');
  assert.equal(state.nodes.length, 20);
  assert.ok(state.treeEdgeCount >= state.nodes.length - 1);
  assert.ok(state.packets.every((packet) => nodeIds.has(packet.fromId) && nodeIds.has(packet.toId)));
});

test('Submarine Cables summarizes fetched catalog data and reuses its cache', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: string | URL) => {
    calls += 1;
    const key = String(url);
    const data = key.includes('/cable/all')
      ? [{ name: 'Aurora' }, { name: 'Beacon' }]
      : key.includes('/landing-point/')
        ? { features: [{ properties: { name: 'A, Japan' } }, { properties: { name: 'B, Japan' } }, { properties: { name: 'C, Chile' } }] }
        : { features: [{}, {}, {}] };
    return { ok: true, json: async () => data } as Response;
  }) as typeof fetch;
  try {
    const runtime = new SubmarineCablesRuntime();
    const state = await runtime.getSnapshot();
    await runtime.getSnapshot();
    assert.equal(calls, 3);
    assert.equal(state.cableCount, 2);
    assert.equal(state.countryCount, 2);
    assert.deepEqual(state.topCableNames, ['Aurora', 'Beacon']);
    assert.equal(state.topCountries[0]?.country, 'Japan');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Submarine Network 3D summarizes landing and route topology', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const data = String(url).includes('/landing-point/')
      ? { features: [{ properties: { name: 'A, Japan' } }, { properties: { name: 'B, Chile' } }] }
      : { features: [{}, {}, {}, {}] };
    return { ok: true, json: async () => data } as Response;
  }) as typeof fetch;
  try {
    const state = await new SubmarineNetwork3DRuntime().getSnapshot();
    assert.equal(state.page, 'submarine_network_3d');
    assert.equal(state.landingCount, 2);
    assert.equal(state.routeCount, 4);
    assert.equal(state.countryCount, 2);
    assert.equal(state.topCountries?.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
