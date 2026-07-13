import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

type AppBuildTarget = {
  name: string;
  source: string;
  html: string;
  bundle: string;
  htmlModuleSrc: string;
};

const projectRoot = path.resolve(__dirname, '..', '..');

const appBuildTargets: readonly AppBuildTarget[] = [
  {
    name: 'City Traffic',
    source: 'apps/city-traffic/city_traffic.ts',
    html: 'apps/city-traffic/city_traffic.html',
    bundle: 'build/apps/city-traffic/city_traffic.js',
    htmlModuleSrc: './city_traffic.js',
  },
  {
    name: 'MOSS',
    source: 'apps/moss/moss.ts',
    html: 'apps/moss/moss.html',
    bundle: 'build/apps/moss/moss.js',
    htmlModuleSrc: './moss.js',
  },
  {
    name: 'Escort TD',
    source: 'apps/escort-td/escort_td.ts',
    html: 'apps/escort-td/escort_td.html',
    bundle: 'build/apps/escort-td/escort_td.js',
    htmlModuleSrc: '/escort_td.js',
  },
  {
    name: 'Network Small World',
    source: 'apps/network-smallworld/network_smallworld.ts',
    html: 'apps/network-smallworld/network_smallworld.html',
    bundle: 'build/apps/network-smallworld/network_smallworld.js',
    htmlModuleSrc: './network_smallworld.js',
  },
  {
    name: 'AI Planet Strategy',
    source: 'apps/planet-strategy/planet_strategy.ts',
    html: 'apps/planet-strategy/planet_strategy.html',
    bundle: 'build/apps/planet-strategy/planet_strategy.js',
    htmlModuleSrc: './planet_strategy.js',
  },
  {
    name: 'Network Tower Defense',
    source: 'apps/network-defense/network_defense.ts',
    html: 'apps/network-defense/network_defense.html',
    bundle: 'build/apps/network-defense/network_defense.js',
    htmlModuleSrc: './network_defense.js',
  },
  {
    name: 'Network Ecosystem',
    source: 'apps/network-ecosystem/network_ecosystem.ts',
    html: 'apps/network-ecosystem/network_ecosystem.html',
    bundle: 'build/apps/network-ecosystem/network_ecosystem.js',
    htmlModuleSrc: './network_ecosystem.js',
  },
  {
    name: 'Submarine Cables',
    source: 'apps/submarine-cables/submarine_cables.ts',
    html: 'pages/submarine_cables.html',
    bundle: 'build/apps/submarine-cables/submarine_cables.js',
    htmlModuleSrc: '/submarine_cables.js',
  },
  {
    name: 'Submarine Network 3D',
    source: 'apps/submarine-network-3d/submarine_network_3d.ts',
    html: 'pages/submarine_network_3d.html',
    bundle: 'build/apps/submarine-network-3d/submarine_network_3d.js',
    htmlModuleSrc: '/submarine_network_3d.js',
  },
  {
    name: 'AI Colony Sandbox',
    source: 'apps/colony/colony.ts',
    html: 'apps/colony/colony.html',
    bundle: 'build/apps/colony/colony.js',
    htmlModuleSrc: './colony.js',
  },
];

for (const app of appBuildTargets) {
  test(`${app.name} has a buildable TypeScript entry point wired to its page`, () => {
    const sourcePath = path.join(projectRoot, app.source);
    const htmlPath = path.join(projectRoot, app.html);
    const bundlePath = path.join(projectRoot, app.bundle);

    assert.equal(existsSync(sourcePath), true, `missing TypeScript entry: ${app.source}`);
    assert.equal(existsSync(htmlPath), true, `missing page: ${app.html}`);
    assert.equal(existsSync(bundlePath), true, `missing built entry: ${app.bundle}`);
    assert.ok(statSync(bundlePath).size > 0, `built entry is empty: ${app.bundle}`);

    const html = readFileSync(htmlPath, 'utf8');
    assert.match(html, new RegExp(`src=["']${escapeRegExp(app.htmlModuleSrc)}["']`));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
