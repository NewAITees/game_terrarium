import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { TrainerStatusStore } from './trainer_status_store.js';

export type TrainingSessionConfig = {
  gameId: string;
  page: string;
  trainerModule: string;
  trainerArguments?: readonly string[];
  root?: string;
};

export function startTrainingSession(config: TrainingSessionConfig): void {
  const root = config.root ?? process.cwd();
  const statusStore = new TrainerStatusStore(process.env.RL_MODEL_ROOT || root, config.gameId);
  const startedAt = new Date().toISOString();
  const trainer = spawn(process.execPath, [
    join(__dirname, '..', config.trainerModule),
    ...(config.trainerArguments ?? []),
  ], { cwd: root, stdio: 'inherit' });
  const publishRunning = (): void => { void statusStore.publish({ state: 'running', pid: trainer.pid, startedAt }); };
  publishRunning();
  const heartbeat = setInterval(publishRunning, 2000);
  const electronCli = join(root, 'node_modules', 'electron', 'cli.js');
  const player = spawn(process.execPath, [electronCli, '.', `--page=${config.page}`], {
    cwd: root,
    stdio: 'inherit',
  });
  let stopping = false;
  const stop = (exitCode?: number | null): void => {
    if (stopping) return;
    stopping = true;
    terminate(trainer);
    if (exitCode !== undefined) process.exitCode = exitCode ?? 0;
  };
  player.on('exit', (code) => stop(code));
  player.on('error', (error) => {
    stop(1);
    console.error(`${config.gameId} player failed`, error);
  });
  trainer.on('error', (error) => {
    // The player remains usable with its last published model.
    console.error(`${config.gameId} trainer failed`, error);
    clearInterval(heartbeat);
    void statusStore.publish({ state: 'failed', pid: trainer.pid, startedAt, error: error.message });
  });
  trainer.on('exit', (code, signal) => {
    clearInterval(heartbeat);
    void statusStore.publish({
      state: code === 0 ? 'stopped' : 'failed',
      pid: trainer.pid,
      startedAt,
      stoppedAt: new Date().toISOString(),
      exitCode: code,
      error: code === 0 ? undefined : `trainer exited ${code ?? signal ?? 'unknown'}`,
    });
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stop(0);
      terminate(player);
    });
  }
}

function terminate(child: ChildProcess): void {
  if (child.exitCode === null && !child.killed) child.kill();
}
