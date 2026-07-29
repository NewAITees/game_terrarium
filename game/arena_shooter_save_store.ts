import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type StoredEnvelope = {
  schemaVersion: 1;
  checksum: string;
  payload: unknown;
};

export type ArenaSaveBundle = {
  schemaVersion: 2;
  updatedAt: string;
  data: number;
  damageResearch: number;
  hullResearch: number;
};

type LegacyProfile = {
  updatedAt?: string;
  meta?: {
    data?: number;
    damageResearch?: number;
    hullResearch?: number;
  };
};

export class ArenaShooterSaveStore {
  private readonly root: string;

  constructor(userDataRoot: string) {
    this.root = path.join(userDataRoot, 'rl-arena');
  }

  async load(): Promise<ArenaSaveBundle | null> {
    const stored = await this.readWithBackup('profile.json');
    if (!stored || typeof stored !== 'object') return null;
    const value = stored as Partial<ArenaSaveBundle> & LegacyProfile;
    if (value.schemaVersion === 2) {
      return isValidSave(value) ? value as ArenaSaveBundle : null;
    }
    const migrated = {
      schemaVersion: 2 as const,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
      data: Number(value.meta?.data),
      damageResearch: Number(value.meta?.damageResearch),
      hullResearch: Number(value.meta?.hullResearch),
    };
    return isValidSave(migrated) ? migrated : null;
  }

  async save(bundle: ArenaSaveBundle): Promise<void> {
    if (!isValidSave(bundle)) throw new Error('invalid arena permanent save');
    await fs.mkdir(path.join(this.root, 'backups'), { recursive: true });
    const current = await this.load();
    if (current && Date.parse(current.updatedAt) > Date.parse(bundle.updatedAt)) return;
    await this.atomicWrite('profile.json', bundle);
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
    if (source.length > 1024 * 1024) throw new Error('arena save exceeds 1 MiB');
    const envelope = JSON.parse(source) as Partial<StoredEnvelope>;
    if (envelope.schemaVersion !== 1 || typeof envelope.checksum !== 'string') {
      throw new Error('invalid arena save envelope');
    }
    if (checksum(envelope.payload) !== envelope.checksum) throw new Error('arena save checksum mismatch');
    return envelope.payload;
  }
}

function isValidSave(value: Partial<ArenaSaveBundle>): boolean {
  return value.schemaVersion === 2
    && typeof value.updatedAt === 'string'
    && Number.isFinite(Date.parse(value.updatedAt))
    && [value.data, value.damageResearch, value.hullResearch]
      .every((entry) => Number.isFinite(entry) && Number(entry) >= 0);
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

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
