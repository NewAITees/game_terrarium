import {
  QLearningAgent,
  ARENA_ACTION_SETS,
  ARENA_OBSERVATIONS,
  type ArenaActionVariant,
} from '../../apps/arena-shooter/arena_shooter_agent.js';
import {
  DEFAULT_ARENA_REWARD_WEIGHTS,
  type ArenaObservationVariant,
  type ArenaRewardWeights,
} from '../../apps/arena-shooter/arena_shooter_core.js';
import {
  fingerprintArenaStart,
  runArenaEpisode,
  type ArenaEpisodeResult,
} from '../../apps/arena-shooter/arena_shooter_episode.js';
import {
  validateSpec,
  type EpisodeOutcome,
  type ExperimentSpec,
  type RlExperimentSession,
  type RlGameAdapter,
  type RlSearchSpace,
} from '../../shared/rl/experiment_spec.js';
import { createModelManifest } from '../../shared/rl/model_manifest.js';
import { TABULAR_LEARNER_VARIANTS, type TabularLearnerVariant } from '../../shared/rl/learner_variant.js';

/**
 * Arena Shooter's declaration of what an automated search may vary.
 *
 * The largest of the three: fourteen reward weights that used to be literals scattered through
 * `stepArena`, a 162-way action product, and an observation carrying two sixteen-way sensor rings.
 * Nothing about that was reachable by a search before, which is why the shipped configuration has
 * never actually been compared against an alternative.
 */

const REWARD_WEIGHTS = [
  'survival', 'edgeLoiter', 'edgeApproach', 'boundaryHit', 'shotCost',
  'kill', 'bruteKill', 'beamHit', 'beamIntercept', 'trailTick',
  'projectileHit', 'shotIntercept', 'contactHit', 'projectileTaken',
] as const;

export const ARENA_SEARCH_SPACE: RlSearchSpace = {
  gameId: 'arena-shooter',
  learnerVariants: TABULAR_LEARNER_VARIANTS,
  observations: ARENA_OBSERVATIONS,
  actions: ARENA_ACTION_SETS,
  rewardWeights: REWARD_WEIGHTS,
  // Only the shaped formulation exists here so far. Declaring 'sparse' without implementing it would
  // put a variant in the search space that silently behaves like the one next to it.
  rewardModes: ['shaped'],
  // No difficulty knobs are wired up yet, and declaring none is honest: the searcher simply cannot
  // propose a difficulty change for this game until one exists.
  environment: {},
};

export function createArenaShooterAdapter(): RlGameAdapter {
  return {
    searchSpace: ARENA_SEARCH_SPACE,
    defaultSpec: () => defaultArenaSpec(),
    createSession(spec, random) {
      validateSpec(spec, ARENA_SEARCH_SPACE);
      return new ArenaSession(spec, random);
    },
    environmentFingerprint(spec, seed) {
      validateSpec(spec, ARENA_SEARCH_SPACE);
      return fingerprintArenaStart(seed, rewardsFor(spec));
    },
    livePublication: {
      stem: 'arena-shooter-live-model',
      liveLearnerVariant: 'tabular-1step',
      liveObservation: 'full',
      liveActions: 'full',
      bundle(model, revision, metadata) {
        return {
          version: 1,
          revision,
          publishedAt: metadata.publishedAt,
          manifest: createModelManifest({
            gameId: 'arena-shooter', algorithm: 'tabular-q', modelVersion: 3,
            observationSchemaVersion: 1, rewardSchemaVersion: 1,
          }, { revision, trainingSteps: metadata.trainingSteps, publishedAt: metadata.publishedAt }),
          model,
        };
      },
    },
  };
}

/** The champion by default: today's shipped agent, expressed as a spec. */
export function defaultArenaSpec(): ExperimentSpec {
  return {
    gameId: 'arena-shooter',
    learnerVariant: 'tabular-1step',
    observation: 'full',
    actions: 'full',
    reward: { mode: 'shaped', weights: { ...DEFAULT_ARENA_REWARD_WEIGHTS } },
    environment: {},
    learner: {},
    budget: { episodes: 600, capSeconds: 90, trainSeeds: 64, holdoutSeeds: 32, repeats: 3 },
  };
}

function rewardsFor(spec: ExperimentSpec): ArenaRewardWeights {
  return { ...DEFAULT_ARENA_REWARD_WEIGHTS, ...spec.reward.weights };
}

class ArenaSession implements RlExperimentSession {
  private readonly agent: QLearningAgent;
  private readonly rewards: ArenaRewardWeights;
  private readonly capSeconds: number;

  constructor(spec: ExperimentSpec, random?: () => number) {
    this.agent = new QLearningAgent({
      learnerVariant: spec.learnerVariant as TabularLearnerVariant,
      observation: spec.observation as ArenaObservationVariant,
      actions: spec.actions as ArenaActionVariant,
      learner: spec.learner,
      random,
    });
    this.rewards = rewardsFor(spec);
    this.capSeconds = spec.budget.capSeconds;
  }

  train(seed: number): EpisodeOutcome {
    return outcome(runArenaEpisode(this.agent, seed, this.capSeconds, 'random', 1 / 60, this.rewards));
  }

  evaluate(seed: number): EpisodeOutcome {
    this.agent.setEvaluationMode(true);
    try {
      return outcome(runArenaEpisode(this.agent, seed, this.capSeconds, 'random', 1 / 60, this.rewards));
    } finally {
      this.agent.setEvaluationMode(false);
    }
  }

  serialize(): unknown { return this.agent.serialize(); }

  get trainingSteps(): number { return this.agent.trainingSteps; }
  get knownStates(): number { return this.agent.knownStates; }
}

function outcome(result: ArenaEpisodeResult): EpisodeOutcome {
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
      hp: result.hpFraction,
      defeated: result.terminated ? 1 : 0,
    },
  };
}
