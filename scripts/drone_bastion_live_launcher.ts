import { startTrainingSession } from './rl/training_supervisor';

startTrainingSession({
  gameId: 'drone-bastion',
  page: 'drone_bastion',
  trainerModule: 'drone_bastion_live_trainer.js',
});
