import { createModelManifest, type ModelCompatibility, type ModelManifest } from '../../shared/rl/model_manifest.js';
import { ModelFileStore } from './model_file_store.js';

/**
 * The batch loop shared by the live trainers that publish every batch without a promotion gate:
 * load the last published model, train a batch, publish, honour a reset request, repeat.
 *
 * A game supplies only how to build a learner from a saved model and how to run one episode on it.
 * Gunship's trainer is not built on this: it evaluates each batch on hold-out seeds and promotes
 * through `ModelLifecycleStore`, which is a different contract, not a variant of this one.
 */

export type LiveModel<Save> = {
  version: 1;
  revision: number;
  publishedAt: string;
  manifest?: ModelManifest;
  model?: Save;
};

export interface LiveLearner<Save> {
  /** `episode` is the 0-based index within the current batch. */
  runEpisode(seed: number, capSeconds: number, episode: number): void | Promise<void>;
  serialize(): Save | undefined;
  readonly trainingSteps: number;
}

export type LiveTrainerConfig<Save> = {
  /** Shown in the trainer's first log line. */
  label: string;
  fileStem: string;
  compatibility: ModelCompatibility;
  defaultEpisodes: number;
  defaultCapSeconds: number;
  /** Builds a fresh learner, or one restored from `save` when there is a published model. */
  createLearner(save: Save | undefined): LiveLearner<Save>;
};

const emptyModel = <Save>(): LiveModel<Save> => ({ version: 1, revision: 0, publishedAt: new Date(0).toISOString() });

export async function runLiveTrainer<Save>(config: LiveTrainerConfig<Save>, argv = process.argv.slice(2)): Promise<void> {
  const args = new Map(argv.map((token) => {
    const [key, value = ''] = token.replace(/^--/, '').split('=');
    return [key, value];
  }));
  const episodesPerBatch = Math.max(1, Number(args.get('episodes') ?? config.defaultEpisodes));
  const cap = Math.max(1, Number(args.get('cap') ?? config.defaultCapSeconds));
  const batches = Math.max(0, Number(args.get('batches') ?? Number.POSITIVE_INFINITY));
  const store = new ModelFileStore<LiveModel<Save>>(process.env.RL_MODEL_ROOT || process.cwd(), config.fileStem);

  let bundle = await store.load(emptyModel);
  let learner = config.createLearner(bundle.version === 1 ? bundle.model : undefined);
  console.log(`${config.label} trainer: episodes=${episodesPerBatch}, cap=${cap}s, model=${bundle.revision}`);
  for (let batch = 0; batch < batches; batch += 1) {
    if (await store.consumeReset()) {
      learner = config.createLearner(undefined);
      bundle = emptyModel();
      console.log('learning reset accepted');
    }
    for (let episode = 0; episode < episodesPerBatch; episode += 1) {
      await learner.runEpisode(bundle.revision * episodesPerBatch + episode + 1, cap, episode);
    }
    const revision = bundle.revision + 1;
    const publishedAt = new Date().toISOString();
    const trainingSteps = learner.trainingSteps;
    bundle = {
      version: 1,
      revision,
      publishedAt,
      manifest: createModelManifest(config.compatibility, { revision, trainingSteps, publishedAt }),
      model: learner.serialize(),
    };
    await store.publish(bundle);
    console.log(`published model r${revision} (${trainingSteps} steps, ${publishedAt})`);
  }
}
