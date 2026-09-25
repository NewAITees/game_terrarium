import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildLeaderboard, formatLeaderboard, type GameLeaderboard } from './leaderboard.js';
import { RESEARCH_ADAPTERS, resolveAdapter } from './research_adapters.js';
import { ResearchLedger } from './research_ledger.js';

/**
 * `npm run research:board [-- --game=<id>] [--limit=N] [--out=path]`
 *
 * Prints every wired game's leaderboard (or one game's) and writes the whole set to
 * `logs/rl-research/leaderboard.json`, so anything that wants to show it reads one derived file
 * instead of re-implementing the ranking. The ledgers stay the only source; this file is rebuilt
 * from them on every run and never read back.
 */

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const root = resolve(args.get('dir') || 'logs/rl-research');
const limit = Number(args.get('limit') ?? 20);
const outPath = resolve(args.get('out') || `${root}/leaderboard.json`);

async function main(): Promise<void> {
  const gameIds = args.get('game') ? [args.get('game') as string] : Object.keys(RESEARCH_ADAPTERS);
  const games: GameLeaderboard[] = [];
  for (const gameId of gameIds) {
    const adapter = resolveAdapter(gameId);
    const ledger = await ResearchLedger.open(resolve(root, `${gameId}.jsonl`));
    const board = buildLeaderboard(ledger, adapter);
    games.push(board);
    console.log(formatLeaderboard(board, limit));
    console.log('');
  }
  // A single-game run would otherwise replace the all-games file with a one-game one.
  if (args.get('game') && !args.has('out')) return;
  const temporary = `${outPath}.${process.pid}.tmp`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(temporary, `${JSON.stringify({ generatedAt: new Date().toISOString(), games }, null, 2)}\n`, 'utf8');
  await rename(temporary, outPath);
  console.log(`wrote ${outPath}`);
}

void main();
