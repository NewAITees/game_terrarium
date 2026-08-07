import { readFileSync } from 'fs';
import path from 'path';
import { buildTopology, edgeKey } from '../shared/network-core';
import { WIN_WAVE } from '../apps/network-defense/network_defense_config';
import { createNetworkDefenseAppHelpers } from '../apps/network-defense/network_defense_app_helpers';
import { createNetworkDefenseRuleRuntime } from '../apps/network-defense/network_defense_rule_runtime';
import { createNetworkDefenseRuntime } from '../apps/network-defense/network_defense_runtime';
import {
  NetworkDefenseRlController,
  type NetworkDefenseRlSave,
} from '../apps/network-defense/network_defense_rl';
import { scanNetworkForWave } from '../apps/network-defense/network_defense_wave';
import { initializeNetworkDefenseSimulationState } from '../apps/network-defense/network_defense_simulation_setup';
import { buildNetworkDefenseLogicalEdges } from '../apps/network-defense/network_defense_logical_edges';
import { nullNetworkDefenseVisualAdapter } from '../apps/network-defense/network_defense_visual_adapter';

// Mirrors apps/network-defense/network_defense_app.ts's simulation wiring (observerMode: false)
// without constructing a DOM, renderer, Scene, Mesh, material, or other visual object.

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

function buildSetup(seed: number) {
  const total = 24 + (seed % 16);
  const rewirePct = 28;
  const topo = buildTopology(total, seed, 'smallworld', rewirePct);
  const { edgeMap, allEdges } = buildNetworkDefenseLogicalEdges(topo);
  const attackPool: any[] = [];
  const normalPool: any[] = [];
  const triggerFlash = (_pool: any[], _node: any) => {};
  const simulation = initializeNetworkDefenseSimulationState({
    topo,
    edgeMap,
    allEdges,
    seed,
    observerMode: false,
  });
  return { ...simulation, attackPool, normalPool, scene: null, triggerFlash, visuals: nullNetworkDefenseVisualAdapter };
}

type RunResult = {
  run: number;
  outcome: string;
  wave: number;
  score: number;
  kills: number;
  elapsed: number;
  serverHp: number;
  agents: number;
  firewalls: number;
  trainingSteps: number;
  knownStates: number;
  model?: NetworkDefenseRlSave;
};

export async function runNetworkDefenseEpisode(
  run: number,
  seed: number,
  maxSeconds: number,
  aiMode: 'rules' | 'rl',
  model?: NetworkDefenseRlSave,
  evaluation = false,
): Promise<RunResult> {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed ^ 0x9e3779b9);
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
    observerMode: false, rankPersonalities: null, rng, scene, terms, topo, visuals: setup.visuals,
    now: () => game.elapsed,
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
  const {
    assignAgent: assignRuleAgent,
    buildSnapshot,
    execAction,
    loadAgentRules,
    triggerRuleUpdate,
  } = ruleRuntime;
  if (aiMode === 'rules') await loadAgentRules();

  const rlController = aiMode === 'rl'
    ? new NetworkDefenseRlController({
        game,
        topo,
        agents,
        enemyPackets,
        firewalls,
        buildSnapshot,
        executeAction: (agent, action, snapshot) => execAction(agent, action, snapshot),
        now: () => game.elapsed,
      })
    : null;
  if (rlController && model) rlController.restore(model);
  if (rlController) rlController.setEvaluationMode(evaluation);
  const assignAgent = rlController
    ? (agent: any) => rlController.assignAgent(agent)
    : assignRuleAgent;

  const runtime = createNetworkDefenseRuntime({
    adj, agents, applyPersonalityToAgent: (agent: any) => agent, attackPool,
    buildObserverSnapshot: () => ({}), createPacket, defensePackets, deployFirewall, edgeKey,
    edgeMap, edgeTravelFactor, enemyFrontierTarget, enemyPackets, firewalls, firewallKey, game,
    logEvent: () => {}, normalPackets, normalPool,
    observationEvents: { update: () => {}, getHudState: () => ({}) },
    observationUi: { update: () => {} }, observerMode: false, perimeterNode, rankPersonalities: null, rng, route,
    safeRoute, scanPackets, scene, setMessage: () => {}, topo, triggerFlash, visuals: setup.visuals, winWave: WIN_WAVE,
    assignAgent,
    triggerRuleUpdate: aiMode === 'rl' ? async () => {} : triggerRuleUpdate,
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
      if (aiMode === 'rules') runtime.updateSeniorStrategy(dt);
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
  if (rlController) rlController.finishEpisode(Boolean(game.victory));
  const result = {
    run, outcome, wave: game.wave, score: game.score, kills: game.kills,
    elapsed: Math.round(game.elapsed), serverHp: Math.max(0, Math.round(topo.server.hp)),
    agents: agents.length, firewalls: firewalls.size,
    trainingSteps: rlController?.trainingSteps ?? 0,
    knownStates: rlController?.knownStates ?? 0,
    model: rlController?.serialize(),
  };
  Math.random = originalRandom;
  return result;
}

function parseArgs(argv: string[]): {
  runs: number;
  maxSeconds: number;
  seedStart: number;
  aiMode: 'rules' | 'rl';
} {
  const args = Object.fromEntries(argv.map((entry) => {
    const [key, value] = entry.replace(/^--/, '').split('=');
    return [key, value];
  }));
  return {
    runs: Number(args.runs ?? 10),
    maxSeconds: Number(args.maxSeconds ?? 300),
    seedStart: Number(args.seed ?? 1),
    aiMode: args.ai === 'rl' ? 'rl' : 'rules',
  };
}

async function main(): Promise<void> {
  installAgentRulesFetchShim();
  const { runs, maxSeconds, seedStart, aiMode } = parseArgs(process.argv.slice(2));
  const results = [];
  let model: NetworkDefenseRlSave | undefined;
  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const startedAt = Date.now();
    const result = await runNetworkDefenseEpisode(i + 1, seed, maxSeconds, aiMode, model);
    model = result.model;
    const wallMs = Date.now() - startedAt;
    results.push(result);
    console.log(
      `run ${String(result.run).padStart(3)} seed=${seed} outcome=${result.outcome.padEnd(8)} wave=${String(result.wave).padStart(2)} ` +
      `score=${String(result.score).padStart(5)} kills=${String(result.kills).padStart(3)} serverHp=${String(result.serverHp).padStart(3)} ` +
      `agents=${result.agents} firewalls=${result.firewalls} states=${result.knownStates} steps=${result.trainingSteps} ` +
      `simSec=${String(result.elapsed).padStart(4)} wallMs=${wallMs}`,
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
