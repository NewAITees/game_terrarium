import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type StoredEnvelope = {
  schemaVersion: 1;
  checksum: string;
  payload: unknown;
};

export type ArenaSaveBundle = {
  schemaVersion: 1;
  updatedAt: string;
  meta: unknown;
  run: unknown;
  agent: unknown;
  episode: number;
  wave: number;
  waveTime: number;
  score: number;
  kills: number;
};

export class ArenaShooterSaveStore {
  private readonly root: string;

  constructor(userDataRoot: string) {
    this.root = path.join(userDataRoot, 'rl-arena');
  }

  async load(): Promise<ArenaSaveBundle | null> {
    const profile = await this.readWithBackup('profile.json');
    const run = await this.readWithBackup('run.json');
    const model = await this.readWithBackup(path.join('models', 'training.json'));
    if (!profile || !run || !model) return null;
    const profileData = profile as Pick<ArenaSaveBundle, 'schemaVersion' | 'updatedAt' | 'meta'>;
    const runData = run as Omit<ArenaSaveBundle, 'schemaVersion' | 'updatedAt' | 'meta' | 'agent'>;
    return {
      schemaVersion: 1,
      updatedAt: profileData.updatedAt,
      meta: profileData.meta,
      ...runData,
      agent: model,
    };
  }

  async save(bundle: ArenaSaveBundle): Promise<void> {
    validateBundle(bundle);
    await fs.mkdir(path.join(this.root, 'models'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'backups'), { recursive: true });
    await this.atomicWrite('profile.json', {
      schemaVersion: 1,
      updatedAt: bundle.updatedAt,
      meta: bundle.meta,
    });
    await this.atomicWrite('run.json', {
      run: bundle.run,
      episode: bundle.episode,
      wave: bundle.wave,
      waveTime: bundle.waveTime,
      score: bundle.score,
      kills: bundle.kills,
    });
    await this.atomicWrite(path.join('models', 'training.json'), bundle.agent);
  }

  private async atomicWrite(relativePath: string, payload: unknown): Promise<void> {
    const target = path.join(this.root, relativePath);
    const temporary = `${target}.tmp`;
    const backup = path.join(this.root, 'backups', `${relativePath.replaceAll(path.sep, '__')}.prev`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const envelope = createEnvelope(payload);
    await fs.writeFile(temporary, `${JSON.stringify(envelope)}\n`, 'utf8');
    await this.readEnvelope(temporary);
    try {
      await fs.copyFile(target, backup);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await fs.rename(temporary, target);
  }

  private async readWithBackup(relativePath: string): Promise<unknown | null> {
    const target = path.join(this.root, relativePath);
    try {
      return await this.readEnvelope(target);
    } catch {
      const backup = path.join(this.root, 'backups', `${relativePath.replaceAll(path.sep, '__')}.prev`);
      try {
        return await this.readEnvelope(backup);
      } catch {
        return null;
      }
    }
  }

  private async readEnvelope(filePath: string): Promise<unknown> {
    const source = await fs.readFile(filePath, 'utf8');
    if (source.length > 8 * 1024 * 1024) throw new Error('arena save exceeds 8 MiB');
    const envelope = JSON.parse(source) as Partial<StoredEnvelope>;
    if (envelope.schemaVersion !== 1 || typeof envelope.checksum !== 'string') {
      throw new Error('invalid arena save envelope');
    }
    if (checksum(envelope.payload) !== envelope.checksum) throw new Error('arena save checksum mismatch');
    return envelope.payload;
  }
}

function createEnvelope(payload: unknown): StoredEnvelope {
  return {
    schemaVersion: 1,
    checksum: checksum(payload),
    payload,
  };
}

function checksum(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function validateBundle(bundle: ArenaSaveBundle): void {
  if (bundle.schemaVersion !== 1) throw new Error('unsupported arena save schema');
  if (!bundle.meta || !bundle.run || !bundle.agent) throw new Error('arena save sections are required');
  for (const value of [bundle.episode, bundle.wave, bundle.waveTime, bundle.score, bundle.kills]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('arena save contains invalid numeric state');
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
