import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { bindComposerResize, startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import {
  RNG,
  STYLE,
  buildAdj,
  buildEdges,
  buildScene,
  buildTopology,
  makeMats,
  tickEdges,
} from './network-core.js';
import {
  primeInitialEcology,
  updateCarnivoreSpawns,
  updateEcology,
  updatePulses,
  updateStressSpawns,
} from './network_ecosystem_ecology.js';
import { reportEcosystemTelemetry } from './network_ecosystem_metrics.js';
import {
  interactEcosystemNode,
  setEcosystemMode,
  updateEcosystemHud,
  updateEcosystemNodeVisuals,
} from './network_ecosystem_ui.js';
import type { EcosystemGameState, EcosystemRuntimeContext, EcosystemPulse } from '../../shared/types/network_ecosystem.js';

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
const clickable: any[] = [];

const topo = buildTopology(TOTAL, SEED, 'smallworld', 34);
const spinData: any[] = [];
const edgeMap = new Map();
const allEdges: any[] = [];
const mats = makeMats();
const serverGlow = buildScene(topo, scene, spinData);
buildEdges(topo, scene, edgeMap, allEdges, mats);

const adj = buildAdj(topo.nodes, edgeMap);
const rng = new RNG(SEED + 11);
const pulses: EcosystemPulse[] = [];
const game: EcosystemGameState = {
  mode: 'immune',
  elapsed: 0,
  nextPulse: 0.2,
  nextCarnivore: 1.4,
  nextStress: 2.2,
};
const runtime: EcosystemRuntimeContext = { topo, adj, rng, edgeMap, scene, pulses, game };

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

primeInitialEcology(runtime);
setEcosystemMode(game, 'immune');

document.getElementById('seed-immune')?.addEventListener('click', () => setEcosystemMode(game, 'immune'));
document.getElementById('seed-threat')?.addEventListener('click', () => setEcosystemMode(game, 'threat'));

window.addEventListener('pointerdown', (event: PointerEvent) => {
  pointer.x = (event.clientX / innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickable, false);
  if (hits.length) interactEcosystemNode(hits[0].object.userData.node, game);
});

const clock = new THREE.Clock();
let elapsed = 0;

function tick(dt: number, now: number): void {
  elapsed += dt;
  game.elapsed += dt;

  for (const { mesh, s } of spinData) {
    if (s.rx) mesh.rotation.x += dt * s.rx;
    if (s.rz) mesh.rotation.z += dt * s.rz;
    if (s.ry) mesh.rotation.y += dt * s.ry;
  }

  serverGlow.intensity = 2.6 + Math.sin(elapsed * 1.1) * 0.45;
  updateStressSpawns(runtime, dt);
  updateCarnivoreSpawns(runtime, dt);
  updateEcology(runtime, dt);
  updateEcosystemNodeVisuals(topo);
  updatePulses(runtime, dt, now);
  updateEcosystemHud(topo);
  reportEcosystemTelemetry(topo, pulses, game);
  tickEdges(allEdges, mats, now);
  controls.update();
  composer.render();
}

startAnimationFrameLoop({ clock, step: tick });
bindComposerResize({ camera, renderer, composer });
