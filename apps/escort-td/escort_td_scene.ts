import { AmbientLight,BoxGeometry,CatmullRomCurve3,Color,CylinderGeometry,DirectionalLight,FogExp2,Group,Mesh,MeshBasicMaterial,MeshLambertMaterial,Object3D,PerspectiveCamera,Plane,PlaneGeometry,Raycaster,Scene,Vector2,Vector3,WebGLRenderer, } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { bindComposerResize } from '../../shared/browser-runtime.js';
import { COMMAND_MODE_LABEL, COMMAND_MODES, CS, GH, GW, VISION, g2w, w2gi, type CommandMode, type Enemy, type PieceType, type Unit } from './escort_td_core.js';

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
  onPlaceBarricade: (gx: number, gy: number) => void;
  onReclaimAt: (gx: number, gy: number) => void;
  onDeployFromKing: () => void;
  onToggleKingPause: () => void;
  onToggleForceAdvance: () => void;
  getCommandMode: () => CommandMode;
  isKingPaused: () => boolean;
  isForceAdvance: () => boolean;
  onCommandModeChange: (mode: CommandMode) => void;
  onRestart: () => void;
}): { getSelectedPiece: () => PieceType } {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  let selectedBuild: PieceType | 'barricade' = 'pawn';
  const commandButtons = COMMAND_MODES.map((mode) => document.getElementById(`cmd-${mode}`) as HTMLButtonElement | null);
  const commandModeLabel = document.getElementById('command-mode') as HTMLElement | null;
  const kingStateLabel = document.getElementById('king-state') as HTMLElement | null;
  const deployButton = document.getElementById('cmd-deploy') as HTMLButtonElement | null;
  const stopButton = document.getElementById('cmd-stop') as HTMLButtonElement | null;
  const forceButton = document.getElementById('cmd-force') as HTMLButtonElement | null;
  const buildButtons = Array.from(document.querySelectorAll('[data-build]')) as HTMLButtonElement[];

  const syncCommandMode = (): void => {
    const mode = context.getCommandMode();
    if (commandModeLabel) commandModeLabel.textContent = COMMAND_MODE_LABEL[mode];
    for (const button of commandButtons) {
      if (!button) continue;
      button.dataset.active = button.dataset.mode === mode ? 'true' : 'false';
    }
    if (kingStateLabel) kingStateLabel.textContent = context.isKingPaused() ? 'HOLD' : context.isForceAdvance() ? 'FORCE' : 'ADVANCE';
    if (stopButton) stopButton.dataset.active = context.isKingPaused() ? 'true' : 'false';
    if (forceButton) forceButton.dataset.active = context.isForceAdvance() ? 'true' : 'false';
  };

  for (const button of commandButtons) {
    if (!button) continue;
    button.addEventListener('click', () => {
      const mode = button.dataset.mode as CommandMode | undefined;
      if (!mode) return;
      context.onCommandModeChange(mode);
      syncCommandMode();
    });
  }

  for (const button of buildButtons) {
    button.addEventListener('click', () => {
      const selected = button.dataset.build as PieceType | 'barricade' | undefined;
      if (!selected) return;
      selectedBuild = selected;
      for (const other of buildButtons) other.dataset.active = String(other === button);
    });
  }

  context.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const bounds = context.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, context.camera);
    const point = raycaster.ray.intersectPlane(groundPlane, new Vector3());
    if (!point) return;
    const { gx, gy } = w2gi(point.x, point.z);
    if (event.button === 2) context.onReclaimAt(gx, gy);
    else if (selectedBuild === 'barricade') context.onPlaceBarricade(gx, gy);
    else context.onPlaceUnit(gx, gy, selectedBuild);
  });
  context.renderer.domElement.addEventListener('contextmenu', (event: MouseEvent) => event.preventDefault());

  deployButton?.addEventListener('click', () => {
    context.onDeployFromKing();
    syncCommandMode();
  });
  stopButton?.addEventListener('click', () => {
    context.onToggleKingPause();
    syncCommandMode();
  });
  forceButton?.addEventListener('click', () => {
    context.onToggleForceAdvance();
    syncCommandMode();
  });

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'r' || event.key === 'R') context.onRestart();
    if (event.key === 'd' || event.key === 'D') context.onDeployFromKing();
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      context.onToggleKingPause();
    }
    if (event.key === 'f' || event.key === 'F') context.onToggleForceAdvance();
    if (event.key === '1') context.onCommandModeChange('balanced');
    if (event.key === '2') context.onCommandModeChange('ground');
    if (event.key === '3') context.onCommandModeChange('air');
    if (event.key === '4') context.onCommandModeChange('siege');
    if (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4' || event.key === 'd' || event.key === 'D' || event.key === 'f' || event.key === 'F' || event.key === ' ' || event.code === 'Space') syncCommandMode();
  });

  syncCommandMode();

  return { getSelectedPiece: () => selectedBuild === 'barricade' ? 'pawn' : selectedBuild };
}

export function updateEscortTdVisibility(vipMesh: any, units: Unit[], enemies: Enemy[], fogCells: any[]): void {
  const sources = [
    { x: vipMesh.position.x, z: vipMesh.position.z, r: VISION.vip },
    ...units.filter((unit) => unit.type === 'pawn').map((unit) => ({ x: unit.wx, z: unit.wz, r: VISION.pawn })),
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

export function updateEscortTdHud(hud: any, vipHp: number, vipHpMax: number, gold: number, wave: number, commandMode: string): void {
  const pct = Math.max(0, vipHp / vipHpMax * 100);
  hud.hpFill.style.width = `${pct}%`;
  hud.hpFill.style.background = pct > 50 ? '#4f4' : pct > 25 ? '#fa4' : '#f44';
  hud.hpVal.textContent = String(Math.max(0, Math.ceil(vipHp)));
  hud.gold.textContent = String(gold);
  hud.wave.textContent = String(wave);
  hud.commandMode.textContent = commandMode;
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

  drawRoadNetwork(scene, city, rnd);
  drawRoadTiles(scene, city, rnd);
  drawRouteNeon(scene, city);
  drawRoadLandmarks(scene, city);

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

function drawRoadTiles(scene: any, city: any, rnd: () => number): void {
  const loader = new GLTFLoader();
  const urls = {
    straight: '/assets/kenney_space_kit/Models/GLTF format/terrain_roadStraight.glb',
    corner: '/assets/kenney_space_kit/Models/GLTF format/terrain_roadCorner.glb',
    cross: '/assets/kenney_space_kit/Models/GLTF format/terrain_roadCross.glb',
    split: '/assets/kenney_space_kit/Models/GLTF format/terrain_roadSplit.glb',
    end: '/assets/kenney_space_kit/Models/GLTF format/terrain_roadEnd.glb',
  } as const;

  const roadGroup = new Group();
  roadGroup.name = 'escort-road-tiles';
  scene.add(roadGroup);

  void Promise.all(
    Object.entries(urls).map(([key, url]) =>
      new Promise<[string, Object3D | null]>((resolve) => {
        loader.load(
          encodeURI(url),
          (gltf) => resolve([key, gltf.scene]),
          undefined,
          () => resolve([key, null])
        );
      })
    )
  ).then((entries) => {
    const templates = Object.fromEntries(entries) as Record<string, Object3D | null>;
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        if (city.g[y][x] !== 0) continue;
        const info = classifyRoadCell(city.g, x, y);
        const kind = pickRoadKind(info);
        const template = templates[kind];
        if (!template) continue;
        const tile = template.clone(true);
        tile.position.copy(g2w(x, y));
        tile.position.y = 0.03;
        tile.rotation.y = info.rotation * (Math.PI / 2);
        const scale = kind === 'cross' ? 1.08 : kind === 'split' ? 1.06 : 1.0;
        tile.scale.setScalar(scale);
        tile.traverse((obj: any) => {
          if (!obj.isMesh) return;
          obj.castShadow = true;
          obj.receiveShadow = true;
        });
        roadGroup.add(tile);

        if (rnd() < 0.12 || kind === 'cross' || kind === 'split') {
          const beacon = new Mesh(
            new CylinderGeometry(CS * 0.06, CS * 0.08, 0.6, 6),
            new MeshBasicMaterial({ color: 0x7cf7ff, transparent: true, opacity: 0.85 })
          );
          beacon.position.copy(tile.position);
          beacon.position.y = 0.5;
          roadGroup.add(beacon);
        }
      }
    }
  });
}

function drawRouteNeon(scene: any, city: any): void {
  const route = Array.isArray(city.route) ? city.route : [];
  if (route.length < 2) return;
  const mainMat = new MeshBasicMaterial({ color: 0x54f3ff, transparent: true, opacity: 0.9 });
  const altMat = new MeshBasicMaterial({ color: 0xa6ff8f, transparent: true, opacity: 0.36 });
  for (let i = 0; i < route.length - 1; i++) {
    const a = g2w(route[i].x, route[i].y);
    const b = g2w(route[i + 1].x, route[i + 1].y);
    const delta = b.clone().sub(a);
    const len = Math.max(0.4, delta.length());
    const center = a.clone().add(b).multiplyScalar(0.5);
    const mat = i % 2 === 0 ? mainMat : altMat;
    const strip = new Mesh(new BoxGeometry(len + 0.2, 0.05, CS * 0.14), mat);
    strip.position.copy(center);
    strip.position.y = 0.36;
    strip.rotation.y = Math.atan2(delta.z, delta.x);
    scene.add(strip);
  }
}

function drawRoadLandmarks(scene: any, city: any): void {
  const routes = Array.isArray(city.roads) ? city.roads : [];
  const landmarkMat = new MeshLambertMaterial({ color: 0x20344a, emissive: 0x0b1016, emissiveIntensity: 0.1 });
  for (const route of routes) {
    const points = route?.points ?? [];
    if (!points.length) continue;
    const anchors = [points[0], points[(points.length / 2) | 0], points[points.length - 1]].filter(Boolean);
    for (const pt of anchors) {
      const p = g2w(pt.x, pt.y);
      const hub = new Mesh(new CylinderGeometry(CS * 0.56, CS * 0.56, 0.42, 14), landmarkMat.clone());
      hub.position.set(p.x, 0.21, p.z);
      hub.castShadow = true;
      hub.receiveShadow = true;
      scene.add(hub);
    }
  }
}

function classifyRoadCell(grid: Uint8Array[], x: number, y: number): { dirs: Array<'N' | 'E' | 'S' | 'W'>; rotation: number } {
  const dirs: Array<'N' | 'E' | 'S' | 'W'> = [];
  if (y > 0 && grid[y - 1][x] === 0) dirs.push('N');
  if (x < grid[0].length - 1 && grid[y][x + 1] === 0) dirs.push('E');
  if (y < grid.length - 1 && grid[y + 1][x] === 0) dirs.push('S');
  if (x > 0 && grid[y][x - 1] === 0) dirs.push('W');
  return { dirs, rotation: roadRotationFor(dirs) };
}

function pickRoadKind(info: { dirs: Array<'N' | 'E' | 'S' | 'W'> }): 'straight' | 'corner' | 'cross' | 'split' | 'end' {
  const count = info.dirs.length;
  if (count >= 4) return 'cross';
  if (count === 3) return 'split';
  if (count === 2) {
    const dirs = info.dirs.join('');
    if (dirs.includes('N') && dirs.includes('S')) return 'straight';
    if (dirs.includes('E') && dirs.includes('W')) return 'straight';
    return 'corner';
  }
  return 'end';
}

function roadRotationFor(dirs: Array<'N' | 'E' | 'S' | 'W'>): number {
  if (dirs.length === 0) return 0;
  if (dirs.length === 1) {
    return ({ N: 2, E: 3, S: 0, W: 1 } as Record<'N' | 'E' | 'S' | 'W', number>)[dirs[0]];
  }
  if (dirs.length === 2) {
    const has = (dir: 'N' | 'E' | 'S' | 'W') => dirs.includes(dir);
    if (has('N') && has('S')) return 0;
    if (has('E') && has('W')) return 1;
    if (has('N') && has('E')) return 0;
    if (has('E') && has('S')) return 1;
    if (has('S') && has('W')) return 2;
    if (has('W') && has('N')) return 3;
  }
  if (dirs.length === 3) {
    if (!dirs.includes('N')) return 0;
    if (!dirs.includes('E')) return 1;
    if (!dirs.includes('S')) return 2;
    return 3;
  }
  return 0;
}

function drawRoadNetwork(scene: any, city: any, rnd: () => number): void {
  const roadMat = new MeshLambertMaterial({ color: 0x273241, emissive: 0x11161e, emissiveIntensity: 0.12 });
  const stripeMat = new MeshLambertMaterial({ color: 0x4a5a6b, emissive: 0x18222c, emissiveIntensity: 0.1 });
  const route = Array.isArray(city.route) && city.route.length > 1 ? city.route : [city.start, city.end];
  const points = route.map((pt: { x: number; y: number }) => {
    const p = g2w(pt.x, pt.y);
    return new Vector3(p.x, 0.08, p.z);
  });
  const curvePoints: Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const current = points[i].clone();
    curvePoints.push(current);
    const next = points[i + 1];
    if (!next) continue;
    const mid = current.clone().lerp(next, 0.5);
    const edge = next.clone().sub(current);
    const bend = edge.length() * (0.08 + rnd() * 0.08);
    const normal = new Vector3(-edge.z, 0, edge.x);
    if (normal.lengthSq() > 0.0001) normal.normalize().multiplyScalar((i % 2 === 0 ? 1 : -1) * bend);
    mid.add(normal);
    curvePoints.push(mid);
  }

  const curve = new CatmullRomCurve3(curvePoints, false, 'centripetal', 0.4);
  const segments = Math.max(28, curvePoints.length * 12);
  const sampled = curve.getSpacedPoints(segments);
  for (let i = 0; i < sampled.length - 1; i++) {
    const a = sampled[i];
    const b = sampled[i + 1];
    const delta = b.clone().sub(a);
    const len = delta.length();
    if (len < 0.05) continue;
    const road = new Mesh(new BoxGeometry(len + 0.1, 0.18, CS * 1.06), roadMat);
    road.position.copy(a.clone().add(b).multiplyScalar(0.5));
    road.position.y = 0.09;
    road.rotation.y = Math.atan2(delta.z, delta.x);
    road.receiveShadow = true;
    scene.add(road);

    const stripe = new Mesh(new BoxGeometry(len + 0.08, 0.04, CS * 0.18), stripeMat);
    stripe.position.copy(road.position);
    stripe.position.y = 0.19;
    stripe.rotation.y = road.rotation.y;
    scene.add(stripe);
  }

  for (let i = 0; i < route.length; i++) {
    const pt = route[i];
    const p = g2w(pt.x, pt.y);
    const radius = i === 0 || i === route.length - 1 ? CS * 0.76 : CS * 0.56;
    const node = new Mesh(
      new CylinderGeometry(radius, radius, 0.18, 14),
      new MeshLambertMaterial({ color: i === 0 ? 0x00ee88 : i === route.length - 1 ? 0xff8800 : 0x324150, emissive: 0x101820, emissiveIntensity: 0.08 })
    );
    node.position.set(p.x, 0.11, p.z);
    scene.add(node);
  }
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
    commandMode: document.getElementById('command-mode') as HTMLElement,
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
