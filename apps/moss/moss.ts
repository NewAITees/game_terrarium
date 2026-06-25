import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bindComposerResize, startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import type {
  MossNodeSnapshot,
  MossNodeType,
  MossStateSnapshot,
} from '../../shared/types/moss.js';

const NODE_COLORS: Record<MossNodeType, number> = {
  terminal: 0x00e5ff,
  router: 0x7fffff,
  switch: 0xffffff,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07131c);
scene.fog = new THREE.FogExp2(0x07131c, 0.0035);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 1000);
camera.position.set(0, 80, 60);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 40;
controls.maxDistance = 220;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

scene.add(new THREE.HemisphereLight(0xa6dff3, 0x081018, 1.4));
const keyLight = new THREE.DirectionalLight(0xdff6ff, 1.25);
keyLight.position.set(30, 70, 24);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x234e7a, 0.72);
fillLight.position.set(-30, 15, -36);
scene.add(fillLight);

const grid = new THREE.GridHelper(100, 20, 0x234862, 0x1b3448);
grid.position.y = -0.01;
scene.add(grid);

const nodeGeometries = {
  terminal: new THREE.IcosahedronGeometry(1.5, 0),
  router: new THREE.OctahedronGeometry(2),
  switch: new THREE.BoxGeometry(3, 3, 3),
};

const edgeMaterial = new THREE.LineBasicMaterial({
  color: 0x2f6d96,
  transparent: true,
  opacity: 0.72,
});

const activeEdgeMaterial = new THREE.LineBasicMaterial({
  color: 0x00e5ff,
  transparent: true,
  opacity: 0.82,
});

const packetGeometry = new THREE.SphereGeometry(0.5, 10, 10);

type NodeVisual = {
  mesh: THREE.Mesh;
  spin: THREE.Vector3;
  type: MossNodeType;
};

const nodeVisuals = new Map<number, NodeVisual>();
const edgeVisuals = new Map<string, THREE.Line>();
const packetVisuals = new Map<number, THREE.Mesh>();
const nodePositions = new Map<number, THREE.Vector3>();
let latestState: MossStateSnapshot | null = null;
let sceneBuilt = false;
let pollingTimer: number | null = null;

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function buildNodeMesh(node: MossNodeSnapshot): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: NODE_COLORS[node.type],
    wireframe: true,
  });
  const mesh = new THREE.Mesh(nodeGeometries[node.type], material);
  mesh.position.set(node.x, node.y, node.z);
  return mesh;
}

function rebuildScene(state: MossStateSnapshot): void {
  nodeVisuals.clear();
  edgeVisuals.clear();
  nodePositions.clear();

  for (const node of state.nodes) {
    const mesh = buildNodeMesh(node);
    scene.add(mesh);
    nodePositions.set(node.id, new THREE.Vector3(node.x, node.y, node.z));
    nodeVisuals.set(node.id, {
      mesh,
      spin: new THREE.Vector3(node.spin.x, node.spin.y, node.spin.z),
      type: node.type,
    });
  }

  for (const edge of state.edges) {
    const a = nodePositions.get(edge.a);
    const b = nodePositions.get(edge.b);
    if (!a || !b) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geometry, edgeMaterial);
    scene.add(line);
    edgeVisuals.set(edgeKey(edge.a, edge.b), line);
  }

  sceneBuilt = true;
}

function getPacketMesh(id: number, color: number): THREE.Mesh {
  let mesh = packetVisuals.get(id);
  if (mesh) return mesh;
  mesh = new THREE.Mesh(
    packetGeometry,
    new THREE.MeshBasicMaterial({ color })
  );
  scene.add(mesh);
  packetVisuals.set(id, mesh);
  return mesh;
}

function applyState(state: MossStateSnapshot): void {
  if (!sceneBuilt) rebuildScene(state);
  latestState = state;

  const activeEdges = new Set(state.activeEdgeKeys);
  for (const [key, line] of edgeVisuals) {
    line.material = activeEdges.has(key) ? activeEdgeMaterial : edgeMaterial;
  }

  const seenPackets = new Set<number>();
  for (const packet of state.packets) {
    const mesh = getPacketMesh(packet.id, packet.color);
    const from = nodePositions.get(packet.startId);
    const to = nodePositions.get(packet.endId);
    if (from && to) {
      mesh.position.lerpVectors(from, to, packet.t);
    }
    mesh.visible = true;
    seenPackets.add(packet.id);
  }

  for (const [id, mesh] of packetVisuals) {
    if (!seenPackets.has(id)) mesh.visible = false;
  }

  window.Telemetry?.report('moss', {
    seed: state.seed,
    elapsed: state.elapsed,
    nodes: state.nodeCount,
    edges: state.edgeCount,
    packets: state.packetCount,
    activeEdges: state.activeEdgeKeys.length,
    typeCounts: state.typeCounts,
    avgDegree: state.avgDegree,
  });
}

async function fetchState(): Promise<void> {
  const response = await fetch('/api/moss/state');
  if (!response.ok) throw new Error(`moss state ${response.status}`);
  applyState(await response.json() as MossStateSnapshot);
}

void fetchState();
pollingTimer = window.setInterval(() => {
  void fetchState().catch((error: unknown) => {
    console.error('MOSS poll failed', error);
  });
}, 100);

startAnimationFrameLoop({
  clock: new THREE.Clock(),
  step: (dt) => {
    if (!latestState) return;
    for (const { mesh, spin } of nodeVisuals.values()) {
      mesh.rotation.x += dt * spin.x;
      mesh.rotation.y += dt * spin.y;
      mesh.rotation.z += dt * spin.z;
    }
    controls.update();
  },
  render: () => renderer.render(scene, camera),
});

bindComposerResize({
  camera,
  renderer,
});

window.addEventListener('beforeunload', () => {
  if (pollingTimer !== null) window.clearInterval(pollingTimer);
});
