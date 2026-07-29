import { updateStrategy as industrialistStrategy } from '../apps/planet-strategy/planet_strategy_ai_industrialist';
import { updateStrategy as raiderStrategy } from '../apps/planet-strategy/planet_strategy_ai_raider';
import { updateStrategy as expansionistStrategy } from '../apps/planet-strategy/planet_strategy_ai_expansionist';
import { updateStrategy as fortifierStrategy } from '../apps/planet-strategy/planet_strategy_ai_fortifier';
import { createPlanetStrategyBootstrap } from '../apps/planet-strategy/planet_strategy_bootstrap';
import { createPlanetStrategyEconomyRuntime } from '../apps/planet-strategy/planet_strategy_economy';
import { createPlanetStrategyCombatRuntime } from '../apps/planet-strategy/planet_strategy_combat';
import { createPlanetStrategyMatchRuntime } from '../apps/planet-strategy/planet_strategy_match';
import type { PlanetStrategyAiStrategy, PlanetStrategyPersonality } from '../shared/types/planet_strategy';

// Mirrors apps/planet-strategy/planet_strategy.ts's wiring, minus the Three.js renderer/DOM UI —
// economy/combat/match are pure state machines; the WASM ship-physics bridge already has a full
// JS fallback (used automatically here since the browser-only wasm module can't load in Node).
const AI_STRATEGIES: Record<PlanetStrategyPersonality, PlanetStrategyAiStrategy> = {
  industrialist: industrialistStrategy,
  raider: raiderStrategy,
  expansionist: expansionistStrategy,
  fortifier: fortifierStrategy,
};

const COLORS = ['#7de8ff', '#ff9f80', '#c8ff8a'];
const PERSONALITIES: Array<{ key: PlanetStrategyPersonality; summary: string }> = [
  { key: 'industrialist', summary: 'feed factories and multiply transports' },
  { key: 'raider', summary: 'stretch routes toward rich outer planets' },
  { key: 'expansionist', summary: 'claim rich frontier worlds through logistics' },
  { key: 'fortifier', summary: 'favor safe short routes and stable supply' },
];
const MATCH_END_SECONDS = 8 * 60;
const MATCH_FORCE_END_SECONDS = 10 * 60;
const FACTORY_MAINTENANCE_COST = 8;
const FACTORY_STALL_COLLAPSE_SECONDS = 90;
const SHIP_BUILD_COST = 20;
const TIE_BREAK_DELTA = 0.5;
const ATTACK_RANGE = 200;

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distance3d(a: any, b: any): number {
  return Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
}

const noopRendererView = {
  ensureRouteVisual: () => {},
  attachShipMesh: () => {},
  removeShipMesh: () => {},
  updateVisuals: () => {},
  renderFrame: () => {},
  onResize: () => {},
};

type RunSummary = {
  run: number;
  endReason: string;
  elapsed: number;
  winner: string;
  scores: string;
};

function parseArgs(argv: string[]): { runs: number; maxSeconds: number; seedStart: number } {
  const args = Object.fromEntries(argv.map((entry) => {
    const [key, value] = entry.replace(/^--/, '').split('=');
    return [key, value];
  }));
  return {
    runs: Number(args.runs ?? 5),
    maxSeconds: Number(args.maxSeconds ?? MATCH_FORCE_END_SECONDS + 60),
    seedStart: Number(args.seed ?? 1),
  };
}

function runOne(run: number, seed: number, maxSeconds: number): RunSummary {
  const rng = mulberry32(seed);
  const {
    createCombatShip,
    createTransportShip,
    getEmpire,
    getPlanet,
    routeKey,
    seedInitialRoutes,
    touchRoute,
    world,
  } = createPlanetStrategyBootstrap({ colors: COLORS, distance3d, personalities: PERSONALITIES, rng });

  seedInitialRoutes(noopRendererView);

  function logEvent(): void {}
  function maybeLog(key: string, text: string, type: string, intervalSeconds: number): void {
    const last = world.logCooldowns.get(key) || -Infinity;
    if (world.time - last < intervalSeconds) return;
    world.logCooldowns.set(key, world.time);
  }

  const economy = createPlanetStrategyEconomyRuntime({
    aiStrategies: AI_STRATEGIES,
    createCombatShip,
    createTransportShip,
    distance3d,
    factoryMaintenanceCost: FACTORY_MAINTENANCE_COST,
    getEmpire,
    getPlanet,
    logEvent,
    recordShipJump: () => {},
    maybeLog,
    rendererView: noopRendererView,
    rng,
    shipBuildCost: SHIP_BUILD_COST,
    touchRoute: (fromPlanetId: string, toPlanetId: string, weight = 1, hostileSeconds = 0) => touchRoute(noopRendererView, fromPlanetId, toPlanetId, weight, hostileSeconds),
    world,
  });

  const combat = createPlanetStrategyCombatRuntime({
    attackRange: ATTACK_RANGE,
    distance3d,
    getPlanet,
    logEvent,
    maybeLog,
    rendererView: noopRendererView,
    rng,
    touchRoute: (fromPlanetId: string, toPlanetId: string, weight = 1, hostileSeconds = 0) => touchRoute(noopRendererView, fromPlanetId, toPlanetId, weight, hostileSeconds),
    world,
  });

  const match = createPlanetStrategyMatchRuntime({
    factoryStallCollapseSeconds: FACTORY_STALL_COLLAPSE_SECONDS,
    getPlanet,
    logEvent,
    matchEndSeconds: MATCH_END_SECONDS,
    matchForceEndSeconds: MATCH_FORCE_END_SECONDS,
    maybeLog,
    rendererView: noopRendererView,
    tieBreakDelta: TIE_BREAK_DELTA,
    ui: { update: () => {}, log: () => {} },
    world,
  });

  const dt = 1 / 20;
  let mineTick = 0;
  let aiTick = 0;
  let attackTick = 0;
  let factoryTick = 0;

  while (world.time < maxSeconds && !world.gameOver) {
    world.time += dt;
    aiTick += dt;
    mineTick += dt;
    attackTick += dt;
    factoryTick += dt;

    if (mineTick >= 0.5) {
      economy.runMining(mineTick);
      economy.runCargoHandling(mineTick);
      mineTick = 0;
    }
    if (aiTick >= 2) {
      economy.updateEmpireIntentions();
      economy.assignRoutes();
      aiTick = 0;
    }
    if (attackTick >= 5) {
      combat.decideAttacks();
      attackTick = 0;
    }
    if (factoryTick >= 5) {
      economy.runFactories(factoryTick);
      factoryTick = 0;
    }

    economy.updateShips(dt);
    combat.runCombat(dt);
    economy.updateOrbiting(dt);
    economy.decayTraffic(dt);
    match.evaluateEmpireCollapse();
    match.evaluateMatchState();
  }
  if (!world.gameOver) match.finalizeMatch('sim-timeout');

  const scores = match.computeVictoryScores();
  const winner = scores[0];
  return {
    run,
    endReason: world.endReason ?? 'unresolved',
    elapsed: Math.round(world.time),
    winner: winner ? `${winner.name}(${Math.round(winner.total)})` : 'none',
    scores: scores.map((s: any) => `${s.name}=${Math.round(s.total)}${s.collapsed ? '†' : ''}`).join(' '),
  };
}

function main(): void {
  const { runs, maxSeconds, seedStart } = parseArgs(process.argv.slice(2));
  const summaries: RunSummary[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const startedAt = Date.now();
    const summary = runOne(i + 1, seed, maxSeconds);
    const wallMs = Date.now() - startedAt;
    summaries.push(summary);
    console.log(
      `run ${String(summary.run).padStart(3)} seed=${seed} endReason=${summary.endReason.padEnd(10)} ` +
      `elapsedSec=${String(summary.elapsed).padStart(4)} winner=${summary.winner.padEnd(18)} scores=[${summary.scores}] wallMs=${wallMs}`,
    );
  }
  console.log('---');
  const reasonCounts: Record<string, number> = {};
  for (const summary of summaries) reasonCounts[summary.endReason] = (reasonCounts[summary.endReason] ?? 0) + 1;
  console.log(`runs=${runs} end reasons: ${Object.entries(reasonCounts).map(([reason, count]) => `${reason}=${count}`).join(' ')}`);
  const avgElapsed = summaries.reduce((sum, s) => sum + s.elapsed, 0) / (summaries.length || 1);
  console.log(`avg match length=${avgElapsed.toFixed(1)}s`);
}

main();
