import { DroneBastionAgent, type DroneBastionAgentSave } from '../apps/drone-bastion/drone_bastion_agent.js';
import { runDroneBastionEpisode } from '../apps/drone-bastion/drone_bastion_episode.js';
import { runLiveTrainer } from './rl/live_trainer_loop.js';

void runLiveTrainer<DroneBastionAgentSave>({
  label: 'drone bastion',
  fileStem: 'drone-bastion-live-model',
  compatibility: { gameId: 'drone-bastion', algorithm: 'tabular-q', modelVersion: 2, observationSchemaVersion: 1, rewardSchemaVersion: 1 },
  defaultEpisodes: 40,
  defaultCapSeconds: 300,
  createLearner(save) {
    const agent = new DroneBastionAgent();
    if (save) agent.restore(save);
    return {
      runEpisode: (seed, cap) => { runDroneBastionEpisode(agent, seed, cap); },
      serialize: () => agent.serialize(),
      get trainingSteps() { return agent.trainingSteps; },
    };
  },
});
