import {
  DroneBastionAgent,
  DRONE_BASTION_ACTION_SETS,
  DRONE_BASTION_OBSERVATIONS,
  type DroneBastionActionVariant,
  type DroneBastionObservationVariant,
} from '../../apps/drone-bastion/drone_bastion_agent.js';
import {
  DEFAULT_DRONE_BASTION_REWARD_WEIGHTS,
  type DroneBastionRewardWeights,
} from '../../apps/drone-bastion/drone_bastion_core.js';
import {
  fingerprintDroneBastionStart,
  runDroneBastionEpisode,
  type DroneBastionEpisodeResult,
} from '../../apps/drone-bastion/drone_bastion_episode.js';
import {
  validateSpec,
  type EpisodeOutcome,
  type ExperimentSpec,
  type RlExperimentSession,
  type RlGameAdapter,
  type RlSearchSpace,
} from '../../shared/rl/experiment_spec.js';
import { createModelManifest } from '../../shared/rl/model_manifest.js';
import { DQN_LEARNER_VARIANTS, TABULAR_LEARNER_VARIANTS, isDqnVariant, type TabularLearnerVariant } from '../../shared/rl/learner_variant.js';
import { DroneBastionDqnAgent } from '../../apps/drone-bastion/drone_bastion_dqn_agent.js';

/**
 * Drone Bastion's declaration of what an automated search may vary.
 *
 * The second game to implement the adapter, and the one that decided the shape of the interface:
 * gunship varies its world in the opening layout, this one only in what spawns later, which is why
 * `environmentFingerprint` asks the game for a summary rather than prescribing how to produce one.
 */

const REWARD_WEIGHTS = [
  'survival', 'switchCost', 'chip', 'kill', 'bruteKill',
  'wallHit', 'droneHit', 'droneLost', 'towerDamage', 'wave', 'defeat',
] as const;

export const DRONE_BASTION_SEARCH_SPACE: RlSearchSpace = {
  gameId: 'drone-bastion',
  // The only game with both families implemented, so it is the one that can answer whether function
  // approximation is worth its cost here.
  learnerVariants: [...TABULAR_LEARNER_VARIANTS, ...DQN_LEARNER_VARIANTS],
  observations: DRONE_BASTION_OBSERVATIONS,
  actions: DRONE_BASTION_ACTION_SETS,
  rewardModes: ['sparse', 'shaped'],
  rewardWeights: REWARD_WEIGHTS,
  // This game has no difficulty knobs wired up yet, so there is nothing here to vary. An empty
  // declaration is honest: the searcher simply cannot propose difficulty changes for it.
  environment: {},
};

export function createDroneBastionAdapter(): RlGameAdapter {
  return {
    searchSpace: DRONE_BASTION_SEARCH_SPACE,
    defaultSpec: () => defaultDroneBastionSpec(),
    createSession(spec, random) {
      validateSpec(spec, DRONE_BASTION_SEARCH_SPACE);
      return new DroneBastionSession(spec, random);
    },
    environmentFingerprint(spec, seed) {
      validateSpec(spec, DRONE_BASTION_SEARCH_SPACE);
      return fingerprintDroneBastionStart(seed, resolveDroneBastionRewards(spec));
    },
    livePublication: {
      stem: 'drone-bastion-live-model',
      liveLearnerVariant: 'tabular-1step',
      liveObservation: 'shipped',
      liveActions: 'full',
      bundle(model, revision, metadata) {
        return {
          version: 1,
          revision,
          publishedAt: metadata.publishedAt,
          manifest: createModelManifest({
            gameId: 'drone-bastion', algorithm: 'tabular-q', modelVersion: 2,
            observationSchemaVersion: 1, rewardSchemaVersion: 1,
          }, { revision, trainingSteps: metadata.trainingSteps, publishedAt: metadata.publishedAt }),
          model,
        };
      },
    },
  };
}

/** The champion by default: today's shipped agent, expressed as a spec. */
export function defaultDroneBastionSpec(): ExperimentSpec {
  return {
    gameId: 'drone-bastion',
    learnerVariant: 'tabular-1step',
    observation: 'shipped',
    actions: 'full',
    reward: { mode: 'shaped', weights: { ...DEFAULT_DRONE_BASTION_REWARD_WEIGHTS } },
    environment: {},
    learner: {},
    // Episodes here run to a defeat that can take a while, so the budget is smaller than gunship's.
    budget: { episodes: 400, capSeconds: 120, trainSeeds: 64, holdoutSeeds: 32, repeats: 3 },
  };
}

export function resolveDroneBastionRewards(spec: ExperimentSpec): DroneBastionRewardWeights {
  if (spec.reward.mode === 'sparse') {
    return {
      survival: 0,
      switchCost: 0,
      chip: 0,
      kill: 0,
      bruteKill: 0,
      wallHit: 0,
      droneHit: 0,
      droneLost: 0,
      towerDamage: 0,
      wave: 0,
      defeat: spec.reward.weights.defeat ?? DEFAULT_DRONE_BASTION_REWARD_WEIGHTS.defeat,
    };
  }
  return { ...DEFAULT_DRONE_BASTION_REWARD_WEIGHTS, ...spec.reward.weights };
}

class DroneBastionSession implements RlExperimentSession {
  private readonly agent: DroneBastionAgent | DroneBastionDqnAgent;
  private readonly rewards: DroneBastionRewardWeights;
  private readonly capSeconds: number;

  constructor(spec: ExperimentSpec, random?: () => number) {
    this.agent = isDqnVariant(spec.learnerVariant)
      // The network takes a fixed-size vector, so it uses its own encodings rather than the tabular
      // key sets. 'minimal' maps across; anything else gets the full engineered vector.
      ? new DroneBastionDqnAgent(spec.observation === 'minimal' ? 'minimal' : 'engineered', random, spec.learnerVariant)
      : new DroneBastionAgent({
        learnerVariant: spec.learnerVariant as TabularLearnerVariant,
        observation: spec.observation as DroneBastionObservationVariant,
        actions: spec.actions as DroneBastionActionVariant,
        learner: spec.learner,
        random,
      });
    this.rewards = resolveDroneBastionRewards(spec);
    this.capSeconds = spec.budget.capSeconds;
  }

  train(seed: number): EpisodeOutcome {
    return outcome(runDroneBastionEpisode(this.agent, seed, this.capSeconds, 0.05, this.rewards));
  }

  evaluate(seed: number): EpisodeOutcome {
    this.agent.setEvaluationMode(true);
    try {
      return outcome(runDroneBastionEpisode(this.agent, seed, this.capSeconds, 0.05, this.rewards));
    } finally {
      this.agent.setEvaluationMode(false);
    }
  }

  serialize(): unknown { return this.agent.serialize(); }

  get trainingSteps(): number { return this.agent.trainingSteps; }
  get knownStates(): number { return this.agent.knownStates; }
}

function outcome(result: DroneBastionEpisodeResult): EpisodeOutcome {
  return {
    seed: result.seed,
    taskReturn: result.taskReturn,
    channels: result.channels,
    terminated: result.terminated,
    truncated: result.truncated,
    values: {
      kills: result.kills,
      wave: result.wave,
      seconds: result.seconds,
      towerHp: result.towerHpFraction,
      defeated: result.terminated ? 1 : 0,
    },
  };
}
