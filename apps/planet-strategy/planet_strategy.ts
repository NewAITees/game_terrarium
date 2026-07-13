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
const {
  createCombatShip,
  createTransportShip,
  getEmpire,
  getPlanet,
  routeKey,
  seedInitialRoutes,
  touchRoute,
  world,
} = createPlanetStrategyBootstrap({
  colors: COLORS,
  distance3d,
  personalities: PERSONALITIES,
  rng,
});
const rendererView = createPlanetStrategyRenderer({ world, rng, getPlanet, distance3d, routeKey });
const clock = new Clock();
let aiTick = 0;
let mineTick = 0;
let factoryTick = 0;
let telemetryTick = 0;
let attackTick = 0;

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
  world,
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
  render: () => rendererView.renderFrame(),
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
