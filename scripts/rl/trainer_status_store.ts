import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type TrainerRunState = 'running' | 'stopped' | 'failed';

export type TrainerStatus = {
  version: 1;
  gameId: string;
  state: TrainerRunState;
  pid?: number;
  startedAt?: string;
  heartbeatAt: string;
  stoppedAt?: string;
  exitCode?: number | null;
  error?: string;
};

export class TrainerStatusStore {
  readonly path: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(root: string, private readonly gameId: string) {
    if (!/^[a-z0-9-]+$/.test(gameId)) throw new Error('trainer game id must be lowercase kebab-case');
    this.path = join(root, 'logs', `${gameId}-trainer-status.json`);
  }

  async publish(values: Omit<TrainerStatus, 'version' | 'gameId' | 'heartbeatAt'> & { heartbeatAt?: string }): Promise<TrainerStatus> {
    const status: TrainerStatus = {
      version: 1,
      gameId: this.gameId,
      ...values,
      heartbeatAt: values.heartbeatAt ?? new Date().toISOString(),
    };
    // The queue must never keep a rejection: chaining onto a rejected promise skips every later
    // handler, so a single failed write used to silence the heartbeat for the life of the process.
    // A status writer that goes quiet is read as "the trainer died", which is worse than the
    // transient failure it is reporting.
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(status)}\n`, 'utf8');
      // Windows fails the rename with EPERM/EBUSY while a reader holds the destination open, and
      // the status file is read by the server on every trainer poll. Retry briefly rather than
      // treating a reader as a fatal error, and never leave the temp file behind.
      await renameWithRetry(temporaryPath, this.path);
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
    return status;
  }

  async read(staleAfterMs = 7000): Promise<TrainerStatus> {
    try {
      const status = JSON.parse(await readFile(this.path, 'utf8')) as TrainerStatus;
      if (status.version !== 1 || status.gameId !== this.gameId || !Number.isFinite(Date.parse(status.heartbeatAt))) throw new Error('invalid status');
      if (status.state === 'running' && Date.now() - Date.parse(status.heartbeatAt) > staleAfterMs) {
        return { ...status, state: 'failed', error: 'trainer heartbeat expired' };
      }
      return status;
    } catch {
      return { version: 1, gameId: this.gameId, state: 'stopped', heartbeatAt: new Date(0).toISOString() };
    }
  }
}

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await rename(from, to); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (attempt >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) {
        await unlink(from).catch(() => undefined);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}
