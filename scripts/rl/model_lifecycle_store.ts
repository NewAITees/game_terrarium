import { unlink } from 'node:fs/promises';
import { ModelFileStore } from './model_file_store.js';

/**
 * Durable model stages shared by live trainers.
 *
 * The unsuffixed file remains the Champion so existing Player APIs can never accidentally serve a
 * half-trained snapshot. Training and Candidate files are private to the trainer/evaluator.
 */
export class ModelLifecycleStore<Model> {
  private readonly training: ModelFileStore<Model>;
  private readonly candidate: ModelFileStore<Model>;
  private readonly champion: ModelFileStore<Model>;

  constructor(root: string, fileStem: string) {
    this.training = new ModelFileStore(root, `${fileStem}-training`);
    this.candidate = new ModelFileStore(root, `${fileStem}-candidate`);
    this.champion = new ModelFileStore(root, fileStem);
  }

  loadTraining(fallback: () => Model): Promise<Model> {
    return this.training.load(fallback);
  }

  loadCandidate(fallback: () => Model): Promise<Model> {
    return this.candidate.load(fallback);
  }

  loadChampion(fallback: () => Model): Promise<Model> {
    return this.champion.load(fallback);
  }

  publishTraining(model: Model): Promise<void> {
    return this.training.publish(model);
  }

  stageCandidate(model: Model): Promise<void> {
    return this.candidate.publish(model);
  }

  /** Promote only after the caller's fixed-seed evaluation accepts the staged snapshot. */
  async promoteCandidate(accept: (candidate: Model, champion: Model) => boolean, fallback: () => Model): Promise<boolean> {
    const candidate = await this.loadCandidate(fallback);
    const champion = await this.loadChampion(fallback);
    if (!accept(candidate, champion)) return false;
    await this.champion.publish(candidate);
    return true;
  }

  requestReset(): Promise<void> {
    return this.champion.requestReset();
  }

  /** A reset requested through the existing Champion API clears model stages, not UI/meta data. */
  async consumeReset(): Promise<boolean> {
    if (!await this.champion.consumeReset()) return false;
    await Promise.all([
      unlink(this.training.modelPath).catch(() => undefined),
      unlink(this.candidate.modelPath).catch(() => undefined),
      unlink(this.champion.modelPath).catch(() => undefined),
    ]);
    return true;
  }
}
