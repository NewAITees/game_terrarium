import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildEdges, buildScene, makeMats } from '../../shared/network-core.js';
import { bindComposerResize, startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import type { NetworkSmallWorldStateSnapshot } from '../../shared/types/network_smallworld.js';

const BG = 0x0d2040;
const BASE_EMISSIVE: Record<string, number> = {
  server: 1.8,
  core: 1.4,
  dist: 1.3,
  acc: 1.1,
  term: 1.2,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.0042);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 700);
camera.position.set(0, 72, 130);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.04;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.28;
controls.minDistance = 35;
controls.maxDistance = 300;
controls.target.set(0, 8, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.5, 0.5, 0.07));

scene.add(new THREE.AmbientLight(0x112233, 3));
const keyLight = new THREE.DirectionalLight(0xfff0cc, 1.6);
keyLight.position.set(20, 60, 30);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x2244aa, 0.8);
fillLight.position.set(-30, 20, -40);
scene.add(fillLight);
const grid = new THREE.GridHelper(200, 40, 0x0f2030, 0x0a1820);
grid.position.y = -26;
scene.add(grid);

let serverGlow: THREE.PointLight | null = null;
let spinData: Array<{ mesh: THREE.Object3D; s: { rx?: number; ry?: number; rz?: number } }> = [];
const edgeMap = new Map<string, any>();
const allEdges: any[] = [];
const mats = makeMats();
const packetMeshes = new Map<number, THREE.Mesh>();
const nodeById = new Map<number, any>();
let latestState: NetworkSmallWorldStateSnapshot | null = null;
let sceneReady = false;
let pollingTimer: number | null = null;

function rebuildScene(state: NetworkSmallWorldStateSnapshot): void {
  spinData = [];
  edgeMap.clear();
  allEdges.length = 0;
  nodeById.clear();

  const nodes = state.nodes.map((node) => ({ ...node, parent: null, children: [] as any[] }));
  for (const node of nodes) nodeById.set(node.id, node);

  const topo = {
    nodes,
    treeEdges: state.edges
      .filter((edge) => !edge.shortcut)
      .map((edge) => ({ a: nodeById.get(edge.a), b: nodeById.get(edge.b) })),
    shortcutEdges: state.edges
      .filter((edge) => edge.shortcut)
      .map((edge) => ({ a: nodeById.get(edge.a), b: nodeById.get(edge.b) })),
    server: nodeById.get(state.serverNodeId),
  };

  serverGlow = buildScene(topo, scene, spinData);
  buildEdges(topo, scene, edgeMap, allEdges, mats);
  sceneReady = true;
}

function getPacketMesh(id: number, color: number): THREE.Mesh {
  let mesh = packetMeshes.get(id);
  if (mesh) return mesh;
  mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.37, 7, 7),
    new THREE.MeshBasicMaterial({ color })
  );
  scene.add(mesh);
  packetMeshes.set(id, mesh);
  return mesh;
}

function applyState(state: NetworkSmallWorldStateSnapshot): void {
  if (!sceneReady) rebuildScene(state);
  latestState = state;

  const activeEdges = new Set(state.activeEdgeKeys);
  for (const edge of allEdges) {
    const key = `${Math.min(edge.an.id, edge.bn.id)}-${Math.max(edge.an.id, edge.bn.id)}`;
    edge.line.material = activeEdges.has(key)
      ? (edge.shortcut ? mats.sA : mats.tA)
      : (edge.shortcut ? mats.sI : mats.tI);
  }

  const glowByNode = new Map(state.glowNodes.map((node) => [node.id, node.intensity]));
  for (const node of nodeById.values()) {
    const base = BASE_EMISSIVE[node.isServer ? 'server' : node.layer] ?? 1;
    node.mesh.material.emissiveIntensity = base + (glowByNode.get(node.id) ?? 0) * 6;
  }

  const seenPackets = new Set<number>();
  for (const packet of state.packets) {
    const mesh = getPacketMesh(packet.id, packet.color);
    const edge = edgeMap.get(`${Math.min(packet.fromId, packet.toId)}-${Math.max(packet.fromId, packet.toId)}`);
    if (edge) {
      const forward = edge.an.id === packet.fromId;
      mesh.position.copy(edge.curve.getPoint(forward ? packet.t : 1 - packet.t));
    }
    mesh.visible = true;
    seenPackets.add(packet.id);
  }

  for (const [id, mesh] of packetMeshes) {
    if (!seenPackets.has(id)) mesh.visible = false;
  }
}

async function fetchState(): Promise<void> {
  const response = await fetch('/api/network-smallworld/state');
  if (!response.ok) throw new Error(`smallworld state ${response.status}`);
  const state = await response.json() as NetworkSmallWorldStateSnapshot;
  applyState(state);
  window.Telemetry?.report('network_smallworld', {
    seed: state.seed,
    rewirePct: state.rewirePct,
    elapsed: Math.round(state.elapsed),
    nodes: state.nodes.length,
    treeEdges: state.treeEdgeCount,
    shortcutEdges: state.shortcutEdgeCount,
    packets: state.packets.length,
    activeEdges: state.activeEdgeKeys.length,
    glowingNodes: state.glowNodes.filter((node) => node.intensity > 0.05).length,
    serverNode: state.serverNodeId,
  });
}

function startPolling(): void {
  void fetchState();
  pollingTimer = window.setInterval(() => {
    void fetchState().catch((error: unknown) => {
      console.error('Network smallworld poll failed', error);
    });
  }, 100);
}

startAnimationFrameLoop({
  clock: new THREE.Clock(),
  step: (dt) => {
    if (!latestState) return;
    for (const { mesh, s } of spinData) {
      if (s.rx) mesh.rotation.x += dt * s.rx;
      if (s.rz) mesh.rotation.z += dt * s.rz;
      if (s.ry) mesh.rotation.y += dt * s.ry;
    }
    if (serverGlow) {
      serverGlow.intensity = 3 + Math.sin(latestState.elapsed * 1.3) * 0.8;
    }
    controls.update();
  },
  render: () => composer.render(),
});

bindComposerResize({
  camera,
  renderer,
  composer,
});

document.getElementById('bg')?.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement;
  const color = new THREE.Color(target.value);
  scene.background = color;
  scene.fog.color = color;
});

window.addEventListener('beforeunload', () => {
  if (pollingTimer !== null) window.clearInterval(pollingTimer);
});

startPolling();
