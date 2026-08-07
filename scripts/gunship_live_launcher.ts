import { startTrainingSession } from './rl/training_supervisor';

startTrainingSession({
  gameId: 'gunship',
  page: 'gunship',
  trainerModule: 'gunship_live_trainer.js',
});
