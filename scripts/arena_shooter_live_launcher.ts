import { startTrainingSession } from './rl/training_supervisor';

startTrainingSession({
  gameId: 'arena-shooter',
  page: 'arena_shooter',
  trainerModule: 'arena_shooter_live_trainer.js',
});
