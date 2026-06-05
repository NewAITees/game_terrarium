import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const COLORS = ['#7de8ff', '#ff9f80', '#c8ff8a'];
const PERSONALITIES = [
  { key: 'industrialist', summary: 'feed factories and multiply transports' },
  { key: 'raider', summary: 'stretch routes toward rich outer planets' },
  { key: 'expansionist', summary: 'claim rich frontier worlds through logistics' },
  { key: 'fortifier', summary: 'favor safe short routes and stable supply' },
];

const rng = mulberry32(Math.floor(Math.random() * 1e9));
const world = createWorld();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06101c);
scene.fog = new THREE.FogExp2(0x06101c, 0.0036);

const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.5, 1200);
camera.position.set(0, 160, 240);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.045;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.15;
controls.minDistance = 120;
controls.maxDistance = 520;
controls.target.set(0, 0, 0);

scene.add(new THREE.AmbientLight(0x244060, 2.4));
const keyLight = new THREE.DirectionalLight(0xfff0d0, 1.7);
keyLight.position.set(80, 120, 60);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x3355aa, 0.85);
fillLight.position.set(-90, 60, -80);
scene.add(fillLight);
scene.add(new THREE.GridHelper(520, 24, 0x112034, 0x0b1626));

const planetGroup = new THREE.Group();
scene.add(planetGroup);
const routeGroup = new THREE.Group();
scene.add(routeGroup);
const shipGroup = new THREE.Group();
scene.add(shipGroup);

const clock = new THREE.Clock();
let aiTick = 0;
let mineTick = 0;
let factoryTick = 0;
let telemetryTick = 0;

buildSceneObjects();
seedInitialRoutes();
logEvent('Planet strategy initialized. Logistics web coming online.', 'info');

function createWorld() {
  const planets = [];
  const empires = [];
  const ships = [];
  const routes = new Map();
  const routeStats = [];

  const empireConfigs = [
    { name: 'Aster Union', color: COLORS[0] },
    { name: 'Red Meridian', color: COLORS[1] },
    { name: 'Verdant Ring', color: COLORS[2] },
  ];

  const radius = 170;
  const count = 15;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const dist = radius + (rng() - 0.5) * 70;
    planets.push({
      id: `p${i}`,
      label: `P-${i + 1}`,
      x: Math.cos(angle) * dist,
      z: Math.sin(angle) * dist,
      resources: 220 + Math.floor(rng() * 520),
      maxResources: 220 + Math.floor(rng() * 520),
      mineRate: 2 + rng() * 3,
      owner: -1,
      stock: 0,
      type: 'neutral',
      structures: { mine: 0, factory: 0 },
      productionQueue: 0,
      trafficIn: 0,
      mesh: null,
      ring: null,
      labelGlow: null,
    });
  }

  const used = new Set();
  empireConfigs.forEach((config, empireId) => {
    const personality = PERSONALITIES[empireId % PERSONALITIES.length];
    const homeMine = pickFreePlanet(planets, used, empireId * 2, 'mine');
    const homeFactory = pickClosestFreePlanet(planets, used, homeMine, 'factory');
    homeMine.owner = empireId;
    homeMine.type = 'mine';
    homeMine.structures.mine = 1;
    homeMine.stock = 30;
    homeFactory.owner = empireId;
    homeFactory.type = 'factory';
    homeFactory.structures.factory = 1;
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
      homeMineId: homeMine.id,
      homeFactoryId: homeFactory.id,
      shipCap: personality.key === 'industrialist' ? 12 : personality.key === 'fortifier' ? 8 : 10,
    };
    empires.push(empire);

    for (let i = 0; i < 2; i++) {
      ships.push(createTransportShip(empire, homeMine.id, homeFactory.id, i * 0.5));
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
  };
}

function pickFreePlanet(planets, used, indexBias, type) {
  const candidates = planets.filter((_, index) => !used.has(index));
  const picked = candidates[indexBias % candidates.length];
  const index = planets.indexOf(picked);
  used.add(index);
  picked.type = type;
  return picked;
}

function pickClosestFreePlanet(planets, used, origin, type) {
  const picked = planets
    .map((planet, index) => ({ planet, index, dist: distance2d(origin, planet) }))
    .filter(({ index }) => !used.has(index))
    .sort((a, b) => a.dist - b.dist)[0];
  used.add(picked.index);
  picked.planet.type = type;
  return picked.planet;
}

function createTransportShip(empire, fromPlanetId, toPlanetId, phase = 0) {
  return {
    id: `s${worldLikeCount('ship') + Math.floor(rng() * 9999)}`,
    kind: 'transport',
    owner: empire.id,
    fromPlanetId,
    toPlanetId,
    progress: phase,
    speed: 0.06 + rng() * 0.03,
    cargo: 0,
    capacity: 50,
    status: 'loading',
    mesh: null,
  };
}

function worldLikeCount(kind) {
  if (kind === 'ship' && world?.ships) return world.ships.length;
  return 0;
}

function buildSceneObjects() {
  const coreGeo = new THREE.SphereGeometry(1, 18, 18);
  const ringGeo = new THREE.TorusGeometry(1.55, 0.08, 10, 36);
  const shipGeo = new THREE.BoxGeometry(1.6, 1, 2.8);

  for (const planet of world.planets) {
    const color = planet.owner >= 0 ? world.empires[planet.owner].color : '#62758a';
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color).multiplyScalar(0.18),
      metalness: 0.24,
      roughness: 0.55,
    });
    const mesh = new THREE.Mesh(coreGeo, mat);
    mesh.position.set(planet.x, 0, planet.z);
    planetGroup.add(mesh);

    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0xb9e8ff,
        transparent: true,
        opacity: 0.24,
      })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(planet.x, 0, planet.z);
    planetGroup.add(ring);

    planet.mesh = mesh;
    planet.ring = ring;
  }

  for (const ship of world.ships) {
    const empire = world.empires[ship.owner];
    const mesh = new THREE.Mesh(
      shipGeo,
      new THREE.MeshStandardMaterial({
        color: empire.color,
        emissive: new THREE.Color(empire.color).multiplyScalar(0.2),
        metalness: 0.35,
        roughness: 0.45,
      })
    );
    shipGroup.add(mesh);
    ship.mesh = mesh;
  }
}

function seedInitialRoutes() {
  for (const empire of world.empires) {
    touchRoute(empire.homeMineId, empire.homeFactoryId, 6);
  }
}

function touchRoute(fromPlanetId, toPlanetId, weight = 1) {
  const key = routeKey(fromPlanetId, toPlanetId);
  if (!world.routes.has(key)) {
    const from = getPlanet(fromPlanetId);
    const to = getPlanet(toPlanetId);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, 0, from.z),
      new THREE.Vector3(to.x, 0, to.z),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: 0x5ca8c8,
      transparent: true,
      opacity: 0.18,
    });
    const line = new THREE.Line(geometry, material);
    routeGroup.add(line);
    world.routes.set(key, {
      fromPlanetId,
      toPlanetId,
      traffic: 0,
      line,
    });
  }
  world.routes.get(key).traffic += weight;
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

function distance2d(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function updateWorld(dt) {
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
  if (aiTick >= 2) {
    updateEmpireIntentions();
    assignRoutes();
    aiTick = 0;
  }
  if (factoryTick >= 5) {
    runFactories(factoryTick);
    factoryTick = 0;
  }

  updateShips(dt);
  decayTraffic(dt);
  updateVisuals();
  updateHud();

  if (telemetryTick >= 0.5) {
    reportTelemetry();
    telemetryTick = 0;
  }
}

function runMining(step) {
  for (const planet of world.planets) {
    if (planet.owner < 0 || planet.resources <= 0 || planet.structures.mine <= 0) continue;
    const mined = Math.min(planet.resources, planet.mineRate * (1 + planet.structures.mine * 0.5) * step);
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
      to.stock += amount;
      const empire = getEmpire(ship.owner);
      empire.delivered += amount;
      world.deliveredTotal += amount;
      if (ship.cargo <= 0.01) {
        ship.cargo = 0;
        ship.status = 'travel_back';
        ship.progress = 0;
      }
    }
  }
}

function updateEmpireIntentions() {
  for (const empire of world.empires) {
    const mine = getPlanet(empire.homeMineId);
    const factory = getPlanet(empire.homeFactoryId);
    const ownShips = world.ships.filter((ship) => ship.owner === empire.id);
    const stockGap = mine.stock - factory.stock;
    if (factory.stock < 25) {
      empire.intent = 'rescue a hungry factory core';
    } else if (stockGap > 110) {
      empire.intent = 'drain ore surplus into production';
    } else if (ownShips.length < 4) {
      empire.intent = 'scale the transport wing';
    } else {
      empire.intent = empire.summary;
    }
  }
}

function assignRoutes() {
  for (const empire of world.empires) {
    const mine = getPlanet(empire.homeMineId);
    const factory = getPlanet(empire.homeFactoryId);
    for (const ship of world.ships.filter((entry) => entry.owner === empire.id && (entry.status === 'loading' || entry.status === 'idle'))) {
      ship.fromPlanetId = mine.id;
      ship.toPlanetId = factory.id;
    }
  }
}

function runFactories(step) {
  for (const empire of world.empires) {
    const factory = getPlanet(empire.homeFactoryId);
    const ownShips = world.ships.filter((ship) => ship.owner === empire.id);
    if (factory.stock >= 20 && ownShips.length < empire.shipCap) {
      factory.stock -= 20;
      const ship = createTransportShip(empire, empire.homeMineId, empire.homeFactoryId);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1, 2.8),
        new THREE.MeshStandardMaterial({
          color: empire.color,
          emissive: new THREE.Color(empire.color).multiplyScalar(0.2),
          metalness: 0.35,
          roughness: 0.45,
        })
      );
      ship.mesh = mesh;
      shipGroup.add(mesh);
      world.ships.push(ship);
      maybeLog(`newShip:${empire.id}`, `${empire.name} launched a new transport.`, 'empire', 2);
    } else if (factory.stock < 5) {
      maybeLog(`starved:${factory.id}`, `${factory.label} factory is stalling for ore.`, 'warning', 2);
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

function decayTraffic(dt) {
  for (const route of world.routes.values()) {
    route.traffic = Math.max(0, route.traffic - dt * 0.5);
  }
}

function updateVisuals() {
  for (const planet of world.planets) {
    const size = 5 + (planet.resources / Math.max(planet.maxResources, 1)) * 8;
    planet.mesh.scale.setScalar(size);
    const color = planet.owner >= 0 ? world.empires[planet.owner].color : '#5a6778';
    planet.mesh.material.color.set(color);
    planet.mesh.material.emissive.set(color).multiplyScalar(planet.owner >= 0 ? 0.18 : 0.08);
    const ringScale = 1.8 + Math.min(planet.stock / 90, 1.8);
    planet.ring.scale.setScalar(ringScale * size * 0.22);
    planet.ring.material.opacity = 0.12 + Math.min(planet.stock / 180, 0.35);
    planet.ring.material.color.set(planet.stock > 15 ? 0xa8ecff : 0x66798d);
  }

  for (const route of world.routes.values()) {
    route.line.material.opacity = 0.08 + Math.min(route.traffic / 18, 0.42);
    route.line.material.color.set(route.traffic > 8 ? 0x8adfff : 0x3f6d89);
  }

  for (const ship of world.ships) {
    const from = getPlanet(ship.fromPlanetId);
    const to = getPlanet(ship.toPlanetId);
    const origin = ship.status === 'travel_back' ? to : from;
    const target = ship.status === 'travel_back' ? from : to;
    const pos = lerpPlanet(origin, target, ship.progress);
    ship.mesh.position.set(pos.x, 4 + ship.owner * 1.7, pos.z);
    ship.mesh.rotation.y = Math.atan2(target.x - origin.x, target.z - origin.z);
    const scale = 0.8 + (ship.cargo / ship.capacity) * 0.5;
    ship.mesh.scale.set(scale, 0.9, 1.1 + (ship.cargo / ship.capacity) * 0.4);
  }
}

function lerpPlanet(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function buildWorldSummary() {
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

function updateHud() {
  const summary = buildWorldSummary();
  document.getElementById('elapsed').textContent = Math.floor(world.time);
  document.getElementById('planets').textContent = world.planets.length;
  document.getElementById('ships').textContent = world.ships.length;
  document.getElementById('mined').textContent = Math.floor(world.minedTotal);
  document.getElementById('moved').textContent = Math.floor(world.deliveredTotal);
  document.getElementById('depleted').textContent = world.planets.filter((planet) => planet.resources <= 0).length;
  document.getElementById('summary-text').textContent = summary.text;
  document.getElementById('summary-detail').textContent = summary.detail;
  document.getElementById('busiest-route').textContent = summary.busiest
    ? `${summary.busiest.fromPlanetId} ⇄ ${summary.busiest.toPlanetId}  traffic ${summary.busiest.traffic.toFixed(1)}`
    : 'No route established yet.';

  const list = document.getElementById('empire-list');
  list.innerHTML = world.empires.map((empire) => {
    const planets = world.planets.filter((planet) => planet.owner === empire.id);
    const stock = planets.reduce((sum, planet) => sum + planet.stock, 0);
    const transports = world.ships.filter((ship) => ship.owner === empire.id).length;
    return [
      `<div class="empire-row">`,
      `<div class="empire-dot" style="background:${empire.color}"></div>`,
      `<div class="empire-meta"><div class="empire-name">${empire.name}</div><div class="empire-intent">${empire.intent}</div></div>`,
      `<div class="empire-numbers">${planets.length}p / ${transports}s / ${Math.floor(stock)} ore</div>`,
      `</div>`,
    ].join('');
  }).join('');
}

function reportTelemetry() {
  const summary = buildWorldSummary();
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
  window.Telemetry?.report('planet_strategy', {
    elapsed: Math.round(world.time),
    planets: world.planets.length,
    ships: world.ships.length,
    minedTotal: Math.round(world.minedTotal),
    deliveredTotal: Math.round(world.deliveredTotal),
    depletedPlanets: world.planets.filter((planet) => planet.resources <= 0).length,
    empires,
    busiestRoute: summary.busiest
      ? {
          from: summary.busiest.fromPlanetId,
          to: summary.busiest.toPlanetId,
          traffic: Number(summary.busiest.traffic.toFixed(2)),
        }
      : null,
    summary,
  });
}

function maybeLog(key, text, type, intervalSeconds) {
  const last = world.logCooldowns.get(key) || -Infinity;
  if (world.time - last < intervalSeconds) return;
  world.logCooldowns.set(key, world.time);
  logEvent(text, type);
}

function logEvent(text, type = 'info') {
  const el = document.getElementById('log-entries');
  const div = document.createElement('div');
  div.className = `le le-${type}`;
  div.textContent = `[${String(Math.floor(world.time)).padStart(4)}s] ${text}`;
  el.appendChild(div);
  while (el.children.length > 220) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateWorld(dt);
  controls.update();
  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
