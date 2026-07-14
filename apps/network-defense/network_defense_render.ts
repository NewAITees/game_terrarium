import { ACESFilmicToneMapping,AdditiveBlending,AmbientLight,BackSide,Color,DirectionalLight,FogExp2,GridHelper,Mesh,MeshBasicMaterial,PerspectiveCamera,Raycaster,Scene,SphereGeometry,Vector2,WebGLRenderer, } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildEdges, buildScene, buildTopology, makeMats } from '../../shared/network-core.js';

export function initializeNetworkDefenseRender({
  total,
  seed,
  rewirePct,
  background,
  observerMode,
  lowLoadMode,
}: {
  total: number;
  seed: number;
  rewirePct: number;
  background: number;
  observerMode: boolean;
  lowLoadMode: boolean;
}) {
  const scene = new Scene();
  scene.background = new Color(background);
  scene.fog = new FogExp2(background, 0.0042);

  const camera = new PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 700);
  camera.position.set(0, 72, 130);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
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
  const bloomPass = new UnrealBloomPass(new Vector2(innerWidth, innerHeight), 1.5, 0.5, 0.07);
  composer.addPass(bloomPass);

  scene.add(new AmbientLight(0x112233, 3));
  const keyLight = new DirectionalLight(0xfff0cc, 1.6);
  keyLight.position.set(20, 60, 30);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0x2244aa, 0.8);
  fillLight.position.set(-30, 20, -40);
  scene.add(fillLight);

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const clickable: any[] = [];
  const topo = buildTopology(total, seed, 'smallworld', rewirePct);
  const spinData: any[] = [];
  const edgeMap = new Map();
  const allEdges: any[] = [];
  const mats = makeMats();
  const serverGlow = buildScene(topo, scene, spinData);
  buildEdges(topo, scene, edgeMap, allEdges, mats);

  const grid = new GridHelper(200, 40, 0x0f2030, 0x0a1820);
  grid.position.y = -26;
  scene.add(grid);

  function applyRenderProfile(nextLowLoadMode: boolean) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, observerMode && nextLowLoadMode ? 1 : 2));
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloomPass.strength = observerMode && nextLowLoadMode ? 0.85 : 1.5;
  }

  applyRenderProfile(lowLoadMode);

  return {
    scene,
    camera,
    renderer,
    controls,
    composer,
    raycaster,
    pointer,
    clickable,
    topo,
    spinData,
    edgeMap,
    allEdges,
    mats,
    serverGlow,
    applyRenderProfile,
  };
}

function makeLevelMats(rHDR: number, gHDR: number, bHDR: number, levels = 10) {
  return Array.from({ length: levels }, (_, i) => {
    const b = i / (levels - 1);
    const mat = new MeshBasicMaterial({
      transparent: true,
      side: BackSide,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    mat.color.setRGB(rHDR * b, gHDR * b, bHDR * b);
    mat.opacity = 0.55 + b * 0.45;
    return mat;
  });
}

export function createNetworkDefenseFlashPools(scene: any) {
  const MATS_ATK = makeLevelMats(3.0, 0.08, 0.04);
  const MATS_NORM = makeLevelMats(0.1, 1.5, 3.0);
  const flashGeo = new SphereGeometry(9, 8, 8);

  function makeSpherePools(mats: any[], count: number) {
    return Array.from({ length: count }, () => {
      const mesh = new Mesh(flashGeo, mats[0]);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, t: 0, mats };
    });
  }

  const attackPool = makeSpherePools(MATS_ATK, 6);
  const normalPool = makeSpherePools(MATS_NORM, 4);

  function triggerFlash(pool: any[], node: any) {
    const slot = pool.reduce((m, f) => (f.t < m.t ? f : m));
    slot.mesh.position.set(node.x, node.y, node.z);
    slot.mesh.material = slot.mats[slot.mats.length - 1];
    slot.mesh.visible = true;
    slot.t = 1.0;
  }

  return { attackPool, normalPool, triggerFlash };
}
