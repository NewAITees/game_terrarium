import { QLearningAgent, type QLearningAgentSave } from '../apps/arena-shooter/arena_shooter_agent.js';
import { runArenaEpisode } from '../apps/arena-shooter/arena_shooter_episode.js';
import { runLiveTrainer } from './rl/live_trainer_loop.js';

void runLiveTrainer<QLearningAgentSave>({
  label: 'arena',
  fileStem: 'arena-shooter-live-model',
  compatibility: { gameId: 'arena-shooter', algorithm: 'tabular-q', modelVersion: 3, observationSchemaVersion: 1, rewardSchemaVersion: 1 },
  defaultEpisodes: 40,
  defaultCapSeconds: 180,
  createLearner(save) {
    const agent = new QLearningAgent();
    if (save) agent.restore(save);
    return {
      runEpisode: (seed, cap) => { runArenaEpisode(agent, seed, cap); },
      serialize: () => agent.serialize(),
      get trainingSteps() { return agent.trainingSteps; },
    };
  },
});
