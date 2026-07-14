import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { dirname } from 'path';

const repoRoot = __dirname;

function resolveSourceJsToTs() {
  return {
    name: 'resolve-source-js-to-ts',
    resolveId(source: string, importer: string | undefined) {
      if (source === '/_vendor/wasm/network_core_wasm.js' || source === '/_vendor/wasm/network_core_wasm_bg.wasm') {
        const vendorPath = resolve(repoRoot, 'build', '_vendor', 'wasm', source.split('/').pop() ?? '');
        return existsSync(vendorPath) ? vendorPath : null;
      }
      if (!importer || !source.startsWith('./') && !source.startsWith('../')) return null;
      if (!source.endsWith('.js')) return null;
      const jsPath = resolve(dirname(importer), source);
      if (existsSync(jsPath)) return jsPath;
      const tsPath = jsPath.replace(/\.js$/i, '.ts');
      if (existsSync(tsPath)) return tsPath;
      const tsxPath = jsPath.replace(/\.js$/i, '.tsx');
      if (existsSync(tsxPath)) return tsxPath;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveSourceJsToTs()],
  build: {
    outDir: 'build',
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      input: {
        'apps/city-traffic/city_traffic':
          resolve(__dirname, 'apps/city-traffic/city_traffic.ts'),
        'apps/moss/moss':
          resolve(__dirname, 'apps/moss/moss.ts'),
        'apps/escort-td/escort_td':
          resolve(__dirname, 'apps/escort-td/escort_td.ts'),
        'apps/submarine-cables/submarine_cables':
          resolve(__dirname, 'apps/submarine-cables/submarine_cables.ts'),
        'apps/submarine-network-3d/submarine_network_3d':
          resolve(__dirname, 'apps/submarine-network-3d/submarine_network_3d.ts'),
        'apps/colony/colony':
          resolve(__dirname, 'apps/colony/colony.ts'),
        'apps/network-smallworld/network_smallworld':
          resolve(__dirname, 'apps/network-smallworld/network_smallworld.ts'),
        'apps/network-defense/network_defense':
          resolve(__dirname, 'apps/network-defense/network_defense.ts'),
        'apps/network-defense/network_defense_observer':
          resolve(__dirname, 'apps/network-defense/network_defense_observer.ts'),
        'apps/network-ecosystem/network_ecosystem':
          resolve(__dirname, 'apps/network-ecosystem/network_ecosystem.ts'),
        'apps/planet-strategy/planet_strategy':
          resolve(__dirname, 'apps/planet-strategy/planet_strategy.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '_vendor/[name]-[hash].js',
      },
    },
  },
});




