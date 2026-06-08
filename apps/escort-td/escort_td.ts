import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Config ────────────────────────────────────────────────────────────────
const GW = 21, GH = 17;
const CS = 5;
const ROAD = 4;

const VIP_HP_MAX  = 400;
const VIP_SPEED   = 6;
const ENEMY_SPEED_BASE = 7;
const ENEMY_HP_BASE    = 28;
const ENEMY_DMG        = 20;
const ENEMY_SEP_RADIUS = CS * 0.6;
const ENEMY_SEP_FORCE  = 3.5;

// Vision radii (world units) per source type
const VISION = {
  vip:    CS * 2.0,   // bare minimum so player isn't blind at start
  pawn:   CS * 5.0,   // main scout
  rook:   CS * 1.5,
  bishop: CS * 1.5,
  knight: CS * 1.5,
  queen:  CS * 2.0,
} as const;
const GOLD_KILL   = 8;
const START_GOLD  = 100;
const SPAWN_SEC   = 10;
const WAVE_BASE   = 8;

// ── Piece definitions ─────────────────────────────────────────────────────
type PieceType = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';

interface PieceDef {
  cost: number;
  range: number;      // world units
  fireRate: number;   // seconds between shots
  dmg: number;
  aoe: number;        // world units radius; 0 = single target
  color: number;
  emissive: number;
  makeGeo: () => any;
}

const PIECE: Record<PieceType, PieceDef> = {
  pawn: {
    cost: 40, range: CS * 3.5, fireRate: 0.48, dmg: 14, aoe: 0,
    color: 0x40e0d0, emissive: 0x0a3535,
    makeGeo: () => new THREE.CylinderGeometry(CS * 0.27, CS * 0.31, CS * 0.48, 8),
  },
  rook: {
    cost: 80, range: CS * 6, fireRate: 1.0, dmg: 38, aoe: CS * 1.6,
    color: 0x8899cc, emissive: 0x111a33,
    makeGeo: () => new THREE.BoxGeometry(CS * 0.62, CS * 0.55, CS * 0.62),
  },
  bishop: {
    cost: 70, range: CS * 8, fireRate: 1.2, dmg: 45, aoe: 0,
    color: 0xcc77ee, emissive: 0x220033,
    makeGeo: () => new THREE.ConeGeometry(CS * 0.27, CS * 0.72, 8),
  },
  knight: {
    cost: 90, range: CS * 1.8, fireRate: 0.14, dmg: 6, aoe: 0,
    color: 0xdd9944, emissive: 0x331100,
    makeGeo: () => new THREE.BoxGeometry(CS * 0.52, CS * 0.62, CS * 0.42),
  },
  queen: {
    cost: 150, range: CS * 12, fireRate: 4.0, dmg: 160, aoe: CS * 3.2,
    color: 0xffe066, emissive: 0x554400,
    makeGeo: () => new THREE.SphereGeometry(CS * 0.34, 12, 8),
  },
};

// ── Types ─────────────────────────────────────────────────────────────────
interface GridPt { x: number; y: number }
interface Enemy  { x: number; z: number; hp: number; speed: number; mesh: any; dead: boolean; hitFlash: number }
interface Unit   { type: PieceType; gx: number; gy: number; wx: number; wz: number; mesh: any; fireTimer: number }
interface Effect { mesh: any; mat: any; life: number; maxLife: number; grow: boolean }

// ── RNG ───────────────────────────────────────────────────────────────────
function mkRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── City ──────────────────────────────────────────────────────────────────
function buildCity(W: number, H: number, seed: number) {
  const rand = mkRng(seed);
  const g: Uint8Array[] = Array.from({ length: H }, () => new Uint8Array(W));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (x % ROAD !== 0 && y % ROAD !== 0)
        g[y][x] = rand() < 0.62 ? 1 : 0;
  const midY = Math.round(H / 2 / ROAD) * ROAD;
  g[midY][0] = 0;
  g[midY][W - 1] = 0;
  return { g, W, H, start: { x: 0, y: midY } as GridPt, end: { x: W - 1, y: midY } as GridPt };
}

// ── BFS flow field ────────────────────────────────────────────────────────
const D4: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];

function bfsFlow(g: Uint8Array[], W: number, H: number, goalX: number, goalY: number): Int8Array {
  const INF = 0x7fffffff;
  const dist = new Int32Array(W * H).fill(INF);
  const flow = new Int8Array(W * H).fill(-1);
  dist[goalY * W + goalX] = 0;
  const q: number[] = [goalY * W + goalX];
  for (let head = 0; head < q.length; head++) {
    const idx = q[head];
    const x = idx % W, y = (idx / W) | 0;
    const d = dist[idx];
    for (let di = 0; di < 4; di++) {
      const nx = x + D4[di][0], ny = y + D4[di][1];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (g[ny][nx] === 1 || dist[ni] < INF) continue;
      dist[ni] = d + 1;
      q.push(ni);
    }
  }
  for (let i = 0; i < W * H; i++) {
    if (dist[i] === INF) continue;
    const x = i % W, y = (i / W) | 0;
    let best = -1, bd = dist[i];
    for (let di = 0; di < 4; di++) {
      const nx = x + D4[di][0], ny = y + D4[di][1];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nd = dist[ny * W + nx];
      if (nd < bd) { bd = nd; best = di; }
    }
    flow[i] = best;
  }
  return flow;
}

// ── Coord helpers ─────────────────────────────────────────────────────────
const g2w = (gx: number, gy: number) =>
  new THREE.Vector3((gx - GW / 2 + 0.5) * CS, 0, (gy - GH / 2 + 0.5) * CS);
const w2gi = (wx: number, wz: number) => ({
  gx: Math.floor(wx / CS + GW / 2),
  gy: Math.floor(wz / CS + GH / 2),
});

// ── Three.js setup ────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.FogExp2(0x0d1117, 0.007);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 400);
camera.position.set(0, 68, 48);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.43;
controls.minDistance = 15;
controls.maxDistance = 160;

scene.add(new THREE.AmbientLight(0x223355, 3.5));
const sun = new THREE.DirectionalLight(0xfff0e0, 2.5);
sun.position.set(30, 60, 20);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(1024);
scene.add(sun);

// ── City meshes ───────────────────────────────────────────────────────────
const SEED = Date.now() & 0xffffff;
const city = buildCity(GW, GH, SEED);
const rnd2 = mkRng(SEED + 7);

const gnd = new THREE.Mesh(
  new THREE.PlaneGeometry(GW * CS, GH * CS),
  new THREE.MeshLambertMaterial({ color: 0x1a2030 })
);
gnd.rotation.x = -Math.PI / 2;
gnd.receiveShadow = true;
scene.add(gnd);

const roadMat = new THREE.MeshLambertMaterial({ color: 0x252f3c });
for (let x = 0; x < GW; x += ROAD) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(CS * 0.92, GH * CS), roadMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x - GW / 2 + 0.5) * CS, 0.01, 0);
  scene.add(m);
}
for (let y = 0; y < GH; y += ROAD) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(GW * CS, CS * 0.92), roadMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.01, (y - GH / 2 + 0.5) * CS);
  scene.add(m);
}

const bldColors = [0x2e4060, 0x1e3050, 0x3a4a5a, 0x253540, 0x303a28];
for (let y = 0; y < GH; y++) {
  for (let x = 0; x < GW; x++) {
    if (city.g[y][x] !== 1) continue;
    const h = 4 + rnd2() * 13;
    const w = CS * (0.76 + rnd2() * 0.14);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, w),
      new THREE.MeshLambertMaterial({ color: bldColors[Math.floor(rnd2() * bldColors.length)] })
    );
    m.castShadow = true; m.receiveShadow = true;
    const p = g2w(x, y);
    m.position.set(p.x, h / 2, p.z);
    scene.add(m);
  }
}

([
  [city.start, 0x00ee88],
  [city.end,   0xff8800],
] as [GridPt, number][]).forEach(([pt, col]) => {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(CS * 0.42, CS * 0.42, 0.3, 16),
    new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 })
  );
  m.position.copy(g2w(pt.x, pt.y)); m.position.y = 0.2;
  scene.add(m);
});

// ── Fog of War tiles ──────────────────────────────────────────────────────
// One plane per grid cell; toggled visible/invisible each frame based on vision
const fogGeo = new THREE.PlaneGeometry(CS * 0.99, CS * 0.99);
const fogMat = new THREE.MeshBasicMaterial({
  color: 0x06080f, transparent: true, opacity: 0.82, depthWrite: false,
});
const fogCells: any[] = [];
for (let gy = 0; gy < GH; gy++) {
  for (let gx = 0; gx < GW; gx++) {
    const m = new THREE.Mesh(fogGeo, fogMat);
    m.rotation.x = -Math.PI / 2;
    const p = g2w(gx, gy);
    m.position.set(p.x, 0.6, p.z);
    m.renderOrder = 1;
    scene.add(m);
    fogCells.push(m);
  }
}

function updateVisibility() {
  // Gather vision sources: VIP + all units
  const sources: { x: number; z: number; r: number }[] = [
    { x: vipMesh.position.x, z: vipMesh.position.z, r: VISION.vip },
    ...units.map(u => ({ x: u.wx, z: u.wz, r: VISION[u.type] })),
  ];

  const vis = new Uint8Array(GW * GH);   // 1 = visible
  for (const src of sources) {
    const r2 = src.r * src.r;
    const { gx: cx, gy: cy } = w2gi(src.x, src.z);
    const cells = Math.ceil(src.r / CS) + 1;
    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= GW || ny < 0 || ny >= GH) continue;
        const wp = g2w(nx, ny);
        const ddx = wp.x - src.x, ddz = wp.z - src.z;
        if (ddx * ddx + ddz * ddz <= r2) vis[ny * GW + nx] = 1;
      }
    }
  }

  // Fog tiles
  for (let i = 0; i < fogCells.length; i++) fogCells[i].visible = vis[i] === 0;

  // Enemies outside vision are hidden
  for (const e of enemies) {
    if (e.dead) continue;
    const { gx, gy } = w2gi(e.x, e.z);
    const idx = gy * GW + gx;
    e.mesh.visible = idx >= 0 && idx < vis.length && vis[idx] === 1;
  }
}

// ── VIP ───────────────────────────────────────────────────────────────────
const vipFlow = bfsFlow(city.g, GW, GH, city.end.x, city.end.y);

function buildVipPath(): any[] {
  const path: any[] = [];
  let x = city.start.x, y = city.start.y;
  for (let i = 0; i < GW * GH; i++) {
    path.push(g2w(x, y));
    if (x === city.end.x && y === city.end.y) break;
    const fi = vipFlow[y * GW + x];
    if (fi < 0) break;
    x += D4[fi][0]; y += D4[fi][1];
  }
  return path;
}

const vipPath = buildVipPath();

const vipMesh = new THREE.Mesh(
  new THREE.BoxGeometry(CS * 0.54, CS * 0.72, CS * 0.54),
  new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 0.35 })
);
vipMesh.castShadow = true;
vipMesh.position.copy(vipPath[0]);
vipMesh.position.y = CS * 0.36;
scene.add(vipMesh);

const vip = { hp: VIP_HP_MAX, pathIdx: 0, t: 0 };

// ── Visual effects ────────────────────────────────────────────────────────
const effects: Effect[] = [];

function spawnTracer(fx: number, fz: number, tx: number, tz: number, color: number) {
  const pts = [
    new THREE.Vector3(fx, CS * 0.32, fz),
    new THREE.Vector3(tx, CS * 0.20, tz),
  ];
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
  const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  scene.add(mesh);
  effects.push({ mesh, mat, life: 0.12, maxLife: 0.12, grow: false });
}

function spawnAOERing(tx: number, tz: number, radius: number, color: number) {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius * 0.85, radius, 32), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(tx, 0.25, tz);
  mesh.scale.setScalar(0.05);
  scene.add(mesh);
  effects.push({ mesh, mat, life: 0.4, maxLife: 0.4, grow: true });
}

// ── Enemies ───────────────────────────────────────────────────────────────
const enemies: Enemy[] = [];
let enemyFlow = bfsFlow(city.g, GW, GH, city.start.x, city.start.y);
let flowRefresh = 0;

function refreshEnemyFlow() {
  const { gx, gy } = w2gi(vipMesh.position.x, vipMesh.position.z);
  enemyFlow = bfsFlow(
    city.g, GW, GH,
    Math.max(0, Math.min(GW - 1, gx)),
    Math.max(0, Math.min(GH - 1, gy))
  );
}

const spawnCells: GridPt[] = [];
for (let y = 0; y < GH; y++) if (city.g[y][GW-1] === 0) spawnCells.push({ x: GW-1, y });
for (let x = 0; x < GW; x++) if (city.g[0][x]    === 0) spawnCells.push({ x, y: 0 });
for (let x = 0; x < GW; x++) if (city.g[GH-1][x]  === 0) spawnCells.push({ x, y: GH-1 });

const enemyGeo = new THREE.BoxGeometry(CS * 0.36, CS * 0.36, CS * 0.36);
const enemyMat = new THREE.MeshLambertMaterial({ color: 0xee2222, emissive: 0x660000, emissiveIntensity: 0.4 });

function spawnWave(n: number) {
  const count  = WAVE_BASE + n * 4;
  const hp     = ENEMY_HP_BASE    * (1 + n * 0.18);   // +18% HP per wave
  const speed  = ENEMY_SPEED_BASE * (1 + n * 0.05);   // +5%  speed per wave
  for (let i = 0; i < count; i++) {
    const c = spawnCells[(Math.random() * spawnCells.length) | 0];
    const p = g2w(c.x, c.y);
    const jx = (Math.random() - 0.5) * CS * 0.3;
    const jz = (Math.random() - 0.5) * CS * 0.3;
    // Clone material so each enemy can flash independently
    const mat = enemyMat.clone();
    const mesh = new THREE.Mesh(enemyGeo, mat);
    mesh.castShadow = true;
    mesh.position.set(p.x + jx, CS * 0.18, p.z + jz);
    scene.add(mesh);
    enemies.push({ x: p.x + jx, z: p.z + jz, hp, speed, mesh, dead: false, hitFlash: 0 });
  }
}

// ── Units ─────────────────────────────────────────────────────────────────
const units: Unit[] = [];

function placeUnit(gx: number, gy: number, type: PieceType) {
  const def = PIECE[type];
  if (state.gold < def.cost) return;
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH || city.g[gy][gx] === 1) return;
  if (units.some(u => u.gx === gx && u.gy === gy)) return;
  state.gold -= def.cost;
  const p = g2w(gx, gy);
  const mesh = new THREE.Mesh(
    def.makeGeo(),
    new THREE.MeshLambertMaterial({ color: def.color, emissive: def.emissive, emissiveIntensity: 0.35 })
  );
  mesh.castShadow = true;
  mesh.position.set(p.x, CS * 0.24, p.z);
  scene.add(mesh);
  units.push({ type, gx, gy, wx: p.x, wz: p.z, mesh, fireTimer: 0 });
  updateHUD();
}

// ── Piece selection ───────────────────────────────────────────────────────
let selectedPiece: PieceType = 'pawn';
document.querySelectorAll<HTMLButtonElement>('.piece-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedPiece = btn.dataset.piece as PieceType;
    document.querySelectorAll('.piece-btn').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
  });
});

// ── Raycasting ────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const gPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPt = new THREE.Vector3();

renderer.domElement.addEventListener('click', (e: MouseEvent) => {
  if (over || won) return;
  ray.setFromCamera(
    new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
    camera
  );
  if (!ray.ray.intersectPlane(gPlane, hitPt)) return;
  const { gx, gy } = w2gi(hitPt.x, hitPt.z);
  placeUnit(gx, gy, selectedPiece);
});

// ── HUD ───────────────────────────────────────────────────────────────────
const hpFill = document.getElementById('hp-fill') as HTMLElement;
const hpVal  = document.getElementById('hp-val')  as HTMLElement;
const goldEl = document.getElementById('gold')    as HTMLElement;
const waveEl = document.getElementById('wave')    as HTMLElement;
const msgEl  = document.getElementById('msg')     as HTMLElement;

function updateHUD() {
  const pct = Math.max(0, vip.hp / VIP_HP_MAX * 100);
  hpFill.style.width      = pct + '%';
  hpFill.style.background = pct > 50 ? '#4f4' : pct > 25 ? '#fa4' : '#f44';
  hpVal.textContent  = String(Math.max(0, Math.ceil(vip.hp)));
  goldEl.textContent = String(state.gold);
  waveEl.textContent = String(state.wave);
}

// ── Game state ────────────────────────────────────────────────────────────
const state = { gold: START_GOLD, wave: 0, spawnTimer: SPAWN_SEC * 0.35 };
let over = false, won = false;
updateHUD();

// ── Tick ──────────────────────────────────────────────────────────────────
function tick(dt: number) {
  if (over || won) return;

  // VIP advances along path
  if (vip.pathIdx < vipPath.length - 1) {
    vip.t += (VIP_SPEED / CS) * dt;
    while (vip.t >= 1 && vip.pathIdx < vipPath.length - 1) {
      vip.t -= 1;
      vip.pathIdx++;
    }
    if (vip.pathIdx < vipPath.length - 1) {
      vipMesh.position.lerpVectors(vipPath[vip.pathIdx], vipPath[vip.pathIdx + 1], vip.t);
    } else {
      vipMesh.position.copy(vipPath[vip.pathIdx]);
      won = true;
      msgEl.textContent = 'KING ESCAPED — MISSION COMPLETE\n[R] RESTART';
      msgEl.style.color = '#4f4';
      msgEl.style.whiteSpace = 'pre';
      msgEl.style.display = 'block';
      return;
    }
    vipMesh.position.y = CS * 0.36;
  }

  // Refresh flow field
  flowRefresh -= dt;
  if (flowRefresh <= 0) { flowRefresh = 1.4; refreshEnemyFlow(); }

  // Move enemies
  const hitR2 = (CS * 0.5) ** 2;
  for (const e of enemies) {
    if (e.dead) continue;
    const { gx, gy } = w2gi(e.x, e.z);
    if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) {
      const fi = enemyFlow[gy * GW + gx];
      if (fi >= 0) {
        e.x += D4[fi][0] * e.speed * dt;
        e.z += D4[fi][1] * e.speed * dt;
      }
    }
    e.mesh.position.set(e.x, CS * 0.18, e.z);
    // Hit flash decay
    if (e.hitFlash > 0) {
      e.hitFlash -= dt;
      const t = Math.max(0, e.hitFlash / 0.12);
      e.mesh.material.emissive.setHex(t > 0 ? 0xffffff : 0x660000);
      e.mesh.material.emissiveIntensity = t * 2.5 + (t === 0 ? 0.4 : 0);
    }
    const dx = e.x - vipMesh.position.x, dz = e.z - vipMesh.position.z;
    if (dx * dx + dz * dz < hitR2) {
      vip.hp -= ENEMY_DMG;
      e.dead = true;
      if (vip.hp <= 0) {
        over = true;
        msgEl.textContent = 'KING CAPTURED — MISSION FAILED\n[R] RESTART';
        msgEl.style.color = '#f44';
        msgEl.style.whiteSpace = 'pre';
        msgEl.style.display = 'block';
      }
      updateHUD();
    }
  }

  // Separation: push overlapping enemies apart
  const sepR2 = ENEMY_SEP_RADIUS * ENEMY_SEP_RADIUS;
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.dead) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b.dead) continue;
      const dx = a.x - b.x, dz = a.z - b.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < sepR2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const f = (ENEMY_SEP_RADIUS - d) / d * ENEMY_SEP_FORCE * dt;
        a.x += dx * f; a.z += dz * f;
        b.x -= dx * f; b.z -= dz * f;
      }
    }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    if (!enemies[i].dead) continue;
    scene.remove(enemies[i].mesh);
    enemies[i].mesh.material.dispose();   // each enemy has its own cloned mat
    enemies.splice(i, 1);
  }

  // Unit attacks
  for (const u of units) {
    u.fireTimer -= dt;
    if (u.fireTimer > 0) continue;
    const def = PIECE[u.type];
    const r2 = def.range * def.range;
    // Find nearest enemy in range
    let target: Enemy | null = null, best = r2;
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - u.wx, dz = e.z - u.wz;
      if (dx * dx + dz * dz < best) { best = dx * dx + dz * dz; target = e; }
    }
    if (!target || target.dead) continue;
    u.fireTimer = def.fireRate;
    // Tracer line from unit to target
    spawnTracer(u.wx, u.wz, target.x, target.z, def.color);
    // Apply damage (AOE if radius > 0)
    if (def.aoe > 0) {
      spawnAOERing(target.x, target.z, def.aoe, def.color);
      const aoe2 = def.aoe * def.aoe;
      for (const e of enemies) {
        if (e.dead) continue;
        const dx = e.x - target.x, dz = e.z - target.z;
        if (dx * dx + dz * dz <= aoe2) {
          e.hp -= def.dmg;
          e.hitFlash = 0.12;
          if (e.hp <= 0) { e.dead = true; state.gold += GOLD_KILL; }
        }
      }
    } else {
      target.hp -= def.dmg;
      target.hitFlash = 0.12;
      if (target.hp <= 0) { target.dead = true; state.gold += GOLD_KILL; }
    }
    updateHUD();
  }

  // Effects (tracers, AOE rings)
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.life -= dt;
    const t = fx.life / fx.maxLife;        // 1→0 as effect ages
    fx.mat.opacity = t * (fx.grow ? 0.55 : 1);
    if (fx.grow) fx.mesh.scale.setScalar(1 - t);  // expand from 0 to 1
    if (fx.life <= 0) {
      scene.remove(fx.mesh);
      fx.mesh.geometry.dispose();
      fx.mat.dispose();
      effects.splice(i, 1);
    }
  }

  // Spawn
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    state.spawnTimer = SPAWN_SEC;
    state.wave++;
    spawnWave(state.wave);
    waveEl.textContent = String(state.wave);
  }

  updateVisibility();
}

// ── Restart ───────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.key === 'r' || e.key === 'R') && (over || won)) location.reload();
});

// ── Render loop ───────────────────────────────────────────────────────────
const clock = new THREE.Clock();
(function animate() {
  requestAnimationFrame(animate);
  tick(Math.min(clock.getDelta(), 0.05));
  controls.update();
  renderer.render(scene, camera);
})();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
