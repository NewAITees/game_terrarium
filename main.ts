import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './server';
import { describePage, isPageKey, PAGE_BY_NUMBER, PAGE_REGISTRY, type PageKey } from './shared/page_registry';

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

const IS_DEBUG_MINIMAL = process.env.ELECTRON_DEBUG_MINIMAL === '1';
const ENABLE_APP_MENU = process.env.ELECTRON_DISABLE_MENU !== '1';
const ENABLE_GLOBAL_SHORTCUTS = process.env.ELECTRON_DISABLE_SHORTCUTS !== '1';
const ENABLE_ALWAYS_ON_TOP = process.env.ELECTRON_ENABLE_ALWAYS_ON_TOP === '1' && !IS_DEBUG_MINIMAL;
const ENABLE_ALL_WORKSPACES = process.env.ELECTRON_ENABLE_ALL_WORKSPACES === '1' && !IS_DEBUG_MINIMAL;
const ENABLE_SERVER = process.env.ELECTRON_DISABLE_SERVER !== '1';
const ENABLE_TRAY = process.env.ELECTRON_DISABLE_TRAY !== '1' && !IS_DEBUG_MINIMAL;
const REQUESTED_SERVER_PORT = Number.parseInt(
  process.env.GAME_TERRARIUM_PORT || process.env.PORT || '3000',
  10,
) || 3000;
let activeServerPort = REQUESTED_SERVER_PORT;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
const requestedPage = process.argv
  .find((argument) => argument.startsWith('--page='))
  ?.slice('--page='.length)
  ?? process.env.GAME_TERRARIUM_PAGE
  ?? '';
const initialPage: PageKey = isPageKey(requestedPage) ? requestedPage : 'city';
if (requestedPage && !isPageKey(requestedPage)) {
  console.warn(`[page] unknown startup page "${requestedPage}", falling back to city`);
}
let currentPage: PageKey = initialPage;
let lastLoadState: { page: PageKey; status: 'idle' | 'loading' | 'loaded' | 'failed'; error?: string } = {
  page: initialPage,
  status: 'idle',
};
let rendererErrors: Array<{ message: string; source: string; line: number }> = [];

type WindowState = { x?: number; y?: number; width: number; height: number };
function windowStatePath(): string { return join(app.getPath('userData'), 'window-state.json'); }
function loadWindowState(): WindowState {
  try { return JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowState; }
  catch { return { width: 1440, height: 900 }; }
}
function saveWindowState(): void {
  if (!win) return;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(windowStatePath(), JSON.stringify(win.getBounds()), 'utf8');
  } catch { /* Window placement is a convenience, never a startup blocker. */ }
}

function loadPage(pageKey: PageKey): void {
  if (!win) return;
  const page = PAGE_REGISTRY.find((entry) => entry.key === pageKey);
  if (!page) return;
  currentPage = pageKey;
  rendererErrors = [];
  lastLoadState = { page: pageKey, status: 'loading' };
  const targetUrl = new URL(page.target);
  targetUrl.port = String(activeServerPort);
  const target = targetUrl.toString();
  console.log(`[page] switching -> ${describePage(page)}: ${target}`);
  void win.loadURL(target);
  refreshMenu();
}

async function canReuseGameServer(port: number): Promise<boolean> {
  const hosts = ['127.0.0.1', 'localhost', '[::1]'];
  let foundGameServer = false;
  for (const host of hosts) {
    try {
      const response = await fetch(`http://${host}:${port}/api/game-terrarium/health`, {
        signal: AbortSignal.timeout(600),
      });
      if (response.ok) {
        const body = await response.json() as {
          service?: string;
          arenaSaveSchema?: number;
          browserAssetsVersion?: number;
        };
        if (body.service === 'game-terrarium') {
          foundGameServer = true;
          if (body.arenaSaveSchema === 2 && body.browserAssetsVersion === 2) return true;
        }
      }
    } catch {
      // Try the next loopback address.
    }
  }
  // A server from an older build must not serve a newer renderer/save schema.
  if (foundGameServer) return false;
  for (const host of hosts) {
    try {
      const response = await fetch(`http://${host}:${port}/electron/state`, {
        signal: AbortSignal.timeout(600),
      });
      if (!response.ok) continue;
      const body = await response.json() as { currentPage?: unknown };
      if (typeof body.currentPage === 'string') return true;
    } catch {
      // Try the next loopback address.
    }
  }
  return false;
}

function pageShortcutLabel(page: { number: number }): string {
  return page.number >= 10 ? `Ctrl+Shift+${page.number - 10}` : `Ctrl+${page.number}`;
}

function registerSwitchHandlers(): void {
  ipcMain.handle('terrarium:pages', () => ({
    currentPage,
    pages: PAGE_REGISTRY.map((page) => ({
      key: page.key,
      label: page.label,
      shortcut: pageShortcutLabel(page),
    })),
  }));
  ipcMain.on('terrarium:switch-page', (_event, pageKey: unknown) => {
    const key = String(pageKey ?? '');
    if (isPageKey(key)) loadPage(key);
  });
}

/**
 * Menu-bar entry point. The window is always-on-top and often not focused, so a
 * tray menu is the switching route that needs neither focus nor a shortcut.
 */
function refreshTray(): void {
  if (!ENABLE_TRAY) return;
  if (!tray) {
    const iconPath = join(__dirname, '..', 'assets', 'tray', 'trayTemplate.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.warn(`[tray] icon missing at ${iconPath}; skipping tray`);
      return;
    }
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Game Terrarium');
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    ...PAGE_REGISTRY.map((page): MenuItemConstructorOptions => ({
      label: page.label,
      type: 'radio',
      checked: currentPage === page.key,
      click: () => {
        loadPage(page.key);
        win?.show();
      },
    })),
    { type: 'separator' },
    { label: 'Show Window', click: () => win?.show() },
    { label: 'Quit', role: 'quit' },
  ]));
}

function refreshMenu(): void {
  refreshTray();
  if (!ENABLE_APP_MENU) {
    Menu.setApplicationMenu(null);
    return;
  }

  const radio = (label: string, pageKey: PageKey, accelerator: string): MenuItemConstructorOptions => ({
    label,
    type: 'radio',
    checked: currentPage === pageKey,
    accelerator,
    click: () => loadPage(pageKey),
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'View',
      submenu: [
        ...PAGE_REGISTRY.map((page) => radio(`${page.label} (${page.number})`, page.key, page.accelerator)),
        { type: 'separator' },
        {
          label: 'Toggle Always On Top',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
            if (!win) return;
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

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow(): void {
  const savedState = loadWindowState();
  win = new BrowserWindow({
    ...savedState,
    autoHideMenuBar: false,
    backgroundColor: '#000000',
    alwaysOnTop: ENABLE_ALWAYS_ON_TOP,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Injects the Ctrl+K page palette into every page so switching does not
      // depend on each experience shipping its own navigation.
      preload: join(__dirname, 'preload.js'),
    },
  });

  // Global shortcuts can be claimed by the OS; keep focused-window page switching reliable.
  win.webContents.on('before-input-event', (event, input) => {
    const modifierPressed = process.platform === 'darwin' ? input.meta : input.control;
    if (!modifierPressed || input.alt || !/^[0-9]$/.test(input.key)) return;
    // Shift+digit reaches the pages past the ten the plain digits can address.
    const page = PAGE_BY_NUMBER.get(input.shift ? Number(input.key) + 10 : Number(input.key));
    if (!page) return;
    event.preventDefault();
    loadPage(page.key);
  });
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    rendererErrors.push({ message, source: sourceId, line });
    rendererErrors = rendererErrors.slice(-12);
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
    saveWindowState();
    win = null;
  });
  win.on('close', saveWindowState);
  refreshMenu();
}

app.whenReady().then(async () => {
  registerSwitchHandlers();
  if (ENABLE_SERVER) {
    if (await canReuseGameServer(activeServerPort)) {
      console.log(`[server] reusing game server on port ${activeServerPort}`);
    } else {
      const dispatch = async (type: string, payload: any) => {
        if (type === 'switch_page') {
          const page = String(payload?.page ?? '');
          if (!isPageKey(page)) return { error: `unknown page: ${page}` };
          loadPage(page);
          return { currentPage };
        }
        if (type === 'rl_model_status') {
          if (!win) return { error: 'window unavailable' };
          const status = await win.webContents.executeJavaScript('document.documentElement.dataset.rlModelStatus || "unknown"', true);
          return { status };
        }
        return { error: `unknown action: ${type}` };
      };
      for (let offset = 0; offset < 20; offset += 1) {
        activeServerPort = REQUESTED_SERVER_PORT + offset;
        try {
          await startServer(
            () => ({ currentPage, lastLoadState, rendererErrors }),
            dispatch,
            app.getPath('userData'),
            activeServerPort,
          );
          break;
        } catch (error) {
          if (!isAddressInUse(error)) {
            console.error('Failed to start server', error);
            break;
          }
          if (await canReuseGameServer(activeServerPort)) {
            console.log(`[server] another window claimed port ${activeServerPort}; reusing it`);
            break;
          }
          console.warn(`[server] port ${activeServerPort} is occupied; trying the next port`);
        }
      }
    }
  }

  createMainWindow();

  if (ENABLE_GLOBAL_SHORTCUTS) {
    for (const page of PAGE_REGISTRY) {
      globalShortcut.register(page.accelerator, () => loadPage(page.key));
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

function isAddressInUse(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (ENABLE_GLOBAL_SHORTCUTS) {
    globalShortcut.unregisterAll();
  }
});
