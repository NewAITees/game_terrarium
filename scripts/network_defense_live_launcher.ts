import { startTrainingSession } from './rl/training_supervisor';

startTrainingSession({
  gameId: 'network-defense',
  page: 'network_defense',
  trainerModule: 'network_defense_live_trainer.js',
});
