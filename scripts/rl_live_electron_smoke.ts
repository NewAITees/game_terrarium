import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

type LiveTarget = { gameId: string; page: string; launcher: string; trainer: string; trainerArguments: string[]; fileStem: string };

const projectRoot = path.resolve(__dirname, '..', '..');
const targets: readonly LiveTarget[] = [
  { gameId: 'gunship', page: 'gunship', launcher: 'gunship_live_launcher.js', trainer: 'gunship_live_trainer.js', trainerArguments: ['--batch=1', '--cap=1', '--density=1', '--batches=1'], fileStem: 'gunship-live-models' },
  { gameId: 'drone-bastion', page: 'drone_bastion', launcher: 'drone_bastion_live_launcher.js', trainer: 'drone_bastion_live_trainer.js', trainerArguments: ['--episodes=1', '--cap=1', '--batches=1'], fileStem: 'drone-bastion-live-model' },
  { gameId: 'arena-shooter', page: 'arena_shooter', launcher: 'arena_shooter_live_launcher.js', trainer: 'arena_shooter_live_trainer.js', trainerArguments: ['--episodes=1', '--cap=1', '--batches=1'], fileStem: 'arena-shooter-live-model' },
  { gameId: 'network-defense', page: 'net_defense', launcher: 'network_defense_live_launcher.js', trainer: 'network_defense_live_trainer.js', trainerArguments: ['--episodes=1', '--cap=1', '--batches=1'], fileStem: 'network-defense-live-model' },
];

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read().catch(() => null);
    if (value !== null) return value;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function runTrainerOnce(target: LiveTarget, modelRoot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const trainer = spawn(process.execPath, [
      path.join(projectRoot, 'build-node', 'scripts', target.trainer),
      ...target.trainerArguments,
    ], {
      cwd: projectRoot,
      env: { ...process.env, RL_MODEL_ROOT: modelRoot },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    trainer.stdout?.on('data', chunk => { output += chunk.toString('utf8'); });
    trainer.stderr?.on('data', chunk => { output += chunk.toString('utf8'); });
    trainer.once('error', reject);
    trainer.once('exit', code => code === 0 ? resolve() : reject(new Error(`${target.gameId} reset trainer exited ${code}\n${output}`)));
  });
}

async function smokeTarget(target: LiveTarget, index: number): Promise<void> {
  const modelRoot = await mkdtemp(path.join(tmpdir(), `terrarium-${target.gameId}-`));
  const port = 3130 + index;
  const baseUrl = `http://127.0.0.1:${port}`;
  const lines: string[] = [];
  const child = spawn(process.execPath, [path.join(projectRoot, 'build-node', 'scripts', target.launcher)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RL_LIVE_SMOKE: '1',
      RL_MODEL_ROOT: modelRoot,
      GAME_TERRARIUM_PORT: String(port),
      ELECTRON_DEBUG_MINIMAL: '1',
      ELECTRON_DISABLE_MENU: '1',
      ELECTRON_DISABLE_SHORTCUTS: '1',
      ELECTRON_DISABLE_TRAY: '1',
      ELECTRON_ENABLE_ALWAYS_ON_TOP: '0',
      ELECTRON_ENABLE_ALL_WORKSPACES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const append = (chunk: Buffer): void => {
    lines.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  try {
    await waitFor(async () => {
      const state = await fetchJson(`${baseUrl}/electron/state`);
      return state.currentPage === target.page && state.lastLoadState?.status === 'loaded' ? state : null;
    }, 30000, `${target.gameId} Electron page`);

    const model = await waitFor(async () => {
      const bundle = await fetchJson(`${baseUrl}/api/rl/models/${target.gameId}`);
      return Number(bundle.revision) >= 1 && bundle.manifest ? bundle : null;
    }, 30000, `${target.gameId} published model`);

    await new Promise(resolve => setTimeout(resolve, 900));
    const stateAfterTrainer = await fetchJson(`${baseUrl}/electron/state`);
    if (stateAfterTrainer.currentPage !== target.page || stateAfterTrainer.lastLoadState?.status !== 'loaded') {
      throw new Error(`${target.gameId} Player did not survive trainer completion`);
    }
    const fatalRendererErrors = (stateAfterTrainer.rendererErrors ?? []).filter((entry: { message?: string }) => /(?:Uncaught|ReferenceError|TypeError|Cannot access)/.test(entry.message ?? ''));
    if (fatalRendererErrors.length) throw new Error(`${target.gameId} renderer error: ${fatalRendererErrors.at(-1).message}`);

    const resetResponse = await fetch(`${baseUrl}/api/rl/models/${target.gameId}/reset`, { method: 'POST' });
    if (!resetResponse.ok) throw new Error(`${target.gameId} reset returned ${resetResponse.status}`);
    const resetBundle = await fetchJson(`${baseUrl}/api/rl/models/${target.gameId}`);
    if (Number(resetBundle.revision) !== 0) throw new Error(`${target.gameId} reset did not remove published revision`);
    await runTrainerOnce(target, modelRoot);
    const republished = await waitFor(async () => {
      const bundle = await fetchJson(`${baseUrl}/api/rl/models/${target.gameId}`);
      return Number(bundle.revision) >= 1 && bundle.manifest ? bundle : null;
    }, 30000, `${target.gameId} model after reset`);
    const finalPlayerState = await fetchJson(`${baseUrl}/electron/state`);
    if (finalPlayerState.currentPage !== target.page || finalPlayerState.lastLoadState?.status !== 'loaded') {
      throw new Error(`${target.gameId} Player stopped during reset and republish`);
    }

    const modelPath = path.join(modelRoot, 'logs', `${target.fileStem}.json`);
    const incompatibleBundle = JSON.parse(await readFile(modelPath, 'utf8'));
    incompatibleBundle.manifest.observationSchemaVersion += 100;
    incompatibleBundle.revision += 1;
    incompatibleBundle.manifest.revision = incompatibleBundle.revision;
    await writeFile(modelPath, JSON.stringify(incompatibleBundle), 'utf8');
    await fetch(`${baseUrl}/electron/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'switch_page', page: target.page }),
    });
    await waitFor(async () => {
      const state = await fetchJson(`${baseUrl}/electron/state`);
      return state.currentPage === target.page && state.lastLoadState?.status === 'loaded' ? state : null;
    }, 30000, `${target.gameId} reload with incompatible manifest`);
    const modelStatus = await waitFor(async () => {
      const response = await fetch(`${baseUrl}/electron/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'rl_model_status' }),
      });
      const body = await response.json();
      return body.status === 'incompatible' ? body.status : null;
    }, 10000, `${target.gameId} incompatible manifest fallback`);
    if (modelStatus !== 'incompatible') throw new Error(`${target.gameId} did not reject incompatible manifest`);
    console.log(`${target.gameId}: load, trainer exit, reset, republish, and incompatible fallback passed`);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${lines.slice(-30).join('\n')}`);
  } finally {
    await stopChild(child);
    await rm(modelRoot, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const selected = process.env.RL_LIVE_SMOKE_TARGET
    ? targets.filter(target => target.gameId === process.env.RL_LIVE_SMOKE_TARGET)
    : targets;
  if (!selected.length) throw new Error(`unknown RL_LIVE_SMOKE_TARGET: ${process.env.RL_LIVE_SMOKE_TARGET}`);
  for (const target of selected) await smokeTarget(target, targets.indexOf(target));
  console.log(`RL live Electron smoke passed for ${selected.length} game(s)`);
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
