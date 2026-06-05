import * as THREE from 'three';
import { createPlanetStrategyRenderer } from './planet_strategy_render.js';
import { createPlanetStrategyUi } from './planet_strategy_ui.js';
import { reportPlanetStrategyTelemetry } from './planet_strategy_telemetry.js';
import { updateStrategy as industrialistStrategy } from './planet_strategy_ai_industrialist.js';
import { updateStrategy as raiderStrategy } from './planet_strategy_ai_raider.js';
import { updateStrategy as expansionistStrategy } from './planet_strategy_ai_expansionist.js';
import { updateStrategy as fortifierStrategy } from './planet_strategy_ai_fortifier.js';
import type {
  PlanetStrategyAiStrategy,
  PlanetStrategyConstructionType,
  PlanetStrategyEmpire,
  PlanetStrategyInterventionType,
  PlanetStrategyLogType,
  PlanetStrategyPersonality,
  PlanetStrategyPlanet,
  PlanetStrategyPosition,
  PlanetStrategyRoute,
  PlanetStrategyScoreEntry,
  PlanetStrategyShip,
  PlanetStrategyShipKind,
  PlanetStrategyWorld,
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
const world = createWorld();
const ui = createPlanetStrategyUi();
const rendererView = createPlanetStrategyRenderer({ world, rng, getPlanet, distance3d, routeKey });
const clock = new THREE.Clock();
let aiTick = 0;
let mineTick = 0;
let factoryTick = 0;
let telemetryTick = 0;
let attackTick = 0;

seedInitialRoutes();
logEvent('Planet strategy initialized. Logistics web coming online.', 'info');

function createWorld() {
  const planets = [];
  const empires = [];
  const ships = [];
  const routes = new Map();
  const routeStats = [];
  let shipSerial = 0;

  const empireConfigs = [
    { name: 'Aster Union', color: COLORS[0] },
    { name: 'Red Meridian', color: COLORS[1] },
    { name: 'Verdant Ring', color: COLORS[2] },
  ];

  const count = 15;
  const positions = generatePlanetPositions(count, {
    minRadius: 80,
    maxRadius: 300,
    minDistance: 72,
    verticalRange: 120,
    maxAttempts: 120,
  });
  for (let i = 0; i < count; i++) {
    const initialResources = 500 + Math.floor(rng() * 1000);
    planets.push({
      id: `p${i}`,
      label: `P-${i + 1}`,
      x: positions[i].x,
      y: positions[i].y,
      z: positions[i].z,
      resources: initialResources,
      maxResources: initialResources,
      mineRate: 4 + rng() * 6,
      owner: -1,
      stock: 0,
      type: 'neutral',
      structures: { mine: 0, factory: 0 },
      factoryHp: 0,
      underConstruction: null,
      productionQueue: 0,
      trafficIn: 0,
      stalled: false,
      mesh: null,
      ring: null,
      labelGlow: null,
    });
  }

  const used = new Set();
  empireConfigs.forEach((config, empireId) => {
    const personality = PERSONALITIES[empireId % PERSONALITIES.length];
    const homeMine = pickSectorMinePlanet(planets, used, empireId);
    const homeFactory = pickClosestFreePlanet(planets, used, homeMine, 'factory');
    homeMine.owner = empireId;
    homeMine.type = 'mine';
    homeMine.structures.mine = 1;
    homeMine.stock = 150;
    homeFactory.owner = empireId;
    homeFactory.type = 'factory';
    homeFactory.structures.factory = 1;
    homeFactory.factoryHp = 100;
    homeFactory.stock = 100;
    homeFactory.productionQueue = 20;

    const empire = {
      id: empireId,
      name: config.name,
      color: config.color,
      personality: personality.key,
      summary: personality.summary,
      intent: 'bring ore into the first factory',
      mined: 0,
      delivered: 0,
      producedShips: 0,
      stalledTime: 0,
      collapsed: false,
      collapseReason: null,
      homeMineId: homeMine.id,
      homeFactoryId: homeFactory.id,
      shipCap: 999,
    };
    empires.push(empire);

    for (let i = 0; i < 2; i++) {
      ships.push(createTransportShip(empire, homeMine.id, homeFactory.id, shipSerial++, i * 0.5));
    }
  });

  return {
    time: 0,
    planets,
    empires,
    ships,
    routes,
    routeStats,
    minedTotal: 0,
    deliveredTotal: 0,
    logCooldowns: new Map(),
    shipSerial,
    kills: 0,
    gameOver: false,
    endReason: null,
    winnerId: null,
    finalSummary: '',
    finalDetail: '',
    finalScores: [],
    oreFalloffStart: null,
  };
}

function generatePlanetPositions(count, options) {
  const positions = [];
  const {
    minRadius = 60,
    maxRadius = 260,
    minDistance = 60,
    verticalRange = 90,
    maxAttempts = 80,
  } = options;

  for (let i = 0; i < count; i++) {
    let accepted = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = minRadius + Math.sqrt(rng()) * (maxRadius - minRadius);
      const heightScale = 0.35 + (1 - radius / maxRadius) * 0.65;
      const candidate = {
        x: Math.cos(angle) * radius,
        y: (rng() - 0.5) * verticalRange * heightScale,
        z: Math.sin(angle) * radius,
      };
      const hasRoom = positions.every((position) => distance3d(position, candidate) >= minDistance);
      if (hasRoom) {
        accepted = candidate;
        break;
      }
    }

    if (!accepted) {
      const angle = rng() * Math.PI * 2;
      const radius = minRadius + Math.sqrt(rng()) * (maxRadius - minRadius);
      const heightScale = 0.35 + (1 - radius / maxRadius) * 0.65;
      accepted = {
        x: Math.cos(angle) * radius,
        y: (rng() - 0.5) * verticalRange * heightScale,
        z: Math.sin(angle) * radius,
      };
    }

    positions.push(accepted);
  }

  return positions;
}

function pickSectorMinePlanet(planets, used, sectorIndex) {
  const sectorAngle = (Math.PI * 2) / 3;
  const sectorStart = sectorIndex * sectorAngle;
  const sectorEnd = sectorStart + sectorAngle;
  const inSector = planets
    .map((planet, index) => ({ planet, index }))
    .filter(({ index }) => !used.has(index))
    .filter(({ planet }) => {
      const angle = (Math.atan2(planet.z, planet.x) + Math.PI * 2) % (Math.PI * 2);
      return angle >= sectorStart && angle < sectorEnd;
    })
    .sort((a, b) => Math.hypot(b.planet.x, b.planet.z) - Math.hypot(a.planet.x, a.planet.z));
  const picked = inSector[0] ?? planets
    .map((planet, index) => ({ planet, index }))
    .filter(({ index }) => !used.has(index))[0];
  used.add(picked.index);
  picked.planet.type = 'mine';
  return picked.planet;
}

function pickClosestFreePlanet(planets, used, origin, type) {
  const picked = planets
    .map((planet, index) => ({ planet, index, dist: distance3d(origin, planet) }))
    .filter(({ index }) => !used.has(index))
    .sort((a, b) => a.dist - b.dist)[0];
  used.add(picked.index);
  picked.planet.type = type;
  return picked.planet;
}

function createTransportShip(
  empire: PlanetStrategyEmpire,
  fromPlanetId: string,
  toPlanetId: string,
  serial: number,
  phase = 0
): PlanetStrategyShip {
  return {
    id: `s${serial}`, kind: 'transport', owner: empire.id,
    fromPlanetId, toPlanetId,
    homePlanetId: fromPlanetId, targetPlanetId: null,
    progress: phase, speed: 0.06 + rng() * 0.03,
    cargo: 0, capacity: 50, status: 'loading',
    hp: 20, maxHp: 20, attack: 0, defense: 0,
    orbitAngle: rng() * Math.PI * 2,
    orbitRadius: 10 + rng() * 8,
    orbitSpeed: 0.45 + rng() * 0.25,
    mesh: null,
  };
}

function createCombatShip(
  empire: PlanetStrategyEmpire,
  planetId: string,
  kind: Exclude<PlanetStrategyShipKind, 'transport'>,
  serial: number
): PlanetStrategyShip {
  const isAtt = kind === 'attacker';
  return {
    id: `s${serial}`, kind, owner: empire.id,
    fromPlanetId: planetId, toPlanetId: planetId,
    homePlanetId: planetId, targetPlanetId: null,
    progress: 0, speed: isAtt ? 0.075 : 0.05,
    cargo: 0, capacity: 0, status: 'orbiting',
    hp:    isAtt ? 30  : 55,
    maxHp: isAtt ? 30  : 55,
    attack:  isAtt ? 8  : 5,
    defense: isAtt ? 2  : 7,
    orbitAngle: rng() * Math.PI * 2,
    orbitRadius: 16 + rng() * 10,
    orbitSpeed: isAtt ? 0.9 + rng() * 0.4 : 0.45 + rng() * 0.2,
    mesh: null,
  };
}

function seedInitialRoutes() {
  for (const empire of world.empires) {
    touchRoute(empire.homeMineId, empire.homeFactoryId, 6);
  }
}

function touchRoute(fromPlanetId: string, toPlanetId: string, weight = 1): void {
  const key = routeKey(fromPlanetId, toPlanetId);
  if (!world.routes.has(key)) {
    const route: PlanetStrategyRoute = { fromPlanetId, toPlanetId, traffic: 0, line: null, curve: null };
    world.routes.set(key, route);
    rendererView.ensureRouteVisual(route);
  }
  const route = world.routes.get(key);
  if (route) route.traffic += weight;
}

function routeKey(a, b) {
  return [a, b].sort().join('::');
}

function getPlanet(id) {
  return world.planets.find((planet) => planet.id === id);
}

function getEmpire(id) {
  return world.empires.find((empire) => empire.id === id);
}

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

function runMining(step) {
  const falloffActive = world.oreFalloffStart !== null && world.time - world.oreFalloffStart < 20;
  for (const planet of world.planets) {
    if (planet.owner < 0 || planet.resources <= 0 || planet.structures.mine <= 0) continue;
    const rateScale = falloffActive ? 0.2 : 1;
    const mined = Math.min(planet.resources, planet.mineRate * (1 + planet.structures.mine * 0.5) * rateScale * step);
    planet.resources -= mined;
    planet.stock += mined;
    const empire = getEmpire(planet.owner);
    empire.mined += mined;
    world.minedTotal += mined;
    if (planet.resources <= 0) maybeLog(`depleted:${planet.id}`, `${planet.label} depleted its ore veins.`, 'warning', 1);
  }
}

function runCargoHandling(step) {
  for (const ship of world.ships) {
    const from = getPlanet(ship.fromPlanetId);
    const to = getPlanet(ship.toPlanetId);
    if (ship.status === 'loading') {
      const amount = Math.min(from.stock, ship.capacity - ship.cargo, 18 * step);
      ship.cargo += amount;
      from.stock -= amount;
      if (ship.cargo >= ship.capacity * 0.6 || from.stock <= 1) {
        ship.status = 'travel';
        ship.progress = 0;
        touchRoute(from.id, to.id, 3);
      }
    } else if (ship.status === 'unloading') {
      const amount = Math.min(ship.cargo, 18 * step);
      ship.cargo -= amount;
      if (to.underConstruction?.empireId === ship.owner) {
        to.underConstruction.progress += amount;
        if (to.underConstruction.progress >= to.underConstruction.needed) completeConstruction(to);
      } else {
        to.stock += amount;
        const empire = getEmpire(ship.owner);
        empire.delivered += amount;
        world.deliveredTotal += amount;
      }
      if (ship.cargo <= 0.01) {
        ship.cargo = 0;
        ship.status = 'travel_back';
        ship.progress = 0;
      }
    }
  }
}

function queueConstruction(empire, planet, type) {
  if (planet.underConstruction || planet.owner >= 0) return;
  planet.underConstruction = { empireId: empire.id, type, progress: 0, needed: 200 };
  maybeLog(`build:${empire.id}:${planet.id}`, `${empire.name} targets ${planet.label} for ${type} construction.`, 'empire', 5);
}

function completeConstruction(planet) {
  const { empireId, type } = planet.underConstruction;
  const empire = getEmpire(empireId);
  planet.owner = empireId;
  planet.type = type;
  if (type === 'mine') {
    planet.structures.mine = 1;
  } else {
    planet.structures.factory = 1;
    planet.factoryHp = 100;
  }
  planet.underConstruction = null;
  logEvent(`${empire?.name ?? '?'} completed ${type} on ${planet.label}!`, 'resource');
}

function updateEmpireIntentions() {
  const ctx = { world, getPlanet, distance3d, queueConstruction, maybeLog };
  for (const empire of world.empires) {
    if (empire.collapsed) {
      empire.intent = 'collapsed and drifting out of contention';
      continue;
    }
    const strategy = AI_STRATEGIES[empire.personality];
    if (strategy) strategy(empire, ctx);
  }
}

function assignRoutes() {
  for (const empire of world.empires) {
    if (empire.collapsed) continue;
    const mines         = world.planets.filter(p => p.owner === empire.id && p.structures.mine > 0 && (p.resources > 0 || p.stock > 0));
    const factories     = world.planets.filter(p => p.owner === empire.id && p.structures.factory > 0);
    const constructions = world.planets.filter(p => p.underConstruction?.empireId === empire.id);
    if (!mines.length || !factories.length) continue;

    const idleShips = world.ships.filter(s => s.owner === empire.id && (s.status === 'loading' || s.status === 'idle'));
    const factoryStock = factories.reduce((sum, f) => sum + f.stock, 0);
    const canBuild = constructions.length > 0 && factoryStock > 50;
    idleShips.forEach((ship, i) => {
      const bestMine = mines.sort((a, b) => (b.stock + b.resources * 0.05) - (a.stock + a.resources * 0.05))[0];
      // 工場stockが50以上の時だけ5隻に1隻を建設地へ
      const constTarget = canBuild && i % 5 === 0 ? constructions[0] : null;
      if (constTarget) {
        ship.fromPlanetId = bestMine.id;
        ship.toPlanetId   = constTarget.id;
      } else {
        const bestFactory = factories.sort((a, b) => distance3d(bestMine, a) - distance3d(bestMine, b))[0];
        ship.fromPlanetId = bestMine.id;
        ship.toPlanetId   = bestFactory.id;
      }
    });
  }
}

// 性格別の船種比率
const SHIP_RATIOS = {
  industrialist: { transport: 0.60, attacker: 0.28, defender: 0.12 },
  raider:        { transport: 0.28, attacker: 0.60, defender: 0.12 },
  expansionist:  { transport: 0.38, attacker: 0.50, defender: 0.12 },
  fortifier:     { transport: 0.38, attacker: 0.20, defender: 0.42 },
};

function chooseShipKind(empire) {
  const owned = world.ships.filter(s => s.owner === empire.id);
  const total = owned.length + 1;
  const t = owned.filter(s => s.kind === 'transport').length / total;
  const a = owned.filter(s => s.kind === 'attacker').length  / total;
  const ratio = SHIP_RATIOS[empire.personality] ?? SHIP_RATIOS.industrialist;
  if (t < ratio.transport) return 'transport';
  if (a < ratio.attacker)  return 'attacker';
  return 'defender';
}

function runFactories(step) {
  for (const empire of world.empires) {
    if (empire.collapsed) continue;
    const ownShips      = world.ships.filter(s => s.owner === empire.id);
    const ownedFactories = world.planets.filter(p => p.owner === empire.id && p.structures.factory > 0);

    for (const factory of ownedFactories) {
      const isHome = factory.id === empire.homeFactoryId;
      if (factory.stock >= FACTORY_MAINTENANCE_COST) {
        factory.stock -= FACTORY_MAINTENANCE_COST;
        if (factory.stalled) maybeLog(`resume:${factory.id}`, `${factory.label} recovered from ore starvation.`, 'resource', 6);
        factory.stalled = false;
        if (isHome) empire.stalledTime = Math.max(0, empire.stalledTime - step * 0.5);
      } else {
        factory.stalled = true;
        if (isHome) empire.stalledTime += step;
        maybeLog(`starved:${factory.id}`, `${factory.label} factory stalling for ore.`, 'warning', 2);
        continue;
      }

      if (factory.stock >= SHIP_BUILD_COST && ownShips.length < empire.shipCap) {
        factory.stock -= SHIP_BUILD_COST;
        const kind = chooseShipKind(empire);
        const bestMine = world.planets
          .filter(p => p.owner === empire.id && p.structures.mine > 0 && (p.resources > 0 || p.stock > 0))
          .sort((a, b) => (b.stock + b.resources * 0.05) - (a.stock + a.resources * 0.05))[0];
        const ship = kind === 'transport'
          ? createTransportShip(empire, bestMine?.id ?? empire.homeMineId, factory.id, world.shipSerial++)
          : createCombatShip(empire, factory.id, kind, world.shipSerial++);
        rendererView.attachShipMesh(ship, empire);
        world.ships.push(ship);
        empire.producedShips += 1;
        maybeLog(`newShip:${empire.id}:${kind}`, `${empire.name} launched a ${kind}.`, 'empire', 2);
      }
    }
  }
}

function updateShips(dt) {
  for (const ship of world.ships) {
    if (ship.status !== 'travel' && ship.status !== 'travel_back') continue;
    ship.progress = Math.min(1, ship.progress + dt * ship.speed);
    if (ship.progress >= 1) {
      if (ship.status === 'travel') {
        ship.status = 'unloading';
      } else {
        ship.status = 'loading';
      }
      ship.progress = 0;
    }
  }
}

// ── 惑星周回 ────────────────────────────────────────────────────────────────
function updateOrbiting(dt) {
  for (const ship of world.ships) {
    if (ship.status !== 'orbiting' && ship.status !== 'battling') continue;
    ship.orbitAngle += dt * ship.orbitSpeed;
    const pid    = ship.status === 'battling' ? ship.targetPlanetId : ship.homePlanetId;
    const planet = getPlanet(pid ?? ship.fromPlanetId);
    if (!planet || !ship.mesh) continue;
    const pSize = 5 + (planet.resources / Math.max(planet.maxResources, 1)) * 8;
    const r = ship.orbitRadius + pSize * 0.6;
    ship.mesh.position.set(
      planet.x + Math.cos(ship.orbitAngle) * r,
      planet.y + 2 + ship.owner * 1.8,
      planet.z + Math.sin(ship.orbitAngle) * r
    );
    if (ship.kind !== 'defender') {
      ship.mesh.rotation.y = ship.orbitAngle + Math.PI / 2;
    } else {
      ship.mesh.rotation.y += dt * 1.2;
    }
    const hpFrac = ship.hp / ship.maxHp;
    const intensity = ship.status === 'battling'
      ? 0.6 + Math.sin(performance.now() / 180) * 0.4
      : 0.25 + (1 - hpFrac) * 0.3;
    ship.mesh.traverse(node => { if (node.material && !Array.isArray(node.material)) node.material.emissiveIntensity = intensity; });
    ship.mesh.scale.setScalar(0.9 + hpFrac * 0.4);
  }
}

// ── 出撃判断 ────────────────────────────────────────────────────────────────
function decideAttacks() {
  for (const empire of world.empires) {
    const myAttackers = world.ships.filter(s =>
      s.owner === empire.id && s.kind === 'attacker' && s.status === 'orbiting'
    );
    if (myAttackers.length < 3) continue;

    // 工場が占領済みの場合は自軍惑星の重心を基準にする
    const ownedPlanets = world.planets.filter(p => p.owner === empire.id);
    const base = getPlanet(empire.homeFactoryId)?.owner === empire.id
      ? getPlanet(empire.homeFactoryId)
      : ownedPlanets[0] ?? null;
    const enemyPlanets = world.planets.filter(p =>
      p.owner !== empire.id &&
      p.underConstruction?.empireId !== empire.id &&
      (!base || distance3d(base, p) <= ATTACK_RANGE)
    );
    if (!enemyPlanets.length) continue;

    const scored = enemyPlanets.map(p => {
      const defCount = world.ships.filter(s =>
        s.homePlanetId === p.id && s.kind !== 'transport' &&
        (s.status === 'orbiting' || s.status === 'battling')
      ).length;
      return { p, score: defCount * 3 + distance3d(base ?? p, p) * 0.04 };
    });
    const target = scored.sort((a, b) => a.score - b.score)[0]?.p;
    if (!target) continue;

    const fleetSize = Math.max(2, Math.floor(myAttackers.length * 0.65));
    const fleet = myAttackers.slice(0, fleetSize);
    if (base) touchRoute(base.id, target.id, 8);

    for (const ship of fleet) {
      ship.status        = 'attacking';
      ship.targetPlanetId = target.id;
      ship.fromPlanetId  = base?.id ?? ship.homePlanetId;
      ship.toPlanetId    = target.id;
      ship.progress      = 0;
    }
    empire.intent = `attacking ${target.label} (fleet: ${fleetSize})`;
    logEvent(`${empire.name} launches ${fleetSize} attackers → ${target.label}!`, 'empire');
  }
}

// ── 戦闘解決 ────────────────────────────────────────────────────────────────
function capturePlanet(planet, newOwner, fleet) {
  const oldName    = planet.owner >= 0 ? (world.empires[planet.owner]?.name ?? '?') : 'neutral';
  const wasNeutral = planet.owner < 0;
  planet.owner     = newOwner;
  const newEmpire  = world.empires[newOwner];

  // 中立星で資源あり → 自動鉱山化
  if (wasNeutral && planet.structures.mine === 0 && planet.structures.factory === 0 && planet.resources > 0) {
    planet.type = 'mine';
    planet.structures.mine = 1;
  }
  // 敵工場は破壊済み（runCombatで処理）、念のためリセット
  planet.factoryHp = 0;
  // 前の帝国の建設計画を破棄
  if (planet.underConstruction && planet.underConstruction.empireId !== newOwner) {
    planet.underConstruction = null;
  }

  for (const ship of fleet) {
    ship.status         = 'orbiting';
    ship.homePlanetId   = planet.id;
    ship.targetPlanetId = null;
    ship.mesh?.traverse(node => {
      if (node.material && !Array.isArray(node.material)) {
        node.material.color?.set(newEmpire.color);
        node.material.emissive?.set(newEmpire.color);
      }
    });
  }
  if (planet.mesh) {
    planet.mesh.material.color.set(newEmpire.color);
    planet.mesh.material.emissive.set(new THREE.Color(newEmpire.color).multiplyScalar(0.18));
  }
  logEvent(`${newEmpire.name} captured ${planet.label} from ${oldName}!`, 'empire');
}

function runCombat(dt) {
  // 攻撃中の船を移動（目標が自軍になっていたら中止）
  for (const ship of world.ships) {
    if (ship.status !== 'attacking') continue;
    const target = getPlanet(ship.targetPlanetId);
    if (target && target.owner === ship.owner) {
      ship.status = 'orbiting';
      ship.homePlanetId = ship.fromPlanetId;
      ship.targetPlanetId = null;
      continue;
    }
    ship.progress = Math.min(1, ship.progress + dt * ship.speed);
    if (ship.progress >= 1) {
      ship.status   = 'battling';
      ship.progress = 1;
    }
  }

  // 惑星ごとに戦闘解決
  const contested = new Set(
    world.ships.filter(s => s.status === 'battling').map(s => s.targetPlanetId)
  );
  for (const planetId of contested) {
    const planet    = getPlanet(planetId);
    if (!planet) continue;
    const attackers = world.ships.filter(s => s.status === 'battling' && s.targetPlanetId === planetId);
    // 目標が自軍になっていたら攻撃艦を帰還させる
    if (attackers.length && planet.owner === attackers[0].owner) {
      for (const s of attackers) { s.status = 'orbiting'; s.targetPlanetId = null; s.homePlanetId = planetId; }
      continue;
    }
    const defenders = world.ships.filter(s =>
      s.owner === planet.owner && s.homePlanetId === planetId &&
      s.kind !== 'transport' && (s.status === 'orbiting' || s.status === 'battling')
    );

    const factoryAlive = () => planet.structures.factory > 0 && planet.factoryHp > 0;

    if (!defenders.length && attackers.length) {
      if (!factoryAlive()) {
        capturePlanet(planet, attackers[0].owner, attackers);
      } else {
        // 守備船なし・工場のみ残存 → 工場を直接攻撃
        for (const atk of attackers) {
          planet.factoryHp -= atk.attack * 0.2 * dt;
        }
        if (planet.factoryHp <= 0) {
          planet.factoryHp = 0;
          planet.structures.factory = 0;
          planet.stalled = false;
          maybeLog(`factoryDown:${planet.id}`, `${planet.label} factory destroyed!`, 'warning', 1);
          capturePlanet(planet, attackers[0].owner, attackers);
        }
      }
      continue;
    }

    // 1隻ずつ相互攻撃 + 工場ダメージ
    for (const atk of attackers) {
      if (defenders.length) {
        const def = defenders[Math.floor(rng() * defenders.length)];
        def.hp -= Math.max(0, atk.attack - def.defense) * dt;
      }
      if (factoryAlive()) {
        planet.factoryHp -= atk.attack * 0.1 * dt;
        if (planet.factoryHp <= 0) {
          planet.factoryHp = 0;
          planet.structures.factory = 0;
          planet.stalled = false;
          maybeLog(`factoryDown:${planet.id}`, `${planet.label} factory destroyed!`, 'warning', 1);
        }
      }
    }
    for (const def of defenders) {
      if (!attackers.length) break;
      const atk = attackers[Math.floor(rng() * attackers.length)];
      atk.hp -= Math.max(0, def.attack - atk.defense) * dt;
    }

    // 撃破
    const killed = world.ships.filter(s =>
      s.hp <= 0 && s.kind !== 'transport' &&
      (s.status === 'orbiting' || s.status === 'battling' || s.status === 'attacking')
    );
    for (const s of killed) {
      rendererView.removeShipMesh(s);
      world.kills++;
      maybeLog(`kill:${s.id}`, `A ${s.kind} ship destroyed near ${planet.label}!`, 'warning', 1);
    }
    world.ships = world.ships.filter(s => s.hp > 0 || s.kind === 'transport');

    // 決着チェック
    const stillAtk = world.ships.filter(s => s.status === 'battling' && s.targetPlanetId === planetId);
    const stillDef = world.ships.filter(s =>
      s.owner === planet.owner && s.homePlanetId === planetId &&
      s.kind !== 'transport' && (s.status === 'orbiting' || s.status === 'battling')
    );
    if (!stillDef.length && stillAtk.length && !factoryAlive()) {
      capturePlanet(planet, stillAtk[0].owner, stillAtk);
    } else if (!stillAtk.length && defenders.length) {
      maybeLog(`held:${planetId}`, `${planet.label} held — attack repelled!`, 'empire', 3);
    }
  }
}

function decayTraffic(dt) {
  for (const route of world.routes.values()) {
    route.traffic = Math.max(0, route.traffic - dt * 0.5);
  }
}

function buildWorldSummary() {
  if (world.gameOver) {
    return {
      text: world.finalSummary || 'Match finished.',
      detail: world.finalDetail || 'The empires have stopped competing.',
      busiest: [...world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0],
    };
  }
  const busiest = [...world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0];
  const starvedFactories = world.planets.filter((planet) => planet.type === 'factory' && planet.stock < 10).length;
  const depleted = world.planets.filter((planet) => planet.resources <= 0).length;
  let text = 'Empires are stretching ore lanes across the sector.';
  let detail = `${starvedFactories} factories are running thin.`;
  if (starvedFactories >= 2) {
    text = 'Ore starvation is starting to bite into factory output.';
    detail = 'Transport allocation is lagging behind demand.';
  } else if ((busiest?.traffic ?? 0) > 10) {
    text = 'A few core routes are carrying most of the sector traffic.';
    detail = 'Watching those lanes explains the current balance.';
  } else if (depleted > 0) {
    text = 'Some planets have already burned through their easy ore.';
    detail = 'Empire routes will need to adapt soon.';
  }
  return { text, detail, busiest };
}

function computeVictoryScores() {
  return world.empires.map((empire) => {
    const planets = world.planets.filter((planet) => planet.owner === empire.id).length;
    const deliveredScore = empire.delivered / 10;
    const producedScore = empire.producedShips * 20;
    const planetScore = planets * 30;
    const survivalBonus = empire.collapsed ? 0 : 40;
    return {
      id: empire.id,
      name: empire.name,
      collapsed: empire.collapsed,
      deliveredScore,
      producedScore,
      planetScore,
      survivalBonus,
      total: producedScore + deliveredScore + planetScore + survivalBonus,
    };
  }).sort((a, b) => b.total - a.total);
}

function collapseEmpire(empire, reason) {
  if (empire.collapsed) return;
  empire.collapsed = true;
  empire.collapseReason = reason;
  empire.intent = `collapsed: ${reason}`;
  maybeLog(`collapse:${empire.id}`, `${empire.name} collapsed after it ${reason}.`, 'warning', 999);
}

function evaluateEmpireCollapse() {
  for (const empire of world.empires) {
    if (empire.collapsed) continue;
    const ownedPlanets = world.planets.filter((planet) => planet.owner === empire.id).length;
    const transports = world.ships.filter((ship) => ship.owner === empire.id && ship.kind === 'transport').length;
    const factory = getPlanet(empire.homeFactoryId);
    if (factory && factory.owner !== empire.id) collapseEmpire(empire, 'lost its factory planet');
    else if (ownedPlanets <= 0) collapseEmpire(empire, 'lost all planets');
    else if (transports <= 0) collapseEmpire(empire, 'lost all transport ships');
    else if (factory?.stalled && empire.stalledTime >= FACTORY_STALL_COLLAPSE_SECONDS) {
      collapseEmpire(empire, 'kept its factory stalled too long');
    }
  }
}

function finalizeMatch(reason) {
  if (world.gameOver) return;
  const scores = computeVictoryScores();
  const winner = scores[0] ?? null;
  const busiest = [...world.routes.values()].sort((a, b) => b.traffic - a.traffic)[0];
  world.gameOver = true;
  world.endReason = reason;
  world.winnerId = winner?.id ?? null;
  world.finalScores = scores;
  world.finalSummary = winner
    ? `${winner.name} wins the sector through logistics efficiency.`
    : 'No empire could secure the sector.';
  world.finalDetail = busiest
    ? `Top lane: ${busiest.fromPlanetId} ⇄ ${busiest.toPlanetId}.`
    : 'No stable route survived to the finish.';
  maybeLog('match:end', world.finalSummary, 'empire', 999);
}

function evaluateMatchState() {
  if (world.gameOver) return;
  if (world.time >= 300 && world.oreFalloffStart === null) {
    world.oreFalloffStart = world.time;
    logEvent('Sector ore veins exhausted — mining rates collapsing for 20 seconds.', 'warning');
  }
  const alive = world.empires.filter((empire) => !empire.collapsed);
  if (alive.length <= 1) {
    finalizeMatch('collapse');
    return;
  }
  const scores = computeVictoryScores();
  const leadGap = (scores[0]?.total ?? 0) - (scores[1]?.total ?? 0);
  if (world.time >= MATCH_END_SECONDS && leadGap > TIE_BREAK_DELTA) {
    finalizeMatch('time');
  } else if (world.time >= MATCH_FORCE_END_SECONDS) {
    finalizeMatch('forced');
  }
}

function updateHud() {
  const summary = buildWorldSummary();
  const scores = world.gameOver ? world.finalScores : computeVictoryScores();
  const topDelivery = [...world.empires].sort((a, b) => b.delivered - a.delivered)[0] ?? null;
  ui.update({
    elapsed: Math.floor(world.time),
    planets: world.planets.length,
    ships: world.ships.length,
    mined: Math.floor(world.minedTotal),
    moved: Math.floor(world.deliveredTotal),
    depleted: world.planets.filter((planet) => planet.resources <= 0).length,
    kills: world.kills,
    summaryText: summary.text,
    summaryDetail: summary.detail,
    busiestRoute: summary.busiest
      ? `${summary.busiest.fromPlanetId} ⇄ ${summary.busiest.toPlanetId}  traffic ${summary.busiest.traffic.toFixed(1)}`
      : 'No route established yet.',
    busiestRouteLabel: summary.busiest
      ? `${summary.busiest.fromPlanetId} ⇄ ${summary.busiest.toPlanetId}`
      : null,
    phaseLine: world.gameOver
      ? `Match complete at ${Math.floor(world.time)}s.`
      : world.time < MATCH_END_SECONDS
        ? `Running toward ${MATCH_END_SECONDS}s regulation.`
        : `Overtime until ${MATCH_FORCE_END_SECONDS}s force end.`,
    winnerLine: world.gameOver
      ? (scores[0] ? `${scores[0].name} won with ${Math.round(scores[0].total)} points.` : 'No winner decided.')
      : 'Winner not decided yet.',
    statusDetail: world.gameOver
      ? summary.detail
      : `${world.empires.filter((empire) => empire.collapsed).length} empires collapsed so far.`,
    gameOver: world.gameOver,
    winnerName: scores[0]?.name ?? null,
    topDeliveryEmpire: topDelivery?.name ?? null,
    depletedCount: world.planets.filter((planet) => planet.resources <= 0).length,
    scoreRows: scores.slice(0, 3).map((score) => ({
      name: score.name,
      collapsed: score.collapsed,
      value: Math.round(score.total),
    })),
    empireRows: world.empires.map((empire) => {
    const planets = world.planets.filter((planet) => planet.owner === empire.id);
    const stock = planets.reduce((sum, planet) => sum + planet.stock, 0);
    const transports = world.ships.filter((ship) => ship.owner === empire.id).length;
      return {
        color: empire.color,
        name: empire.name,
        intent: empire.intent,
        numbers: `${planets.length}p / ${transports}s / ${Math.floor(stock)} ore${empire.collapsed ? ' / dead' : ''}`,
      };
    }),
  });
}

function reportTelemetry() {
  const summary = buildWorldSummary();
  const scores = computeVictoryScores();
  const empires = world.empires.map((empire) => {
    const planets = world.planets.filter((planet) => planet.owner === empire.id);
    return {
      id: empire.id,
      name: empire.name,
      personality: empire.personality,
      planets: planets.length,
      stock: Math.round(planets.reduce((sum, planet) => sum + planet.stock, 0)),
      transports: world.ships.filter((ship) => ship.owner === empire.id).length,
      intent: empire.intent,
    };
  });
  reportPlanetStrategyTelemetry({
    elapsed: Math.round(world.time),
    matchEndSeconds: MATCH_END_SECONDS,
    matchForceEndSeconds: MATCH_FORCE_END_SECONDS,
    planets: world.planets.length,
    ships: world.ships.length,
    minedTotal: Math.round(world.minedTotal),
    deliveredTotal: Math.round(world.deliveredTotal),
    depletedPlanets: world.planets.filter((planet) => planet.resources <= 0).length,
    gameOver: world.gameOver,
    endReason: world.endReason,
    winnerId: world.winnerId,
    empires,
    scores: scores.map((entry) => ({
      id: entry.id,
      name: entry.name,
      total: Math.round(entry.total),
      collapsed: entry.collapsed,
      breakdown: {
        deliveredScore: Math.round(entry.deliveredScore),
        producedScore: Math.round(entry.producedScore),
        planetScore: Math.round(entry.planetScore),
        survivalBonus: Math.round(entry.survivalBonus),
      },
    })),
    finalScores: world.finalScores.map((entry) => ({
      id: entry.id,
      name: entry.name,
      total: Math.round(entry.total),
      collapsed: entry.collapsed,
    })),
    busiestRoute: summary.busiest
      ? {
          from: summary.busiest.fromPlanetId,
          to: summary.busiest.toPlanetId,
          traffic: Number(summary.busiest.traffic.toFixed(2)),
        }
      : null,
    summary: { text: summary.text, detail: summary.detail },
  });
}

function maybeLog(key, text, type, intervalSeconds) {
  const last = world.logCooldowns.get(key) || -Infinity;
  if (world.time - last < intervalSeconds) return;
  world.logCooldowns.set(key, world.time);
  logEvent(text, type);
}

function logEvent(text, type = 'info') {
  ui.log(`[${String(Math.floor(world.time)).padStart(4)}s] ${text}`, type);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateWorld(dt);
  rendererView.renderFrame();
}

window.__planetStrategy = { world, computeVictoryScores, finalizeMatch };
animate();

// バックグラウンドタブでも動作するようにMessageChannelでループを補完
{
  const mc = new MessageChannel();
  let lastBg = performance.now();
  mc.port1.onmessage = () => {
    if (document.visibilityState !== 'hidden') { mc.port2.postMessage(0); return; }
    const now = performance.now();
    const dt = Math.min((now - lastBg) / 1000, 0.05);
    lastBg = now;
    if (!world.gameOver) updateWorld(dt);
    mc.port2.postMessage(0);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastBg = performance.now();
      mc.port2.postMessage(0);
    }
  });
  // ロード時点で既にhiddenの場合も即起動
  if (document.visibilityState === 'hidden') {
    lastBg = performance.now();
    mc.port2.postMessage(0);
  }
}

window.addEventListener('resize', () => rendererView.onResize());

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
