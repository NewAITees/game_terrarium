import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { ModelFileStore } from './model_file_store.js';
import { resolveAdapter } from './research_adapters.js';
import { ResearchLedger } from './research_ledger.js';
import { verifyContract } from './research_contract.js';

/**
 * Promotes the ledger's champion into the model file the running player reads.
 *
 * The page builds its agent from the encoding stored with the model, so a champion trained under
 * any declared observation or action variant can be shown as-is. That is what makes publishing on
 * promotion safe to automate: there is no longer a variant the player would silently reject.
 *
 * Refusals that remain are about the artifact, not the encoding — a champion with no stored model
 * cannot be published, and a model path that escapes the ledger directory is not read.
 */

/**
 * A string discriminant, not a boolean one: this project compiles with `strict: false`, and without
 * strictNullChecks a boolean discriminant does not narrow the union at the use site.
 */
export type PublishOutcome =
  | { status: 'published'; championId: string; revision: number; modelPath: string; holdoutMedian: number }
  | { status: 'skipped'; reason: string };

export type PublishOptions = {
  gameId: string;
  ledgerPath: string;
  modelRoot: string;
  dryRun?: boolean;
};

export async function publishChampion(options: PublishOptions): Promise<PublishOutcome> {
  const adapter = resolveAdapter(options.gameId);
  const violations = verifyContract(adapter);
  if (violations.length) {
    return {
      status: 'skipped',
      reason: `the ledger's contract is broken: ${violations.map((v) => `[${v.check}] ${v.detail}`).join('; ')}`,
    };
  }

  const publication = adapter.livePublication;
  if (!publication) return { status: 'skipped', reason: `${options.gameId} declares no live publication route` };

  const ledger = await ResearchLedger.open(options.ledgerPath);
  const champion = ledger.champion(options.gameId, adapter.defaultSpec());
  if (!champion) return { status: 'skipped', reason: `no champion in ${options.ledgerPath}` };

  if (!champion.modelFile) {
    return {
      status: 'skipped',
      reason: `champion ${champion.id} has no stored model (it predates model storage);`
        + ' re-run the spec so its model is kept, then publish',
    };
  }

  const ledgerDirectory = dirname(options.ledgerPath);
  const modelPath = resolve(ledgerDirectory, champion.modelFile);
  const relativeModelPath = relative(ledgerDirectory, modelPath);
  if (relativeModelPath.startsWith('..') || relativeModelPath === '' || relativeModelPath.startsWith('/')) {
    return { status: 'skipped', reason: `model artifact escapes the ledger directory (${champion.modelFile})` };
  }

  const model = JSON.parse(await readFile(modelPath, 'utf8')) as unknown;
  const store = new ModelFileStore<unknown>(options.modelRoot, publication.stem);
  const existing = await store.load(() => ({ revision: 0 })) as { revision?: number };
  const revision = (existing.revision ?? 0) + 1;
  const publishedAt = new Date().toISOString();
  const bundle = publication.bundle(model, revision, { publishedAt, trainingSteps: champion.trainingSteps }, existing);

  if (options.dryRun) {
    return { status: 'skipped', reason: `would write revision ${revision} to ${store.modelPath}` };
  }
  await store.publish(bundle);
  return {
    status: 'published',
    championId: champion.id,
    revision,
    modelPath: store.modelPath,
    holdoutMedian: champion.holdout.median,
  };
}

export function describeChampionSpec(spec: { learnerVariant: string; observation: string; actions: string }): string {
  return `learner=${spec.learnerVariant} obs=${spec.observation} act=${spec.actions}`;
}
