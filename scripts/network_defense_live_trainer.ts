import type { NetworkDefenseRlSave } from '../apps/network-defense/network_defense_rl.js';
import { runNetworkDefenseEpisode } from './network_defense_headless_sim.js';
import { runLiveTrainer } from './rl/live_trainer_loop.js';

void runLiveTrainer<NetworkDefenseRlSave>({
  label: 'network defense',
  fileStem: 'network-defense-live-model',
  compatibility: { gameId: 'network-defense', algorithm: 'ranked-tabular-q', modelVersion: 1, observationSchemaVersion: 1, rewardSchemaVersion: 1 },
  defaultEpisodes: 20,
  defaultCapSeconds: 300,
  // The episode runner owns the agent and hands back its save, so the learner here is only that save.
  createLearner(save) {
    let model = save;
    let trainingSteps = 0;
    return {
      async runEpisode(seed, cap, episode) {
        const result = await runNetworkDefenseEpisode(episode + 1, seed, cap, 'rl', model);
        model = result.model;
        trainingSteps = result.trainingSteps;
      },
      serialize: () => model,
      get trainingSteps() { return trainingSteps; },
    };
  },
});
