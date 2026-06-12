import path from 'path';
import { app, BrowserWindow, globalShortcut, Menu, type MenuItemConstructorOptions } from 'electron';
import { startServer } from './server';
import { describePage, isPageKey, PAGE_REGISTRY, type PageKey } from './shared/page_registry';

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

const IS_DEBUG_MINIMAL = process.env.ELECTRON_DEBUG_MINIMAL === '1';
const ENABLE_APP_MENU = process.env.ELECTRON_DISABLE_MENU !== '1';
const ENABLE_GLOBAL_SHORTCUTS = process.env.ELECTRON_DISABLE_SHORTCUTS !== '1';
const ENABLE_ALWAYS_ON_TOP = process.env.ELECTRON_DISABLE_ALWAYS_ON_TOP !== '1' && !IS_DEBUG_MINIMAL;
const ENABLE_ALL_WORKSPACES = process.env.ELECTRON_DISABLE_ALL_WORKSPACES !== '1' && !IS_DEBUG_MINIMAL;
const ENABLE_SERVER = process.env.ELECTRON_DISABLE_SERVER !== '1';

let win: BrowserWindow | null = null;
let currentPage: PageKey = 'city';

function loadPage(pageKey: PageKey): void {
  if (!win) return;
  const page = PAGE_REGISTRY.find((entry) => entry.key === pageKey);
  if (!page) return;
  currentPage = pageKey;
  const target = page.loadMode === 'file'
    ? path.join(__dirname, '..', page.target)
    : page.target;
  console.log(`[page] switching -> ${describePage(page)}: ${target}`);
  if (page.loadMode === 'http') {
    void win.loadURL(target);
  } else {
    void win.loadFile(target);
  }
  refreshMenu();
}

function refreshMenu(): void {
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
  win = new BrowserWindow({
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

app.whenReady().then(async () => {
  if (ENABLE_SERVER) {
    try {
      await startServer(
        () => ({ currentPage }),
        (type: string, payload: any) => {
          if (type === 'switch_page') {
            const page = String(payload?.page ?? '');
            if (!isPageKey(page)) return { error: `unknown page: ${page}` };
            loadPage(page);
            return { currentPage };
          }
          return { error: `unknown action: ${type}` };
        }
      );
    } catch (error) {
      console.error('Failed to start server', error);
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (ENABLE_GLOBAL_SHORTCUTS) {
    globalShortcut.unregisterAll();
  }
});
