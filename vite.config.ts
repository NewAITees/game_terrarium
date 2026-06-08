import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
