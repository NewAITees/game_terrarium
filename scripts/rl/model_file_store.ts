import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class ModelFileStore<Model> {
  readonly modelPath: string;
  readonly resetPath: string;

  constructor(root: string, fileStem: string) {
    if (!/^[a-z0-9-]+$/.test(fileStem)) throw new Error('model file stem must be lowercase kebab-case');
    this.modelPath = join(root, 'logs', `${fileStem}.json`);
    this.resetPath = join(root, 'logs', `${fileStem}.reset`);
  }

  async load(fallback: () => Model): Promise<Model> {
    try {
      return JSON.parse(await readFile(this.modelPath, 'utf8')) as Model;
    } catch {
      return fallback();
    }
  }

  async publish(model: Model): Promise<void> {
    await mkdir(dirname(this.modelPath), { recursive: true });
    const temporaryPath = `${this.modelPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(model), 'utf8');
    await rename(temporaryPath, this.modelPath);
  }

  async requestReset(): Promise<void> {
    await mkdir(dirname(this.resetPath), { recursive: true });
    await writeFile(this.resetPath, String(Date.now()), 'utf8');
    await unlink(this.modelPath).catch(() => undefined);
  }

  async consumeReset(): Promise<boolean> {
    try {
      await readFile(this.resetPath);
      await unlink(this.resetPath);
      return true;
    } catch {
      return false;
    }
  }
}
