import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export type TrainingSessionConfig = {
  gameId: string;
  page: string;
  trainerModule: string;
  trainerArguments?: readonly string[];
  root?: string;
};

export function startTrainingSession(config: TrainingSessionConfig): void {
  const root = config.root ?? process.cwd();
  const trainer = spawn(process.execPath, [
    join(__dirname, '..', config.trainerModule),
    ...(config.trainerArguments ?? []),
  ], { cwd: root, stdio: 'inherit' });
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
