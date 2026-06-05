import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  RNG,
  STYLE,
  buildAdj,
  buildEdges,
  buildScene,
  buildTopology,
  edgeKey,
  makeMats,
  tickEdges,
} from './network-core.js';

const TOTAL = 30 + (Math.random() * 18 | 0);
const SEED = Math.random() * 1e9 | 0;
const BG = 0x0b2114;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.004);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 700);
camera.position.set(0, 76, 138);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.04;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.24;
controls.minDistance = 35;
controls.maxDistance = 300;
controls.target.set(0, 8, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.15, 0.45, 0.08));

scene.add(new THREE.AmbientLight(0x183522, 3));
const keyLight = new THREE.DirectionalLight(0xf2ffe8, 1.4);
keyLight.position.set(22, 62, 36);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x2a9c73, 0.9);
fillLight.position.set(-38, 28, -46);
scene.add(fillLight);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clickable = [];

const topo = buildTopology(TOTAL, SEED, 'smallworld', 34);
const spinData = [];
const edgeMap = new Map();
const allEdges = [];
const mats = makeMats();
const serverGlow = buildScene(topo, scene, spinData);
buildEdges(topo, scene, edgeMap, allEdges, mats);

const adj = buildAdj(topo.nodes, edgeMap);
const rng = new RNG(SEED + 11);
const pulses = [];
const game = {
  mode: 'immune',
  elapsed: 0,
  nextPulse: 0.2,
  nextCarnivore: 1.4,
  nextStress: 2.2,
};

const grid = new THREE.GridHelper(200, 40, 0x163322, 0x0d2116);
grid.position.y = -26;
scene.add(grid);

for (const node of topo.nodes) {
  node.resource = 0.62 + rng.next() * 0.22;
  node.threat = rng.next() < 0.12 ? 0.28 + rng.next() * 0.22 : 0;
  node.immune = rng.next() < 0.2 ? 0.18 + rng.next() * 0.2 : 0;
  node.carnivore = rng.next() < 0.04 ? 0.1 + rng.next() * 0.16 : 0;
  node.baseStyle = STYLE[node.isServer ? 'server' : node.layer];
  node.material = node.mesh.material;
  node.halo = node.mesh.children[0];
  node.mesh.userData.node = node;
  clickable.push(node.mesh);
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function averageNeighbors(node, key) {
  const neighbors = adj.get(node.id) || [];
  if (!neighbors.length) return 0;
  return neighbors.reduce((sum, neighbor) => sum + neighbor[key], 0) / neighbors.length;
}

function seedCarnivore(force = false) {
  const candidates = topo.nodes
    .filter(node => node.resource > 0.45 && (node.threat > 0.18 || averageNeighbors(node, 'threat') > 0.16))
    .sort((a, b) => (
      b.resource + averageNeighbors(b, 'threat') + b.threat * 0.55 - b.carnivore * 0.8
    ) - (
      a.resource + averageNeighbors(a, 'threat') + a.threat * 0.55 - a.carnivore * 0.8
    ));
  if (!candidates.length) return false;
  const node = rng.pick(candidates.slice(0, Math.min(6, candidates.length)));
  node.carnivore = clamp(node.carnivore + (force ? 0.12 : 0.05 + rng.next() * 0.07));
  node.resource = clamp(node.resource - 0.06);
  return true;
}

function seedThreat() {
  const candidates = topo.nodes
    .filter(node => node.resource > 0.5 && node.threat < 0.35)
    .sort((a, b) => (
      b.resource - b.threat * 0.5 + b.carnivore * 0.28 - averageNeighbors(b, 'threat') * 0.25
    ) - (
      a.resource - a.threat * 0.5 + a.carnivore * 0.28 - averageNeighbors(a, 'threat') * 0.25
    ));
  const node = candidates.length ? rng.pick(candidates.slice(0, Math.min(8, candidates.length))) : rng.pick(topo.nodes);
  node.threat = clamp(node.threat + 0.12 + rng.next() * 0.1);
  node.resource = clamp(node.resource - 0.04);
}

function primeInitialEcology() {
  const avgThreat = topo.nodes.reduce((sum, node) => sum + node.threat, 0) / topo.nodes.length;
  const avgCarnivore = topo.nodes.reduce((sum, node) => sum + node.carnivore, 0) / topo.nodes.length;
  if (avgThreat < 0.06) {
    seedThreat();
    seedThreat();
    seedThreat();
  }
  if (avgCarnivore < 0.02) {
    seedCarnivore(true);
    seedCarnivore(true);
    seedCarnivore(true);
  }
}

primeInitialEcology();

function setMessage(text, alert = false) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = alert ? 'alert' : '';
}

function setMode(mode) {
  game.mode = mode;
  document.getElementById('seed-immune').classList.toggle('active', mode === 'immune');
  document.getElementById('seed-threat').classList.toggle('active', mode === 'threat');
}

function interactNode(node) {
  if (!node) return;
  if (game.mode === 'immune') {
    node.immune = clamp(node.immune + 0.5);
    node.resource = clamp(node.resource + 0.12);
    setMessage(`Immune culture seeded at node ${node.id}.`);
  } else {
    node.threat = clamp(node.threat + 0.45);
    node.resource = clamp(node.resource - 0.15);
    setMessage(`Threat bloom introduced at node ${node.id}.`, true);
  }
}

function updateEcology(dt) {
  const next = new Map();
  for (const node of topo.nodes) {
    const neighborThreat = averageNeighbors(node, 'threat');
    const neighborImmune = averageNeighbors(node, 'immune');
    const neighborResource = averageNeighbors(node, 'resource');
    const neighborCarnivore = averageNeighbors(node, 'carnivore');

    const crowding = Math.max(0, node.threat + node.immune + node.carnivore - 1.05);
    const threatBirth = (0.07 + neighborThreat * 0.38 + node.carnivore * 0.12) * (0.45 + node.resource * 0.35);
    const immuneBirth = (node.threat * 0.4 + neighborThreat * neighborImmune * 0.22) * (0.45 + node.resource);
    const immuneDecay = node.immune * (0.1 + Math.max(0, 0.22 - node.threat - neighborThreat) * 0.34);
    const immuneSuppression = node.immune * (0.42 + neighborImmune * 0.16);
    const preyPressure = node.threat + neighborThreat * 0.65;
    const carnivoreBirth = preyPressure * (0.08 + node.carnivore * 0.12 + neighborCarnivore * 0.22) * node.resource;
    const starvation = node.carnivore * (0.025 + Math.max(0, 0.16 - preyPressure) * 0.08 + Math.max(0, node.carnivore - 0.28) * 0.9);
    const predation = node.carnivore * (0.06 + neighborCarnivore * 0.03);
    const resourceRecovery = 0.14 + neighborResource * 0.08;

    next.set(node, {
      threat: clamp(node.threat + dt * (threatBirth - immuneSuppression - predation - 0.012 - crowding * 0.18)),
      immune: clamp(node.immune + dt * (immuneBirth - immuneDecay - crowding * 0.12)),
      carnivore: clamp(node.carnivore + dt * (carnivoreBirth - starvation - crowding * 0.16)),
      resource: clamp(node.resource + dt * (resourceRecovery - node.threat * 0.3 - node.immune * 0.08 - node.carnivore * 0.12)),
    });
  }

  for (const [node, state] of next) {
    node.threat = state.threat;
    node.immune = state.immune;
    node.carnivore = state.carnivore;
    node.resource = state.resource;
  }
}

function updateNodeVisuals() {
  const healthy = new THREE.Color(0x79d984);
  const immune = new THREE.Color(0x57d7ff);
  const threat = new THREE.Color(0xff5b3d);
  const carnivore = new THREE.Color(0xffd35a);
  const depleted = new THREE.Color(0x4a514b);

  for (const node of topo.nodes) {
    const color = depleted.clone().lerp(healthy, node.resource);
    color.lerp(immune, node.immune * 0.72);
    color.lerp(threat, node.threat * 0.82);
    color.lerp(carnivore, node.carnivore * 0.9);

    node.material.color.copy(color);
    node.material.emissive.copy(color).multiplyScalar(0.34 + node.immune * 0.42 + node.threat * 0.35 + node.carnivore * 0.48);
    node.material.emissiveIntensity = node.baseStyle.emI + node.immune * 1.5 + node.threat * 1.2 + node.carnivore * 1.7;
    if (node.halo?.material) {
      node.halo.material.color.copy(color);
      node.halo.material.opacity = node.baseStyle.hOp + node.immune * 0.08 + node.threat * 0.12 + node.carnivore * 0.13;
    }
  }
}

function updateHud() {
  const totals = topo.nodes.reduce((acc, node) => {
    acc.resource += node.resource;
    acc.threat += node.threat;
    acc.immune += node.immune;
    acc.carnivore += node.carnivore;
    return acc;
  }, { resource: 0, threat: 0, immune: 0, carnivore: 0 });
  const count = topo.nodes.length;
  const balance = Math.round(balanceScore(totals, count) * 100);
  document.getElementById('balance').textContent = balance;
  document.getElementById('immune').textContent = Math.round((totals.immune / count) * 100);
  document.getElementById('stress').textContent = Math.round((totals.threat / count) * 100);
  document.getElementById('carnivore').textContent = ((totals.carnivore / count) * 100).toFixed(1);
}

function balanceScore(totals, count) {
  const avgResource = totals.resource / count;
  const avgThreat = totals.threat / count;
  const avgImmune = totals.immune / count;
  const avgCarnivore = totals.carnivore / count;
  const targetThreat = 0.16;
  const targetCarnivore = 0.22;
  const activityPenalty = Math.abs(avgThreat - targetThreat) * 0.9 + Math.abs(avgCarnivore - targetCarnivore) * 0.9;
  const immunePenalty = Math.max(0, avgImmune - 0.24) * 0.45;
  const resourcePenalty = Math.max(0, 0.58 - avgResource) * 0.7;
  const overgrowthPenalty = Math.max(0, avgThreat + avgCarnivore - 0.55) * 0.55;
  return clamp(0.92 - activityPenalty - immunePenalty - resourcePenalty - overgrowthPenalty);
}

function ecosystemSnapshot() {
  const totals = topo.nodes.reduce((acc, node) => {
    acc.resource += node.resource;
    acc.threat += node.threat;
    acc.immune += node.immune;
    acc.carnivore += node.carnivore;
    return acc;
  }, { resource: 0, threat: 0, immune: 0, carnivore: 0 });
  const count = topo.nodes.length;
  const balance = balanceScore(totals, count);
  const hotspots = topo.nodes
    .filter(node => node.threat > 0.18 || node.carnivore > 0.18 || node.resource < 0.35)
    .sort((a, b) => (b.threat + b.carnivore - b.resource * 0.35) - (a.threat + a.carnivore - a.resource * 0.35))
    .slice(0, 6)
    .map(node => ({
      id: node.id,
      layer: node.isServer ? 'server' : node.layer,
      resource: Number(node.resource.toFixed(3)),
      threat: Number(node.threat.toFixed(3)),
      immune: Number(node.immune.toFixed(3)),
      carnivore: Number(node.carnivore.toFixed(3)),
    }));

  return {
    elapsed: Math.round(game.elapsed),
    mode: game.mode,
    nodes: count,
    balance: Math.round(balance * 100),
    idealBalanceRange: [70, 90],
    avgResource: Number((totals.resource / count).toFixed(3)),
    avgThreat: Number((totals.threat / count).toFixed(3)),
    avgImmune: Number((totals.immune / count).toFixed(3)),
    avgCarnivore: Number((totals.carnivore / count).toFixed(3)),
    activeNodes: topo.nodes.filter(node => node.threat > 0.05 || node.carnivore > 0.05).length,
    coexistNodes: topo.nodes.filter(node => node.threat > 0.05 && node.carnivore > 0.05).length,
    activePulses: pulses.length,
    hotspots,
  };
}

function reportTelemetry() {
  window.Telemetry?.report('network_ecosystem', ecosystemSnapshot());
}

function spawnPulse() {
  const active = topo.nodes.filter(node => node.threat > 0.05 || node.immune > 0.1 || node.carnivore > 0.05);
  if (!active.length || pulses.length > 48) return;
  const source = rng.pick(active);
  const neighbors = adj.get(source.id) || [];
  if (!neighbors.length) return;
  const target = rng.pick(neighbors);
  const pulseType = source.carnivore > source.threat && source.carnivore > source.immune ? 'carnivore' : source.threat > source.immune ? 'threat' : 'immune';
  const edge = edgeMap.get(edgeKey(source.id, target.id));
  if (!edge) return;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(pulseType === 'threat' ? 0.48 : pulseType === 'carnivore' ? 0.54 : 0.42, 8, 8),
    new THREE.MeshBasicMaterial({ color: pulseType === 'threat' ? 0xff684d : pulseType === 'carnivore' ? 0xffd35a : 0x77eaff })
  );
  scene.add(mesh);
  pulses.push({ mesh, edge, from: source, t: 0, speed: 0.45 + rng.next() * 0.35, pulseType });
}

function updatePulses(dt, now) {
  game.nextPulse -= dt;
  if (game.nextPulse <= 0) {
    spawnPulse();
    game.nextPulse = 0.045 + rng.next() * 0.075;
  }

  for (let index = pulses.length - 1; index >= 0; index--) {
    const pulse = pulses[index];
    pulse.t += dt * pulse.speed;
    if (pulse.t >= 1) {
      scene.remove(pulse.mesh);
      pulse.mesh.geometry.dispose();
      pulse.mesh.material.dispose();
      pulses.splice(index, 1);
      continue;
    }
    pulse.mesh.position.copy(pulse.edge.curve.getPoint(pulse.edge.an === pulse.from ? pulse.t : 1 - pulse.t));
    pulse.edge.activeUntil = Math.max(pulse.edge.activeUntil, now + 0.25);
  }
}

function updateCarnivoreSpawns(dt) {
  game.nextCarnivore -= dt;
  if (game.nextCarnivore > 0) return;

  const totalCarnivore = topo.nodes.reduce((sum, node) => sum + node.carnivore, 0);
  const totalThreat = topo.nodes.reduce((sum, node) => sum + node.threat, 0);
  const maxThreat = topo.nodes.reduce((max, node) => Math.max(max, node.threat, averageNeighbors(node, 'threat')), 0);
  const avgCarnivore = totalCarnivore / topo.nodes.length;
  const avgThreat = totalThreat / topo.nodes.length;
  const force = avgCarnivore < 0.05 && maxThreat > 0.16;
  const spawned = (maxThreat > 0.08 || avgThreat > 0.06) && avgCarnivore < 0.24 ? seedCarnivore(force) : false;
  game.nextCarnivore = spawned ? 1.6 + rng.next() * 1.8 : 0.9 + rng.next() * 1.2;
}

function updateStressSpawns(dt) {
  game.nextStress -= dt;
  if (game.nextStress > 0) return;

  const totals = topo.nodes.reduce((acc, node) => {
    acc.threat += node.threat;
    acc.carnivore += node.carnivore;
    return acc;
  }, { threat: 0, carnivore: 0 });
  const avgThreat = totals.threat / topo.nodes.length;
  const avgCarnivore = totals.carnivore / topo.nodes.length;
  if (avgThreat < 0.22 && avgCarnivore < 0.48) {
    seedThreat();
    if (avgThreat < 0.12) seedThreat();
  }
  game.nextStress = 2.2 + rng.next() * 2.8;
}

document.getElementById('seed-immune').addEventListener('click', () => setMode('immune'));
document.getElementById('seed-threat').addEventListener('click', () => setMode('threat'));

window.addEventListener('pointerdown', event => {
  pointer.x = (event.clientX / innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickable, false);
  if (hits.length) interactNode(hits[0].object.userData.node);
});

const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;
  elapsed += dt;
  game.elapsed += dt;

  for (const { mesh, s } of spinData) {
    if (s.rx) mesh.rotation.x += dt * s.rx;
    if (s.rz) mesh.rotation.z += dt * s.rz;
    if (s.ry) mesh.rotation.y += dt * s.ry;
  }

  serverGlow.intensity = 2.6 + Math.sin(elapsed * 1.1) * 0.45;
  updateStressSpawns(dt);
  updateCarnivoreSpawns(dt);
  updateEcology(dt);
  updateNodeVisuals();
  updatePulses(dt, now);
  updateHud();
  reportTelemetry();
  tickEdges(allEdges, mats, now);
  controls.update();
  composer.render();
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
