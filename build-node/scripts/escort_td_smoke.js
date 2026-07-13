"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const projectRoot = path_1.default.resolve(__dirname, '..', '..');
const electronBin = process.platform === 'win32'
    ? path_1.default.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path_1.default.join(projectRoot, 'node_modules', '.bin', 'electron');
const smokePort = process.env.GAME_TERRARIUM_PORT || '3018';
const baseUrl = `http://localhost:${smokePort}`;
async function fetchJson(pathName, init) {
    const response = await fetch(`${baseUrl}${pathName}`, init);
    if (!response.ok)
        throw new Error(`${pathName} failed: ${response.status} ${await response.text()}`);
    return response.json();
}
async function postJson(pathName, body) {
    return fetchJson(pathName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}
async function waitForState(predicate, timeoutMs, label) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
        const state = await fetchJson('/electron/state').catch(() => null);
        if (state && predicate(state))
            return state;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`timeout waiting for ${label}`);
}
async function verifyApiActions() {
    const initial = await fetchJson('/api/escort-td/state');
    if (initial.page !== 'escort_td')
        throw new Error(`unexpected state page: ${initial.page}`);
    if (initial.gold < 40)
        throw new Error(`initial gold cannot fund deploy: ${initial.gold}`);
    const deployed = await postJson('/api/escort-td/action', { action: 'deploy' });
    if (!deployed.ok)
        throw new Error('deploy action was not successful');
    if (deployed.state.units.length !== initial.units.length + 1) {
        throw new Error(`deploy did not add exactly one unit: ${initial.units.length} -> ${deployed.state.units.length}`);
    }
    const pausedBefore = deployed.state.king.paused;
    const toggled = await postJson('/api/escort-td/action', { action: 'toggle_pause' });
    if (!toggled.ok || toggled.state.king.paused === pausedBefore) {
        throw new Error(`toggle_pause did not invert king.paused from ${pausedBefore}`);
    }
    const restored = await postJson('/api/escort-td/action', { action: 'toggle_pause' });
    if (!restored.ok || restored.state.king.paused !== pausedBefore) {
        throw new Error(`toggle_pause did not restore king.paused to ${pausedBefore}`);
    }
}
async function verifyEscortPage() {
    await postJson('/electron/action', { type: 'switch_page', page: 'escort_td' });
    await waitForState((state) => state.currentPage === 'escort_td' && state.lastLoadState?.status === 'loaded', 30000, 'Ctrl+3 / Escort TD load');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const stable = await fetchJson('/electron/state');
    if (stable.currentPage !== 'escort_td') {
        throw new Error(`page changed during stability wait: ${stable.currentPage ?? 'unknown'}`);
    }
    if (stable.lastLoadState?.status !== 'loaded') {
        throw new Error(`Escort TD did not remain loaded: ${stable.lastLoadState?.error || stable.lastLoadState?.status || 'unknown'}`);
    }
}
async function main() {
    let fatalError = null;
    let exited = false;
    const child = (0, child_process_1.spawn)(electronBin, ['.'], {
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
        if (!fatalError && code !== 0)
            fatalError = new Error(`electron exited early: code=${code} signal=${signal ?? 'none'}`);
    });
    const inspectOutput = (chunk) => {
        for (const line of chunk.toString('utf8').split(/\r?\n/)) {
            if (!fatalError && /(did-fail-load|Uncaught (ReferenceError|TypeError)|ENOENT: no such file or directory)/.test(line)) {
                fatalError = new Error(line);
            }
        }
    };
    child.stdout?.on('data', inspectOutput);
    child.stderr?.on('data', inspectOutput);
    try {
        await waitForState((state) => state.currentPage === 'city' && state.lastLoadState?.status === 'loaded', 30000, 'initial city page load');
        if (fatalError)
            throw fatalError;
        await verifyApiActions();
        await verifyEscortPage();
        if (fatalError)
            throw fatalError;
        console.log('Escort TD API and Ctrl+3 startup smoke passed');
    }
    finally {
        if (!exited)
            child.kill();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
