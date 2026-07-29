import { GameEngine } from '../game/engine';

type RunSummary = {
  run: number;
  floor: number;
  score: number;
  turns: number;
  outcome: 'died' | 'turnLimit';
  hp: number;
  maxHp: number;
};

function parseArgs(argv: string[]): { runs: number; maxTurns: number } {
  const args = Object.fromEntries(argv.map((entry) => {
    const [key, value] = entry.replace(/^--/, '').split('=');
    return [key, value];
  }));
  return {
    runs: Number(args.runs ?? 20),
    maxTurns: Number(args.maxTurns ?? 400),
  };
}

// Greedy bot policy driven entirely off getAvailableActions(): fight when adjacent to a
// monster, otherwise loot/descend opportunistically, otherwise wander to a random legal move.
function pickAction(engine: GameEngine): { action: string; params: Record<string, any> } | null {
  const actions = engine.getAvailableActions();
  if (actions.length === 0) return null;
  const attack = actions.find((a) => a.action === 'attack');
  if (attack) return { action: 'attack', params: { dir: attack.dir } };
  const descend = actions.find((a) => a.action === 'descend');
  if (descend) return { action: 'descend', params: {} };
  const pickup = actions.find((a) => a.action === 'pickup');
  if (pickup) return { action: 'pickup', params: {} };
  const equip = actions.find((a) => a.action === 'equip');
  if (equip) return { action: 'equip', params: { item: equip.item } };
  const useItem = actions.find((a) => a.action === 'use_item' && engine.player.hp < engine.player.maxHp * 0.5);
  if (useItem) return { action: 'use_item', params: { item: useItem.item } };
  const moves = actions.filter((a) => a.action === 'move');
  if (moves.length === 0) return null;
  const move = moves[(Math.random() * moves.length) | 0];
  return { action: 'move', params: { dir: move.dir } };
}

function runOne(run: number, maxTurns: number): RunSummary {
  const engine = new GameEngine();
  let turns = 0;
  while (turns < maxTurns && !engine.gameOver) {
    const choice = pickAction(engine);
    if (!choice) break;
    engine.processAction(choice.action, choice.params);
    turns += 1;
  }
  return {
    run,
    floor: engine.floorNum,
    score: engine.score,
    turns,
    outcome: engine.gameOver ? 'died' : 'turnLimit',
    hp: engine.player.hp,
    maxHp: engine.player.maxHp,
  };
}

function main(): void {
  const { runs, maxTurns } = parseArgs(process.argv.slice(2));
  const summaries: RunSummary[] = [];
  for (let i = 0; i < runs; i++) {
    const startedAt = Date.now();
    const summary = runOne(i + 1, maxTurns);
    const wallMs = Date.now() - startedAt;
    summaries.push(summary);
    console.log(
      `run ${String(summary.run).padStart(3)} outcome=${summary.outcome.padEnd(9)} floor=${String(summary.floor).padStart(2)} ` +
      `score=${String(summary.score).padStart(5)} turns=${String(summary.turns).padStart(4)} hp=${summary.hp}/${summary.maxHp} wallMs=${wallMs}`,
    );
  }

  const died = summaries.filter((s) => s.outcome === 'died').length;
  const turnLimit = summaries.filter((s) => s.outcome === 'turnLimit').length;
  const avg = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  const max = (values: number[]) => values.reduce((m, v) => Math.max(m, v), -Infinity);

  console.log('---');
  console.log(`runs=${runs} died=${died} turnLimit=${turnLimit}`);
  console.log(`avg floor reached=${avg(summaries.map((s) => s.floor)).toFixed(2)} (max=${max(summaries.map((s) => s.floor))})`);
  console.log(`avg score=${avg(summaries.map((s) => s.score)).toFixed(1)} (max=${max(summaries.map((s) => s.score))})`);
  console.log(`avg turns survived=${avg(summaries.map((s) => s.turns)).toFixed(1)}`);
}

main();
