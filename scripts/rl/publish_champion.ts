import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { ModelFileStore } from './model_file_store.js';
import { resolveAdapter } from './research_adapters.js';
import { ResearchLedger } from './research_ledger.js';
import { verifyContract } from './research_contract.js';

/**
 * Promotes the ledger's champion into the model file the running player reads.
 *
 * This is the only place research results reach the game, and it is deliberately a separate command
 * rather than something the search does on its own. The search runs unattended for hours; changing
 * what the player shows is a decision, and one that should not happen while nobody is looking.
 *
 * Publication is refused, not forced, when the champion cannot actually run in the live page. The
 * agent there is built with a fixed observation and action variant and will reject a table built
 * under any other — silently, falling back to an untrained policy. That failure looks exactly like a
 * bad champion, so it is better to stop here with an explanation.
 */

const args = new Map(process.argv.slice(2).map((token) => {
  const [key, value = ''] = token.replace(/^--/, '').split('=');
  return [key, value];
}));
const gameId = args.get('game') || 'gunship';
const ledgerPath = resolve(args.get('ledger') || `logs/rl-research/${gameId}.jsonl`);
const modelRoot = resolve(args.get('model-root') || process.env.RL_MODEL_ROOT || process.cwd());
const dryRun = args.has('dry-run');

async function main(): Promise<void> {
  const adapter = resolveAdapter(gameId);
  const violations = verifyContract(adapter);
  if (violations.length) {
    console.error('refusing to publish from a ledger whose contract is broken:');
    for (const violation of violations) console.error(`  [${violation.check}] ${violation.detail}`);
    process.exitCode = 1;
    return;
  }

  const publication = adapter.livePublication;
  if (!publication) {
    console.error(`${gameId} declares no live publication route`);
    process.exitCode = 1;
    return;
  }

  const ledger = await ResearchLedger.open(ledgerPath);
  const champion = ledger.champion(gameId, adapter.defaultSpec());
  if (!champion) {
    console.error(`no champion in ${ledgerPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`champion ${champion.id}: hold-out median ${champion.holdout.median.toFixed(2)}`
    + ` (95% ${champion.holdout.lower95.toFixed(2)}–${champion.holdout.upper95.toFixed(2)})`
    + ` obs=${champion.spec.observation} act=${champion.spec.actions}`);

  if (champion.spec.observation !== publication.liveObservation || champion.spec.actions !== publication.liveActions) {
    console.error(`refusing to publish: the live ${gameId} page runs`
      + ` obs=${publication.liveObservation} act=${publication.liveActions}, and a table built under`
      + ` obs=${champion.spec.observation} act=${champion.spec.actions} would be rejected on load.`);
    console.error('  Adopt the variant in the page first, then publish.');
    process.exitCode = 1;
    return;
  }

  if (!champion.modelFile) {
    console.error(`refusing to publish: champion ${champion.id} has no stored model`
      + ' (it predates model storage). Re-run the spec so its model is kept, then publish.');
    process.exitCode = 1;
    return;
  }

  const ledgerDirectory = dirname(ledgerPath);
  const modelPath = resolve(ledgerDirectory, champion.modelFile);
  const relativeModelPath = relative(ledgerDirectory, modelPath);
  if (relativeModelPath.startsWith('..') || relativeModelPath === '' || relativeModelPath.startsWith('/')) {
    console.error(`refusing to publish: model artifact escapes the ledger directory (${champion.modelFile})`);
    process.exitCode = 1;
    return;
  }
  const model = JSON.parse(await readFile(modelPath, 'utf8')) as unknown;
  const store = new ModelFileStore<unknown>(modelRoot, publication.stem);
  const existing = await store.load(() => ({ revision: 0 })) as { revision?: number };
  const revision = (existing.revision ?? 0) + 1;
  const publishedAt = new Date().toISOString();
  const bundle = publication.bundle(model, revision, {
    publishedAt,
    trainingSteps: champion.trainingSteps,
  }, existing);

  if (dryRun) {
    console.log(`would write revision ${revision} to ${store.modelPath}`);
    return;
  }
  await store.publish(bundle);
  console.log(`published champion ${champion.id} as revision ${revision} to ${store.modelPath}`);
}

void main();
