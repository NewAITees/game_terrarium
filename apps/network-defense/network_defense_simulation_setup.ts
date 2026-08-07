import { RNG, STYLE, buildAdj } from '../../shared/network-core.js';
import { EDGE_SPEED } from './network_defense_config.js';
import type { NetworkDefenseGameState } from '../../shared/types/network_defense.js';

export type NetworkDefenseSimulationSetupOptions = {
  topo: any;
  edgeMap: Map<string, any>;
  allEdges: any[];
  seed: number;
  rng?: RNG;
  observerMode: boolean;
  rankPersonalities?: any;
  attachNodeVisual?: (node: any) => void;
};

export function initializeNetworkDefenseSimulationState(options: NetworkDefenseSimulationSetupOptions) {
  const { topo, edgeMap, allEdges, seed, observerMode, rankPersonalities } = options;
  const adj = buildAdj(topo.nodes, edgeMap);
  const rng = options.rng ?? new RNG(seed + 1);
  const game: NetworkDefenseGameState = {
    mode: 'harden', elapsed: 0, kills: 0, score: 0, credits: 50, wave: 1,
    gameOver: false, victory: false, waveRemaining: 5, waveCooldown: 0,
    nextAttack: 0.7, rule: 'balanced', nextScan: 4, seniorAlive: true,
    waveSpawned: 0, waveStartKills: 0, waveServerHpStart: 120,
    waveActions: {}, environmentSpeedMultiplier: 1, lowLoadMode: false,
    telemetryCooldown: 0,
    rankIntents: observerMode && rankPersonalities
      ? Object.fromEntries(Object.entries(rankPersonalities).map(([rank, personality]: [string, any]) => [rank, personality.summary]))
      : {},
    lastRecruitTime: 0,
  };

  initializeEdgeSpeeds(allEdges);
  for (const node of topo.nodes) {
    node.baseStyle = STYLE[node.isServer ? 'server' : node.layer];
    node.hp = node.isServer ? 120 : 100;
    node.maxHp = node.hp;
    node.infection = 0;
    node.hardenUntil = 0;
    node.rebootUntil = 0;
    node.targetedUntil = 0;
    options.attachNodeVisual?.(node);
  }

  return {
    adj,
    agents: [] as any[],
    defensePackets: [] as any[],
    enemyPackets: [] as any[],
    firewalls: new Map(),
    game,
    normalPackets: [] as any[],
    rng,
    scanPackets: [] as any[],
    terms: topo.lnodes.term,
    topo,
    edgeMap,
    allEdges,
  };
}

function initializeEdgeSpeeds(allEdges: any[]): void {
  for (const edge of allEdges) {
    const points = edge.curve.getPoints(28);
    let length = 0;
    for (let index = 1; index < points.length; index += 1) length += points[index - 1].distanceTo(points[index]);
    edge.length = length;
  }
  const lengths = allEdges.map((edge) => edge.length);
  const minimum = Math.min(...lengths);
  const maximum = Math.max(...lengths);
  const span = Math.max(1e-6, maximum - minimum);
  for (const edge of allEdges) {
    const normalized = (edge.length - minimum) / span;
    const shortcutBoost = edge.shortcut ? 0.1 : 0;
    edge.speedFactor = Math.max(EDGE_SPEED.min, Math.min(EDGE_SPEED.max, EDGE_SPEED.max - normalized * 0.46 + shortcutBoost));
  }
}
