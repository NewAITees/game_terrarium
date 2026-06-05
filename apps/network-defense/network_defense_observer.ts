import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  RNG,
  STYLE,
  buildAdj,
  buildEdges,
  buildScene,
  buildTopology,
  edgeKey,
  findShortestPath,
  makeMats,
  tickEdges,
} from './network-core.js';
import {
  applyPersonalitiesToRules,
  applyPersonalityToAgent,
  buildObserverSnapshot,
  pickRankPersonalities,
} from './network_defense_personality.js';
import { createObservationEvents } from './network_defense_events.js';
import { createObservationUi } from './network_defense_ui.js';
import type {
  NetworkDefenseGameState,
  NetworkDefenseNode,
  NetworkDefenseRank,
} from '../../shared/types/network_defense.js';

const TOTAL = 24 + (Math.random() * 16 | 0);
const SEED = Math.random() * 1e9 | 0;
const REWIRE_PCT = 28;
const BG = 0x0d2040;

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.FogExp2(BG, 0.0042);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 700);
camera.position.set(0, 72, 130);

const renderer = new THREE.WebGLRenderer({ antialias: true });
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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.5, 0.5, 0.07);
composer.addPass(bloomPass);

scene.add(new THREE.AmbientLight(0x112233, 3));
const keyLight = new THREE.DirectionalLight(0xfff0cc, 1.6);
keyLight.position.set(20, 60, 30);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x2244aa, 0.8);
fillLight.position.set(-30, 20, -40);
scene.add(fillLight);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clickable = [];

const topo = buildTopology(TOTAL, SEED, 'smallworld', REWIRE_PCT);
const spinData = [];
const edgeMap = new Map();
const allEdges = [];
const mats = makeMats();
const serverGlow = buildScene(topo, scene, spinData);
buildEdges(topo, scene, edgeMap, allEdges, mats);

const adj = buildAdj(topo.nodes, edgeMap);
const rng = new RNG(SEED + 1);
const rankPersonalities = pickRankPersonalities(rng);
const terms = topo.lnodes.term;
const EDGE_SPEED = { min: 0.42, max: 1.08 };
const WIN_WAVE = 10;
const RULE_UPDATE_RANKS: NetworkDefenseRank[] = ['senior', 'mid', 'junior'];
let ruleUpdateRankIdx = 0;

const game: NetworkDefenseGameState = {
  mode: 'harden',
  elapsed: 0,
  kills: 0,
  score: 0,
  credits: 50,
  wave: 1,
  gameOver: false,
  victory: false,
  waveRemaining: 5,
  waveCooldown: 0,
  nextAttack: 0.7,
  rule: 'balanced',
  nextScan: 4,
  seniorAlive: true,
  waveSpawned: 0,
  waveStartKills: 0,
  waveServerHpStart: 120,
  waveActions: {},
  environmentSpeedMultiplier: 1,
  lowLoadMode: false,
  telemetryCooldown: 0,
  rankIntents: Object.fromEntries(
    Object.entries(rankPersonalities).map(([rank, personality]) => [rank, personality.summary])
  ),
};

const enemyPackets = [];
const defensePackets = [];
const normalPackets = [];
const scanPackets = [];
const agents = [];
const firewalls = new Map();
const observationUi = createObservationUi({
  onToggleLowLoadMode: () => toggleLowLoadMode(undefined),
  onIntervenePulse: () => observerPulseCalm(),
  onInterveneBreach: () => observerBreachSpike(),
});
const observationEvents = createObservationEvents({ game, topo, rng, logEvent, setMessage });

function applyRenderProfile() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, game.lowLoadMode ? 1 : 2));
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloomPass.strength = game.lowLoadMode ? 0.85 : 1.5;
}

applyRenderProfile();

// 見た目・クールダウンのみ (能力はRank_PROFILEで定義)
const AGENT_RANKS = {
  senior: { color: 0xfff0a8, size: 1.65, cooldown: 1.8,  label: 'senior' },
  mid:    { color: 0x7de8ff, size: 1.25, cooldown: 1.1,  label: 'mid'    },
  junior: { color: 0x9df0a4, size: 0.95, cooldown: 0.75, label: 'junior' },
};

// ランクプロファイル: 重処理(heavy) / 軽処理(light) × [コスト倍率, 実行時間倍率, 効果倍率]
// senior: 重処理が安く速く強力、軽処理は苦手
// junior: 軽処理が安く速く強力、重処理は苦手
const RANK_PROFILE = {
  senior: { moveSpeed: 0.42, heavy: [0.60, 0.50, 1.55], light: [1.45, 1.80, 0.60] },
  mid:    { moveSpeed: 0.66, heavy: [1.00, 1.00, 1.00], light: [1.00, 1.00, 1.00] },
  junior: { moveSpeed: 0.98, heavy: [1.60, 2.10, 0.50], light: [0.60, 0.50, 1.60] },
};

// アクション定義: { cost基本コスト, dur基本実行秒数, heavy重処理フラグ }
const ACTION_DEFS = {
  containServerNeighbor: { cost: 25,  dur: 1.8, heavy: true  },
  interceptEnemy:        { cost: 20,  dur: 1.5, heavy: true  },
  suppressHottest:       { cost: 20,  dur: 2.0, heavy: true  },
  deployFirewallGuard:   { cost: 30,  dur: 1.8, heavy: true  },
  rebootNode:            { cost: 40,  dur: 2.5, heavy: true  },
  rebootNeighbor:        { cost: 35,  dur: 2.0, heavy: true  },
  clearPathTo:           { cost: 25,  dur: 1.8, heavy: true  },
  repairWeakest:         { cost: 8,   dur: 0.8, heavy: false },
  hardenNode:            { cost: 15,  dur: 1.0, heavy: false },
  patrol:                { cost: 0,   dur: 0,   heavy: false },
  repair:                { cost: 10,  dur: 1.2, heavy: false },
  recruitMid:            { cost: 0,   dur: 0,   heavy: false },
  recruitJunior:         { cost: 0,   dur: 0,   heavy: false },
  idle:                  { cost: 0,   dur: 0,   heavy: false },
};

for (const edge of allEdges) {
  const points = edge.curve.getPoints(28);
  let length = 0;
  for (let i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
  edge.length = length;
}

const edgeLengths = allEdges.map(edge => edge.length);
const minEdgeLength = Math.min(...edgeLengths);
const maxEdgeLength = Math.max(...edgeLengths);

for (const edge of allEdges) {
  const span = Math.max(1e-6, maxEdgeLength - minEdgeLength);
  const norm = (edge.length - minEdgeLength) / span;
  const shortcutBoost = edge.shortcut ? 0.1 : 0;
  edge.speedFactor = Math.max(
    EDGE_SPEED.min,
    Math.min(EDGE_SPEED.max, EDGE_SPEED.max - norm * 0.46 + shortcutBoost)
  );
}

function actionStats(rank, key) {
  const def  = ACTION_DEFS[key] ?? { cost: 0, dur: 0, heavy: false };
  const prof = RANK_PROFILE[rank]?.[def.heavy ? 'heavy' : 'light'] ?? [1, 1, 1];
  return {
    cost: Math.round(def.cost * prof[0]),
    dur:  def.dur  * prof[1],
    eff:  prof[2],
  };
}

// MeshBasicMaterial + AdditiveBlending flash spheres
// Same technique as network_sw edges: HDR color values trigger UnrealBloomPass
function makeLevelMats(rHDR, gHDR, bHDR, levels = 10) {
  return Array.from({ length: levels }, (_, i) => {
    const b = i / (levels - 1);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    mat.color.setRGB(rHDR * b, gHDR * b, bHDR * b);
    mat.opacity = 0.55 + b * 0.45;
    return mat;
  });
}
const MATS_ATK  = makeLevelMats(3.0, 0.08, 0.04);  // HDR red
const MATS_NORM = makeLevelMats(0.1, 1.5,  3.0);   // HDR cyan

const flashGeo = new THREE.SphereGeometry(9, 8, 8);

function makeSpherePools(mats, count) {
  return Array.from({ length: count }, () => {
    const mesh = new THREE.Mesh(flashGeo, mats[0]);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, t: 0, mats };
  });
}
const attackPool = makeSpherePools(MATS_ATK,  6);
const normalPool = makeSpherePools(MATS_NORM, 4);

function triggerFlash(pool, node) {
  const slot = pool.reduce((m, f) => f.t < m.t ? f : m);
  slot.mesh.position.set(node.x, node.y, node.z);
  slot.mesh.material = slot.mats[slot.mats.length - 1]; // start at max brightness
  slot.mesh.visible = true;
  slot.t = 1.0;
}

let nextNormal = 0.4;

const grid = new THREE.GridHelper(200, 40, 0x0f2030, 0x0a1820);
grid.position.y = -26;
scene.add(grid);

for (const node of topo.nodes) {
  const style = STYLE[node.isServer ? 'server' : node.layer];
  node.baseStyle = style;
  node.hp = node.isServer ? 120 : 100;
  node.maxHp = node.hp;
  node.infection = 0;
  node.hardenUntil = 0;
  node.rebootUntil = 0;
  node.targetedUntil = 0;
  node.material = node.mesh.material;
  node.halo = node.mesh.children[0];
  node.mesh.userData.node = node;
  clickable.push(node.mesh);
}

function perimeterNode() {
  return rng.pick(terms.filter(node => !node.isServer));
}

function infectedNodes() {
  return topo.nodes.filter(node => node.infection > 0.08 && !node.isServer);
}

function exposedServer() {
  return (adj.get(topo.server.id) || []).some(node => node.infection > 0.25);
}

function enemyFrontierTarget() {
  const infected = topo.nodes.filter(node => node.infection > 0.18);
  if (!infected.length) return perimeterNode();

  const candidates = new Set<NetworkDefenseNode>();
  for (const node of infected) {
    for (const neighbor of adj.get(node.id) || []) {
      if (neighbor.rebootUntil > performance.now() / 1000) continue;
      if (neighbor.isServer && !exposedServer()) continue;
      if (neighbor.infection < 0.72) candidates.add(neighbor);
    }
  }

  if (!candidates.size) return perimeterNode();
  const weighted = [...candidates].sort((a, b) => {
    if (a.isServer !== b.isServer) return a.isServer ? -1 : 1;
    return a.infection - b.infection || a.hp - b.hp;
  });
  return weighted[0];
}

function route(from, to) {
  return findShortestPath(from, to, adj);
}

function isFriendlyPassable(node, target) {
  if (node === target || node.isServer) return true;
  return node.infection < 0.35 && node.rebootUntil <= performance.now() / 1000;
}

function safeRoute(from, to) {
  if (from === to) return [from];
  const visited = new Set([from.id]);
  const prev = new Map([[from.id, null]]);
  const queue = [from];

  while (queue.length) {
    const current = queue.shift();
    if (current === to) {
      const path = [];
      let node = to;
      while (node !== null) {
        path.unshift(node);
        node = prev.get(node.id);
      }
      return path;
    }

    for (const neighbor of adj.get(current.id) || []) {
      if (visited.has(neighbor.id) || !isFriendlyPassable(neighbor, to)) continue;
      visited.add(neighbor.id);
      prev.set(neighbor.id, current);
      queue.push(neighbor);
    }
  }
  return [];
}

function safeStagingNode(target, from = topo.server) {
  const candidates = (adj.get(target.id) || [])
    .filter(node => node.infection < 0.35 && !node.isServer)
    .map(node => ({ node, path: safeRoute(from, node) }))
    .filter(item => item.path.length > 1)
    .sort((a, b) => a.node.infection - b.node.infection || b.node.degree - a.node.degree);
  return candidates[0] || null;
}

function createPacket(color, radius) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 9, 9),
    new THREE.MeshBasicMaterial({ color })
  );
  scene.add(mesh);
  return mesh;
}

function agentHomePosition(index = 1) {
  return new THREE.Vector3(topo.server.x + index * 2.6 - 2.6, topo.server.y + 8, topo.server.z);
}

function createAgent(rank, index = agents.length) {
  const spec = AGENT_RANKS[rank];
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(spec.size, 0),
    new THREE.MeshBasicMaterial({ color: spec.color })
  );
  mesh.position.copy(agentHomePosition(index));
  scene.add(mesh);
  return {
    mesh,
    index,
    rank,
    state: 'idle',
    cooldown: index * 0.45,
    path: [],
    seg: 0,
    t: 0,
    target: null,
    arrivalAction: 'repair',
    currentNode: topo.server,
  };
}

agents.push(applyPersonalityToAgent(createAgent('senior', 0), rankPersonalities));
agents.push(applyPersonalityToAgent(createAgent('mid', 1), rankPersonalities));
agents.push(applyPersonalityToAgent(createAgent('junior', 2), rankPersonalities));

function firewallKey(edge) {
  return edgeKey(edge.an.id, edge.bn.id);
}

function deployFirewall(edge, now) {
  if (!edge) return;
  const key = firewallKey(edge);
  const existing = firewalls.get(key);
  if (existing) {
    existing.until = Math.max(existing.until, now + 18);
    return;
  }

  const center = edge.curve.getPoint(0.5);
  const ahead  = edge.curve.getPoint(0.54);
  const tangent = ahead.clone().sub(center).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
  const wallMat = new THREE.MeshBasicMaterial({
    color: 0x9cefff,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xc9f8ff,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const group = new THREE.Group();
  for (let i = -1; i <= 1; i++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.4, 2.6), wallMat.clone());
    slab.position.copy(center).addScaledVector(normal, i * 0.85);
    slab.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
    group.add(slab);
  }
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.52, 5.0, 4.0), glowMat);
  glow.position.copy(center);
  glow.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
  group.add(glow);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.09, 8, 22),
    new THREE.MeshBasicMaterial({
      color: 0x77dfff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ring.position.copy(center);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  group.add(ring);
  scene.add(group);
  firewalls.set(key, { edge, group, panels: group.children, until: now + 18 });
}

function updateFirewalls(now, dt) {
  for (const [key, firewall] of firewalls) {
    const pulse = 0.72 + 0.28 * Math.sin(now * 6.8);
    firewall.group.scale.y = 0.96 + 0.08 * pulse;
    firewall.group.scale.z = 0.96 + 0.14 * pulse;
    firewall.group.children.forEach((child, index) => {
      if (!child.material) return;
      child.material.opacity = index === firewall.group.children.length - 1
        ? 0.18 + pulse * 0.16
        : 0.36 + pulse * 0.42;
    });
    if (firewall.until <= now) {
      scene.remove(firewall.group);
      firewall.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(mat => mat.dispose());
          else obj.material.dispose();
        }
      });
      firewalls.delete(key);
    }
  }
}

function edgeTravelFactor(edge) {
  return (edge?.speedFactor ?? 0.72) * game.environmentSpeedMultiplier;
}

function hottestNode() {
  return topo.nodes
    .filter(node => !node.isServer)
    .sort((a, b) => b.infection - a.infection || a.hp - b.hp)[0] || topo.server;
}

function weakestDamagedNode() {
  return topo.nodes
    .filter(node => !node.isServer && node.hp < node.maxHp * 0.86 && node.infection < 0.35)
    .sort((a, b) => a.hp - b.hp || b.degree - a.degree)[0] || null;
}

function sendAgent(agent, target, blockedTarget = null) {
  let from = agent.currentNode ?? topo.server;
  let path = safeRoute(from, target);
  let actionTarget = target;
  if (path.length < 2) {
    const staging = safeStagingNode(target, from);
    if (!staging) return false;
    path = staging.path;
    actionTarget = staging.node;
  }
  if (path.length < 2) return false;
  const stats = actionStats(agent.rank, agent.actionKey ?? 'patrol');
  if (stats.cost > 0 && game.credits < stats.cost) return false;
  agent.moveSpeed  = RANK_PROFILE[agent.rank].moveSpeed;
  agent.workDur    = stats.dur;
  agent.workCost   = stats.cost;
  agent.effectMult = stats.eff;
  agent.state = 'moving';
  agent.path = path;
  agent.seg = 0;
  agent.t = 0;
  agent.target = actionTarget;
  agent.blockedTarget = blockedTarget || (actionTarget === target ? null : target);
  return true;
}

function patrolTarget() {
  const candidates = topo.nodes
    .filter(node => !node.isServer && node.infection < 0.25)
    .map(node => ({ node, path: safeRoute(topo.server, node) }))
    .filter(item => item.path.length > 1)
    .sort((a, b) => b.node.degree - a.node.degree || b.path.length - a.path.length);
  if (!candidates.length) return null;
  const top = candidates.slice(0, Math.min(8, candidates.length));
  return rng.pick(top).node;
}

// ── Rule engine ──────────────────────────────────────────────────────────────
// Rules are loaded from agent_rules/<rank>.json and hot-reloaded every 5s.
// Any agent can execute any action — behavior is entirely driven by the JSON.

const DEFAULT_RULES = {
  senior: [
    { id: 'server_emergency',  when: { serverNeighborInfection: 0.5 }, action: 'containServerNeighbor' },
    { id: 'intercept_enemy',   when: { enemyCount: 2 },                action: 'interceptEnemy' },
    { id: 'recruit_mid_emerg', when: 'midCount < 6 && avgInfection > 0.3 && credits >= 160',  action: 'recruitMid' },
    { id: 'recruit_mid',       when: 'midCount < 4 && wave >= 2 && credits >= 240',           action: 'recruitMid' },
    { id: 'recruit_junior_emerg', when: 'juniorCount < 4 && serverHp < 70 && credits >= 80', action: 'recruitJunior' },
    { id: 'recruit_junior',    when: 'juniorCount < 2 && credits >= 160',                     action: 'recruitJunior' },
    { id: 'patrol',                                                     action: 'patrol' },
  ],
  mid: [
    { id: 'server_perimeter',  when: { serverNeighborInfection: 0.3 }, action: 'containServerNeighbor' },
    { id: 'intercept_enemy',   when: { enemyCount: 1, gameRuleNot: 'containment' }, action: 'interceptEnemy' },
    { id: 'recruit_junior',    when: 'juniorCount < 3 && credits >= 160',                action: 'recruitJunior' },
    { id: 'suppress_hottest',  when: { hottestInfection: 0.15 },       action: 'suppressHottest' },
    { id: 'patrol',                                                     action: 'patrol' },
  ],
  junior: [
    { id: 'server_emergency',  when: { serverNeighborInfection: 0.6 }, action: 'containServerNeighbor' },
    { id: 'clear_path',        when: 'hottestInfection > 0.4',                           action: 'clearPathTo' },
    { id: 'repair_weakest',                                             action: 'repairWeakest' },
    { id: 'patrol',                                                     action: 'patrol' },
  ],
};

const baseAgentRules = {
  senior: [...DEFAULT_RULES.senior],
  mid:    [...DEFAULT_RULES.mid],
  junior: [...DEFAULT_RULES.junior],
};

const agentRules = applyPersonalitiesToRules(baseAgentRules, rankPersonalities);

function refreshAgentRules() {
  const nextRules = applyPersonalitiesToRules(baseAgentRules, rankPersonalities);
  for (const rank of Object.keys(nextRules)) {
    agentRules[rank] = nextRules[rank];
  }
}

let nextRuleReload = 3;
let rulesLoadedAt = null;

async function triggerRuleUpdate() {
  const rank = RULE_UPDATE_RANKS[ruleUpdateRankIdx % RULE_UPDATE_RANKS.length];
  ruleUpdateRankIdx++;

  const snap = {
    ...scanNetwork(),
    wave: game.wave,
    credits: Math.floor(game.credits),
    rule: game.rule,
    serverHp: Math.round(topo.server.hp),
  };

  const statusEl = document.getElementById('rules-status');
  if (statusEl) statusEl.textContent = `rules: asking ollama for ${rank}…`;

  try {
    const res = await fetch('/api/update-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rank, snapshot: snap, currentRules: agentRules[rank] }),
      signal: AbortSignal.timeout(22000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (statusEl) statusEl.textContent = `rules: ollama rewrote ${rank} (${data.ruleCount} rules)`;
    setMessage(`Ollama updated ${rank} agent rules (wave ${game.wave}).`);
    logEvent(`Ollama rewrote ${rank} rules (${data.ruleCount} rules)`, 'ollama');
    await loadAgentRules();
  } catch (err) {
    if (statusEl) statusEl.textContent = `rules: update failed — ${err.message}`;
    logEvent(`Ollama update failed: ${err.message}`, 'info');
  }
}

async function loadAgentRules() {
  let anyLoaded = false;
  for (const rank of ['senior', 'mid', 'junior']) {
    try {
      const res = await fetch(`./agent_rules/${rank}.json?t=${Date.now()}`);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.rules)) {
        baseAgentRules[rank] = data.rules.map(rule => ({ ...rule }));
        anyLoaded = true;
      }
    } catch (_) {
      // keep existing rules on fetch failure
    }
  }
  refreshAgentRules();
  if (anyLoaded) {
    rulesLoadedAt = new Date().toLocaleTimeString();
    const el = document.getElementById('rules-status');
    if (el) el.textContent = `rules: loaded ${rulesLoadedAt}`;
  }
}

function buildSnapshot(now) {
  const serverNeighbors = adj.get(topo.server.id) || [];
  const allInfected = topo.nodes.filter(n => n.infection > 0.08);
  const agentCounts = agents.reduce((acc, a) => { acc[a.rank] = (acc[a.rank] || 0) + 1; return acc; }, {});
  return {
    now,
    serverNeighbors,
    serverNeighborMaxInfection: serverNeighbors.reduce((m, n) => Math.max(m, n.infection), 0),
    hottestInfection: topo.nodes.reduce((m, n) => Math.max(m, n.infection), 0),
    avgInfection: topo.nodes.reduce((s, n) => s + n.infection, 0) / topo.nodes.length,
    serverHp: topo.server.hp,
    enemyCount: enemyPackets.length,
    infectedCount: allInfected.length,
    firewallCount: firewalls.size,
    gameRule: game.rule,
    wave: game.wave,
    credits: game.credits,
    seniorCount: agentCounts.senior || 0,
    midCount:    agentCounts.mid    || 0,
    juniorCount: agentCounts.junior || 0,
    totalAgents: agents.length,
  };
}

// evalCondition: when が文字列なら式として評価、オブジェクトなら辞書形式
const SNAP_KEYS = [
  'hottestInfection', 'avgInfection', 'serverHp', 'serverNeighborMaxInfection',
  'enemyCount', 'infectedCount', 'firewallCount', 'gameRule', 'wave', 'credits',
  'seniorCount', 'midCount', 'juniorCount', 'totalAgents',
];

function evalCondition(when, snap) {
  if (typeof when === 'string') {
    try {
      return new Function(...SNAP_KEYS, `return !!(${when});`)(
        ...SNAP_KEYS.map(k => snap[k])
      );
    } catch (e) {
      console.warn('[agent rule] condition error:', e.message, '|', when);
      return false;
    }
  }

  // object-based dict format (backward compatible)
  for (const [key, val] of Object.entries(when)) {
    switch (key) {
      case 'serverNeighborInfection':
        if (snap.serverNeighborMaxInfection <= val) return false; break;
      case 'hottestInfection':
        if (snap.hottestInfection <= val) return false; break;
      case 'avgInfection':
        if (snap.avgInfection <= val) return false; break;
      case 'enemyCount':
        if (snap.enemyCount < val) return false; break;
      case 'infectedCount':
        if (snap.infectedCount < val) return false; break;
      case 'serverHpBelow':
        if (snap.serverHp >= val) return false; break;
      case 'waveGte':
        if (snap.wave < val) return false; break;
      case 'gameRule':
        if (snap.gameRule !== val) return false; break;
      case 'gameRuleNot':
        if (snap.gameRule === val) return false; break;
      case 'creditsGte':
        if (snap.credits < val) return false; break;
    }
  }
  return true;
}

// All actions are available to every agent — rank is purely cosmetic/speed.
function execAction(agent, action, snap) {
  switch (action) {
    case 'containServerNeighbor': {
      const threat = snap.serverNeighbors
        .filter(n => n.infection > 0.1 && n.rebootUntil <= snap.now)
        .sort((a, b) => b.infection - a.infection)[0];
      if (!threat) return false;
      agent.actionKey = 'containServerNeighbor';
      return sendAgent(agent, threat);
    }
    case 'interceptEnemy': {
      const enemy = enemyPackets
        .filter(e => e.path?.length > 1)
        .sort((a, b) => (b.path.length - b.seg) - (a.path.length - a.seg))[0];
      if (!enemy) return false;
      const idx = Math.max(enemy.seg, enemy.path.length - 3);
      agent.actionKey = 'interceptEnemy';
      return sendAgent(agent, enemy.path[idx], enemy.path[idx + 1] || null);
    }
    case 'suppressHottest': {
      const hot = hottestNode();
      if (!hot) return false;
      agent.actionKey = 'suppressHottest';
      return sendAgent(agent, hot);
    }
    case 'repairWeakest': {
      const damaged = weakestDamagedNode();
      if (!damaged) return false;
      agent.actionKey = 'repairWeakest';
      return sendAgent(agent, damaged);
    }
    case 'deployFirewallGuard': {
      const enemy = enemyPackets[0];
      if (!enemy?.path?.length) return false;
      const gi = Math.max(0, enemy.path.length - 2);
      agent.actionKey = 'deployFirewallGuard';
      return sendAgent(agent, enemy.path[gi], enemy.path[gi + 1] || null);
    }
    case 'patrol': {
      const p = patrolTarget();
      if (!p) return false;
      agent.actionKey = 'patrol';
      return sendAgent(agent, p);
    }
    case 'recruitMid': {
      const now = performance.now() / 1000;
      const pressure = snap.avgInfection > 0.3 || snap.serverHp < 70;
      const cd  = pressure ? 1.0 : 3.0;
      const res = pressure ? 0   : 80;
      if (game.credits < AGENT_COSTS.mid + res || now - (game.lastRecruitTime || 0) < cd) return false;
      game.lastRecruitTime = now;
      buyAgent('mid');
      agent.cooldown = cd;
      return true;
    }
    case 'recruitJunior': {
      const now = performance.now() / 1000;
      const pressure = snap.avgInfection > 0.3 || snap.serverHp < 70;
      const cd  = pressure ? 1.0 : 3.0;
      const res = pressure ? 0   : 50;
      if (game.credits < AGENT_COSTS.junior + res || now - (game.lastRecruitTime || 0) < cd) return false;
      game.lastRecruitTime = now;
      buyAgent('junior');
      agent.cooldown = cd;
      return true;
    }
    case 'clearPathTo': {
      const blocked = topo.nodes
        .filter(n => !n.isServer && n.infection > 0.3)
        .sort((a, b) => b.infection - a.infection)[0];
      if (!blocked) return false;
      const neighbor = (adj.get(blocked.id) || [])
        .filter(n => n.infection < 0.3 && n !== topo.server)
        .sort((a, b) => a.infection - b.infection)[0];
      if (!neighbor) return false;
      agent.actionKey = 'clearPathTo';
      agent.arrivalAction = 'rebootNeighbor';
      agent._rebootTarget = blocked;
      return sendAgent(agent, neighbor);
    }
    case 'hardenNode': {
      const now = performance.now() / 1000;
      const target = weakestDamagedNode() ?? hottestNode();
      if (!target || target.hardenUntil > now) return false;
      agent.actionKey = 'hardenNode';
      agent.arrivalAction = 'harden';
      return sendAgent(agent, target);
    }
    case 'rebootNode': {
      const now = performance.now() / 1000;
      const target = hottestNode();
      if (!target || target.rebootUntil > now) return false;
      agent.actionKey = 'rebootNode';
      agent.arrivalAction = 'reboot';
      return sendAgent(agent, target);
    }
    case 'idle':
      agent.cooldown = AGENT_RANKS[agent.rank].cooldown;
      return true;
    default:
      return false;
  }
}

function runAgentRules(agent, snap) {
  for (const rule of agentRules[agent.rank] ?? []) {
    if (rule.when && !evalCondition(rule.when, snap)) continue;
    if (execAction(agent, rule.action, snap)) {
      game.rankIntents[agent.rank] = rule.id ?? rule.action;
      logEvent(`${agent.rank} › ${rule.id ?? rule.action}`, 'agent');
      game.waveActions[agent.rank] = (game.waveActions[agent.rank] || 0) + 1;
      return;
    }
  }
  // 全ルール失敗 → 現在地が感染していれば自力で修復してから再試行
  const cur = agent.currentNode;
  if (cur && cur !== topo.server && cur.infection > 0.15) {
    cur.infection = Math.max(0, cur.infection - 0.28);
    cur.hp = Math.min(cur.maxHp, cur.hp + 15);
    game.rankIntents[agent.rank] = 'self-repair current sector';
    agent.cooldown = 0.8;
    return;
  }
  game.rankIntents[agent.rank] = 'scan for the next opening';
  agent.cooldown = AGENT_RANKS[agent.rank].cooldown + rng.next() * 0.5;
}

function assignAgent(agent) {
  const now = performance.now() / 1000;
  runAgentRules(agent, buildSnapshot(now));
}

function spawnEnemy() {
  if (game.gameOver || game.waveRemaining <= 0) return;
  game.waveSpawned++;
  const target = enemyFrontierTarget();
  const infected = topo.nodes.filter(node => node.infection > 0.18);
  const adjacentInfected = infected.filter(node => (adj.get(node.id) || []).includes(target));
  const source = adjacentInfected.length ? rng.pick(adjacentInfected) : perimeterNode();
  const waveBoost = Math.min(2.4, 1 + game.wave * 0.09);
  enemyPackets.push({
    mesh: createPacket(0xff3e2f, 0.55),
    path: route(source, target),
    seg: 0,
    t: 0,
    speed: 0.18 + rng.next() * 0.12 + game.wave * 0.006,
    damage: (9 + rng.next() * 8) * waveBoost,
  });
  game.waveRemaining--;
}


function removePacket(list, index) {
  const packet = list[index];
  scene.remove(packet.mesh);
  packet.mesh.geometry.dispose();
  packet.mesh.material.dispose();
  list.splice(index, 1);
}

function spawnNormalTraffic() {
  const COLS = [0x38aaff, 0x44ffaa, 0xffffff, 0xFFD060, 0x88ddcc];
  const src = rng.pick(topo.nodes);
  const candidates = topo.nodes.filter(n => n !== src);
  if (!candidates.length) return;
  const dst = rng.pick(candidates);
  const path = route(src, dst);
  if (path.length < 2) return;
  normalPackets.push({
    mesh: createPacket(COLS[rng.int(0, COLS.length - 1)], 0.32),
    path, seg: 0, t: rng.next(),
    speed: 0.35 + rng.next() * 0.3,
  });
}

let nextScan = 2;

function spawnScanner() {
  if (game.gameOver || scanPackets.length >= 10) return;
  const dst = rng.pick(topo.nodes.filter(n => !n.isServer));
  if (!dst) return;
  const path = safeRoute(topo.server, dst);
  if (path.length < 2) return;
  scanPackets.push({
    mesh: createPacket(0x33ddaa, 0.26),
    path, seg: 0,
    t: rng.next() * 0.2,
    speed: 0.20 + rng.next() * 0.10,
    scanPower: 0.014,
  });
}

function updateScanPackets(dt) {
  for (let i = scanPackets.length - 1; i >= 0; i--) {
    const packet = scanPackets[i];

    if (packet.seg >= packet.path.length - 1) {
      const dest = packet.path[packet.path.length - 1];
      if (dest) {
        dest.infection = Math.max(0, dest.infection - 0.03);
        dest.hp = Math.min(dest.maxHp, dest.hp + 4);
      }
      removePacket(scanPackets, i);
      continue;
    }

    const from = packet.path[packet.seg];
    const to   = packet.path[packet.seg + 1];
    if (!from || from.infection > 0.85) { removePacket(scanPackets, i); continue; }

    // 通過中ノードの感染を微量削減
    if (from.infection > 0) {
      from.infection = Math.max(0, from.infection - dt * packet.scanPower);
    }

    const edge = edgeMap.get(edgeKey(from.id, to.id));
    if (!edge) { removePacket(scanPackets, i); continue; }

    // 同エッジ上の敵パケットを低確率で撃退 (~8%/秒)
    for (let j = enemyPackets.length - 1; j >= 0; j--) {
      const enemy = enemyPackets[j];
      if (enemy.seg >= enemy.path.length - 1) continue;
      const ef = enemy.path[enemy.seg];
      const et = enemy.path[enemy.seg + 1];
      if (ef && et && edgeKey(ef.id, et.id) === edgeKey(from.id, to.id)
          && Math.random() < dt * 0.08) {
        game.kills++;
        game.score += 8 + game.wave * 2;
        game.credits = Math.min(999, game.credits + 6);
        triggerFlash(normalPool, from);
        removePacket(enemyPackets, j);
      }
    }

    packet.t += dt * packet.speed * edgeTravelFactor(edge);
    if (packet.t >= 1) { packet.t = 0; packet.seg++; }
    packet.mesh.position.copy(edge.curve.getPoint(edge.an === from ? packet.t : 1 - packet.t));
    edge.activeUntil = Math.max(edge.activeUntil, performance.now() / 1000 + 0.2);
  }
}

function applyAttack(node, damage, now) {
  if (!node || game.gameOver || node.rebootUntil > now) return;
  const serverBuffer = node.isServer ? 0.48 : 1;
  const shield = (node.hardenUntil > now ? 0.35 : 1) * serverBuffer;
  node.hp = Math.max(0, node.hp - damage * shield);
  node.infection = Math.min(1, node.infection + (damage / node.maxHp) * shield);
  node.targetedUntil = now + 0.8;
  triggerFlash(attackPool, node);
  if (node.isServer && node.hp <= 0) {
    showEndOverlay(false);
    logEvent('SERVER DOWN — game over', 'combat');
    setMessage('SERVER DOWN. Defense model halted.', true);
  } else if (node.isServer) {
    logEvent(`Enemy hit server  HP: ${Math.max(0, Math.round(node.hp))}/${node.maxHp}`, 'combat');
  }
}

function applyDefense(node, repair) {
  if (!node || node.isServer) return;
  node.hp = Math.min(node.maxHp, node.hp + repair * 0.3);
  const before = node.infection;
  node.infection = Math.max(0, node.infection - repair / 100);
  if (before > 0.08 && node.infection <= 0.08) {
    game.kills++;
    game.score += 35 + game.wave * 4;
    game.credits = Math.min(999, game.credits + 15);
  }
}

function updatePackets(list, dt, onArrive) {
  for (let index = list.length - 1; index >= 0; index--) {
    const packet = list[index];
    if (packet.seg >= packet.path.length - 1) {
      onArrive(packet.path[packet.path.length - 1], packet);
      removePacket(list, index);
      continue;
    }
    const from = packet.path[packet.seg];
    const to = packet.path[packet.seg + 1];
    const edge = edgeMap.get(edgeKey(from.id, to.id));
    if (!edge) {
      removePacket(list, index);
      continue;
    }
    packet.t += dt * packet.speed * edgeTravelFactor(edge);
    if (packet.t >= 1) {
      packet.t = 0;
      packet.seg++;
    }
    if (list === enemyPackets && firewalls.has(firewallKey(edge))) {
      game.kills++;
      game.score += 20 + game.wave * 3;
      game.credits = Math.min(999, game.credits + 10);
      triggerFlash(normalPool, from);
      removePacket(list, index);
      continue;
    }
    packet.mesh.position.copy(edge.curve.getPoint(edge.an === from ? packet.t : 1 - packet.t));
    edge.activeUntil = Math.max(edge.activeUntil, performance.now() / 1000 + 0.35);
  }
}

function setNodeColor(node, now) {
  const style = node.baseStyle;
  const base = new THREE.Color(style.color);
  const color = base.lerp(new THREE.Color(0xff2e24), node.infection);
  if (node.hardenUntil > now) color.lerp(new THREE.Color(0x80e8ff), 0.55);
  if (node.rebootUntil > now) color.set(0x566472);
  node.material.color.copy(color);
  node.material.emissive.copy(color).multiplyScalar(node.isServer ? 0.55 : 0.35);
  node.material.emissiveIntensity = node.targetedUntil > now ? 2.2 : style.emI;
  if (node.halo?.material) {
    node.halo.material.color.copy(color);
    node.halo.material.opacity = node.hardenUntil > now ? 0.13 : style.hOp + node.infection * 0.13;
  }
}

function updateNodes(dt, now) {
  for (const node of topo.nodes) {
    if (node.rebootUntil > now) {
      node.infection = Math.max(0, node.infection - dt * 0.75);
      node.hp = Math.min(node.maxHp, node.hp + dt * 15);
    } else if (node.infection > 0.02 && !node.isServer) {
      node.infection = Math.min(1, node.infection + dt * 0.018);
      node.hp = Math.max(0, node.hp - dt * node.infection * 1.2);
    }
    if (!node.isServer && node.hp <= 0) node.infection = 1;
    setNodeColor(node, now);
  }

  for (const node of topo.nodes) {
    if (node.infection < 0.35 || node.rebootUntil > now) continue;
    for (const neighbor of adj.get(node.id) || []) {
      if (neighbor.isServer) continue; // サーバーは直接攻撃のみでダメージ
      if (neighbor.hardenUntil > now || neighbor.rebootUntil > now) continue;
      neighbor.infection = Math.min(1, neighbor.infection + dt * node.infection * 0.018);
    }
  }
}

function updateAgents(dt, now) {
  for (const agent of agents) {
    agent.cooldown -= dt;
    agent.mesh.rotation.y += dt * 2.4;
    agent.mesh.rotation.z += dt * 1.7;

    // ── 待機中 ────────────────────────────────────────────────────
    if (agent.state === 'idle') {
      if (agent.cooldown <= 0) assignAgent(agent);
      continue;
    }

    // ── 作業中: ノードに張り付いてアクション実行 ─────────────────
    if (agent.state === 'working') {
      agent.workTimer -= dt;
      agent.mesh.rotation.y += dt * 4.8;
      agent.mesh.rotation.z += dt * 3.5;
      if (agent.workTimer <= 0) {
        applyAgentArrival(agent, null, now);
        idleAtSpot(agent);
      }
      continue;
    }

    // ── 移動中 ────────────────────────────────────────────────────
    const from = agent.path[agent.seg];
    const to   = agent.path[agent.seg + 1];
    if (!from || !to) { teleportHome(agent); continue; }

    const edge = edgeMap.get(edgeKey(from.id, to.id));
    if (!edge) { teleportHome(agent); continue; }

    agent.t += dt * (agent.moveSpeed ?? 0.62) * edgeTravelFactor(edge);
    if (agent.t >= 1) {
      agent.t = 0;
      agent.seg++;
      if (agent.seg >= agent.path.length - 1) {
        agent.currentNode = agent.target;
        // クレジット引き落とし
        if ((agent.workCost ?? 0) > 0) {
          if (game.credits < agent.workCost) { idleAtSpot(agent); continue; }
          game.credits -= agent.workCost;
        }
        if ((agent.workDur ?? 0) > 0) {
          agent.state = 'working';
          agent.workTimer = agent.workDur;
        } else {
          applyAgentArrival(agent, edge, now);
          idleAtSpot(agent);
        }
        continue;
      }
    }

    agent.mesh.position.copy(edge.curve.getPoint(edge.an === from ? agent.t : 1 - agent.t));
    edge.activeUntil = Math.max(edge.activeUntil, now + 0.5);
  }
}

function applyAgentArrival(agent, lastEdge, now) {
  const target = agent.target;
  const eff    = agent.effectMult ?? 1.0;
  switch (agent.arrivalAction) {
    case 'harden':
      target.hardenUntil = now + 8 + eff * 2;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(18 * eff));
      game.score += Math.round(6 * eff);
      break;
    case 'reboot':
      target.rebootUntil = now + 4.5 + eff * 1.5;
      target.infection = Math.max(0, target.infection - 0.55 * eff);
      game.score += Math.round(10 * eff);
      break;
    case 'rebootNeighbor': {
      const nb = agent._rebootTarget;
      if (nb) {
        nb.rebootUntil = now + 4.5 + eff * 1.5;
        nb.infection = Math.max(0, nb.infection - 0.55 * eff);
        game.score += Math.round(12 * eff);
        game.credits = Math.min(999, game.credits + 8);
      }
      agent._rebootTarget = null;
      break;
    }
    case 'repair':
    default: {
      const frontierEdge = agent.blockedTarget
        ? edgeMap.get(edgeKey(target.id, agent.blockedTarget.id))
        : lastEdge;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(20 * eff));
      target.infection = Math.max(0, target.infection - (agent.blockedTarget ? 0.08 : 0.28) * eff);
      if (agent.blockedTarget || target.infection > 0.04) deployFirewall(frontierEdge, now);
      defensePackets.push({
        mesh: createPacket(0xa8f4ff, 0.38),
        path: agent.path,
        seg: 0, t: 0, speed: 0.68, repair: Math.round(18 * eff),
      });
      game.score += Math.round((agent.blockedTarget ? 12 : 8) * eff);
      break;
    }
  }
}

// タスク完了後、現地でアイドル → 次のルールを現在地から決定
function idleAtSpot(agent) {
  agent.state = 'idle';
  agent.cooldown = 0.3 + rng.next() * 0.4;
  agent.path = [];
  agent.seg = 0;
  agent.t = 0;
  agent.target = null;
  agent.blockedTarget = null;
  agent.arrivalAction = 'repair';
  // currentNode は呼び出し元で設定済み
}

// エラー時のみサーバーへ瞬間転送 (経路が壊れている場合のフォールバック)
function teleportHome(agent) {
  agent.mesh.position.copy(agentHomePosition(agent.index));
  agent.currentNode = topo.server;
  agent.state = 'idle';
  agent.cooldown = 0.5 + rng.next() * 0.3;
  agent.path = [];
  agent.seg = 0;
  agent.t = 0;
  agent.target = null;
  agent.blockedTarget = null;
  agent.arrivalAction = 'repair';
}

function updateHud() {
  document.getElementById('time').textContent = String(Math.floor(game.elapsed));
  document.getElementById('score').textContent = String(game.score);
  document.getElementById('credits').textContent = String(Math.floor(game.credits));
  document.getElementById('wave').textContent = String(game.wave);
  document.getElementById('kills').textContent = String(game.kills);
  document.getElementById('health').textContent = String(Math.max(0, Math.round(topo.server.hp)));
  (document.getElementById('buy-junior') as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.junior;
  (document.getElementById('buy-mid') as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.mid;
  (document.getElementById('buy-senior') as HTMLButtonElement).disabled = game.credits < AGENT_COSTS.senior;
  document.getElementById('harden').style.opacity = game.credits < 20 ? '0.4' : '1';
  document.getElementById('reboot').style.opacity = game.credits < 40 ? '0.4' : '1';
  const summary = buildObserverSummary();
  observationUi.update({
    lowLoadMode: game.lowLoadMode,
    eventState: observationEvents.getHudState(),
    rankSnapshots: buildObserverSnapshot(agents, rankPersonalities, game.rankIntents),
    summary,
    hotspots: buildObserverHotspots(),
  });
}

function updateWave(dt) {
  if (game.gameOver) return;
  if (game.waveRemaining > 0) return;
  if (enemyPackets.length > 0) return;

  game.waveCooldown -= dt;
  if (game.waveCooldown > 0) return;

  // ── ウェーブ完了サマリー ──
  const waveKills = game.kills - game.waveStartKills;
  const wavePct   = game.waveSpawned > 0 ? Math.round(waveKills / game.waveSpawned * 100) : 0;
  const hpDrop    = Math.round(game.waveServerHpStart - topo.server.hp);
  const actStr    = Object.entries(game.waveActions).map(([r, n]) => `${r}×${n}`).join('  ') || '—';
  logEvent(`── Wave ${game.wave} complete ──`, 'wave');
  logEvent(`  blocked ${waveKills}/${game.waveSpawned} (${wavePct}%)  HP −${hpDrop}`, 'summary');
  logEvent(`  actions: ${actStr}`, 'summary');

  game.wave++;

  // ── 勝利判定 ──
  if (game.wave > WIN_WAVE && !game.victory) {
    showEndOverlay(true);
    logEvent(`🏆 VICTORY — all ${WIN_WAVE} waves cleared!`, 'wave');
    return;
  }

  // ── stats リセット ──
  game.waveSpawned       = 0;
  game.waveStartKills    = game.kills;
  game.waveServerHpStart = Math.round(topo.server.hp);
  game.waveActions       = {};

  game.waveRemaining = 5 + game.wave * 2;
  game.nextAttack    = 0.45;
  game.waveCooldown  = 2.5;
  game.score         += 75 + game.wave * 10;
  game.credits        = Math.min(999, game.credits + 25 + game.wave * 5);
  setMessage(`Wave ${game.wave} incoming. Agents are repositioning firewalls.`);
  logEvent(`Wave ${game.wave} start — ${game.waveRemaining} enemies incoming`, 'wave');
  triggerRuleUpdate();
}

function scanNetwork() {
  const infected = topo.nodes.filter(node => node.infection > 0.08).length;
  const critical = topo.nodes.filter(node => node.infection > 0.65 || node.hp < node.maxHp * 0.45).length;
  const avgInfection = topo.nodes.reduce((sum, node) => sum + node.infection, 0) / topo.nodes.length;
  return { infected, critical, avgInfection, firewalls: firewalls.size, enemies: enemyPackets.length };
}

function fallbackRule(snapshot) {
  if (snapshot.critical > 5 || snapshot.avgInfection > 0.45) return 'containment';
  if (snapshot.enemies > 3 || game.wave >= 4) return 'firewall-first';
  if (snapshot.infected < 2 && topo.server.hp > 90) return 'patrol';
  return 'balanced';
}

async function callLLM(snapshot) {
  try {
    const res = await fetch('/api/strategy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`strategy ${res.status}`);
    const data = await res.json();
    if (data.rule) return data.rule;
  } catch (_) {
    // Ollama 未応答時はフォールバック
  }
  return fallbackRule(snapshot);
}

function updateSeniorStrategy(dt) {
  const senior = agents.find(agent => agent.rank === 'senior');
  game.seniorAlive = Boolean(senior);
  if (!game.seniorAlive) return;

  game.nextScan -= dt;
  if (game.nextScan > 0) return;

  game.nextScan = 6;
  const snapshot = scanNetwork();
  callLLM(snapshot).then(nextRule => {
    if (nextRule !== game.rule) {
      game.rule = nextRule;
      document.getElementById('rules').textContent = `rules: ${nextRule}`;
      setMessage(`Senior alert: rules.txt -> ${nextRule}`);
      game.rankIntents.senior = `adapt network posture to ${nextRule}`;
    }
  });
}

const AGENT_COSTS = { senior: 300, mid: 160, junior: 80 };

function logEvent(text, type = 'info') {
  const el = document.getElementById('log-entries');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `le le-${type}`;
  div.textContent = `[${String(Math.floor(game.elapsed)).padStart(4)}s] ${text}`;
  el.appendChild(div);
  while (el.children.length > 400) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

function buildObserverHotspots() {
  return topo.nodes
    .filter(node => !node.isServer)
    .sort((a, b) => (b.infection + (1 - b.hp / b.maxHp)) - (a.infection + (1 - a.hp / a.maxHp)))
    .slice(0, 3)
    .map(node => ({
      label: `${node.layer.toUpperCase()} ${node.id}`,
      value: `inf ${Math.round(node.infection * 100)} / hp ${Math.round(node.hp)}`,
    }));
}

function buildObserverSummary() {
  const hotspots = buildObserverHotspots();
  const hottest = topo.nodes.reduce((best, node) => (node.infection > best.infection ? node : best), topo.nodes[0]);
  if (topo.server.hp < 70) {
    return {
      text: 'The server core is taking visible pressure.',
      detail: 'Defenders are being forced into emergency containment.',
    };
  }
  if (enemyPackets.length > defensePackets.length + 2) {
    return {
      text: 'Enemy packet flow is outrunning the local defense rhythm.',
      detail: 'Watch the front line before the next wave compounds it.',
    };
  }
  if ((hottest?.infection ?? 0) > 0.48) {
    return {
      text: `Infection pressure is peaking around node ${hottest.id}.`,
      detail: 'A single unstable cluster is shaping the whole grid.',
    };
  }
  if (hotspots.length) {
    return {
      text: 'Defense is holding, but a few lanes are still running hot.',
      detail: `Top pressure point: ${hotspots[0].label}.`,
    };
  }
  return {
    text: 'The grid is stable enough for personalities to shape the flow.',
    detail: 'Most interesting changes are now coming from route choices and event timing.',
  };
}

function observerPulseCalm() {
  const targets = topo.nodes
    .filter(node => !node.isServer)
    .sort((a, b) => b.infection - a.infection)
    .slice(0, 3);
  if (!targets.length) return;
  for (const node of targets) {
    node.infection = Math.max(0, node.infection - 0.18);
    node.hardenUntil = Math.max(node.hardenUntil, performance.now() / 1000 + 6);
  }
  setMessage('Observer intervention: Pulse Calm cooled the hottest sectors.');
  logEvent('Observer: Pulse Calm reduced infection on the top pressure nodes.', 'player');
}

function observerBreachSpike() {
  const targets = topo.nodes
    .filter(node => !node.isServer && node.infection < 0.45)
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 2);
  if (!targets.length) return;
  for (const node of targets) {
    node.infection = Math.min(1, node.infection + 0.26);
    node.targetedUntil = performance.now() / 1000 + 8;
  }
  setMessage('Observer intervention: Breach Spike forced a new frontline.');
  logEvent('Observer: Breach Spike created a fresh infection spike.', 'player');
}

function toggleLowLoadMode(force?: boolean) {
  const next = typeof force === 'boolean' ? force : !game.lowLoadMode;
  if (next === game.lowLoadMode) return;
  game.lowLoadMode = next;
  game.telemetryCooldown = 0;
  applyRenderProfile();
  setMessage(next ? 'Low-load observation enabled.' : 'Full observation restored.');
  logEvent(
    next ? 'Observer mode switched to low-load rendering.' : 'Observer mode returned to full rendering.',
    'summary'
  );
}

function showEndOverlay(isVictory) {
  game.gameOver = true;
  game.victory  = isVictory;
  const overlay = document.getElementById('end-overlay');
  const title   = document.getElementById('end-title');
  const stats   = document.getElementById('end-stats');
  if (!overlay) return;
  title.textContent = isVictory ? 'MISSION COMPLETE' : 'SERVER DOWN';
  title.className   = isVictory ? 'victory' : 'defeat';
  const elapsed = Math.floor(game.elapsed);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  stats.innerHTML = [
    ['Wave',      game.wave],
    ['Score',     game.score],
    ['Time',      `${mm}:${ss}`],
    ['Kills',     game.kills],
    ['Server HP', Math.max(0, Math.round(topo.server.hp))],
    ['Agents',    agents.length],
    ['Firewalls', firewalls.size],
  ].map(([lbl, val]) =>
    `<div class="end-row"><span class="lbl">${lbl}</span><span class="val">${val}</span></div>`
  ).join('');
  overlay.classList.add('show');
}

function buyAgent(rank) {
  const cost = AGENT_COSTS[rank];
  if (game.credits < cost) {
    setMessage(`Not enough credits for ${rank} agent. Need ${cost}cr.`, true);
    return;
  }
  game.credits -= cost;
  agents.push(applyPersonalityToAgent(createAgent(rank, agents.length), rankPersonalities));
  setMessage(`${rank.toUpperCase()} agent deployed.`);
  logEvent(`Player: bought ${rank} agent (−${cost}cr)`, 'player');
}

function reportTelemetry() {
  const totals = topo.nodes.reduce((acc, node) => {
    acc.hp += node.hp;
    acc.infection += node.infection;
    if (node.infection > 0.08) acc.infected += 1;
    return acc;
  }, { hp: 0, infection: 0, infected: 0 });
  const count = topo.nodes.length;
  const hotspots = topo.nodes
    .filter(node => node.infection > 0.12 || node.hp < node.maxHp * 0.72)
    .sort((a, b) => b.infection - a.infection || a.hp - b.hp)
    .slice(0, 5)
    .map(node => ({
      id: node.id,
      layer: node.isServer ? 'server' : node.layer,
      hp: Math.round(node.hp),
      infection: Number(node.infection.toFixed(3)),
    }));
  const agentRanks = agents.reduce((acc, agent) => {
    acc[agent.rank] = (acc[agent.rank] || 0) + 1;
    return acc;
  }, {});

  window.Telemetry?.report('network_defense_observer', {
    elapsed: Math.round(game.elapsed),
    gameOver: game.gameOver,
    kills: game.kills,
    score: game.score,
    credits: Math.floor(game.credits),
    wave: game.wave,
    waveRemaining: game.waveRemaining,
    rule: game.rule,
    seniorAlive: game.seniorAlive,
    mode: game.mode,
    serverHp: Math.max(0, Math.round(topo.server.hp)),
    nodes: count,
    infectedNodes: totals.infected,
    avgHp: Math.round(totals.hp / count),
    avgInfection: Number((totals.infection / count).toFixed(3)),
    packets: {
      enemy: enemyPackets.length,
      defense: defensePackets.length,
      normal: normalPackets.length,
      agents: agents.filter(agent => agent.state !== 'idle').length,
      firewalls: firewalls.size,
    },
    agentRanks,
    hotspots,
    observer: {
      lowLoadMode: game.lowLoadMode,
      event: observationEvents.getHudState().label,
      personalities: Object.fromEntries(
        Object.entries(rankPersonalities).map(([rank, personality]) => [rank, personality.label])
      ),
      intents: game.rankIntents,
    },
  });
}

function setMessage(text, alert = false) {
  const message = document.getElementById('message');
  message.textContent = text;
  message.className = alert ? 'alert' : '';
}

function setMode(mode) {
  game.mode = mode;
  document.getElementById('harden').classList.toggle('active', mode === 'harden');
  document.getElementById('reboot').classList.toggle('active', mode === 'reboot');
}

function interactNode(node) {
  if (!node || game.gameOver) return;
  const now = performance.now() / 1000;
  if (game.mode === 'harden') {
    if (game.credits < 20) { setMessage('Need 20cr to harden a node.', true); return; }
    game.credits -= 20;
    node.hardenUntil = now + 8;
    node.hp = Math.min(node.maxHp, node.hp + 18);
    setMessage(`Hardened ${node.isServer ? 'SERVER' : node.layer.toUpperCase()} node ${node.id}. (-20cr)`);
    logEvent(`Player: harden node ${node.id} [${node.isServer ? 'server' : node.layer}] (−20cr)`, 'player');
  } else {
    if (game.credits < 40) { setMessage('Need 40cr to reboot a node.', true); return; }
    game.credits -= 40;
    node.rebootUntil = now + 4.5;
    node.infection = Math.max(0, node.infection - 0.55);
    setMessage(`Forced reboot on node ${node.id}. (-40cr)`);
    logEvent(`Player: reboot node ${node.id} [${node.isServer ? 'server' : node.layer}] (−40cr)`, 'player');
  }
}

document.getElementById('harden').addEventListener('click', () => setMode('harden'));
document.getElementById('reboot').addEventListener('click', () => setMode('reboot'));
document.getElementById('buy-junior').addEventListener('click', () => buyAgent('junior'));
document.getElementById('buy-mid').addEventListener('click', () => buyAgent('mid'));
document.getElementById('buy-senior').addEventListener('click', () => buyAgent('senior'));
document.getElementById('end-restart').addEventListener('click', () => location.reload());

window.addEventListener('pointerdown', event => {
  pointer.x = (event.clientX / innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickable, false);
  if (hits.length) interactNode(hits[0].object.userData.node);
});

const clock = new THREE.Clock();
let elapsed = 0;
let frameCount = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now() / 1000;
  elapsed += dt;
  frameCount++;

  nextRuleReload -= dt;
  if (nextRuleReload <= 0) {
    loadAgentRules();
    nextRuleReload = 5;
  }

  if (!game.gameOver) {
    game.elapsed += dt;
    game.credits = Math.min(999, game.credits + dt * 3);
    game.nextAttack -= dt;
    updateWave(dt);
    updateSeniorStrategy(dt);
    observationEvents.update(dt, now);
    if (game.nextAttack <= 0 && game.waveRemaining > 0) {
      spawnEnemy();
      game.nextAttack = Math.max(0.32, 1.35 - game.wave * 0.035) + rng.next() * 0.65;
    }
    nextNormal -= dt;
    if (nextNormal <= 0) {
      spawnNormalTraffic();
      nextNormal = 0.25 + rng.next() * 0.55;
    }
    nextScan -= dt;
    if (nextScan <= 0) {
      spawnScanner();
      nextScan = 1.4 + rng.next() * 1.8;
    }
  }

  for (const { mesh, s } of spinData) {
    const node = mesh.userData.node;
    if (s.rx) mesh.rotation.x += dt * s.rx;
    if (s.rz) mesh.rotation.z += dt * s.rz;
    if (s.ry) mesh.rotation.y += dt * s.ry;
    if (node?.rebootUntil > now) mesh.rotation.y += dt * 2.2;
  }

  serverGlow.intensity = 3 + Math.sin(elapsed * 1.3) * 0.8;

  for (const f of attackPool) {
    if (f.t <= 0) continue;
    f.t = Math.max(0, f.t - dt * 4.5);
    if (f.t === 0) { f.mesh.visible = false; continue; }
    f.mesh.material = f.mats[Math.round(f.t * (f.mats.length - 1))];
  }
  for (const f of normalPool) {
    if (f.t <= 0) continue;
    f.t = Math.max(0, f.t - dt * 3.5);
    if (f.t === 0) { f.mesh.visible = false; continue; }
    f.mesh.material = f.mats[Math.round(f.t * (f.mats.length - 1))];
  }
  updatePackets(enemyPackets, dt, (node, packet) => applyAttack(node, packet.damage, now));
  updatePackets(defensePackets, dt, (node, packet) => applyDefense(node, packet.repair));
  updatePackets(normalPackets, dt, node => { if (node) triggerFlash(normalPool, node); });
  updateScanPackets(dt);
  updateAgents(dt, now);
  updateFirewalls(now, dt);
  updateNodes(dt, now);
  updateHud();
  game.telemetryCooldown -= dt;
  if (game.telemetryCooldown <= 0) {
    reportTelemetry();
    game.telemetryCooldown = game.lowLoadMode ? 1.2 : 0.35;
  }
  tickEdges(allEdges, mats, now);
  const shouldRender = !game.lowLoadMode || frameCount % 2 === 0;
  if (shouldRender) {
    controls.update();
    composer.render();
  }
}

loadAgentRules();
for (const [rank, personality] of Object.entries(rankPersonalities)) {
  logEvent(`${rank} personality: ${personality.label} — ${personality.summary}`, 'summary');
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyRenderProfile();
});
