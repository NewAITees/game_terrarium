import type {
  PlanetStrategyConstructionType,
  PlanetStrategyEmpire,
  PlanetStrategyPersonality,
  PlanetStrategyPlanet,
  PlanetStrategyPosition,
  PlanetStrategyRoute,
  PlanetStrategyShip,
  PlanetStrategyShipKind,
} from '../../shared/types/planet_strategy.js';

export function createPlanetStrategyBootstrap({
  colors,
  distance3d,
  personalities,
  rng,
}: any) {
  const world = createWorld();

  function createWorld() {
    const planets: PlanetStrategyPlanet[] = [];
    const empires: PlanetStrategyEmpire[] = [];
    const ships: PlanetStrategyShip[] = [];
    const missiles: any[] = [];
    const routes = new Map<string, PlanetStrategyRoute>();
    const routeStats: any[] = [];
    let shipSerial = 0;
    let missileSerial = 0;
    const empireConfigs = [
      { name: 'Aster Union', color: colors[0] },
      { name: 'Red Meridian', color: colors[1] },
      { name: 'Verdant Ring', color: colors[2] },
    ];
    const count = 15;
    const positions = generatePlanetPositions(count, {
      maxAttempts: 120,
      maxRadius: 300,
      minDistance: 72,
      minRadius: 80,
      verticalRange: 120,
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
        structures: { mine: 0, factory: 0, turret: 0 },
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

    const used = new Set<number>();
    empireConfigs.forEach((config, empireId) => {
      const personality = personalities[empireId % personalities.length];
      const homeMine = pickSectorMinePlanet(planets, used, empireId);
      const homeFactory = pickClosestFreePlanet(planets, used, homeMine, 'factory');
      homeMine.owner = empireId;
      homeMine.type = 'mine';
      homeMine.structures.mine = 1;
      homeMine.stock = 150;
      homeFactory.owner = empireId;
      homeFactory.type = 'factory';
      homeFactory.structures.factory = 1;
      homeFactory.structures.turret = 1;
      homeFactory.factoryHp = 100;
      homeFactory.stock = 100;
      homeFactory.productionQueue = 20;

      const empire: PlanetStrategyEmpire = {
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
        goal: 'stabilize',
      };
      empires.push(empire);

      for (let i = 0; i < 2; i++) {
        ships.push(createTransportShip(empire, homeMine.id, homeFactory.id, shipSerial++));
      }
    });

    return {
      time: 0,
      planets,
      empires,
      ships,
      missiles,
      routes,
      routeStats,
      minedTotal: 0,
      deliveredTotal: 0,
      logCooldowns: new Map(),
      shipSerial,
      missileSerial,
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

  function generatePlanetPositions(count: number, options: any): PlanetStrategyPosition[] {
    const positions: PlanetStrategyPosition[] = [];
    const {
      minRadius = 60,
      maxRadius = 260,
      minDistance = 60,
      verticalRange = 90,
      maxAttempts = 80,
    } = options;

    for (let i = 0; i < count; i++) {
      let accepted: PlanetStrategyPosition | null = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const angle = rng() * Math.PI * 2;
        const radius = minRadius + Math.sqrt(rng()) * (maxRadius - minRadius);
        const heightScale = 0.35 + (1 - radius / maxRadius) * 0.65;
        const candidate = {
          x: Math.cos(angle) * radius,
          y: (rng() - 0.5) * verticalRange * heightScale,
          z: Math.sin(angle) * radius,
        };
        if (positions.every((position) => distance3d(position, candidate) >= minDistance)) {
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

  function pickSectorMinePlanet(planets: PlanetStrategyPlanet[], used: Set<number>, sectorIndex: number) {
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

  function pickClosestFreePlanet(planets: PlanetStrategyPlanet[], used: Set<number>, origin: PlanetStrategyPlanet, type: PlanetStrategyConstructionType) {
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
  ): PlanetStrategyShip {
    const origin = getPlanet(fromPlanetId);
    return {
      id: `s${serial}`,
      kind: 'transport',
      owner: empire.id,
      fromPlanetId,
      toPlanetId,
      homePlanetId: fromPlanetId,
      targetPlanetId: null,
      position: getDockPosition(origin ?? null, 'transport'),
      progress: 0,
      speed: 0.06 + rng() * 0.03,
      cargo: 0,
      capacity: 50,
      status: 'docked',
      hp: 20,
      maxHp: 20,
      physAttack: 0,
      laserAttack: 0,
      physDef: 0,
      heatDef: 0,
      attack: 0,
      defense: 0,
      orbitAngle: rng() * Math.PI * 2,
      orbitRadius: 10 + rng() * 8,
      orbitSpeed: 0.45 + rng() * 0.25,
      launchTimer: 0,
      fireCooldown: 0,
      mesh: null,
    };
  }

  function createCombatShip(
    empire: PlanetStrategyEmpire,
    planetId: string,
    kind: Exclude<PlanetStrategyShipKind, 'transport'>,
    serial: number
  ): PlanetStrategyShip {
    const isAttacker = kind === 'attacker';
    const isGunship = kind === 'gunship';
    return {
      id: `s${serial}`,
      kind,
      owner: empire.id,
      fromPlanetId: planetId,
      toPlanetId: planetId,
      homePlanetId: planetId,
      targetPlanetId: null,
      position: getDockPosition(getPlanet(planetId) ?? null, kind),
      progress: 0,
      speed: isAttacker ? 0.075 : isGunship ? 0.06 : 0.05,
      cargo: 0,
      capacity: 0,
      status: 'docked',
      hp: isAttacker ? 30 : isGunship ? 34 : 55,
      maxHp: isAttacker ? 30 : isGunship ? 34 : 55,
      physAttack: isAttacker ? 9 : isGunship ? 3 : 4,
      laserAttack: isAttacker ? 3 : isGunship ? 11 : 5,
      physDef: isAttacker ? 2 : isGunship ? 3 : 6,
      heatDef: isAttacker ? 2 : isGunship ? 6 : 7,
      attack: isAttacker ? 8 : isGunship ? 11 : 5,
      defense: isAttacker ? 2 : isGunship ? 6 : 7,
      orbitAngle: rng() * Math.PI * 2,
      orbitRadius: 14 + rng() * 10,
      orbitSpeed: isAttacker ? 0.9 + rng() * 0.4 : isGunship ? 0.7 + rng() * 0.3 : 0.45 + rng() * 0.2,
      launchTimer: 0,
      fireCooldown: 0,
      mesh: null,
    };
  }

  function routeKey(a: string, b: string) {
    return [a, b].sort().join('::');
  }

  function getPlanet(id: string) {
    return world.planets.find((planet) => planet.id === id);
  }

  function getEmpire(id: number) {
    return world.empires.find((empire) => empire.id === id);
  }

  function getDockPosition(planet: PlanetStrategyPlanet | null | undefined, kind: PlanetStrategyShipKind) {
    if (!planet) return { x: 0, y: 0, z: 0 };
    const shipScale = kind === 'transport' ? 6.4 : kind === 'gunship' ? 7.8 : 8.8;
    const orbitAngle = kind === 'transport' ? Math.PI * 0.5 : kind === 'gunship' ? Math.PI * 0.1 : Math.PI * 0.7;
    const radius = getOrbitRadius(planet, kind) + shipScale;
    return {
      x: planet.x + Math.cos(orbitAngle) * radius,
      y: planet.y + 1.8 + (planet.type === 'factory' ? 1.8 : 0),
      z: planet.z + Math.sin(orbitAngle) * radius,
    };
  }

  function getOrbitRadius(planet: PlanetStrategyPlanet, kind: PlanetStrategyShipKind) {
    const base = planet.type === 'factory' ? 8.5 : 6.5;
    return base + (kind === 'transport' ? 2.2 : kind === 'gunship' ? 1.8 : 1.4);
  }

  function touchRoute(rendererView: any, fromPlanetId: string, toPlanetId: string, weight = 1): void {
    const key = routeKey(fromPlanetId, toPlanetId);
    if (!world.routes.has(key)) {
      const route: PlanetStrategyRoute = { fromPlanetId, toPlanetId, traffic: 0, line: null, curve: null };
      world.routes.set(key, route);
      rendererView.ensureRouteVisual(route);
    }
    const route = world.routes.get(key);
    if (route) route.traffic += weight;
  }

  function seedInitialRoutes(rendererView: any) {
    for (const empire of world.empires) {
      touchRoute(rendererView, empire.homeMineId, empire.homeFactoryId, 6);
    }
  }

  return {
    createCombatShip,
    createTransportShip,
    getEmpire,
    getPlanet,
    routeKey,
    seedInitialRoutes,
    touchRoute,
    world,
  };
}
