import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type {
  ColonyAction,
  ColonyFaction,
  ColonyFactionDef,
  ColonyInterventionItem,
  ColonyInterventionType,
  ColonyMap,
  ColonyNode,
  ColonyPersonality,
  ColonyRule,
  ColonyWorldState,
} from '../../shared/types/colony.js';

// ── Config ───────────────────────────────────────────────────────────────────
const NODE_COUNT     = 44;
const SEED           = Math.random() * 1e9 | 0;
const TICK_SEC       = 1.6;
const DECAY_RATE     = 0.005;
const DECAY_BY_PERSONALITY: Record<ColonyPersonality, number> = { builder: 0.003, raider: 0.010, hoarder: 0.004 };
const SPREAD         = 136;
const BG             = 0x050810;
const K_NEIGHBORS    = 4;
const NEUTRAL_RESIST = 0.30;  // 中立ノードの初期抵抗値（これを削りきると占領）

// ── RNG ──────────────────────────────────────────────────────────────────────
class RNG {
  constructor(s) { this.s = ((s || Math.random() * 2 ** 32) ^ 0xDEADBEEF) >>> 0; }
  s: number;
  next()       { let x = this.s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; return (this.s = x >>> 0) / 0x100000000; }
  range(a, b)  { return a + this.next() * (b - a); }
  int(a, b)    { return a + (this.next() * (b - a + 1) | 0); }
  pick(arr)    { return arr[this.next() * arr.length | 0]; }
}
const rng = new RNG(SEED);

// ── Faction Definitions ──────────────────────────────────────────────────────
// 私の視点：性格を視覚にも反映させる（色 + emissive intensity の違い）
const FACTION_DEFS: ColonyFactionDef[] = [
  { id: 0, name: 'CYGNUS',  personality: 'builder', color: 0x3a7fea, emCol: 0x0d2d70 },
  { id: 1, name: 'VORTEX',  personality: 'raider',  color: 0xe03a3a, emCol: 0x601010 },
  { id: 2, name: 'VERDANT', personality: 'hoarder', color: 0x3ac060, emCol: 0x0d4520 },
];

// ── Map Generation ───────────────────────────────────────────────────────────
// 私の視点：グリッドより有機的な近傍グラフ。ジッターグリッドで均一に配置
function generateMap(): ColonyMap {
  const nodes: ColonyNode[] = [];
  const perRow = Math.ceil(Math.sqrt(NODE_COUNT * 1.25));
  const cell   = SPREAD / (perRow - 1);

  while (nodes.length < NODE_COUNT) {
    const i   = nodes.length;
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x   = (col / (perRow - 1) - 0.5) * SPREAD + rng.range(-cell * 0.28, cell * 0.28);
    const z   = (row / (perRow - 1) - 0.5) * SPREAD + rng.range(-cell * 0.28, cell * 0.28);
    nodes.push({
      id: i, x, z,
      owner:      -1,
      strength:   NEUTRAL_RESIST,   // 中立ノードは最初から抵抗値あり
      food:       rng.range(10, 42),
      material:   rng.range(5, 24),
      foodRate:   rng.range(0.9, 2.8),
      isBase:     false,
      neighbors:  [],
      flashUntil: 0,
      mesh: null, halo: null, resourceRing: null,
    });
  }

  // K最近傍で接続
  const edges: ColonyMap['edges']  = [];
  const edgeSet = new Set();
  for (const n of nodes) {
    nodes
      .filter(m => m.id !== n.id)
      .map(m => ({ m, d: Math.hypot(m.x - n.x, m.z - n.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, K_NEIGHBORS)
      .forEach(({ m }) => {
        const key = `${Math.min(n.id, m.id)}-${Math.max(n.id, m.id)}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edges.push({ a: n, b: m, line: null });
        n.neighbors.push(m);
        m.neighbors.push(n);
      });
  }
  return { nodes, edges };
}

const map = generateMap();

// ── Faction State ────────────────────────────────────────────────────────────
const factions: ColonyFaction[] = FACTION_DEFS.map(def => ({
  ...def,
  food:     65,
  material: 40,
  nodes:    [],
  baseNode: null,
  intent:   'initializing…',
  alive:    true,
  rules:    [],
}));

// W / E / S 配置：中央を挟んで3方向から押し合う地形
const CORNERS = [
  { x: -SPREAD * 0.44, z:  0              },  // West  — CYGNUS
  { x:  SPREAD * 0.44, z:  0              },  // East  — VORTEX
  { x:  0,             z:  SPREAD * 0.44  },  // South — VERDANT
];
for (let i = 0; i < factions.length; i++) {
  const base = map.nodes.reduce((b, n) =>
    Math.hypot(n.x - CORNERS[i].x, n.z - CORNERS[i].z) <
    Math.hypot(b.x - CORNERS[i].x, b.z - CORNERS[i].z) ? n : b
  );
  base.isBase = true; base.owner = i; base.strength = 1.0;
  factions[i].baseNode = base;
  factions[i].nodes    = [base];
}

// ── Three.js Scene ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.0026);

const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.5, 700);
camera.position.set(0, 130, 72);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.05;
controls.minDistance    = 30;
controls.maxDistance    = 280;
controls.target.set(0, 0, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.25, 0.45, 0.08));

scene.add(new THREE.AmbientLight(0x112233, 4.5));
const sun = new THREE.DirectionalLight(0xfff0e8, 1.3);
sun.position.set(20, 60, 30); scene.add(sun);

const grid = new THREE.GridHelper(260, 52, 0x090f1a, 0x060c14);
grid.position.y = -1.2; scene.add(grid);

// ── Materials（先に定義してからmesh構築に使う）────────────────────────────────
const NEUTRAL_COL  = new THREE.Color(0x2a3a4a);
const CONTESTED_COL = new THREE.Color(0xf0a020);

const factionColors  = factions.map(f => new THREE.Color(f.color));
const factionEmCols  = factions.map(f => new THREE.Color(f.emCol));

const edgeMatNeutral = new THREE.LineBasicMaterial({ color: 0x182838, transparent: true, opacity: 0.35 });
const edgeMatFaction = factions.map(f =>
  new THREE.LineBasicMaterial({ color: f.color, transparent: true, opacity: 0.55 })
);

// ── Node Meshes ──────────────────────────────────────────────────────────────
const NODE_R = 3.6;
const BASE_R = 5.0;

for (const node of map.nodes) {
  const r   = node.isBase ? BASE_R : NODE_R;
  const geo = new THREE.CylinderGeometry(r, r * 1.08, 0.9, 16);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(NEUTRAL_COL),
    emissive: new THREE.Color(0),
    emissiveIntensity: 0,
    metalness: 0.35, roughness: 0.45,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(node.x, 0, node.z);
  scene.add(mesh);
  node.mesh = mesh;

  // ハローは "接戦" と "支配強度" の両方を示す
  const haloGeo = new THREE.SphereGeometry(r * 1.85, 10, 10);
  const haloMat = new THREE.MeshBasicMaterial({
    color: NEUTRAL_COL.clone(), transparent: true, opacity: 0, side: THREE.BackSide,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  mesh.add(halo);
  node.halo = halo;

  // 資源量が多いノードに回転リングをつける（観察者への情報）
  if (node.food > 26 || node.material > 16) {
    const rg  = new THREE.TorusGeometry(r * 0.55, 0.11, 6, 18);
    const rm  = new THREE.MeshBasicMaterial({ color: 0x80e050, transparent: true, opacity: 0.55 });
    const ring = new THREE.Mesh(rg, rm);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.65;
    mesh.add(ring);
    node.resourceRing = ring;
  }
}

// 拠点の装飾リング
for (const f of factions) {
  const b = f.baseNode;
  for (let i = 0; i < 2; i++) {
    const rg  = new THREE.TorusGeometry(BASE_R * 1.35 + i * 1.6, 0.09, 6, 26);
    const rm  = new THREE.MeshBasicMaterial({ color: new THREE.Color(f.color), transparent: true, opacity: 0.4 });
    const ring = new THREE.Mesh(rg, rm);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(b.x, 0.4, b.z);
    scene.add(ring);
  }
}

// ── Edge Lines ───────────────────────────────────────────────────────────────
for (const edge of map.edges) {
  const pts = [
    new THREE.Vector3(edge.a.x, 0.5, edge.a.z),
    new THREE.Vector3(edge.b.x, 0.5, edge.b.z),
  ];
  const geo  = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, edgeMatNeutral);
  scene.add(line);
  edge.line = line;
}

// ── Influence Pulses（動きとして流れる小球）────────────────────────────────
const pulses: Array<{ mesh: any; from: ColonyNode; to: ColonyNode; t: number; speed: number; factionId: number }> = [];

function spawnPulse(fromNode: ColonyNode, toNode: ColonyNode, factionId: number) {
  const geo  = new THREE.SphereGeometry(0.6, 7, 7);
  const mat  = new THREE.MeshBasicMaterial({ color: factions[factionId].color });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  pulses.push({ mesh, from: fromNode, to: toNode, t: 0, speed: 0.9 + rng.next() * 0.4, factionId });
}

function tickPulses(dt) {
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.t += dt * p.speed;
    if (p.t >= 1) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose(); p.mesh.material.dispose();
      pulses.splice(i, 1);
      continue;
    }
    p.mesh.position.lerpVectors(
      new THREE.Vector3(p.from.x, 0.5, p.from.z),
      new THREE.Vector3(p.to.x,   0.5, p.to.z),
      p.t
    );
  }
}

// ── World State ──────────────────────────────────────────────────────────────
const world: ColonyWorldState = { elapsed: 0, tickTimer: 0, tick: 0, eventTimer: rng.range(18, 34) };

// ── Faction Rules ────────────────────────────────────────────────────────────
const DEFAULT_RULES: Record<ColonyPersonality, ColonyRule[]> = {
  builder: [
    { id: 'defend_base',      when: 'baseStrength < 0.7',              action: 'fortify'  },
    { id: 'fortify_weak',     when: 'weakOwnedNode && !enemyNearby',   action: 'fortify'  },
    { id: 'expand_neutral',   when: 'neutralNearby && food >= 20',     action: 'expand'   },
    { id: 'fortify_border',   when: 'enemyNearby && weakOwnedNode',    action: 'fortify'  },
    { id: 'gather_low',       when: 'food < 30',                       action: 'gather'   },
    { id: 'expand_fallback',  when: 'neutralNearby',                   action: 'expand'   },
    { id: 'gather_default',                                             action: 'gather'   },
  ],
  raider: [
    { id: 'strike_weak',      when: 'weakEnemyNearby && food >= 18',   action: 'attack'   },
    { id: 'grab_rich',        when: 'richNeutralNearby',               action: 'expand'   },
    { id: 'restock',          when: 'food < 12',                       action: 'gather'   },
    { id: 'expand_neutral',   when: 'neutralNearby',                   action: 'expand'   },
    { id: 'raid_any',         when: 'enemyNearby && food >= 18',       action: 'attack'   },
    { id: 'gather_mid',       when: 'food < 35',                       action: 'gather'   },
    { id: 'raid_fallback',    when: 'food >= 10',                       action: 'attack'   },
  ],
  hoarder: [
    { id: 'gather_priority',                                            action: 'gather'   },
    { id: 'fortify_border',   when: 'weakOwnedNode && enemyNearby',    action: 'fortify'  },
    { id: 'fortify_interior', when: 'weakOwnedNode',                   action: 'fortify'  },
    { id: 'expand_rich',      when: 'richNeutralNearby && food >= 35', action: 'expand'   },
    { id: 'expand_slow',      when: 'neutralNearby && food >= 55',     action: 'expand'   },
    { id: 'gather_default',                                             action: 'gather'   },
  ],
};

const factionRules: Record<number, ColonyRule[]> = {};
for (const f of factions) factionRules[f.id] = [...(DEFAULT_RULES[f.personality] ?? [])];

async function loadFactionRules() {
  for (const f of factions) {
    try {
      const res = await fetch(`./faction_rules/${f.personality}.json?t=${Date.now()}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.rules)) factionRules[f.id] = data.rules;
    } catch (_) {}
  }
}

// ── Snapshot for Rule Evaluation ─────────────────────────────────────────────
function buildSnap(faction: ColonyFaction) {
  const owned   = map.nodes.filter(n => n.owner === faction.id);
  const borders = owned.flatMap(n => n.neighbors).filter(n => n.owner !== faction.id);
  return {
    territoryCount:    owned.length,
    food:              faction.food,
    material:          faction.material,
    neutralNearby:     borders.some(n => n.owner === -1),
    enemyNearby:       borders.some(n => n.owner >= 0 && n.owner !== faction.id),
    weakEnemyNearby:   borders.some(n => n.owner >= 0 && n.owner !== faction.id && n.strength < 0.45),
    richNeutralNearby: borders.some(n => n.owner === -1 && n.food > 22),
    weakOwnedNode:     owned.some(n => !n.isBase && n.strength < 0.55),
    baseStrength:      faction.baseNode?.strength ?? 1,
  };
}

const SNAP_KEYS = ['territoryCount','food','material','neutralNearby','enemyNearby',
  'weakEnemyNearby','richNeutralNearby','weakOwnedNode','baseStrength'];

function evalCond(when: string | undefined, snap: Record<string, any>) {
  if (!when) return true;
  try {
    return !!new Function(...SNAP_KEYS, `return !!(${when});`)(...SNAP_KEYS.map(k => snap[k]));
  } catch { return false; }
}

// 飛び地防止：最大連結クラスタのみから拡張する
function largestCluster(factionId: number): ColonyNode[] {
  const owned = map.nodes.filter(n => n.owner === factionId);
  if (!owned.length) return [];
  const visited = new Set();
  let largest = [];
  for (const start of owned) {
    if (visited.has(start.id)) continue;
    const cluster = [], queue = [start];
    visited.add(start.id);
    while (queue.length) {
      const cur = queue.shift(); cluster.push(cur);
      for (const nb of cur.neighbors)
        if (!visited.has(nb.id) && nb.owner === factionId) { visited.add(nb.id); queue.push(nb); }
    }
    if (cluster.length > largest.length) largest = cluster;
  }
  return largest;
}

// 支配率が高いほど展開力を落とす（強すぎる帝国が自然に足を引っ張られる）
function dominanceMult(faction: ColonyFaction) {
  const pct = map.nodes.filter(n => n.owner === faction.id).length / map.nodes.length;
  if (pct > 0.55) return 0.55;
  if (pct > 0.42) return 0.78;
  return 1.0;
}

// ── Action Costs ──────────────────────────────────────────────────────────────
const FOOD_CAP = 80;
const COST: Record<ColonyAction, number> = { expand: 18, attack: 28, fortify: 12, gather: 0 };

function execAction(faction: ColonyFaction, action: ColonyAction) {
  if ((COST[action] ?? 0) > faction.food) return false;
  const owned   = map.nodes.filter(n => n.owner === faction.id);
  const borders = owned.flatMap(n => n.neighbors).filter(n => n.owner !== faction.id);

  switch (action) {
    case 'expand': {
      const cluster = largestCluster(faction.id);
      const cands = cluster.flatMap(n => n.neighbors).filter(n => n.owner === -1);
      if (!cands.length) return false;
      const target = cands.reduce((b, n) => n.food + n.material > b.food + b.material ? n : b);
      const src = cluster.find(o => o.neighbors.includes(target)) ?? cluster[0];
      if (src) spawnPulse(src, target, faction.id);
      applyInfluence(faction, target, 0.32 * dominanceMult(faction));
      faction.food -= COST.expand;
      faction.intent = `expanding → [${target.id}]`;
      logEvent(`${faction.name}: expand → node ${target.id} (food+mat: ${Math.round(target.food + target.material)})`, `f${faction.id}`);
      return true;
    }
    case 'attack': {
      const cluster = largestCluster(faction.id);
      const cands = cluster.flatMap(n => n.neighbors).filter(n => n.owner >= 0 && n.owner !== faction.id);
      if (!cands.length) return false;
      const target = cands.reduce((b, n) => n.strength < b.strength ? n : b);
      const src    = cluster.find(o => o.neighbors.includes(target)) ?? cluster[0];
      if (src) spawnPulse(src, target, faction.id);
      applyInfluence(faction, target, 0.33 * dominanceMult(faction));
      faction.food -= COST.attack;
      faction.intent = `raiding ${factions[target.owner]?.name} [${target.id}]`;
      logEvent(`${faction.name}: attack ${factions[target.owner]?.name} node ${target.id} (str: ${target.strength.toFixed(2)})`, `f${faction.id}`);
      return true;
    }
    case 'fortify': {
      const weak = owned.filter(n => !n.isBase).sort((a, b) => a.strength - b.strength)[0];
      if (!weak) return false;
      weak.strength = Math.min(1, weak.strength + 0.32);
      faction.food -= COST.fortify;
      faction.intent = `fortifying [${weak.id}] (str: ${weak.strength.toFixed(2)})`;
      return true;
    }
    case 'gather': {
      const bonus = owned.length * 0.9;
      faction.food     = Math.min(FOOD_CAP, faction.food     + bonus);
      faction.material = Math.min(FOOD_CAP, faction.material + owned.length * 0.45);
      faction.intent   = `gathering (${owned.length} nodes, +${bonus.toFixed(0)} food)`;
      return true;
    }
  }
  return false;
}

// ── Territory Transfer ────────────────────────────────────────────────────────
// 私の視点：完全な離散切り替えでなく強度が0になったときに転換。接戦ノードは黄色くパルス
function applyInfluence(faction: ColonyFaction, target: ColonyNode, power: number) {
  if (target.owner === faction.id) {
    target.strength = Math.min(1, target.strength + power);
    return;
  }
  target.strength = Math.max(0, target.strength - power);
  target.flashUntil = performance.now() / 1000 + 0.35;   // 攻撃ヒット時にフラッシュ
  if (target.strength <= 0) {
    const prev = target.owner;
    const prevName = prev >= 0 ? factions[prev].name : 'neutral';
    if (prev >= 0) factions[prev].nodes = factions[prev].nodes.filter(n => n.id !== target.id);
    target.owner    = faction.id;
    target.strength = 0.22;
    faction.nodes.push(target);
    logEvent(`${faction.name} captured node ${target.id} from ${prevName}!`, 'capture');
    // 壊滅チェック
    if (prev >= 0 && map.nodes.filter(n => n.owner === prev).length === 0) {
      factions[prev].alive = false;
      logEvent(`★ ${factions[prev].name} ELIMINATED!`, 'eliminated');
    }
  }
}

// ── Faction Tick ──────────────────────────────────────────────────────────────
function tickFactions() {
  for (const faction of factions) {
    if (!faction.alive) continue;
    const snap = buildSnap(faction);
    let acted = false;
    for (const rule of factionRules[faction.id] ?? []) {
      if (!evalCond(rule.when, snap)) continue;
      if (execAction(faction, rule.action)) { acted = true; break; }
    }
    if (!acted) faction.intent = 'idle';
    // パッシブ収入（上限 FOOD_CAP）
    const n = map.nodes.filter(n => n.owner === faction.id).length;
    faction.food     = Math.min(FOOD_CAP, faction.food     + n * 0.7 + 0.4);
    faction.material = Math.min(FOOD_CAP, faction.material + n * 0.35 + 0.2);
  }
}

// ── Strength Decay ────────────────────────────────────────────────────────────
function decayStrength(dt) {
  for (const node of map.nodes) {
    if (node.isBase || node.owner === -1) continue;
    const personality = factions[node.owner]?.personality ?? 'builder';
    const rate = DECAY_BY_PERSONALITY[personality] ?? DECAY_RATE;
    node.strength = Math.max(0, node.strength - rate * dt);
    if (node.strength <= 0) {
      factions[node.owner].nodes = factions[node.owner].nodes.filter(n => n.id !== node.id);
      node.owner = -1;
    }
  }
}

// ── Random Events ─────────────────────────────────────────────────────────────
const RANDOM_EVENTS = [
  {
    label: 'Resource Bloom',
    run() {
      const node = rng.pick(map.nodes);
      node.food     = Math.min(65, node.food     + rng.range(12, 24));
      node.material = Math.min(42, node.material + rng.range(6, 15));
      logEvent(`EVENT: Resource bloom at node ${node.id}`, 'event');
    },
  },
  {
    label: 'Local Storm',
    run() {
      const center   = rng.pick(map.nodes);
      const affected = [center, ...center.neighbors].slice(0, rng.int(2, 5));
      for (const n of affected) {
        if (!n.isBase) n.strength = Math.max(0, n.strength - rng.range(0.12, 0.28));
      }
      logEvent(`EVENT: Storm at node ${center.id} — ${affected.length} nodes weakened`, 'event');
    },
  },
  {
    label: 'Neutral Uprising',
    run() {
      const cands  = map.nodes.filter(n => n.owner >= 0 && !n.isBase && n.strength < 0.4);
      if (!cands.length) return;
      const target = rng.pick(cands);
      factions[target.owner].nodes = factions[target.owner].nodes.filter(n => n.id !== target.id);
      target.owner = -1; target.strength = 0;
      logEvent(`EVENT: Node ${target.id} reverted to neutral`, 'event');
    },
  },
  {
    label: 'Fertile Ground',
    run() {
      const neutral = map.nodes.filter(n => n.owner === -1);
      if (!neutral.length) return;
      const target = rng.pick(neutral);
      target.food = Math.min(65, target.food + 18);
      logEvent(`EVENT: Fertile ground discovered at node ${target.id}`, 'event');
    },
  },
  {
    label: 'Insurgency',
    run() {
      // 支配率が高い勢力の国境ノードを弱体化させる
      const alive = factions.filter(f => f.alive);
      const counts = alive.map(f => ({ f, n: map.nodes.filter(n => n.owner === f.id).length }));
      const dominant = counts.reduce((b, c) => c.n > b.n ? c : b);
      if (dominant.n / map.nodes.length < 0.38) return;
      const borders = map.nodes.filter(n =>
        n.owner === dominant.f.id && !n.isBase &&
        n.neighbors.some(nb => nb.owner !== dominant.f.id)
      );
      if (!borders.length) return;
      const count = Math.max(1, Math.floor(borders.length * 0.35));
      for (let i = 0; i < count; i++) {
        const t = rng.pick(borders);
        t.strength = Math.max(0, t.strength - rng.range(0.22, 0.38));
      }
      logEvent(`EVENT: Insurgency! ${dominant.f.name}'s borders weaken (${count} nodes)`, 'event');
    },
  },
  {
    label: 'Resource Drought',
    run() {
      for (const f of factions) {
        if (!f.alive) continue;
        f.food = Math.max(8, f.food * 0.65);
      }
      logEvent('EVENT: Resource drought — all factions lost 35% food', 'event');
    },
  },
];

// ── Interventions ─────────────────────────────────────────────────────────────
function doIntervention(type: ColonyInterventionType) {
  switch (type) {
    case 'resource_drop': {
      const node = rng.pick(map.nodes);
      node.food += 28; node.material += 14;
      logEvent(`INTERVENTION: Resource drop at node ${node.id}`, 'intervention');
      break;
    }
    case 'storm': {
      const center   = rng.pick(map.nodes);
      const affected = [center, ...center.neighbors];
      for (const n of affected) if (!n.isBase) n.strength = Math.max(0, n.strength - 0.32);
      logEvent(`INTERVENTION: Storm hit node ${center.id} cluster`, 'intervention');
      break;
    }
    case 'invader_wave': {
      const owned = map.nodes.filter(n => n.owner >= 0 && !n.isBase);
      for (let i = 0; i < Math.min(4, owned.length); i++) {
        const t = rng.pick(owned);
        t.strength = Math.max(0, t.strength - 0.35);
        logEvent(`INTERVENTION: Invader strikes node ${t.id}`, 'intervention');
      }
      break;
    }
    case 'spawn_neutral': {
      const owned = map.nodes.filter(n => n.owner >= 0 && !n.isBase && n.strength < 0.5);
      if (!owned.length) return;
      const t = rng.pick(owned);
      factions[t.owner].nodes = factions[t.owner].nodes.filter(n => n.id !== t.id);
      t.owner = -1; t.strength = 0; t.food = rng.range(18, 35);
      logEvent(`INTERVENTION: Node ${t.id} returned to wild`, 'intervention');
      break;
    }
  }
}

// ── Visual Update ─────────────────────────────────────────────────────────────
function updateVisuals(now) {
  for (const node of map.nodes) {
    const mat  = node.mesh.material;
    const halo = node.halo.material;

    // 攻撃フラッシュ（全ノード共通 — 最優先）
    const flashing = node.flashUntil > now;
    const flashT   = flashing ? Math.min(1, (node.flashUntil - now) / 0.35) : 0;

    if (node.owner === -1) {
      node.mesh.scale.y = 0.45;
      if (flashing) {
        // 中立ノードが攻撃を受けている → 白くフラッシュ
        mat.color.set(0x888888);
        mat.emissive.set(1.8, 1.8, 1.8);
        mat.emissiveIntensity = flashT * 2.2;
        halo.opacity = flashT * 0.18;
      } else {
        mat.color.copy(NEUTRAL_COL);
        mat.emissive.set(0, 0, 0);
        mat.emissiveIntensity = 0;
        halo.opacity = 0;
      }
    } else {
      const fc = factionColors[node.owner];
      const fe = factionEmCols[node.owner];
      const s  = node.strength;
      // strength を高さに反映 — 強く保持しているほど背が高い
      node.mesh.scale.y = 0.45 + s * 1.3;
      if (flashing) {
        // 攻撃を受けている → 白フラッシュが色に重なる
        mat.color.lerpColors(NEUTRAL_COL, fc, s);
        mat.emissive.set(2.0, 2.0, 2.0);
        mat.emissiveIntensity = flashT * 3.0;
      } else {
        // 接戦ノード：黄色パルスを強め・速めに
        const contested = node.neighbors.some(n => n.owner >= 0 && n.owner !== node.owner);
        if (contested && s < 0.6) {
          mat.color.lerpColors(NEUTRAL_COL, fc, s);
          mat.emissive.copy(CONTESTED_COL);
          mat.emissiveIntensity = 0.9 + Math.sin(now * 6.0 + node.id) * 0.6;
        } else {
          mat.color.lerpColors(NEUTRAL_COL, fc, s);
          mat.emissive.copy(fe);
          mat.emissiveIntensity = 0.3 + s * 0.9;
        }
      }
      halo.color.copy(fc);
      halo.opacity = 0.035 + s * 0.09;
    }

    if (node.resourceRing) {
      const speed = node.owner >= 0 ? 1.4 : 0.4;
      node.resourceRing.rotation.z = now * speed;
      node.resourceRing.material.opacity = 0.35 + Math.sin(now * 1.8 + node.id * 0.7) * 0.18;
    }
  }

  // エッジ色更新（同勢力で支配されている経路は勢力色）
  for (const edge of map.edges) {
    edge.line.material =
      (edge.a.owner >= 0 && edge.a.owner === edge.b.owner)
        ? edgeMatFaction[edge.a.owner]
        : edgeMatNeutral;
  }
}

// ── HUD Update ────────────────────────────────────────────────────────────────
function updateHUD() {
  const total = map.nodes.length;
  for (const f of factions) {
    const cnt = map.nodes.filter(n => n.owner === f.id).length;
    const g = id => document.getElementById(`f${f.id}-${id}`);
    if (!g('territory')) continue;
    const avgStr = cnt > 0
      ? Math.round(map.nodes.filter(n => n.owner === f.id).reduce((s, n) => s + n.strength, 0) / cnt * 100)
      : 0;
    g('territory').textContent = String(cnt);
    g('food').textContent      = String(Math.floor(f.food));
    g('material').textContent  = avgStr + '%';
    g('intent').textContent    = f.alive ? f.intent : '☠ eliminated';
    const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
    const bar = document.getElementById(`f${f.id}-bar`);
    if (bar) { bar.style.width = pct + '%'; }
    const panel = document.getElementById(`f${f.id}-panel`);
    if (panel && !f.alive) panel.style.opacity = '0.38';
  }
  const t  = Math.floor(world.elapsed);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  const el = document.getElementById('world-time');
  if (el) el.textContent = `${mm}:${ss}  tick: ${world.tick}`;
}

// ── Telemetry & Intervention Polling ─────────────────────────────────────────
function reportTelemetry() {
  if (!window.Telemetry) return;
  const counts = factions.map(f => map.nodes.filter(n => n.owner === f.id).length);
  const dominant = factions.reduce((b, f, i) => counts[i] > counts[b.id] ? f : b, factions[0]);
  window.Telemetry.report('colony', {
    elapsed:        Math.round(world.elapsed),
    tick:           world.tick,
    dominantFaction: dominant.name,
    factions: factions.map((f, i) => ({
      id:          f.id,
      name:        f.name,
      personality: f.personality,
      alive:       f.alive,
      territory:   counts[i],
      food:        Math.floor(f.food),
      material:    Math.floor(f.material),
      intent:      f.intent,
    })),
    nodes:        map.nodes.length,
    neutralNodes: map.nodes.filter(n => n.owner === -1).length,
  }, 1500);
}

async function pollInterventions() {
  try {
    const res = await fetch('/colony/intervention/pending');
    if (!res.ok) return;
      const items = await res.json() as ColonyInterventionItem[];
    for (const item of items) doIntervention(item.type);
  } catch (_) {}
}

// ── Log ───────────────────────────────────────────────────────────────────────
function logEvent(text, type = 'info') {
  const el = document.getElementById('log-entries');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `le le-${type}`;
  const t  = Math.floor(world.elapsed);
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  div.textContent = `[${mm}:${ss}] ${text}`;
  el.appendChild(div);
  while (el.children.length > 400) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ── Animate ───────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let nextRuleReload = 6;

function animate() {
  requestAnimationFrame(animate);
  const dt  = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;
  world.elapsed += dt;

  world.tickTimer += dt;
  if (world.tickTimer >= TICK_SEC) {
    world.tickTimer = 0;
    world.tick++;
    tickFactions();
    decayStrength(TICK_SEC);
  }

  world.eventTimer -= dt;
  if (world.eventTimer <= 0) {
    rng.pick(RANDOM_EVENTS).run();
    world.eventTimer = rng.range(20, 42);
  }

  nextRuleReload -= dt;
  if (nextRuleReload <= 0) {
    loadFactionRules();
    nextRuleReload = 8;
  }

  tickPulses(dt);
  updateVisuals(now);
  updateHUD();
  reportTelemetry();
  controls.update();
  composer.render();
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadFactionRules().then(() => {
  logEvent(`Colony initialized. seed: ${SEED}`, 'info');
  logEvent(`Map: ${NODE_COUNT} territories. 3 factions deployed.`, 'info');
  for (const f of factions) {
    logEvent(`${f.name} [${f.personality}] base at node ${f.baseNode.id}`, `f${f.id}`);
  }
  setInterval(pollInterventions, 2000);
  animate();
});

// ── Intervention Buttons ─────────────────────────────────────────────────────
document.getElementById('btn-resource')?.addEventListener('click', () => doIntervention('resource_drop'));
document.getElementById('btn-storm')?.addEventListener('click',    () => doIntervention('storm'));
document.getElementById('btn-invader')?.addEventListener('click',  () => doIntervention('invader_wave'));
document.getElementById('btn-neutral')?.addEventListener('click',  () => doIntervention('spawn_neutral'));

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
