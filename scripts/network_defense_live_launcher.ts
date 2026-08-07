import { startTrainingSession } from './rl/training_supervisor';

startTrainingSession({
  gameId: 'network-defense',
  page: 'net_defense',
  trainerModule: 'network_defense_live_trainer.js',
  trainerArguments: process.env.RL_LIVE_SMOKE === '1' ? ['--episodes=1', '--cap=1', '--batches=1'] : undefined,
});
