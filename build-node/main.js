"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const server_1 = require("./server");
electron_1.app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
const IS_DEBUG_MINIMAL = process.env.ELECTRON_DEBUG_MINIMAL === '1';
const ENABLE_APP_MENU = process.env.ELECTRON_DISABLE_MENU !== '1';
const ENABLE_GLOBAL_SHORTCUTS = process.env.ELECTRON_DISABLE_SHORTCUTS !== '1';
const ENABLE_ALWAYS_ON_TOP = process.env.ELECTRON_DISABLE_ALWAYS_ON_TOP !== '1' && !IS_DEBUG_MINIMAL;
const ENABLE_ALL_WORKSPACES = process.env.ELECTRON_DISABLE_ALL_WORKSPACES !== '1' && !IS_DEBUG_MINIMAL;
const ENABLE_SERVER = process.env.ELECTRON_DISABLE_SERVER !== '1';
const PAGES = {
    city: path_1.default.join(__dirname, '..', 'pages', 'city_traffic_tiltshift_alpha.html'),
    moss: path_1.default.join(__dirname, '..', 'pages', 'moss_alpha.html'),
    escort_td: 'http://localhost:3000/escort_td.html',
    net_sw: path_1.default.join(__dirname, '..', 'pages', 'network_sw.html'),
    net_defense: 'http://localhost:3000/network_defense.html',
    planet_strategy: 'http://localhost:3000/planet_strategy.html',
    net_ecosystem: 'http://localhost:3000/network_ecosystem.html',
    colony: 'http://localhost:3000/colony.html',
    submarine: path_1.default.join(__dirname, '..', 'pages', 'submarine_cables.html'),
    submarine_3d: path_1.default.join(__dirname, '..', 'pages', 'submarine_network_3d.html'),
};
let win = null;
let currentPage = 'city';
function isPageKey(value) {
    return value in PAGES;
}
function loadPage(pageKey) {
    if (!win)
        return;
    currentPage = pageKey;
    const target = PAGES[pageKey];
    console.log(`[page] switching -> ${pageKey}: ${target}`);
    if (target.startsWith('http')) {
        void win.loadURL(target);
    }
    else {
        void win.loadFile(target);
    }
    refreshMenu();
}
function refreshMenu() {
    if (!ENABLE_APP_MENU) {
        electron_1.Menu.setApplicationMenu(null);
        return;
    }
    const radio = (label, pageKey, accelerator) => ({
        label,
        type: 'radio',
        checked: currentPage === pageKey,
        accelerator,
        click: () => loadPage(pageKey),
    });
    const template = [
        {
            label: 'View',
            submenu: [
                radio('City Traffic (1)', 'city', 'CmdOrCtrl+1'),
                radio('MOSS (2)', 'moss', 'CmdOrCtrl+2'),
                radio('Escort TD (3)', 'escort_td', 'CmdOrCtrl+3'),
                radio('Network Small World (4)', 'net_sw', 'CmdOrCtrl+4'),
                radio('AI Planet Strategy (0)', 'planet_strategy', 'CmdOrCtrl+0'),
                radio('Network Tower Defense (7)', 'net_defense', 'CmdOrCtrl+7'),
                radio('Network Ecosystem (8)', 'net_ecosystem', 'CmdOrCtrl+8'),
                radio('Submarine Cables (5)', 'submarine', 'CmdOrCtrl+5'),
                radio('Submarine Network 3D (6)', 'submarine_3d', 'CmdOrCtrl+6'),
                radio('AI Colony Sandbox (9)', 'colony', 'CmdOrCtrl+9'),
                { type: 'separator' },
                {
                    label: 'Toggle Always On Top',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => {
                        if (!win)
                            return;
                        const next = !win.isAlwaysOnTop();
                        win.setAlwaysOnTop(next, 'screen-saver');
                    },
                },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => win?.reload(),
                },
            ],
        },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
function createMainWindow() {
    win = new electron_1.BrowserWindow({
        width: 1440,
        height: 900,
        autoHideMenuBar: false,
        backgroundColor: '#000000',
        alwaysOnTop: ENABLE_ALWAYS_ON_TOP,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (ENABLE_ALWAYS_ON_TOP) {
        win.setAlwaysOnTop(true, 'screen-saver');
    }
    if (ENABLE_ALL_WORKSPACES) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.webContents.on('did-finish-load', () => {
        console.log(`[page] loaded -> ${currentPage}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
        console.error(`[page] failed -> ${validatedURL} (${code}) ${description}`);
    });
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
    });
    loadPage(currentPage);
    win.on('closed', () => {
        win = null;
    });
    refreshMenu();
}
electron_1.app.whenReady().then(async () => {
    if (ENABLE_SERVER) {
        try {
            await (0, server_1.startServer)(() => ({ currentPage }), (type, payload) => {
                if (type === 'switch_page') {
                    const page = String(payload?.page ?? '');
                    if (!isPageKey(page))
                        return { error: `unknown page: ${page}` };
                    loadPage(page);
                    return { currentPage };
                }
                return { error: `unknown action: ${type}` };
            });
        }
        catch (error) {
            console.error('Failed to start server', error);
        }
    }
    createMainWindow();
    if (ENABLE_GLOBAL_SHORTCUTS) {
        electron_1.globalShortcut.register('CmdOrCtrl+1', () => loadPage('city'));
        electron_1.globalShortcut.register('CmdOrCtrl+2', () => loadPage('moss'));
        electron_1.globalShortcut.register('CmdOrCtrl+3', () => loadPage('escort_td'));
        electron_1.globalShortcut.register('CmdOrCtrl+4', () => loadPage('net_sw'));
        electron_1.globalShortcut.register('CmdOrCtrl+5', () => loadPage('submarine'));
        electron_1.globalShortcut.register('CmdOrCtrl+6', () => loadPage('submarine_3d'));
        electron_1.globalShortcut.register('CmdOrCtrl+7', () => loadPage('net_defense'));
        electron_1.globalShortcut.register('CmdOrCtrl+8', () => loadPage('net_ecosystem'));
        electron_1.globalShortcut.register('CmdOrCtrl+9', () => loadPage('colony'));
        electron_1.globalShortcut.register('CmdOrCtrl+0', () => loadPage('planet_strategy'));
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createMainWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('will-quit', () => {
    if (ENABLE_GLOBAL_SHORTCUTS) {
        electron_1.globalShortcut.unregisterAll();
    }
});
