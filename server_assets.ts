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
  // Serve built entry modules before public/: old placeholder files must not win.
  registerFileRoutes(app, projectRoot, {
    '/city_traffic.js': 'build/apps/city-traffic/city_traffic.js',
    '/moss.js': 'build/apps/moss/moss.js',
    '/escort_td.js': 'build/apps/escort-td/escort_td.js',
    '/colony.js': 'build/apps/colony/colony.js',
    '/network_defense.js': 'build/apps/network-defense/network_defense.js',
    '/network_defense_observer.js': 'build/apps/network-defense/network_defense_observer.js',
    '/network_ecosystem.js': 'build/apps/network-ecosystem/network_ecosystem.js',
    '/network_smallworld.js': 'build/apps/network-smallworld/network_smallworld.js',
    '/planet_strategy.js': 'build/apps/planet-strategy/planet_strategy.js',
    '/arena_shooter.js': 'build/apps/arena-shooter/arena_shooter.js',
    '/drone_bastion.js': 'build/apps/drone-bastion/drone_bastion.js',
    '/submarine_cables.js': 'build/apps/submarine-cables/submarine_cables.js',
    '/submarine_network_3d.js': 'build/apps/submarine-network-3d/submarine_network_3d.js',
    '/zombie_survivor.js': 'build/apps/zombie-survivor/zombie_survivor.js',
    '/one_line_rpg.js': 'build/apps/one-line-rpg/one_line_rpg.js',
    '/gunship.js': 'build/apps/gunship/gunship.js',
    '/network-core.js': 'build/shared/network-core.js',
  });
  app.use(express.static(path.join(projectRoot, 'public')));
  app.use('/agent_rules',  express.static(path.join(projectRoot, 'agent_rules')));
  app.use('/faction_rules', express.static(path.join(projectRoot, 'faction_rules')));
  app.use('/assets',       express.static(path.join(projectRoot, 'assets')));
  app.use('/assets',       express.static(path.join(projectRoot, 'build', 'assets')));
  app.use('/ai-restoration-assets', express.static(path.join(projectRoot, 'apps', 'ai-restoration', 'assets')));
  app.use('/_vendor',      express.static(path.join(projectRoot, 'build', '_vendor')));
  // network-core's split modules use relative imports from these app paths.
  app.use('/network-defense', express.static(path.join(projectRoot, 'build', 'shared')));
  app.use('/network-ecosystem', express.static(path.join(projectRoot, 'build', 'shared')));
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
    '/arena_shooter.html': 'apps/arena-shooter/arena_shooter.html',
    '/arena_shooter_training.html': 'apps/arena-shooter/arena_shooter.html',
    '/drone_bastion.html': 'apps/drone-bastion/drone_bastion.html',
    '/ai_restoration.html': 'apps/ai-restoration/ai_restoration.html',
    '/submarine_cables.html': 'pages/submarine_cables.html',
    '/submarine_network_3d.html': 'pages/submarine_network_3d.html',
    '/zombie_survivor.html': 'apps/zombie-survivor/zombie_survivor.html',
    '/one_line_rpg.html': 'apps/one-line-rpg/one_line_rpg.html',
    '/gunship.html': 'apps/gunship/gunship.html',
    '/network-defense/network-core.js': 'build/shared/network-core.js',
    '/network-ecosystem/network-core.js': 'build/shared/network-core.js',
    '/telemetry-client.js': 'shared/telemetry-client.js',
  });

  registerFileRoutes(app, projectRoot, await collectBasenameJsRoutes(projectRoot));
}
