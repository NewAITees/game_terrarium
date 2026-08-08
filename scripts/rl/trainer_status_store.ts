import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(status)}\n`, 'utf8');
      await rename(temporaryPath, this.path);
    });
    await this.writeQueue;
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
