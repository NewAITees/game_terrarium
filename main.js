const path = require('path');
const { app, BrowserWindow, Menu, globalShortcut } = require('electron');
const { startServer } = require('./server');

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

const IS_DEBUG_MINIMAL = process.env.ELECTRON_DEBUG_MINIMAL === '1';
const ENABLE_APP_MENU = process.env.ELECTRON_DISABLE_MENU !== '1';
const ENABLE_GLOBAL_SHORTCUTS = process.env.ELECTRON_DISABLE_SHORTCUTS !== '1';
const ENABLE_ALWAYS_ON_TOP = process.env.ELECTRON_DISABLE_ALWAYS_ON_TOP !== '1' && !IS_DEBUG_MINIMAL;
const ENABLE_ALL_WORKSPACES = process.env.ELECTRON_DISABLE_ALL_WORKSPACES !== '1' && !IS_DEBUG_MINIMAL;
const ENABLE_SERVER = process.env.ELECTRON_DISABLE_SERVER !== '1';

const PAGES = {
  city:          path.join(__dirname, 'pages', 'city_traffic_tiltshift_alpha.html'),
  moss:          path.join(__dirname, 'pages', 'moss_alpha.html'),
  net_tree:      path.join(__dirname, 'pages', 'network_tree.html'),
  net_sw:        path.join(__dirname, 'pages', 'network_sw.html'),
  net_defense:   'http://localhost:3000/network_defense.html',
  planet_strategy: 'http://localhost:3000/planet_strategy.html',
  net_ecosystem: 'http://localhost:3000/network_ecosystem.html',
  colony:        'http://localhost:3000/colony.html',
  submarine:     path.join(__dirname, 'pages', 'submarine_cables.html'),
  submarine_3d:  path.join(__dirname, 'pages', 'submarine_network_3d.html'),
};

let win = null;
let currentPage = 'city';

function loadPage(pageKey) {
  if (!win) return;
  if (!PAGES[pageKey]) return;
  currentPage = pageKey;
  const target = PAGES[pageKey];
  if (target.startsWith('http')) {
    win.loadURL(target);
  } else {
    win.loadFile(target);
  }
  refreshMenu();
}

function refreshMenu() {
  if (!ENABLE_APP_MENU) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: 'View',
      submenu: [
        {
          label: 'City Traffic (1)',
          type: 'radio',
          checked: currentPage === 'city',
          accelerator: 'CmdOrCtrl+1',
          click: () => loadPage('city'),
        },
        {
          label: 'MOSS (2)',
          type: 'radio',
          checked: currentPage === 'moss',
          accelerator: 'CmdOrCtrl+2',
          click: () => loadPage('moss'),
        },
        {
          label: 'Network Tree (3)',
          type: 'radio',
          checked: currentPage === 'net_tree',
          accelerator: 'CmdOrCtrl+3',
          click: () => loadPage('net_tree'),
        },
        {
          label: 'Network Small World (4)',
          type: 'radio',
          checked: currentPage === 'net_sw',
          accelerator: 'CmdOrCtrl+4',
          click: () => loadPage('net_sw'),
        },
        {
          label: 'AI Planet Strategy (0)',
          type: 'radio',
          checked: currentPage === 'planet_strategy',
          accelerator: 'CmdOrCtrl+0',
          click: () => loadPage('planet_strategy'),
        },
        {
          label: 'Network Tower Defense (7)',
          type: 'radio',
          checked: currentPage === 'net_defense',
          accelerator: 'CmdOrCtrl+7',
          click: () => loadPage('net_defense'),
        },
        {
          label: 'Network Ecosystem (8)',
          type: 'radio',
          checked: currentPage === 'net_ecosystem',
          accelerator: 'CmdOrCtrl+8',
          click: () => loadPage('net_ecosystem'),
        },
        {
          label: 'Submarine Cables (5)',
          type: 'radio',
          checked: currentPage === 'submarine',
          accelerator: 'CmdOrCtrl+5',
          click: () => loadPage('submarine'),
        },
        {
          label: 'Submarine Network 3D (6)',
          type: 'radio',
          checked: currentPage === 'submarine_3d',
          accelerator: 'CmdOrCtrl+6',
          click: () => loadPage('submarine_3d'),
        },
        {
          label: 'AI Colony Sandbox (9)',
          type: 'radio',
          checked: currentPage === 'colony',
          accelerator: 'CmdOrCtrl+9',
          click: () => loadPage('colony'),
        },
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
          click: () => win && win.reload(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow() {
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

  loadPage(currentPage);

  win.on('closed', () => {
    win = null;
  });

  refreshMenu();
}

app.whenReady().then(() => {
  createMainWindow();

  if (ENABLE_SERVER) {
    startServer(
      () => ({ currentPage }),
      (type, payload) => {
        if (type === 'switch_page') {
          const { page } = payload;
          if (!PAGES[page]) return { error: `unknown page: ${page}` };
          loadPage(page);
          return { currentPage };
        }
        return { error: `unknown action: ${type}` };
      }
    );
  }

  if (ENABLE_GLOBAL_SHORTCUTS) {
    globalShortcut.register('CmdOrCtrl+1', () => loadPage('city'));
    globalShortcut.register('CmdOrCtrl+2', () => loadPage('moss'));
    globalShortcut.register('CmdOrCtrl+3', () => loadPage('net_tree'));
    globalShortcut.register('CmdOrCtrl+4', () => loadPage('net_sw'));
    globalShortcut.register('CmdOrCtrl+5', () => loadPage('submarine'));
    globalShortcut.register('CmdOrCtrl+6', () => loadPage('submarine_3d'));
    globalShortcut.register('CmdOrCtrl+7', () => loadPage('net_defense'));
    globalShortcut.register('CmdOrCtrl+8', () => loadPage('net_ecosystem'));
    globalShortcut.register('CmdOrCtrl+9', () => loadPage('colony'));
    globalShortcut.register('CmdOrCtrl+0', () => loadPage('planet_strategy'));
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
