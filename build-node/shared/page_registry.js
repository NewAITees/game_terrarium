"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGE_BY_NUMBER = exports.PAGE_BY_KEY = exports.PAGE_REGISTRY = void 0;
exports.isPageKey = isPageKey;
exports.describePage = describePage;
exports.PAGE_REGISTRY = [
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
];
exports.PAGE_BY_KEY = new Map(exports.PAGE_REGISTRY.map((page) => [page.key, page]));
exports.PAGE_BY_NUMBER = new Map(exports.PAGE_REGISTRY.map((page) => [page.number, page]));
function isPageKey(value) {
    return exports.PAGE_BY_KEY.has(value);
}
function describePage(page) {
    return `Ctrl+${page.number} / ${page.label} (${page.key})`;
}
