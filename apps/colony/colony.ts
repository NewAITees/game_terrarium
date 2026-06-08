import { Clock, } from 'three';
import { createColonyObservation } from './colony_observation.js';
import { createColonyRuntime } from './colony_runtime.js';
import { createColonyScene } from './colony_scene.js';
import { createColonySimulation } from './colony_simulation.js';
import type {
  ColonyAction,
  ColonyFaction,
  ColonyFactionDef,
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

const {
  camera,
  composer,
  contestedColor: CONTESTED_COL,
  controls,
  edgeMatFaction,
  edgeMatNeutral,
  factionColors,
  factionEmissiveColors: factionEmCols,
  neutralColor: NEUTRAL_COL,
  renderer,
  scene,
  spawnPulse,
  tickPulses,
} = createColonyScene({
  bg: BG,
  factions,
  innerHeight,
  innerWidth,
  map,
  rng,
});

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
// ── Action Costs ──────────────────────────────────────────────────────────────
const FOOD_CAP = 80;
const COST: Record<ColonyAction, number> = { expand: 18, attack: 28, fortify: 12, gather: 0 };
let logEvent = (_text: string, _type = 'info') => {};
const { decayStrength, tickFactions } = createColonySimulation({
  cost: COST,
  decayByPersonality: DECAY_BY_PERSONALITY,
  factions,
  factionRules,
  foodCap: FOOD_CAP,
  map,
  neutralResist: NEUTRAL_RESIST,
  logEvent: (text: string, type?: string) => logEvent(text, type),
  performanceNow: () => performance.now() / 1000,
  spawnPulse,
});

const observation = createColonyObservation({
  contestedColor: CONTESTED_COL,
  edgeMatFaction,
  edgeMatNeutral,
  factionColors,
  factionEmissiveColors: factionEmCols,
  factions,
  map,
  neutralColor: NEUTRAL_COL,
  rng,
  world,
});
const { doIntervention, pollInterventions, reportTelemetry, updateHUD, updateVisuals } = observation;
logEvent = observation.logEvent;
const clock = new Clock();
createColonyRuntime({
  camera,
  clock,
  composer,
  controls,
  decayStrength,
  doIntervention,
  factions,
  loadFactionRules,
  logEvent: (text: string, type?: string) => logEvent(text, type),
  map,
  nodeCount: NODE_COUNT,
  pollInterventions,
  renderer,
  reportTelemetry,
  rng,
  seed: SEED,
  tickFactions,
  tickPulses,
  tickSec: TICK_SEC,
  updateHUD,
  updateVisuals,
  world,
}).initialize();
