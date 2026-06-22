"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const server_1 = require("./server");
const page_registry_1 = require("./shared/page_registry");
electron_1.app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
const IS_DEBUG_MINIMAL = process.env.ELECTRON_DEBUG_MINIMAL === '1';
const ENABLE_APP_MENU = process.env.ELECTRON_DISABLE_MENU !== '1';
const ENABLE_GLOBAL_SHORTCUTS = process.env.ELECTRON_DISABLE_SHORTCUTS !== '1';
const ENABLE_ALWAYS_ON_TOP = process.env.ELECTRON_ENABLE_ALWAYS_ON_TOP === '1' && !IS_DEBUG_MINIMAL;
const ENABLE_ALL_WORKSPACES = process.env.ELECTRON_ENABLE_ALL_WORKSPACES === '1' && !IS_DEBUG_MINIMAL;
const ENABLE_SERVER = process.env.ELECTRON_DISABLE_SERVER !== '1';
let win = null;
let currentPage = 'city';
let lastLoadState = {
    page: 'city',
    status: 'idle',
};
function loadPage(pageKey) {
    if (!win)
        return;
    const page = page_registry_1.PAGE_REGISTRY.find((entry) => entry.key === pageKey);
    if (!page)
        return;
    currentPage = pageKey;
    lastLoadState = { page: pageKey, status: 'loading' };
    const target = page.loadMode === 'file'
        ? path_1.default.join(__dirname, '..', page.target)
        : page.target;
    console.log(`[page] switching -> ${(0, page_registry_1.describePage)(page)}: ${target}`);
    if (page.loadMode === 'http') {
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
                ...page_registry_1.PAGE_REGISTRY.map((page) => radio(`${page.label} (${page.number})`, page.key, page.accelerator)),
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
        lastLoadState = { page: currentPage, status: 'loaded' };
        console.log(`[page] loaded -> ${currentPage}`);
    });
    win.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
        lastLoadState = {
            page: currentPage,
            status: 'failed',
            error: `${validatedURL} (${code}) ${description}`,
        };
        console.error(`[page] failed -> ${validatedURL} (${code}) ${description}`);
    });
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (level >= 3 && /(?:Uncaught|ReferenceError|TypeError|ENOENT|Cannot access )/.test(message)) {
            lastLoadState = {
                page: currentPage,
                status: 'failed',
                error: `${sourceId}:${line} ${message}`,
            };
        }
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
            await (0, server_1.startServer)(() => ({ currentPage, lastLoadState }), (type, payload) => {
                if (type === 'switch_page') {
                    const page = String(payload?.page ?? '');
                    if (!(0, page_registry_1.isPageKey)(page))
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
        for (const page of page_registry_1.PAGE_REGISTRY) {
            electron_1.globalShortcut.register(page.accelerator, () => loadPage(page.key));
        }
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
