import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..', '..');
const electronBin = process.platform === 'win32'
  ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(projectRoot, 'node_modules', '.bin', 'electron');
const smokePort = process.env.GAME_TERRARIUM_PORT || '3017';
const baseUrl = `http://localhost:${smokePort}`;

function waitForLine(
  lines: string[],
  matcher: RegExp,
  timeoutMs: number,
  label: string,
  hasFatalError: () => Error | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      const fatalError = hasFatalError();
      if (fatalError) {
        reject(fatalError);
        return;
      }
      const matched = lines.find((line) => matcher.test(line));
      if (matched) {
        resolve(matched);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timeout waiting for ${label}`));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function fetchJson(pathName: string): Promise<any> {
  const response = await fetch(`${baseUrl}${pathName}`);
  if (!response.ok) {
    throw new Error(`${pathName} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function postElectronAction(type: string, payload: Record<string, unknown> = {}): Promise<void> {
  const response = await fetch(`${baseUrl}/electron/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...payload }),
  });
  if (!response.ok) {
    throw new Error(`electron/action failed for ${type}: ${response.status} ${await response.text()}`);
  }
}

async function waitForState(
  predicate: (state: any) => boolean,
  timeoutMs: number,
  label: string,
): Promise<any> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const state = await fetchJson('/electron/state').catch(() => null);
    if (state && predicate(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function assertStableLoad(page: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const state = await fetchJson('/electron/state');
  if (state?.currentPage === page && state?.lastLoadState?.status === 'failed') {
    throw new Error(`page failed after load: ${state.lastLoadState.error || page}`);
  }
}

async function assertAssetLoad(pathName: string): Promise<void> {
  const response = await fetch(`${baseUrl}${pathName}`, { method: 'HEAD' });
  if (!response.ok) throw new Error(`asset failed: ${pathName} (${response.status})`);
}

async function assertPlanetStrategyAssets(): Promise<void> {
  await assertAssetLoad('/assets/ships/transport.glb');
  await assertAssetLoad('/assets/structures/factory.glb');
  const assetFiles = await readdir(path.join(projectRoot, 'build', 'assets'));
  const wasmFile = assetFiles.find((file) => /^network_core_wasm_bg-.*\.wasm$/.test(file));
  if (!wasmFile) throw new Error('generated network core WASM asset is missing');
  await assertAssetLoad(`/assets/${wasmFile}`);
}

async function main(): Promise<void> {
  const lines: string[] = [];
  let fatalError: Error | null = null;
  let exited = false;
  let exitCode: number | null = null;
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
  child.on('error', (error) => {
    fatalError = fatalError ?? error;
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitCode = code ?? (signal ? 1 : 0);
    if (!fatalError && code !== 0) {
      fatalError = new Error(`electron exited early: code=${code} signal=${signal ?? 'none'}`);
    }
  });

  const append = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines.push(line);
      if (!fatalError && /(did-fail-load|Uncaught ReferenceError|ENOENT: no such file or directory)/.test(line)) {
        fatalError = new Error(line);
      }
    }
  };

  child.stdout?.on('data', append);
  child.stderr?.on('data', append);

  try {
    await waitForState((state) => state.currentPage === 'city' && state.lastLoadState?.status === 'loaded', 30000, 'city page load');
    if (fatalError) throw fatalError;
    await assertStableLoad('city');

    await postElectronAction('switch_page', { page: 'net_defense' });
    if (fatalError) throw fatalError;
    await waitForState((state) => state.currentPage === 'net_defense' && state.lastLoadState?.status === 'loaded', 30000, 'network defense load');
    if (fatalError) throw fatalError;
    await assertStableLoad('net_defense');

    await postElectronAction('switch_page', { page: 'net_ecosystem' });
    if (fatalError) throw fatalError;
    await waitForState((state) => state.currentPage === 'net_ecosystem' && state.lastLoadState?.status === 'loaded', 30000, 'network ecosystem load');
    if (fatalError) throw fatalError;
    await assertStableLoad('net_ecosystem');

    await postElectronAction('switch_page', { page: 'colony' });
    if (fatalError) throw fatalError;
    await waitForState((state) => state.currentPage === 'colony' && state.lastLoadState?.status === 'loaded', 30000, 'colony load');
    if (fatalError) throw fatalError;
    await assertStableLoad('colony');

    await postElectronAction('switch_page', { page: 'planet_strategy' });
    if (fatalError) throw fatalError;
    await waitForState((state) => state.currentPage === 'planet_strategy' && state.lastLoadState?.status === 'loaded', 30000, 'planet strategy load');
    if (fatalError) throw fatalError;
    await assertStableLoad('planet_strategy');
    await assertPlanetStrategyAssets();

    console.log('electron startup smoke passed');
  } finally {
    if (!exited) {
      child.kill();
    }
    if (fatalError) {
      throw fatalError;
    }
    if (exitCode !== null && exitCode !== 0) {
      throw new Error(`electron smoke exited with code ${exitCode}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
