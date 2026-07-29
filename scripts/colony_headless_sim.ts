import { readFileSync } from 'fs';
import path from 'path';
import { createColonySimulation } from '../apps/colony/colony_simulation';
import type {
  ColonyAction,
  ColonyFaction,
  ColonyFactionDef,
  ColonyMap,
  ColonyNode,
  ColonyPersonality,
  ColonyRule,
} from '../shared/types/colony';

// Mirrors the constants/generateMap logic in apps/colony/colony.ts, minus Three.js scene setup —
// this file has no rendering dependency so it can run headless.
const NODE_COUNT = 44;
const SPREAD = 136;
const K_NEIGHBORS = 4;
const NEUTRAL_RESIST = 0.30;
const FOOD_CAP = 80;
const COST: Record<ColonyAction, number> = { expand: 18, attack: 28, fortify: 12, gather: 0 };
const DECAY_BY_PERSONALITY: Record<ColonyPersonality, number> = { builder: 0.003, raider: 0.010, hoarder: 0.004 };
const TICK_SEC = 1.6;

const FACTION_DEFS: ColonyFactionDef[] = [
  { id: 0, name: 'CYGNUS', personality: 'builder', color: 0x3a7fea, emCol: 0x0d2d70 },
  { id: 1, name: 'VORTEX', personality: 'raider', color: 0xe03a3a, emCol: 0x601010 },
  { id: 2, name: 'VERDANT', personality: 'hoarder', color: 0x3ac060, emCol: 0x0d4520 },
];

class RNG {
  private s: number;
  constructor(seed: number) { this.s = ((seed || Math.random() * 2 ** 32) ^ 0xDEADBEEF) >>> 0; }
  next(): number { let x = this.s; x ^= x << 13; x ^= x >> 17; x ^= x << 5; return (this.s = x >>> 0) / 0x100000000; }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
}

function generateMap(rng: RNG): ColonyMap {
  const nodes: ColonyNode[] = [];
  const perRow = Math.ceil(Math.sqrt(NODE_COUNT * 1.25));
  const cell = SPREAD / (perRow - 1);
  while (nodes.length < NODE_COUNT) {
    const i = nodes.length;
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = (col / (perRow - 1) - 0.5) * SPREAD + rng.range(-cell * 0.28, cell * 0.28);
    const z = (row / (perRow - 1) - 0.5) * SPREAD + rng.range(-cell * 0.28, cell * 0.28);
    nodes.push({
      id: i, x, z,
      owner: -1,
      strength: NEUTRAL_RESIST,
      food: rng.range(10, 42),
      material: rng.range(5, 24),
      foodRate: rng.range(0.9, 2.8),
      isBase: false,
      neighbors: [],
      flashUntil: 0,
      mesh: null, halo: null, resourceRing: null,
    });
  }
  const edges: ColonyMap['edges'] = [];
  const edgeSet = new Set<string>();
  for (const n of nodes) {
    nodes
      .filter((m) => m.id !== n.id)
      .map((m) => ({ m, d: Math.hypot(m.x - n.x, m.z - n.z) }))
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

function loadFactionRules(): Record<number, ColonyRule[]> {
  const rulesDir = path.resolve(__dirname, '..', '..', 'faction_rules');
  const rules: Record<number, ColonyRule[]> = {};
  for (const def of FACTION_DEFS) {
    const raw = JSON.parse(readFileSync(path.join(rulesDir, `${def.personality}.json`), 'utf8'));
    rules[def.id] = raw.rules;
  }
  return rules;
}

type RunSummary = {
  run: number;
  ticks: number;
  winner: string;
  survivors: number;
  territoryShare: Record<string, string>;
};

function parseArgs(argv: string[]): { runs: number; maxTicks: number; seedStart: number } {
  const args = Object.fromEntries(argv.map((entry) => {
    const [key, value] = entry.replace(/^--/, '').split('=');
    return [key, value];
  }));
  return {
    runs: Number(args.runs ?? 10),
    maxTicks: Number(args.maxTicks ?? 400),
    seedStart: Number(args.seed ?? 1),
  };
}

function runOne(run: number, seed: number, maxTicks: number): RunSummary {
  const rng = new RNG(seed);
  const map = generateMap(rng);
  const factions: ColonyFaction[] = FACTION_DEFS.map((def) => ({
    ...def, food: 65, material: 40, nodes: [], baseNode: null, intent: 'initializing…', alive: true, rules: [],
  }));
  const CORNERS = [
    { x: -SPREAD * 0.44, z: 0 },
    { x: SPREAD * 0.44, z: 0 },
    { x: 0, z: SPREAD * 0.44 },
  ];
  for (let i = 0; i < factions.length; i++) {
    const base = map.nodes.reduce((b, n) => (Math.hypot(n.x - CORNERS[i].x, n.z - CORNERS[i].z) < Math.hypot(b.x - CORNERS[i].x, b.z - CORNERS[i].z) ? n : b));
    base.isBase = true; base.owner = i; base.strength = 1.0;
    factions[i].baseNode = base;
    factions[i].nodes = [base];
  }
  const factionRules = loadFactionRules();
  const { decayStrength, tickFactions } = createColonySimulation({
    cost: COST,
    decayByPersonality: DECAY_BY_PERSONALITY,
    factions,
    factionRules,
    foodCap: FOOD_CAP,
    map,
    neutralResist: NEUTRAL_RESIST,
    logEvent: () => {},
    performanceNow: () => Date.now() / 1000,
    spawnPulse: () => {},
  });

  let ticks = 0;
  while (ticks < maxTicks) {
    tickFactions();
    decayStrength(TICK_SEC);
    ticks += 1;
    const alive = factions.filter((f) => f.alive);
    if (alive.length <= 1) break;
  }

  const alive = factions.filter((f) => f.alive);
  const winner = alive.length === 1 ? alive[0].name : alive.length === 0 ? 'none' : 'ongoing';
  const territoryShare: Record<string, string> = {};
  for (const faction of factions) {
    const count = map.nodes.filter((n) => n.owner === faction.id).length;
    territoryShare[faction.name] = `${count}/${NODE_COUNT}`;
  }
  return { run, ticks, winner, survivors: alive.length, territoryShare };
}

function main(): void {
  const { runs, maxTicks, seedStart } = parseArgs(process.argv.slice(2));
  const summaries: RunSummary[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = seedStart + i;
    const startedAt = Date.now();
    const summary = runOne(i + 1, seed, maxTicks);
    const wallMs = Date.now() - startedAt;
    summaries.push(summary);
    const shareStr = Object.entries(summary.territoryShare).map(([name, share]) => `${name}=${share}`).join(' ');
    console.log(
      `run ${String(summary.run).padStart(3)} seed=${seed} winner=${summary.winner.padEnd(9)} survivors=${summary.survivors} ` +
      `ticks=${String(summary.ticks).padStart(4)} ${shareStr} wallMs=${wallMs}`,
    );
  }

  console.log('---');
  const winCounts: Record<string, number> = {};
  for (const summary of summaries) winCounts[summary.winner] = (winCounts[summary.winner] ?? 0) + 1;
  console.log(`runs=${runs} win breakdown: ${Object.entries(winCounts).map(([name, count]) => `${name}=${count}`).join(' ')}`);
  const avgTicks = summaries.reduce((sum, s) => sum + s.ticks, 0) / (summaries.length || 1);
  console.log(`avg ticks to resolve=${avgTicks.toFixed(1)}`);
}

main();
