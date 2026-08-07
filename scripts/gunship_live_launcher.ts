import { startTrainingSession } from './rl/training_supervisor';

startTrainingSession({
  gameId: 'gunship',
  page: 'gunship',
  trainerModule: 'gunship_live_trainer.js',
  trainerArguments: process.env.RL_LIVE_SMOKE === '1' ? ['--batch=1', '--cap=1', '--density=1', '--batches=1'] : undefined,
});
