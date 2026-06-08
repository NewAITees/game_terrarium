import { ACESFilmicToneMapping,AmbientLight,Color,DirectionalLight,FogExp2,GridHelper,Group,PerspectiveCamera,Scene,Vector2,WebGLRenderer, } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export function createPlanetStrategyRenderScene() {
  const scene = new Scene();
  scene.background = new Color(0x06101c);
  scene.fog = new FogExp2(0x06101c, 0.0014);

  const camera = new PerspectiveCamera(44, innerWidth / innerHeight, 0.5, 1200);
  camera.position.set(0, 155, 250);

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  document.body.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new Vector2(innerWidth, innerHeight), 1.4, 0.45, 0.06));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.15;
  controls.minDistance = 90;
  controls.maxDistance = 620;
  controls.target.set(0, 10, 0);

  scene.add(new AmbientLight(0x244060, 2.4));
  const keyLight = new DirectionalLight(0xfff0d0, 1.7);
  keyLight.position.set(80, 120, 60);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0x3355aa, 0.85);
  fillLight.position.set(-90, 60, -80);
  scene.add(fillLight);
  scene.add(new GridHelper(520, 24, 0x112034, 0x0b1626));

  const planetGroup = new Group();
  const routeGroup = new Group();
  const shipGroup = new Group();
  scene.add(planetGroup);
  scene.add(routeGroup);
  scene.add(shipGroup);

  return {
    camera,
    composer,
    controls,
    planetGroup,
    renderer,
    routeGroup,
    scene,
    shipGroup,
  };
}
