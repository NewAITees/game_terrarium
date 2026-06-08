import { AmbientLight,BoxGeometry,Color,CylinderGeometry,DirectionalLight,FogExp2,Mesh,MeshBasicMaterial,MeshLambertMaterial,PerspectiveCamera,Plane,PlaneGeometry,Raycaster,Scene,Vector2,Vector3,WebGLRenderer, } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bindComposerResize } from '../../shared/browser-runtime.js';
import { CS, GH, GOLD_KILL, GW, PIECE, ROAD, VISION, g2w, w2gi, type Enemy, type PieceType, type Unit } from './escort_td_core.js';

export function createEscortTdScene(city: any, seed: number) {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x0d1117);
  scene.fog = new FogExp2(0x0d1117, 0.007);

  const camera = new PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 400);
  camera.position.set(0, 68, 48);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.43;
  controls.minDistance = 15;
  controls.maxDistance = 160;

  scene.add(new AmbientLight(0x223355, 3.5));
  const sun = new DirectionalLight(0xfff0e0, 2.5);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(1024);
  scene.add(sun);

  buildCityMeshes(scene, city, seed);
  const fogCells = buildFogTiles(scene);
  const hud = getHudElements();

  bindComposerResize({ camera, renderer });

  return {
    camera,
    controls,
    fogCells,
    hud,
    renderer,
    scene,
  };
}

export function bindEscortTdInputs(context: {
  camera: any;
  renderer: any;
  onPlaceUnit: (gx: number, gy: number, type: PieceType) => void;
  onRestart: () => void;
}): { getSelectedPiece: () => PieceType } {
  let selectedPiece: PieceType = 'pawn';
  document.querySelectorAll<HTMLButtonElement>('.piece-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedPiece = btn.dataset.piece as PieceType;
      document.querySelectorAll('.piece-btn').forEach((node) => node.classList.remove('sel'));
      btn.classList.add('sel');
    });
  });

  const ray = new Raycaster();
  const plane = new Plane(new Vector3(0, 1, 0), 0);
  const hitPt = new Vector3();
  context.renderer.domElement.addEventListener('click', (event: MouseEvent) => {
    ray.setFromCamera(
      new Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1),
      context.camera
    );
    if (!ray.ray.intersectPlane(plane, hitPt)) return;
    const { gx, gy } = w2gi(hitPt.x, hitPt.z);
    context.onPlaceUnit(gx, gy, selectedPiece);
  });

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'r' || event.key === 'R') context.onRestart();
  });

  return { getSelectedPiece: () => selectedPiece };
}

export function updateEscortTdVisibility(vipMesh: any, units: Unit[], enemies: Enemy[], fogCells: any[]): void {
  const sources = [
    { x: vipMesh.position.x, z: vipMesh.position.z, r: VISION.vip },
    ...units.map((unit) => ({ x: unit.wx, z: unit.wz, r: VISION[unit.type] })),
  ];
  const vis = new Uint8Array(GW * GH);

  for (const src of sources) {
    const r2 = src.r * src.r;
    const { gx: cx, gy: cy } = w2gi(src.x, src.z);
    const cells = Math.ceil(src.r / CS) + 1;
    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
        const wp = g2w(nx, ny);
        const ddx = wp.x - src.x;
        const ddz = wp.z - src.z;
        if (ddx * ddx + ddz * ddz <= r2) vis[ny * GW + nx] = 1;
      }
    }
  }

  for (let i = 0; i < fogCells.length; i++) fogCells[i].visible = vis[i] === 0;
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const { gx, gy } = w2gi(enemy.x, enemy.z);
    const idx = gy * GW + gx;
    enemy.mesh.visible = idx >= 0 && idx < vis.length && vis[idx] === 1;
  }
}

export function updateEscortTdHud(hud: any, vipHp: number, vipHpMax: number, gold: number, wave: number): void {
  const pct = Math.max(0, vipHp / vipHpMax * 100);
  hud.hpFill.style.width = `${pct}%`;
  hud.hpFill.style.background = pct > 50 ? '#4f4' : pct > 25 ? '#fa4' : '#f44';
  hud.hpVal.textContent = String(Math.max(0, Math.ceil(vipHp)));
  hud.gold.textContent = String(gold);
  hud.wave.textContent = String(wave);
}

function buildCityMeshes(scene: any, city: any, seed: number): void {
  const rnd = mkRng(seed + 7);
  const ground = new Mesh(
    new PlaneGeometry(GW * CS, GH * CS),
    new MeshLambertMaterial({ color: 0x1a2030 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = new MeshLambertMaterial({ color: 0x252f3c });
  for (let x = 0; x < GW; x += ROAD) {
    const mesh = new Mesh(new PlaneGeometry(CS * 0.92, GH * CS), roadMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x - GW / 2 + 0.5) * CS, 0.01, 0);
    scene.add(mesh);
  }
  for (let y = 0; y < GH; y += ROAD) {
    const mesh = new Mesh(new PlaneGeometry(GW * CS, CS * 0.92), roadMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.01, (y - GH / 2 + 0.5) * CS);
    scene.add(mesh);
  }

  const buildingColors = [0x2e4060, 0x1e3050, 0x3a4a5a, 0x253540, 0x303a28];
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (city.g[y][x] !== 1) continue;
      const h = 4 + rnd() * 13;
      const w = CS * (0.76 + rnd() * 0.14);
      const mesh = new Mesh(
        new BoxGeometry(w, h, w),
        new MeshLambertMaterial({ color: buildingColors[Math.floor(rnd() * buildingColors.length)] })
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const p = g2w(x, y);
      mesh.position.set(p.x, h / 2, p.z);
      scene.add(mesh);
    }
  }

  ([[city.start, 0x00ee88], [city.end, 0xff8800]] as [any, number][]).forEach(([pt, color]) => {
    const mesh = new Mesh(
      new CylinderGeometry(CS * 0.42, CS * 0.42, 0.3, 16),
      new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.5 })
    );
    mesh.position.copy(g2w(pt.x, pt.y));
    mesh.position.y = 0.2;
    scene.add(mesh);
  });
}

function buildFogTiles(scene: any): any[] {
  const fogGeo = new PlaneGeometry(CS * 0.99, CS * 0.99);
  const fogMat = new MeshBasicMaterial({
    color: 0x06080f,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  const fogCells: any[] = [];
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const mesh = new Mesh(fogGeo, fogMat);
      mesh.rotation.x = -Math.PI / 2;
      const p = g2w(gx, gy);
      mesh.position.set(p.x, 0.6, p.z);
      mesh.renderOrder = 1;
      scene.add(mesh);
      fogCells.push(mesh);
    }
  }
  return fogCells;
}

function getHudElements() {
  return {
    gold: document.getElementById('gold') as HTMLElement,
    hpFill: document.getElementById('hp-fill') as HTMLElement,
    hpVal: document.getElementById('hp-val') as HTMLElement,
    msg: document.getElementById('msg') as HTMLElement,
    wave: document.getElementById('wave') as HTMLElement,
  };
}

function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
