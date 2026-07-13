import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bindComposerResize, startAnimationFrameLoop } from '../../shared/browser-runtime.js';
import type {
  CityTrafficCarSnapshot,
  CityTrafficHeading,
  CityTrafficIntersectionSnapshot,
  CityTrafficStateSnapshot,
} from '../../shared/types/city_traffic.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe3f2);
scene.fog = new THREE.FogExp2(0xcfe3f2, 0.0024);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 1500);
camera.position.set(0, 130, 108);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.42;
document.body.appendChild(renderer.domElement);

const ctrl = new OrbitControls(camera, renderer.domElement);
ctrl.target.set(0, 0, 0);
ctrl.enableDamping = true;
ctrl.dampingFactor = 0.06;
ctrl.enablePan = false;
ctrl.minDistance = 55;
ctrl.maxDistance = 300;
ctrl.maxPolarAngle = Math.PI * 0.455;

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(innerWidth, innerHeight) },
    blurStrength: { value: 0.0 },
    focusLine: { value: 0.5 },
    focusWidth: { value: 0.16 },
    gradient: { value: 0.28 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float blurStrength;
    uniform float focusLine;
    uniform float focusWidth;
    uniform float gradient;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - focusLine);
      float mask = smoothstep(focusWidth, focusWidth + gradient, d);
      vec2 texel = 1.0 / resolution;
      vec2 dir = vec2(1.0, 0.65);
      vec2 r = texel * blurStrength * mask * dir;
      vec4 c = vec4(0.0);
      c += texture2D(tDiffuse, vUv - 4.0 * r) * 0.05;
      c += texture2D(tDiffuse, vUv - 3.0 * r) * 0.09;
      c += texture2D(tDiffuse, vUv - 2.0 * r) * 0.12;
      c += texture2D(tDiffuse, vUv - 1.0 * r) * 0.15;
      c += texture2D(tDiffuse, vUv)           * 0.18;
      c += texture2D(tDiffuse, vUv + 1.0 * r) * 0.15;
      c += texture2D(tDiffuse, vUv + 2.0 * r) * 0.12;
      c += texture2D(tDiffuse, vUv + 3.0 * r) * 0.09;
      c += texture2D(tDiffuse, vUv + 4.0 * r) * 0.05;
      gl_FragColor = c;
    }
  `,
};

const VividShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.34 },
    contrast: { value: 1.16 },
    brightness: { value: 1.08 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb * brightness;
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const tiltShiftPass = new ShaderPass(TiltShiftShader);
composer.addPass(tiltShiftPass);
const vividPass = new ShaderPass(VividShader);
composer.addPass(vividPass);

const APERTURE_LEVELS: Record<string, number> = { off: 0, weak1: 1.7, weak2: 2.2, weak3: 2.8 };
let tiltMode = 'weak2';
let targetAperture = APERTURE_LEVELS.weak2;
const tiltLabelEl = document.getElementById('tilt-label') as HTMLDivElement;
const tiltButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#tilt-ui button[data-tilt]'));

function setTiltMode(mode: string): void {
  tiltMode = mode;
  for (const btn of tiltButtons) btn.classList.toggle('active', btn.dataset.tilt === mode);
}
for (const btn of tiltButtons) btn.addEventListener('click', () => setTiltMode(btn.dataset.tilt ?? 'off'));
setTiltMode(tiltMode);

scene.add(new THREE.HemisphereLight(0xf2f8ff, 0xa4b5c2, 1.35));
const sun = new THREE.DirectionalLight(0xfff8ee, 1.42);
sun.position.set(90, 160, 55);
scene.add(sun);

const signalMaterials = {
  rOff: new THREE.MeshStandardMaterial({ color: 0x4c0a0a }),
  rOn: new THREE.MeshStandardMaterial({ color: 0xff2424, emissive: 0xcc1010, emissiveIntensity: 1.1 }),
  yOff: new THREE.MeshStandardMaterial({ color: 0x362400 }),
  yOn: new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xddaa00, emissiveIntensity: 1.1 }),
  gOff: new THREE.MeshStandardMaterial({ color: 0x073010 }),
  gOn: new THREE.MeshStandardMaterial({ color: 0x1af060, emissive: 0x10cc3a, emissiveIntensity: 1.1 }),
};

const poleGeo = new THREE.CylinderGeometry(0.065, 0.085, 3.8, 6);
const unitArmGeo = new THREE.BoxGeometry(1, 0.08, 0.08);
const dropGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.45, 6);
const boxGeo = new THREE.BoxGeometry(0.42, 1.18, 0.22);
const litGeo = new THREE.SphereGeometry(0.11, 6, 4);
const visorGeo = new THREE.BoxGeometry(0.24, 0.04, 0.12);
const poleMt = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.82 });
const boxMt = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.85 });

const headingYaw: Record<CityTrafficHeading, number> = { E: Math.PI / 2, W: -Math.PI / 2, S: 0, N: Math.PI };

const vehicleLoader = new GLTFLoader();
const vehicleTemplates = new Map<string, { ready: boolean; template: THREE.Group | null; listeners: RuntimeCarVisual[] }>();
const vehicleDefs = new Map<string, string>([
  ['sedan', '/assets/kenney_car_kit/Models/GLB format/sedan.glb'],
  ['suv', '/assets/kenney_car_kit/Models/GLB format/suv.glb'],
  ['taxi', '/assets/kenney_car_kit/Models/GLB format/taxi.glb'],
  ['police', '/assets/kenney_car_kit/Models/GLB format/police.glb'],
  ['ambulance', '/assets/kenney_car_kit/Models/GLB format/ambulance.glb'],
  ['van', '/assets/kenney_car_kit/Models/GLB format/van.glb'],
  ['delivery', '/assets/kenney_car_kit/Models/GLB format/delivery.glb'],
  ['delivery-flat', '/assets/kenney_car_kit/Models/GLB format/delivery-flat.glb'],
  ['truck', '/assets/kenney_car_kit/Models/GLB format/truck.glb'],
  ['truck-flat', '/assets/kenney_car_kit/Models/GLB format/truck-flat.glb'],
  ['garbage-truck', '/assets/kenney_car_kit/Models/GLB format/garbage-truck.glb'],
  ['firetruck', '/assets/kenney_car_kit/Models/GLB format/firetruck.glb'],
  ['hatchback-sports', '/assets/kenney_car_kit/Models/GLB format/hatchback-sports.glb'],
  ['sedan-sports', '/assets/kenney_car_kit/Models/GLB format/sedan-sports.glb'],
  ['suv-luxury', '/assets/kenney_car_kit/Models/GLB format/suv-luxury.glb'],
]);

type RuntimeCarVisual = {
  group: THREE.Group;
  vehicleRoot: THREE.Group;
  vehicleKind: string;
};

type SignalHead = { rl: THREE.Mesh; yl: THREE.Mesh; gl: THREE.Mesh };
type VisualIntersection = { nsHeads: SignalHead[]; ewHeads: SignalHead[] };

let latestState: CityTrafficStateSnapshot | null = null;
let roads: number[] = [];
let hw = 1.6;
const signalVisuals = new Map<string, VisualIntersection>();
const carVisuals = new Map<number, RuntimeCarVisual>();
const cityGroup = new THREE.Group();
scene.add(cityGroup);
const signalGroup = new THREE.Group();
scene.add(signalGroup);
const carGroup = new THREE.Group();
scene.add(carGroup);

function normalizeVehicleRoot(root: THREE.Group): void {
  const box0 = new THREE.Box3().setFromObject(root);
  const size0 = new THREE.Vector3();
  box0.getSize(size0);
  if (size0.x > size0.z * 1.12) root.rotation.y = Math.PI / 2;
  const box1 = new THREE.Box3().setFromObject(root);
  const size1 = new THREE.Vector3();
  const center1 = new THREE.Vector3();
  box1.getSize(size1);
  box1.getCenter(center1);
  const fit = 2.45 / Math.max(size1.x, size1.z, 1e-6);
  root.scale.setScalar(fit);
  root.position.set(-center1.x * fit, -box1.min.y * fit, -center1.z * fit);
}

function getVehicleTemplate(key: string): { ready: boolean; template: THREE.Group | null; listeners: RuntimeCarVisual[] } {
  const cached = vehicleTemplates.get(key);
  if (cached) return cached;
  const entry = { ready: false, template: null as THREE.Group | null, listeners: [] as RuntimeCarVisual[] };
  vehicleTemplates.set(key, entry);
  const path = vehicleDefs.get(key);
  if (!path) return entry;
  vehicleLoader.load(
    path,
    (gltf) => {
      const root = gltf.scene;
      root.traverse((obj: any) => {
        if (!obj.isMesh) return;
        obj.castShadow = false;
        obj.receiveShadow = true;
      });
      normalizeVehicleRoot(root);
      entry.ready = true;
      entry.template = root;
      for (const car of entry.listeners.splice(0)) attachVehicleModel(car, key);
    },
    undefined,
    (error) => console.warn(`Failed to load vehicle ${key}`, error)
  );
  return entry;
}

function attachVehicleModel(car: RuntimeCarVisual, key: string): void {
  const entry = vehicleTemplates.get(key);
  if (!entry?.ready || !entry.template) return;
  car.vehicleRoot.clear();
  car.vehicleRoot.add(entry.template.clone(true));
  car.vehicleKind = key;
}

function ensureVehicleModel(car: RuntimeCarVisual, key: string): void {
  const entry = getVehicleTemplate(key);
  if (entry.ready) attachVehicleModel(car, key);
  else entry.listeners.push(car);
}

function laneFixedFor(heading: CityTrafficHeading, roadIndex: number, laneOff: number): number {
  const roadV = roads[roadIndex];
  if (heading === 'E') return roadV + laneOff;
  if (heading === 'W') return roadV - laneOff;
  if (heading === 'S') return roadV - laneOff;
  return roadV + laneOff;
}

function syncCarVisual(snapshot: CityTrafficCarSnapshot, laneOff: number): void {
  let visual = carVisuals.get(snapshot.id);
  if (!visual) {
    const group = new THREE.Group();
    const vehicleRoot = new THREE.Group();
    const placeholder = new THREE.Mesh(
      new THREE.BoxGeometry(1.22, 0.48, 2.15),
      new THREE.MeshStandardMaterial({ color: 0x8d97a1, roughness: 0.72, metalness: 0.08 })
    );
    placeholder.position.y = 0.24;
    vehicleRoot.add(placeholder);
    group.add(vehicleRoot);
    carGroup.add(group);
    visual = { group, vehicleRoot, vehicleKind: '' };
    carVisuals.set(snapshot.id, visual);
  }
  if (visual.vehicleKind !== snapshot.vehicleKey) ensureVehicleModel(visual, snapshot.vehicleKey);
  const laneFixed = laneFixedFor(snapshot.heading, snapshot.roadIndex, laneOff);
  if (snapshot.heading === 'E' || snapshot.heading === 'W') {
    visual.group.position.set(snapshot.pos, 0, laneFixed);
  } else {
    visual.group.position.set(laneFixed, 0, snapshot.pos);
  }
  visual.group.rotation.y = headingYaw[snapshot.heading];
}

function makeHeadOnPole(poleX: number, poleZ: number, armEndX: number, armEndZ: number, faceX: number, faceZ: number): SignalHead {
  const g = new THREE.Group();
  g.position.set(poleX, 0, poleZ);
  const pole = new THREE.Mesh(poleGeo, poleMt);
  pole.position.y = 1.9;
  g.add(pole);
  const relX = armEndX - poleX;
  const relZ = armEndZ - poleZ;
  const armLen = Math.hypot(relX, relZ);
  const arm = new THREE.Mesh(unitArmGeo, poleMt);
  arm.scale.x = armLen;
  arm.position.set(relX * 0.5, 3.82, relZ * 0.5);
  arm.rotation.y = Math.atan2(-relZ, relX);
  g.add(arm);
  const drop = new THREE.Mesh(dropGeo, poleMt);
  drop.position.set(relX, 3.58, relZ);
  g.add(drop);
  const head = new THREE.Group();
  head.position.set(relX, 3.1, relZ);
  head.rotation.y = Math.atan2(faceX, faceZ);
  const box = new THREE.Mesh(boxGeo, boxMt);
  head.add(box);
  const rl = new THREE.Mesh(litGeo, signalMaterials.rOff);
  rl.position.set(0, 0.36, 0.105);
  head.add(rl);
  const yl = new THREE.Mesh(litGeo, signalMaterials.yOff);
  yl.position.set(0, 0, 0.105);
  head.add(yl);
  const gl = new THREE.Mesh(litGeo, signalMaterials.gOff);
  gl.position.set(0, -0.36, 0.105);
  head.add(gl);
  for (const y of [0.36, 0, -0.36]) {
    const visor = new THREE.Mesh(visorGeo, poleMt);
    visor.position.set(0, y + 0.08, 0.2);
    head.add(visor);
  }
  g.add(head);
  signalGroup.add(g);
  return { rl, yl, gl };
}

function setHeadState(head: SignalHead, state: 'red' | 'yellow' | 'green'): void {
  head.rl.material = state === 'red' ? signalMaterials.rOn : signalMaterials.rOff;
  head.yl.material = state === 'yellow' ? signalMaterials.yOn : signalMaterials.yOff;
  head.gl.material = state === 'green' ? signalMaterials.gOn : signalMaterials.gOff;
}

function applySignalState(intersection: CityTrafficIntersectionSnapshot): void {
  const visual = signalVisuals.get(intersection.id);
  if (!visual) return;
  const nsState = intersection.state === 0 ? 'green' : intersection.state === 1 ? 'yellow' : 'red';
  const ewState = intersection.state === 2 ? 'green' : intersection.state === 3 ? 'yellow' : 'red';
  for (const head of visual.nsHeads) setHeadState(head, nsState);
  for (const head of visual.ewHeads) setHeadState(head, ewState);
}

function buildStaticCity(state: CityTrafficStateSnapshot): void {
  roads = state.roads;
  hw = state.config.roadW / 2;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: 0x94a8b8, roughness: 0.96 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  cityGroup.add(ground);

  const roadGroup = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x22292e, roughness: 0.92 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xe0e2b4 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x7a8898, roughness: 0.85 });
  for (const rz of roads) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(state.config.half * 2 + state.config.roadW + 0.2, 0.05, state.config.roadW), roadMat);
    r.position.set(0, 0.015, rz);
    roadGroup.add(r);
    for (let xi = 0; xi < roads.length - 1; xi++) {
      const cx = (roads[xi] + roads[xi + 1]) / 2;
      for (let d = -1.7; d <= 1.7; d += 1.7) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.11), dashMat);
        m.position.set(cx + d, 0.04, rz);
        roadGroup.add(m);
      }
    }
    for (const side of [-1, 1]) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(state.config.half * 2 + state.config.roadW + 0.2, 0.08, 0.14), curbMat);
      k.position.set(0, 0.04, rz + side * (hw + 0.07));
      roadGroup.add(k);
    }
  }
  for (const rx of roads) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(state.config.roadW, 0.05, state.config.half * 2 + state.config.roadW + 0.2), roadMat);
    r.position.set(rx, 0.015, 0);
    roadGroup.add(r);
    for (let zi = 0; zi < roads.length - 1; zi++) {
      const cz = (roads[zi] + roads[zi + 1]) / 2;
      for (let d = -1.7; d <= 1.7; d += 1.7) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 1.0), dashMat);
        m.position.set(rx, 0.04, cz + d);
        roadGroup.add(m);
      }
    }
  }
  cityGroup.add(roadGroup);

  const buildingGroup = new THREE.Group();
  for (let xi = 0; xi < roads.length - 1; xi++) {
    for (let zi = 0; zi < roads.length - 1; zi++) {
      const cx = (roads[xi] + roads[xi + 1]) / 2;
      const cz = (roads[zi] + roads[zi + 1]) / 2;
      const isPark = (xi + zi) % 5 === 0;
      if (isPark) {
        const park = new THREE.Mesh(
          new THREE.BoxGeometry(10, 0.08, 10),
          new THREE.MeshStandardMaterial({ color: 0x4a7850, roughness: 1 })
        );
        park.position.set(cx, 0.04, cz);
        buildingGroup.add(park);
        continue;
      }
      for (const dx of [-3.6, 3.6]) {
        for (const dz of [-3.6, 3.6]) {
          const h = 2.5 + ((xi * 3 + zi * 5 + (dx > 0 ? 1 : 0) + (dz > 0 ? 1 : 0)) % 5) * 1.2;
          const block = new THREE.Mesh(
            new THREE.BoxGeometry(3.8, h, 3.8),
            new THREE.MeshStandardMaterial({ color: 0xd5cec2, roughness: 0.92 })
          );
          block.position.set(cx + dx, h / 2, cz + dz);
          buildingGroup.add(block);
        }
      }
    }
  }
  cityGroup.add(buildingGroup);

  for (const inter of state.intersections) {
    const d = hw + 0.62;
    const la = state.config.laneOff;
    const inStep = 0.2;
    const nsHeads = [
      makeHeadOnPole(inter.x - d, inter.z - d, inter.x - la, inter.z - d + inStep, 0, -1),
      makeHeadOnPole(inter.x + d, inter.z + d, inter.x + la, inter.z + d - inStep, 0, 1),
    ];
    const ewHeads = [
      makeHeadOnPole(inter.x + d, inter.z - d, inter.x + d - inStep, inter.z - la, 1, 0),
      makeHeadOnPole(inter.x - d, inter.z + d, inter.x - d + inStep, inter.z - 0.15, -1, 0),
    ];
    signalVisuals.set(inter.id, { nsHeads, ewHeads });
    applySignalState(inter);
  }
}

function updateFromState(state: CityTrafficStateSnapshot): void {
  if (!latestState) buildStaticCity(state);
  latestState = state;
  for (const inter of state.intersections) applySignalState(inter);
  for (const car of state.cars) syncCarVisual(car, state.config.laneOff);
  window.Telemetry?.report('city_traffic', {
    cars: state.cars.length,
    roads: state.roads.length,
    intersections: state.intersections.length,
    avgSpeed: Number((state.cars.reduce((sum, car) => sum + car.speedNow, 0) / Math.max(1, state.cars.length)).toFixed(2)),
    stoppedCars: state.cars.filter((car) => car.speedNow < 0.05).length,
    congestion: Number((state.cars.filter((car) => car.speedNow < 0.05).length / Math.max(1, state.cars.length)).toFixed(3)),
    headings: state.cars.reduce((acc, car) => {
      acc[car.heading] = (acc[car.heading] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    signalStates: state.intersections.reduce((acc, inter) => {
      const key = inter.state === 0 ? 'nsGreen' : inter.state === 1 ? 'nsYellow' : inter.state === 2 ? 'ewGreen' : 'ewYellow';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    tiltMode,
  });
}

async function pollState(): Promise<void> {
  const response = await fetch('/api/city-traffic/state');
  if (!response.ok) throw new Error(`city traffic state ${response.status}`);
  updateFromState(await response.json() as CityTrafficStateSnapshot);
}

void pollState();
const pollId = window.setInterval(() => {
  void pollState().catch((error) => console.error('city traffic poll failed', error));
}, 100);

startAnimationFrameLoop({
  clock: new THREE.Clock(),
  step: () => {
    targetAperture = APERTURE_LEVELS[tiltMode] ?? APERTURE_LEVELS.off;
    tiltShiftPass.uniforms.blurStrength.value = THREE.MathUtils.lerp(tiltShiftPass.uniforms.blurStrength.value, targetAperture, 0.08);
    const ratio = THREE.MathUtils.clamp(targetAperture / APERTURE_LEVELS.weak3, 0, 1);
    const pct = Math.round(ratio * 100);
    const modeLabel = tiltMode === 'off' ? 'OFF' : tiltMode.replace('weak', '弱');
    tiltLabelEl.textContent = `TiltShift: ${modeLabel} (${pct}%)`;
    ctrl.update();
  },
  render: () => composer.render(),
});

bindComposerResize({
  camera,
  renderer,
  composer,
  onResize: () => tiltShiftPass.uniforms.resolution.value.set(innerWidth, innerHeight),
});

window.addEventListener('beforeunload', () => window.clearInterval(pollId));
