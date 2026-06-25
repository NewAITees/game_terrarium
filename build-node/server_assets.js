"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountBrowserAssetRoutes = mountBrowserAssetRoutes;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
function registerFileRoutes(app, rootDir, routes) {
    for (const [route, relativePath] of Object.entries(routes)) {
        app.get(route, (_req, res) => {
            res.sendFile(path_1.default.join(rootDir, relativePath));
        });
    }
}
async function collectBasenameJsRoutes(projectRoot) {
    const buildRoots = [
        path_1.default.join(projectRoot, 'build', 'apps'),
        path_1.default.join(projectRoot, 'build', 'shared'),
    ];
    const routes = {};
    async function walk(dir) {
        try {
            await fs_1.promises.access(dir);
        }
        catch {
            return;
        }
        const entries = await fs_1.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (!entry.name.endsWith('.js'))
                continue;
            routes[`/${entry.name}`] = path_1.default.relative(projectRoot, fullPath);
        }
    }
    for (const buildRoot of buildRoots) {
        await walk(buildRoot);
    }
    return routes;
}
async function mountBrowserAssetRoutes(app, projectRoot) {
    app.use(express_1.default.static(path_1.default.join(projectRoot, 'public')));
    app.use('/agent_rules', express_1.default.static(path_1.default.join(projectRoot, 'agent_rules')));
    app.use('/faction_rules', express_1.default.static(path_1.default.join(projectRoot, 'faction_rules')));
    app.use('/assets', express_1.default.static(path_1.default.join(projectRoot, 'assets')));
    app.use('/_vendor', express_1.default.static(path_1.default.join(projectRoot, 'build', '_vendor')));
    app.use('/shared', express_1.default.static(path_1.default.join(projectRoot, 'shared')));
    registerFileRoutes(app, projectRoot, {
        '/city_traffic.html': 'apps/city-traffic/city_traffic.html',
        '/moss.html': 'apps/moss/moss.html',
        '/escort_td.html': 'apps/escort-td/escort_td.html',
        '/colony.html': 'apps/colony/colony.html',
        '/network_defense.html': 'apps/network-defense/network_defense.html',
        '/network_defense_observer.html': 'apps/network-defense/network_defense_observer.html',
        '/network_ecosystem.html': 'apps/network-ecosystem/network_ecosystem.html',
        '/network_sw.html': 'apps/network-smallworld/network_smallworld.html',
        '/planet_strategy.html': 'apps/planet-strategy/planet_strategy.html',
        '/submarine_cables.html': 'pages/submarine_cables.html',
        '/submarine_network_3d.html': 'pages/submarine_network_3d.html',
        '/network-defense/network-core.js': 'build/shared/network-core.js',
        '/network-ecosystem/network-core.js': 'build/shared/network-core.js',
        '/telemetry-client.js': 'shared/telemetry-client.js',
    });
    registerFileRoutes(app, projectRoot, await collectBasenameJsRoutes(projectRoot));
}
