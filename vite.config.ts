import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { dirname } from 'path';

function resolveSourceJsToTs() {
  return {
    name: 'resolve-source-js-to-ts',
    resolveId(source: string, importer: string | undefined) {
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
        'apps/escort-td/escort_td':
          resolve(__dirname, 'apps/escort-td/escort_td.ts'),
        'apps/colony/colony':
          resolve(__dirname, 'apps/colony/colony.ts'),
        'apps/network-defense/network_defense':
          resolve(__dirname, 'apps/network-defense/network_defense.ts'),
        'apps/network-defense/network_defense_observer':
          resolve(__dirname, 'apps/network-defense/network_defense_observer.ts'),
        'apps/network-ecosystem/network_ecosystem':
          resolve(__dirname, 'apps/network-ecosystem/network_ecosystem.ts'),
        'apps/planet-strategy/planet_strategy':
          resolve(__dirname, 'apps/planet-strategy/planet_strategy.ts'),
      },
      // network-core.js is plain JS served by Express at runtime — keep external
      external: ['./network-core.js'],
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '_vendor/[name]-[hash].js',
      },
    },
  },
});
