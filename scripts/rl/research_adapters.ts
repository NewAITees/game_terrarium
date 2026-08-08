import type { RlGameAdapter } from '../../shared/rl/experiment_spec.js';
import { createGunshipAdapter } from './gunship_experiment.js';

/**
 * The registry the searcher resolves a `gameId` through. Adding a game to the automated search is
 * one adapter plus one line here — the searcher itself never changes.
 */
export const RESEARCH_ADAPTERS: Record<string, () => RlGameAdapter> = {
  gunship: () => createGunshipAdapter(),
};

export function resolveAdapter(gameId: string): RlGameAdapter {
  const factory = RESEARCH_ADAPTERS[gameId];
  if (!factory) throw new Error(`no research adapter for '${gameId}' (have: ${Object.keys(RESEARCH_ADAPTERS).join(', ')})`);
  return factory();
}
