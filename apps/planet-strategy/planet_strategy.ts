import { Clock, } from 'three';
import { bindComposerResize, startAnimationFrameLoop, startHiddenTabLoop } from '../../shared/browser-runtime.js';
import { createPlanetStrategyRenderer } from './planet_strategy_render.js';
import { createPlanetStrategyUi } from './planet_strategy_ui.js';
import { updateStrategy as industrialistStrategy } from './planet_strategy_ai_industrialist.js';
import { updateStrategy as raiderStrategy } from './planet_strategy_ai_raider.js';
import { updateStrategy as expansionistStrategy } from './planet_strategy_ai_expansionist.js';
import { updateStrategy as fortifierStrategy } from './planet_strategy_ai_fortifier.js';
import { createPlanetStrategyMatchRuntime } from './planet_strategy_match.js';
import { createPlanetStrategyEconomyRuntime } from './planet_strategy_economy.js';
import { createPlanetStrategyCombatRuntime } from './planet_strategy_combat.js';
import { createPlanetStrategyBootstrap } from './planet_strategy_bootstrap.js';
import { createPlanetStrategyCycle } from './planet_strategy_cycle.js';
import type {
  PlanetStrategyAiStrategy,
  PlanetStrategyInterventionType,
  PlanetStrategyLogType,
  PlanetStrategyPersonality,
  PlanetStrategyScoreEntry,
} from '../../shared/types/planet_strategy.js';

const AI_STRATEGIES: Record<PlanetStrategyPersonality, PlanetStrategyAiStrategy> = {
  industrialist: industrialistStrategy,
  raider:        raiderStrategy,
  expansionist:  expansionistStrategy,
  fortifier:     fortifierStrategy,
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

const rng = mulberry32(Math.floor(Math.random() * 1e9));
const ui = createPlanetStrategyUi();
const cycle = createPlanetStrategyCycle();
let activeWorldModifier = cycle.pickWorldModifier();
let lastMutation = 'Doctrine changes are applied between cycles.';
const {
  createCombatShip,
  createTransportShip,
  getEmpire,
  getPlanet,
  routeKey,
  resetWorld,
  seedInitialRoutes,
  touchRoute,
  world,
} = createPlanetStrategyBootstrap({
  colors: COLORS,
  distance3d,
  getDoctrine: cycle.getDoctrine,
  getGeneration: cycle.getGeneration,
  getWorldModifier: () => activeWorldModifier,
  personalities: PERSONALITIES,
  rng,
});
world.cycleNumber = cycle.cycleNumber();
const rendererView = createPlanetStrategyRenderer({ world, rng, getPlanet, distance3d, routeKey });
const clock = new Clock();
let aiTick = 0;
let mineTick = 0;
let factoryTick = 0;
let telemetryTick = 0;
let attackTick = 0;
let lowFpsMode = localStorage.getItem('planet-strategy-low-fps') === 'true';
let lastRenderTime = 0;

seedInitialRoutes(rendererView);
logEvent('Planet strategy initialized. Logistics web coming online.', 'info');

function distance3d(a, b) {
  return Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
}

function updateWorld(dt) {
  if (world.gameOver) {
    updateHud();
    return;
  }
  world.time += dt;
  aiTick += dt;
  mineTick += dt;
  factoryTick += dt;
  telemetryTick += dt;

  if (mineTick >= 0.5) {
    runMining(mineTick);
    runCargoHandling(mineTick);
    mineTick = 0;
  }
  attackTick += dt;
  if (aiTick >= 2) {
    updateEmpireIntentions();
    assignRoutes();
    aiTick = 0;
  }
  if (attackTick >= 5) {
    decideAttacks();
    attackTick = 0;
  }
  if (factoryTick >= 5) {
    runFactories(factoryTick);
    factoryTick = 0;
  }

  updateShips(dt);
  runCombat(dt);
  updateOrbiting(dt);
  decayTraffic(dt);
  evaluateEmpireCollapse();
  evaluateMatchState();
  rendererView.updateVisuals(dt);
  updateHud();

  if (telemetryTick >= 0.5) {
    reportTelemetry();
    telemetryTick = 0;
  }
}
const {
  assignRoutes,
  decayTraffic,
  queueConstruction,
  runCargoHandling,
  runFactories,
  runMining,
  updateEmpireIntentions,
  updateOrbiting,
  updateShips,
} = createPlanetStrategyEconomyRuntime({
  aiStrategies: AI_STRATEGIES,
  createCombatShip,
  createTransportShip,
  distance3d,
  factoryMaintenanceCost: FACTORY_MAINTENANCE_COST,
  getEmpire,
  getPlanet,
  logEvent,
  recordShipJump,
  maybeLog,
  rendererView,
  rng,
  shipBuildCost: SHIP_BUILD_COST,
  touchRoute: (fromPlanetId: string, toPlanetId: string, weight = 1, hostileSeconds = 0) => touchRoute(rendererView, fromPlanetId, toPlanetId, weight, hostileSeconds),
  world,
});

const {
  decideAttacks,
  runCombat,
} = createPlanetStrategyCombatRuntime({
  attackRange: ATTACK_RANGE,
  distance3d,
  getPlanet,
  logEvent,
  maybeLog,
  rendererView,
  rng,
  touchRoute: (fromPlanetId: string, toPlanetId: string, weight = 1, hostileSeconds = 0) => touchRoute(rendererView, fromPlanetId, toPlanetId, weight, hostileSeconds),
  world,
});

const {
  computeVictoryScores,
  evaluateEmpireCollapse,
  evaluateMatchState,
  finalizeMatch,
  reportTelemetry,
  updateHud,
} = createPlanetStrategyMatchRuntime({
  factoryStallCollapseSeconds: FACTORY_STALL_COLLAPSE_SECONDS,
  getPlanet,
  logEvent,
  matchEndSeconds: MATCH_END_SECONDS,
  matchForceEndSeconds: MATCH_FORCE_END_SECONDS,
  maybeLog,
  rendererView,
  tieBreakDelta: TIE_BREAK_DELTA,
  ui,
  history: cycle.history,
  isAutoRun: cycle.isAutoRun,
  setupLabel: () => {
    const setup = cycle.setup();
    const modifier = setup.selectedModifierId.replace('_', ' ');
    return `${setup.worldMode === 'fixed' ? `Fixed: ${modifier}` : 'Random world'} · ${setup.maxCycles === null ? 'unlimited cycles' : `through C${setup.maxCycles}`}`;
  },
  lineageSummary: () => Object.values(cycle.lineages()).map((lineage) => `${lineage.name}: G${lineage.generation}, ${lineage.totalWins}W-${lineage.totalLosses}L`),
  lastMutation: () => lastMutation,
  onMatchComplete: (result) => {
    const mutations = cycle.record(result);
    lastMutation = mutations.length
      ? mutations.map((mutation) => `${mutation.name} ${mutation.reason}.`).join(' ')
      : 'No doctrine mutation was needed after this cycle.';
    cycle.scheduleNext(startNextCycle);
  },
  world,
});

function startNextCycle() {
  if (!world.gameOver) return;
  cycle.cancelScheduledNext();
  rendererView.resetVisuals();
  activeWorldModifier = cycle.pickWorldModifier();
  resetWorld(cycle.cycleNumber());
  aiTick = 0;
  mineTick = 0;
  factoryTick = 0;
  telemetryTick = 0;
  attackTick = 0;
  seedInitialRoutes(rendererView);
  logEvent(`Cycle ${world.cycleNumber} initialized. Empire lineages continue observing.`, 'info');
  rendererView.updateVisuals(0);
  updateHud();
}

window.addEventListener('planet-strategy-next-cycle', startNextCycle);
window.addEventListener('planet-strategy-toggle-auto-run', () => {
  const enabled = !cycle.isAutoRun();
  cycle.setAutoRun(enabled);
  if (!enabled) cycle.cancelScheduledNext();
  if (enabled && world.gameOver) cycle.scheduleNext(startNextCycle);
  updateHud();
});
window.addEventListener('planet-strategy-cycle-world-mode', () => { cycle.cycleWorldMode(); updateHud(); });
window.addEventListener('planet-strategy-cycle-world', () => { cycle.cycleSelectedModifier(); updateHud(); });
window.addEventListener('planet-strategy-cycle-limit', () => { cycle.cycleMaxCycles(); updateHud(); });
window.addEventListener('planet-strategy-intervention', (event: Event) => {
  if (world.gameOver || world.interventionCharges <= 0) return;
  const type = (event as CustomEvent<{ type: PlanetStrategyInterventionType }>).detail?.type;
  if (type === 'resource_burst') {
    const target = [...world.planets].filter((planet) => planet.owner >= 0).sort((a, b) => a.stock - b.stock)[0];
    if (!target) return;
    target.stock += 80;
    logEvent(`Observer injected 80 ore into ${target.label}.`, 'resource');
  } else if (type === 'panic_repair') {
    const target = world.planets.filter((planet) => planet.type === 'factory' && planet.stalled).sort((a, b) => a.stock - b.stock)[0];
    if (!target) return;
    target.stalled = false;
    target.stock += 24;
    logEvent(`Observer stabilized ${target.label} for a short recovery.`, 'resource');
  } else if (type === 'route_jam') {
    const route = [...world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0];
    if (!route) return;
    route.hostileTimer = Math.max(route.hostileTimer ?? 0, 20);
    logEvent(`Observer jammed ${route.fromPlanetId} ⇄ ${route.toPlanetId} for 20 seconds.`, 'warning');
  } else return;
  world.interventionCharges--;
  updateHud();
});
window.addEventListener('planet-strategy-render-settings', (event: Event) => {
  lowFpsMode = Boolean((event as CustomEvent<{ lowFps: boolean }>).detail?.lowFps);
});

function maybeLog(key, text, type, intervalSeconds) {
  const last = world.logCooldowns.get(key) || -Infinity;
  if (world.time - last < intervalSeconds) return;
  world.logCooldowns.set(key, world.time);
  logEvent(text, type);
}

function logEvent(text, type = 'info') {
  ui.log(`[${String(Math.floor(world.time)).padStart(4)}s] ${text}`, type);
}

function recordShipJump(line) {
  void fetch('/api/ship-jumps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ line }),
  }).catch(() => {});
}

function tick(dt: number) {
  updateWorld(dt);
}

window.__planetStrategy = { world, computeVictoryScores, finalizeMatch };
startAnimationFrameLoop({
  clock,
  step: (dt) => tick(dt),
  render: () => {
    const now = performance.now();
    if (lowFpsMode && now - lastRenderTime < 1000 / 20) return;
    lastRenderTime = now;
    rendererView.renderFrame();
  },
});

// バックグラウンドタブでも動作するようにMessageChannelでループを補完
startHiddenTabLoop({
  step: (dt) => {
    if (!world.gameOver) updateWorld(dt);
  },
});

bindComposerResize({
  camera: rendererView['camera'] ?? { aspect: 1, updateProjectionMatrix: () => {} },
  onResize: () => rendererView.onResize(),
});

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
