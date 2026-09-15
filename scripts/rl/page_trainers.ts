import { cpus } from 'node:os';
import { RESEARCH_ADAPTERS } from './research_adapters.js';

/**
 * What runs in the background while a page is open.
 *
 * For a game wired into the automated search this is the search itself, not the single-configuration
 * live trainer. Both used to run and both wrote the same live model file, so the live trainer -
 * publishing every couple of seconds - overwrote every champion the search promoted within seconds
 * of it being published. The board grew correctly and the player still flew the worst configuration
 * on it. One writer removes the race rather than arbitrating it, and it makes playing the thing that
 * grows the leaderboard.
 *
 * The search is a batch: it runs its candidates and exits. Restarting it is what makes it a resident
 * trainer - each round proposes fresh candidates from the current champion and resumes from the
 * append-only ledger, so nothing is repeated and nothing is lost across rounds.
 */
export type PageTrainer = {
  gameId: string;
  trainerModule: string;
  trainerArguments: readonly string[];
  /** Arguments used when RL_LIVE_SMOKE=1 keeps the trainer to a single tiny batch. */
  smokeArguments: readonly string[];
  /** Search batches exit when their queue is done; the live trainers run until stopped. */
  restartOnExit: boolean;
};

/** Half the machine, so a search running behind a game does not starve the game drawing it. */
function backgroundConcurrency(): number {
  return Math.max(1, Math.floor(cpus().length / 2));
}

function searchTrainer(gameId: string): PageTrainer {
  return {
    gameId,
    trainerModule: 'rl/auto_research.js',
    trainerArguments: [
      `--game=${gameId}`,
      '--candidates=8',
      '--episodes=6000',
      '--repeats=3',
      `--concurrency=${backgroundConcurrency()}`,
    ],
    smokeArguments: [`--game=${gameId}`, '--candidates=1', '--episodes=1', '--repeats=1', '--concurrency=1', '--no-publish'],
    restartOnExit: true,
  };
}

function liveTrainer(gameId: string, trainerModule: string, smokeArguments: readonly string[]): PageTrainer {
  return { gameId, trainerModule, trainerArguments: [], smokeArguments, restartOnExit: false };
}

export const PAGE_TRAINERS: Readonly<Record<string, PageTrainer>> = {
  gunship: searchTrainer('gunship'),
  drone_bastion: searchTrainer('drone-bastion'),
  arena_shooter: searchTrainer('arena-shooter'),
  // No research adapter yet, so the single-configuration trainer is still the only thing to run.
  net_defense: liveTrainer('network-defense', 'network_defense_live_trainer.js', ['--episodes=1', '--cap=1', '--batches=1']),
};

export function trainerForPage(pageKey: string): PageTrainer | undefined {
  return PAGE_TRAINERS[pageKey];
}

/** True when the page's background work is the automated search rather than a fixed-spec trainer. */
export function isSearchBacked(pageKey: string): boolean {
  const trainer = PAGE_TRAINERS[pageKey];
  return Boolean(trainer && trainer.gameId in RESEARCH_ADAPTERS);
}
