import { spawn } from 'child_process';
import { createServer } from 'net';
import path from 'path';
import type { EscortTdStateSnapshot } from '../shared/types/escort_td';

type ElectronState = {
  currentPage?: string;
  lastLoadState?: { status?: string; error?: string };
};

type ActionResponse = { ok: boolean; state: EscortTdStateSnapshot };

const projectRoot = path.resolve(__dirname, '..', '..');
const electronBin = process.platform === 'win32'
  ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(projectRoot, 'node_modules', '.bin', 'electron');
let baseUrl = '';

async function getSmokePort(): Promise<string> {
  if (process.env.GAME_TERRARIUM_PORT) return process.env.GAME_TERRARIUM_PORT;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('could not allocate a smoke-test port')));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(String(address.port)));
    });
  });
}

async function fetchJson<T>(pathName: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${pathName}`, init);
  if (!response.ok) throw new Error(`${pathName} failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function postJson<T>(pathName: string, body: unknown): Promise<T> {
  return fetchJson<T>(pathName, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForState(
  predicate: (state: ElectronState) => boolean,
  timeoutMs: number,
  label: string,
  getFailure?: () => Error | null,
): Promise<ElectronState> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const failure = getFailure?.();
    if (failure) throw failure;
    const state = await fetchJson<ElectronState>('/electron/state').catch(() => null);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function verifyApiActions(): Promise<void> {
  const initial = await fetchJson<EscortTdStateSnapshot>('/api/escort-td/state');
  if (initial.page !== 'escort_td') throw new Error(`unexpected state page: ${initial.page}`);
  if (initial.gold < 40) throw new Error(`initial gold cannot fund deploy: ${initial.gold}`);
  if (initial.progressPercent < 0 || initial.progressPercent > 100) {
    throw new Error(`initial progress is outside 0-100: ${initial.progressPercent}`);
  }
  if (initial.king.coveragePercent < 0 || initial.king.coveragePercent > 100) {
    throw new Error(`initial coverage is outside 0-100: ${initial.king.coveragePercent}`);
  }
  if (typeof initial.king.advanceBlocked !== 'boolean') {
    throw new Error('initial king advanceBlocked is not boolean');
  }
  if (typeof initial.king.forcedAdvance !== 'boolean') throw new Error('initial king forcedAdvance is not boolean');
  if (initial.result !== null) throw new Error('new escort run unexpectedly has a result');

  const deployed = await postJson<ActionResponse>('/api/escort-td/action', { action: 'deploy' });
  if (!deployed.ok) throw new Error('deploy action was not successful');
  if (deployed.state.units.length !== initial.units.length + 1) {
    throw new Error(`deploy did not add exactly one unit: ${initial.units.length} -> ${deployed.state.units.length}`);
  }

  const pausedBefore = deployed.state.king.paused;
  const toggled = await postJson<ActionResponse>('/api/escort-td/action', { action: 'toggle_pause' });
  if (!toggled.ok || toggled.state.king.paused === pausedBefore) {
    throw new Error(`toggle_pause did not invert king.paused from ${pausedBefore}`);
  }

  const restored = await postJson<ActionResponse>('/api/escort-td/action', { action: 'toggle_pause' });
  if (!restored.ok || restored.state.king.paused !== pausedBefore) {
    throw new Error(`toggle_pause did not restore king.paused to ${pausedBefore}`);
  }

  const forced = await postJson<ActionResponse>('/api/escort-td/action', { action: 'toggle_force_advance' });
  if (!forced.ok || !forced.state.king.forcedAdvance || forced.state.king.paused) {
    throw new Error('force advance did not enable the manual override');
  }

  const restarted = await postJson<ActionResponse>('/api/escort-td/action', {
    action: 'restart',
    meta: { startGoldLevel: 1, kingHpLevel: 1, unitLimitLevel: 1, autoRestartLevel: 1, speedLevel: 2 },
  });
  if (!restarted.ok || restarted.state.gold !== 130 || restarted.state.king.hpMax !== 500) {
    throw new Error(`restart did not apply meta progress: gold ${restarted.state.gold}, hp ${restarted.state.king.hpMax}`);
  }
  if (restarted.state.meta.unitLimitLevel !== 1) throw new Error('restart did not retain unit-limit meta progress');

  const accelerated = await postJson<ActionResponse>('/api/escort-td/action', { action: 'set_speed', speed: 4 });
  if (!accelerated.ok || accelerated.state.timeScale !== 4) throw new Error('set_speed did not set 4x speed after its unlock');
}

async function verifyEscortPage(getFailure: () => Error | null): Promise<void> {
  await postJson('/electron/action', { type: 'switch_page', page: 'escort_td' });
  await waitForState(
    (state) => state.currentPage === 'escort_td' && state.lastLoadState?.status === 'loaded',
    30000,
    'Ctrl+3 / Escort TD load',
    getFailure,
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const stable = await fetchJson<ElectronState>('/electron/state');
  if (stable.currentPage !== 'escort_td') {
    throw new Error(`page changed during stability wait: ${stable.currentPage ?? 'unknown'}`);
  }
  if (stable.lastLoadState?.status !== 'loaded') {
    throw new Error(`Escort TD did not remain loaded: ${stable.lastLoadState?.error || stable.lastLoadState?.status || 'unknown'}`);
  }
}

async function main(): Promise<void> {
  const smokePort = await getSmokePort();
  baseUrl = `http://127.0.0.1:${smokePort}`;
  let fatalError: Error | null = null;
  let exited = false;
  let stopping = false;
  const child = spawn(electronBin, ['.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GAME_TERRARIUM_PORT: smokePort,
      ELECTRON_DEBUG_MINIMAL: '1',
      ELECTRON_DISABLE_MENU: '1',
      ELECTRON_DISABLE_SHORTCUTS: '1',
      ELECTRON_DISABLE_SERVER: '0',
      ELECTRON_ENABLE_ALWAYS_ON_TOP: '0',
      ELECTRON_ENABLE_ALL_WORKSPACES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (error) => { fatalError = fatalError ?? error; });
  child.on('exit', (code, signal) => {
    exited = true;
    if (!stopping && !fatalError) fatalError = new Error(`electron exited early: code=${code ?? 'none'} signal=${signal ?? 'none'}`);
  });

  const inspectOutput = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!fatalError && /(did-fail-load|Uncaught (ReferenceError|TypeError)|ENOENT: no such file or directory)/.test(line)) {
        fatalError = new Error(line);
      }
    }
  };
  child.stdout?.on('data', inspectOutput);
  child.stderr?.on('data', inspectOutput);

  try {
    await waitForState(
      (state) => state.currentPage === 'city' && state.lastLoadState?.status === 'loaded',
      30000,
      'initial city page load',
      () => fatalError,
    );
    if (fatalError) throw fatalError;
    await verifyApiActions();
    await verifyEscortPage(() => fatalError);
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (fatalError) throw fatalError;
    console.log('Escort TD API and Ctrl+3 startup smoke passed');
  } finally {
    stopping = true;
    if (!exited) child.kill();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
