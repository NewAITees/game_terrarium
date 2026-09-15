import { resolve } from 'node:path';
import { publishChampion } from './publish_champion_core.js';

/**
 * Manual publication of the ledger's champion into the model file the running player reads.
 *
 * The search also publishes on promotion, so this command is for republishing on demand — after a
 * reset, or to move a ledger's champion onto a machine whose model file is behind.
 */

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const gameId = args.get('game') || 'gunship';

async function main(): Promise<void> {
  const outcome = await publishChampion({
    gameId,
    ledgerPath: resolve(args.get('ledger') || `logs/rl-research/${gameId}.jsonl`),
    modelRoot: resolve(args.get('model-root') || process.env.RL_MODEL_ROOT || process.cwd()),
    dryRun: args.has('dry-run'),
  });
  if (outcome.status !== 'published') {
    console.error(`not published: ${outcome.reason}`);
    process.exitCode = args.has('dry-run') ? 0 : 1;
    return;
  }
  console.log(`published champion ${outcome.championId} (hold-out median ${outcome.holdoutMedian.toFixed(2)})`
    + ` as revision ${outcome.revision} to ${outcome.modelPath}`);
}

void main();
