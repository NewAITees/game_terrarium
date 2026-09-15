/**
 * Which page is backed by which headless trainer.
 *
 * The four `*_live_launcher.ts` entry points each hard-coded this pairing, which only ever ran
 * when the app was started from that specific npm script. Opening the same page from the Ctrl+K
 * palette produced a player with no trainer behind it, so the page sat replaying whatever model
 * was last on disk and nothing ever learned. Naming the pairing once lets the main process start
 * the trainer on page switch, and keeps the launchers and the palette from drifting apart.
 */
export type PageTrainer = {
  gameId: string;
  trainerModule: string;
  /** Arguments used when RL_LIVE_SMOKE=1 keeps the trainer to a single tiny batch. */
  smokeArguments: readonly string[];
};

export const PAGE_TRAINERS: Readonly<Record<string, PageTrainer>> = {
  gunship: {
    gameId: 'gunship',
    trainerModule: 'gunship_live_trainer.js',
    smokeArguments: ['--batch=1', '--cap=1', '--density=1', '--batches=1'],
  },
  drone_bastion: {
    gameId: 'drone-bastion',
    trainerModule: 'drone_bastion_live_trainer.js',
    smokeArguments: ['--episodes=1', '--cap=1', '--batches=1'],
  },
  arena_shooter: {
    gameId: 'arena-shooter',
    trainerModule: 'arena_shooter_live_trainer.js',
    smokeArguments: ['--episodes=1', '--cap=1', '--batches=1'],
  },
  net_defense: {
    gameId: 'network-defense',
    trainerModule: 'network_defense_live_trainer.js',
    smokeArguments: ['--episodes=1', '--cap=1', '--batches=1'],
  },
};

export function trainerForPage(pageKey: string): PageTrainer | undefined {
  return PAGE_TRAINERS[pageKey];
}
