import * as THREE from 'three';
import { RNG, STYLE, buildAdj } from './network-core.js';
import {
  createNetworkDefenseFlashPools,
  initializeNetworkDefenseRender,
} from './network_defense_render.js';
import { EDGE_SPEED } from './network_defense_config.js';
import { pickRankPersonalities } from './network_defense_personality.js';
import type { NetworkDefenseGameState } from '../../shared/types/network_defense.js';

export function initializeNetworkDefenseSetup(observerMode: boolean) {
  const total = 24 + (Math.random() * 16 | 0);
  const seed = Math.random() * 1e9 | 0;
  const rewirePct = 28;
  const background = 0x0d2040;

  const render = initializeNetworkDefenseRender({
    total,
    seed,
    rewirePct,
    background,
    observerMode,
    lowLoadMode: false,
  });

  const adj = buildAdj(render.topo.nodes, render.edgeMap);
  const rng = new RNG(seed + 1);
  const rankPersonalities = observerMode ? pickRankPersonalities(rng) : null;
  const terms = render.topo.lnodes.term;

  const game: NetworkDefenseGameState = {
    mode: 'harden',
    elapsed: 0,
    kills: 0,
    score: 0,
    credits: 50,
    wave: 1,
    gameOver: false,
    victory: false,
    waveRemaining: 5,
    waveCooldown: 0,
    nextAttack: 0.7,
    rule: 'balanced',
    nextScan: 4,
    seniorAlive: true,
    waveSpawned: 0,
    waveStartKills: 0,
    waveServerHpStart: 120,
    waveActions: {},
    environmentSpeedMultiplier: 1,
    lowLoadMode: false,
    telemetryCooldown: 0,
    rankIntents: observerMode && rankPersonalities
      ? Object.fromEntries(Object.entries(rankPersonalities).map(([rank, personality]) => [rank, personality.summary]))
      : {},
    lastRecruitTime: 0,
  };

  const enemyPackets: any[] = [];
  const defensePackets: any[] = [];
  const normalPackets: any[] = [];
  const scanPackets: any[] = [];
  const agents: any[] = [];
  const firewalls = new Map();

  for (const edge of render.allEdges) {
    const points = edge.curve.getPoints(28);
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
    edge.length = length;
  }

  const edgeLengths = render.allEdges.map((edge) => edge.length);
  const minEdgeLength = Math.min(...edgeLengths);
  const maxEdgeLength = Math.max(...edgeLengths);
  for (const edge of render.allEdges) {
    const span = Math.max(1e-6, maxEdgeLength - minEdgeLength);
    const norm = (edge.length - minEdgeLength) / span;
    const shortcutBoost = edge.shortcut ? 0.1 : 0;
    edge.speedFactor = Math.max(
      EDGE_SPEED.min,
      Math.min(EDGE_SPEED.max, EDGE_SPEED.max - norm * 0.46 + shortcutBoost)
    );
  }

  const { attackPool, normalPool, triggerFlash } = createNetworkDefenseFlashPools(render.scene);

  for (const node of render.topo.nodes) {
    const style = STYLE[node.isServer ? 'server' : node.layer];
    node.baseStyle = style;
    node.hp = node.isServer ? 120 : 100;
    node.maxHp = node.hp;
    node.infection = 0;
    node.hardenUntil = 0;
    node.rebootUntil = 0;
    node.targetedUntil = 0;
    node.material = node.mesh.material;
    node.halo = node.mesh.children[0];
    node.mesh.userData.node = node;
    render.clickable.push(node.mesh);
  }

  return {
    adj,
    agents,
    attackPool,
    defensePackets,
    enemyPackets,
    firewalls,
    game,
    normalPackets,
    normalPool,
    rankPersonalities,
    render,
    rng,
    scanPackets,
    terms,
    triggerFlash,
  };
}
