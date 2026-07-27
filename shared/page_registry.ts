export type PageLoadMode = 'file' | 'http';

export type PageDefinition = {
  number: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
  key: string;
  label: string;
  accelerator: string;
  loadMode: PageLoadMode;
  htmlPath: string;
  target: string;
};

export const PAGE_REGISTRY = [
  {
    number: 1,
    key: 'city',
    label: 'City Traffic',
    accelerator: 'CmdOrCtrl+1',
    loadMode: 'http',
    htmlPath: 'apps/city-traffic/city_traffic.html',
    target: 'http://localhost:3000/city_traffic.html',
  },
  {
    number: 2,
    key: 'moss',
    label: 'MOSS',
    accelerator: 'CmdOrCtrl+2',
    loadMode: 'http',
    htmlPath: 'apps/moss/moss.html',
    target: 'http://localhost:3000/moss.html',
  },
  {
    number: 3,
    key: 'escort_td',
    label: 'Escort TD',
    accelerator: 'CmdOrCtrl+3',
    loadMode: 'http',
    htmlPath: 'apps/escort-td/escort_td.html',
    target: 'http://localhost:3000/escort_td.html',
  },
  {
    number: 4,
    key: 'net_sw',
    label: 'Network Small World',
    accelerator: 'CmdOrCtrl+4',
    loadMode: 'http',
    htmlPath: 'apps/network-smallworld/network_smallworld.html',
    target: 'http://localhost:3000/network_sw.html',
  },
  {
    number: 0,
    key: 'planet_strategy',
    label: 'AI Planet Strategy',
    accelerator: 'CmdOrCtrl+0',
    loadMode: 'http',
    htmlPath: 'apps/planet-strategy/planet_strategy.html',
    target: 'http://localhost:3000/planet_strategy.html',
  },
  {
    number: 7,
    key: 'net_defense',
    label: 'Network Tower Defense',
    accelerator: 'CmdOrCtrl+7',
    loadMode: 'http',
    htmlPath: 'apps/network-defense/network_defense.html',
    target: 'http://localhost:3000/network_defense.html',
  },
  {
    number: 8,
    key: 'net_ecosystem',
    label: 'Network Ecosystem',
    accelerator: 'CmdOrCtrl+8',
    loadMode: 'http',
    htmlPath: 'apps/network-ecosystem/network_ecosystem.html',
    target: 'http://localhost:3000/network_ecosystem.html',
  },
  {
    number: 5,
    key: 'submarine',
    label: 'Submarine Cables',
    accelerator: 'CmdOrCtrl+5',
    loadMode: 'http',
    htmlPath: 'pages/submarine_cables.html',
    target: 'http://localhost:3000/submarine_cables.html',
  },
  {
    number: 6,
    key: 'submarine_3d',
    label: 'Submarine Network 3D',
    accelerator: 'CmdOrCtrl+6',
    loadMode: 'http',
    htmlPath: 'pages/submarine_network_3d.html',
    target: 'http://localhost:3000/submarine_network_3d.html',
  },
  {
    number: 9,
    key: 'colony',
    label: 'AI Colony Sandbox',
    accelerator: 'CmdOrCtrl+9',
    loadMode: 'http',
    htmlPath: 'apps/colony/colony.html',
    target: 'http://localhost:3000/colony.html',
  },
  {
    number: 10,
    key: 'arena_shooter',
    label: 'RL Arena Shooter',
    accelerator: 'CmdOrCtrl+Shift+0',
    loadMode: 'http',
    htmlPath: 'apps/arena-shooter/arena_shooter.html',
    target: 'http://localhost:3000/arena_shooter.html',
  },
  {
    number: 11,
    key: 'drone_bastion',
    label: 'Drone Bastion TD',
    accelerator: 'CmdOrCtrl+Shift+1',
    loadMode: 'http',
    htmlPath: 'apps/drone-bastion/drone_bastion.html',
    target: 'http://localhost:3000/drone_bastion.html',
  },
  {
    number: 12,
    key: 'ai_restoration',
    label: 'AI Restoration Alpha',
    accelerator: 'CmdOrCtrl+Shift+2',
    loadMode: 'http',
    htmlPath: 'apps/ai-restoration/ai_restoration.html',
    target: 'http://localhost:3000/ai_restoration.html',
  },
  {
    number: 13,
    key: 'zombie_survivor',
    label: 'Zombie Survivor',
    accelerator: 'CmdOrCtrl+Shift+3',
    loadMode: 'http',
    htmlPath: 'apps/zombie-survivor/zombie_survivor.html',
    target: 'http://localhost:3000/zombie_survivor.html',
  },
] as const satisfies readonly PageDefinition[];

export type PageKey = (typeof PAGE_REGISTRY)[number]['key'];

export const PAGE_BY_KEY = new Map<PageKey, (typeof PAGE_REGISTRY)[number]>(
  PAGE_REGISTRY.map((page) => [page.key, page])
);

export const PAGE_BY_NUMBER = new Map<number, (typeof PAGE_REGISTRY)[number]>(
  PAGE_REGISTRY.map((page) => [page.number, page])
);

export function isPageKey(value: string): value is PageKey {
  return PAGE_BY_KEY.has(value as PageKey);
}

export function describePage(page: { number: number; key: string; label: string }): string {
  const shortcut = page.number === 10
    ? 'Ctrl+Shift+0'
    : page.number === 11
      ? 'Ctrl+Shift+1'
    : page.number === 12
      ? 'Ctrl+Shift+2'
      : `Ctrl+${page.number}`;
  return `${shortcut} / ${page.label} (${page.key})`;
}
