import { promises as fs } from 'fs';
import path from 'path';
import express from 'express';

function registerFileRoutes(app: express.Express, rootDir: string, routes: Record<string, string>): void {
  for (const [route, relativePath] of Object.entries(routes)) {
    app.get(route, (_req, res) => {
      res.sendFile(path.join(rootDir, relativePath));
    });
  }
}

async function collectBasenameJsRoutes(projectRoot: string): Promise<Record<string, string>> {
  const buildRoots = [
    path.join(projectRoot, 'build', 'apps'),
    path.join(projectRoot, 'build', 'shared'),
  ];
  const routes: Record<string, string> = {};

  async function walk(dir: string): Promise<void> {
    try {
      await fs.access(dir);
    } catch {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      routes[`/${entry.name}`] = path.relative(projectRoot, fullPath);
    }
  }

  for (const buildRoot of buildRoots) {
    await walk(buildRoot);
  }

  return routes;
}

export async function mountBrowserAssetRoutes(app: express.Express, projectRoot: string): Promise<void> {
  app.use(express.static(path.join(projectRoot, 'public')));
  app.use('/agent_rules',  express.static(path.join(projectRoot, 'agent_rules')));
  app.use('/faction_rules', express.static(path.join(projectRoot, 'faction_rules')));
  app.use('/assets',       express.static(path.join(projectRoot, 'assets')));
  app.use('/_vendor',      express.static(path.join(projectRoot, 'build', '_vendor')));
  app.use('/shared',       express.static(path.join(projectRoot, 'shared')));

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


