import { readFileSync } from 'fs';
import path from 'path';
import { AdditiveBlending, BackSide, Mesh, MeshBasicMaterial, Scene, SphereGeometry } from 'three';
import { RNG, STYLE, buildAdj, buildEdges, buildScene, buildTopology, edgeKey, makeMats } from '../shared/network-core';
import { EDGE_SPEED, WIN_WAVE } from '../apps/network-defense/network_defense_config';
import { createNetworkDefenseAppHelpers } from '../apps/network-defense/network_defense_app_helpers';
import { createNetworkDefenseRuleRuntime } from '../apps/network-defense/network_defense_rule_runtime';
import { createNetworkDefenseRuntime } from '../apps/network-defense/network_defense_runtime';
import { scanNetworkForWave } from '../apps/network-defense/network_defense_wave';
import type { NetworkDefenseGameState } from '../shared/types/network_defense';

// Mirrors apps/network-defense/network_defense_app.ts's wiring (observerMode: false), minus the
// Three.js WebGLRenderer/OrbitControls/EffectComposer/DOM layer. Scene graph construction (Scene,
// Mesh, materials) works fine headless — only the renderer needs a real GPU/canvas, and this game
// never creates one until initializeNetworkDefenseRender, which we don't call here.

// document/localStorage are referenced by a few DOM-only side paths (end-of-game overlay HTML,
// HUD text, senior-strategy rule label) that already no-op safely when elements are missing.
(globalThis as any).document = { getElementById: () => null };

function installAgentRulesFetchShim(): void {
  const rulesDir = path.resolve(__dirname, '..', '..', 'agent_rules');
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(input);
    const match = url.match(/agent_rules\/(senior|mid|junior)\.json/);
    if (match) {
      const filePath = path.join(rulesDir, `${match[1]}.json`);
      const body = readFileSync(filePath, 'utf8');
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!originalFetch) return new Response('{}', { status: 404 });
    try {
      return await originalFetch(url, init);
    } catch {
      return new Response('{}', { status: 500 });
    }
  };
}

// Local copy of createNetworkDefenseFlashPools (apps/network-defense/network_defense_render.ts) —
// that file also pulls in WebGLRenderer/OrbitControls/EffectComposer, which don't resolve under
// tsconfig.node.json's moduleResolution. The flash pool itself is pure visual state, unused by sim.
function makeLevelMats(rHDR: number, gHDR: number, bHDR: number, levels = 10) {
  return Array.from({ length: levels }, (_, i) => {
    const b = i / (levels - 1);
    const mat = new MeshBasicMaterial({ transparent: true, side: BackSide, blending: AdditiveBlending, depthWrite: false });
    mat.color.setRGB(rHDR * b, gHDR * b, bHDR * b);
    mat.opacity = 0.55 + b * 0.45;
    return mat;
  });
}

function createNetworkDefenseFlashPools(scene: Scene) {
  const MATS_ATK = makeLevelMats(3.0, 0.08, 0.04);
  const MATS_NORM = makeLevelMats(0.1, 1.5, 3.0);
  const flashGeo = new SphereGeometry(9, 8, 8);
  function makeSpherePools(mats: any[], count: number) {
    return Array.from({ length: count }, () => {
      const mesh = new Mesh(flashGeo, mats[0]);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, t: 0, mats };
    });
  }
  const attackPool = makeSpherePools(MATS_ATK, 6);
  const normalPool = makeSpherePools(MATS_NORM, 4);
  function triggerFlash(pool: any[], node: any) {
    const slot = pool.reduce((m, f) => (f.t < m.t ? f : m));
    slot.mesh.position.set(node.x, node.y, node.z);
    slot.mesh.material = slot.mats[slot.mats.length - 1];
    slot.mesh.visible = true;
    slot.t = 1.0;
  }
  return { attackPool, normalPool, triggerFlash };
}

function buildSetup(seed: number) {
  const total = 24 + (seed % 16);
  const rewirePct = 28;
  const scene = new Scene();
  const topo = buildTopology(total, seed, 'smallworld', rewirePct);
  const spinData: any[] = [];
  const edgeMap = new Map();
  const allEdges: any[] = [];
  const mats = makeMats();
  buildScene(topo, scene, spinData);
  buildEdges(topo, scene, edgeMap, allEdges, mats);
  const adj = buildAdj(topo.nodes, edgeMap);
  const rng = new RNG(seed + 1);
  const terms = topo.lnodes.term;

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
    rankIntents: {},
    lastRecruitTime: 0,
  };

  const enemyPackets: any[] = [];
  const defensePackets: any[] = [];
  const normalPackets: any[] = [];
  const scanPackets: any[] = [];
  const agents: any[] = [];
  const firewalls = new Map();

  for (const edge of allEdges) {
    const points = edge.curve.getPoints(28);
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
    edge.length = length;
  }
  const edgeLengths = allEdges.map((edge) => edge.length);
  const minEdgeLength = Math.min(...edgeLengths);
  const maxEdgeLength = Math.max(...edgeLengths);
  for (const edge of allEdges) {
    const span = Math.max(1e-6, maxEdgeLength - minEdgeLength);
    const norm = (edge.length - minEdgeLength) / span;
    const shortcutBoost = edge.shortcut ? 0.1 : 0;
    edge.speedFactor = Math.max(EDGE_SPEED.min, Math.min(EDGE_SPEED.max, EDGE_SPEED.max - norm * 0.46 + shortcutBoost));
  }

  const { attackPool, normalPool, triggerFlash } = createNetworkDefenseFlashPools(scene);

  for (const node of topo.nodes) {
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
  }

  return { adj, agents, attackPool, defensePackets, enemyPackets, firewalls, game, normalPackets, normalPool, rng, scanPackets, scene, terms, topo, edgeMap, allEdges, triggerFlash };
}

async function runOne(run: number, seed: number, maxSeconds: number): Promise<{ run: number; outcome: string; wave: number; score: number; kills: number; elapsed: number; serverHp: number; agents: number; firewalls: number }> {
  const setup = buildSetup(seed);
  const { adj, agents, attackPool, defensePackets, enemyPackets, firewalls, game, normalPackets, normalPool, rng, scanPackets, scene, terms, topo, edgeMap, allEdges, triggerFlash } = setup;

  const {
    createPacket,
    deployFirewall,
    edgeTravelFactor,
    enemyFrontierTarget,
    firewallKey,
    hottestNode,
    patrolTarget,
    perimeterNode,
    route,
    safeRoute,
    seedAgents,
    sendAgent,
    updateFirewalls,
    weakestDamagedNode,
  } = createNetworkDefenseAppHelpers({
    adj, agents, applyPersonalityToAgent: (agent: any) => agent, edgeKey, firewalls, game,
    observerMode: false, rankPersonalities: null, rng, scene, terms, topo,
  });

  seedAgents();

  function scanNetwork() { return scanNetworkForWave(topo, firewalls, enemyPackets); }

  let requestBuyAgent = (_rank: string): void => {};
  const ruleRuntime = createNetworkDefenseRuleRuntime({
    observerMode: false, rankPersonalities: null, applyPersonalitiesToRules: () => ({}),
    scanNetwork, setRuleStatus: () => {}, setMessage: () => {}, logEvent: () => {},
    sendAgent, hottestNode, weakestDamagedNode, patrolTarget,
    buyAgent: (rank: string) => requestBuyAgent(rank),
    game, topo, adj, agents, enemyPackets, firewalls, rng,
  });
  const { assignAgent, loadAgentRules, triggerRuleUpdate } = ruleRuntime;
  await loadAgentRules();

  const runtime = createNetworkDefenseRuntime({
    adj, agents, applyPersonalityToAgent: (agent: any) => agent, attackPool,
    buildObserverSnapshot: () => ({}), createPacket, defensePackets, deployFirewall, edgeKey,
    edgeMap, edgeTravelFactor, enemyFrontierTarget, enemyPackets, firewalls, firewallKey, game,
    logEvent: () => {}, normalPackets, normalPool,
    observationEvents: { update: () => {}, getHudState: () => ({}) },
    observationUi: { update: () => {} }, observerMode: false, perimeterNode, rankPersonalities: null, rng, route,
    safeRoute, scanPackets, scene, setMessage: () => {}, topo, triggerFlash, winWave: WIN_WAVE,
    assignAgent, triggerRuleUpdate,
  });
  requestBuyAgent = runtime.buyAgent;

  const dt = 0.05;
  let elapsed = 0;
  let nextNormal = 0.4;
  let nextScan = 2;

  while (elapsed < maxSeconds && !game.gameOver) {
    const now = elapsed;
    elapsed += dt;

    if (!game.gameOver) {
      game.elapsed += dt;
      game.credits = Math.min(999, game.credits + dt * 3);
      game.nextAttack -= dt;
      runtime.updateWave(dt);
      runtime.updateSeniorStrategy(dt);
      if (game.nextAttack <= 0 && game.waveRemaining > 0) {
        runtime.spawnEnemy();
        game.nextAttack = Math.max(0.32, 1.35 - game.wave * 0.035) + rng.next() * 0.65;
      }
      nextNormal -= dt;
      if (nextNormal <= 0) {
        runtime.spawnNormalTraffic();
        nextNormal = 0.25 + rng.next() * 0.55;
      }
      nextScan -= dt;
      if (nextScan <= 0) {
        runtime.spawnScanner();
        nextScan = 1.4 + rng.next() * 1.8;
      }
    }

    runtime.updatePackets(enemyPackets, dt, (node: any, packet: any) => runtime.applyAttack(node, packet.damage, now));
    runtime.updatePackets(defensePackets, dt, (node: any, packet: any) => runtime.applyDefense(node, packet.repair));
    runtime.updatePackets(normalPackets, dt, (node: any) => { if (node) triggerFlash(normalPool, node); });
    runtime.updateScanPackets(dt);
    runtime.updateAgents(dt, now);
    runtime.updateNodes(dt, now);
    updateFirewalls(now, dt);
  }

  const outcome = game.gameOver ? (game.victory ? 'victory' : 'defeat') : 'timeout';
  return {
    run, outcome, wave: game.wave, score: game.score, kills: game.kills,
    elapsed: Math.round(game.elapsed), serverHp: Math.max(0, Math.round(topo.server.hp)),
    agents: agents.length, firewalls: firewalls.size,
  };
}

function parseArgs(argv: string[]): { runs: number; maxSeconds: number; seedStart: number } {
  const args = Object.fromEntries(argv.map((entry) => {
    const [key, value] = entry.replace(/^--/, '').split('=');
    return [key, value];
  }));
  return {
    runs: Number(args.runs ?? 10),
    maxSeconds: Number(args.maxSeconds ?? 300),
    seedStart: Number(args.seed ?? 1),
  };
}

async function main(): Promise<void> {
  installAgentRulesFetchShim();
  const { runs, maxSeconds, seedStart } = parseArgs(process.argv.slice(2));
  const results = [];
  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const startedAt = Date.now();
    const result = await runOne(i + 1, seed, maxSeconds);
    const wallMs = Date.now() - startedAt;
    results.push(result);
    console.log(
      `run ${String(result.run).padStart(3)} seed=${seed} outcome=${result.outcome.padEnd(8)} wave=${String(result.wave).padStart(2)} ` +
      `score=${String(result.score).padStart(5)} kills=${String(result.kills).padStart(3)} serverHp=${String(result.serverHp).padStart(3)} ` +
      `agents=${result.agents} firewalls=${result.firewalls} simSec=${String(result.elapsed).padStart(4)} wallMs=${wallMs}`,
    );
  }
  console.log('---');
  const victories = results.filter((r) => r.outcome === 'victory').length;
  const defeats = results.filter((r) => r.outcome === 'defeat').length;
  const timeouts = results.filter((r) => r.outcome === 'timeout').length;
  const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  console.log(`runs=${runs} victory=${victories} defeat=${defeats} timeout=${timeouts}`);
  console.log(`avg wave reached=${avg(results.map((r) => r.wave)).toFixed(2)}`);
  console.log(`avg score=${avg(results.map((r) => r.score)).toFixed(1)}`);
  console.log(`avg kills=${avg(results.map((r) => r.kills)).toFixed(1)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
