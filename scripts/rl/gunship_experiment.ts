import { AIRFRAMES, type AirframeId } from '../../apps/gunship/gunship_airframes.js';
import {
  GunshipAgent,
  GUNSHIP_ACTION_SETS,
  GUNSHIP_OBSERVATIONS,
  type GunshipActionVariant,
  type GunshipObservationVariant,
} from '../../apps/gunship/gunship_rl.js';
import { validateSpec, type EpisodeOutcome, type ExperimentSpec, type RlExperimentSession, type RlGameAdapter, type RlSearchSpace } from '../../shared/rl/experiment_spec.js';
import { DEFAULT_GUNSHIP_ENVIRONMENT, fingerprintEpisodeStart, runEpisode, type GunshipEnvironmentSpec, type GunshipEpisodeResult } from '../gunship_headless_sim.js';
import { createModelManifest } from '../../shared/rl/model_manifest.js';

/**
 * Gunship's declaration of what an automated search may vary, and how to run one configuration.
 * The searcher reads only this — it has no idea what an airframe or a chaser is.
 */

const REWARD_WEIGHTS = ['survival', 'ceiling', 'death', 'hpDeath', 'kill', 'hit', 'wave'] as const;

export const GUNSHIP_SEARCH_SPACE: RlSearchSpace = {
  gameId: 'gunship',
  observations: GUNSHIP_OBSERVATIONS,
  actions: GUNSHIP_ACTION_SETS,
  rewardModes: ['shaped'],
  rewardWeights: REWARD_WEIGHTS,
  // Difficulty, not reward: these change what the environment *is*, so two specs that differ here
  // are not comparable on task return and the searcher must treat them as separate ladders.
  environment: {
    density: { min: 1, max: 6 },
    hp: { min: .5, max: 3 },
    fireRate: { min: .25, max: 2 },
    maxChasers: { min: 0, max: 16 },
  },
};

export function createGunshipAdapter(airframeId: AirframeId = 'interceptor'): RlGameAdapter {
  if (!AIRFRAMES.some((frame) => frame.id === airframeId)) throw new Error(`unknown airframe '${airframeId}'`);
  return {
    searchSpace: GUNSHIP_SEARCH_SPACE,
    defaultSpec: () => defaultGunshipSpec(),
    createSession(spec, random) {
      validateSpec(spec, GUNSHIP_SEARCH_SPACE);
      return new GunshipSession(spec, airframeId, random);
    },
    environmentFingerprint(spec, seed) {
      validateSpec(spec, GUNSHIP_SEARCH_SPACE);
      return fingerprintEpisodeStart(airframeId, environmentFor(spec), seed);
    },
    livePublication: {
      stem: 'gunship-live-models',
      // apps/gunship/gunship.ts builds its agent with the default spec, so only a champion trained
      // under that encoding is restorable by the running page.
      liveObservation: 'full',
      liveActions: 'full',
      bundle(model, revision, metadata, existing) {
        const previous = existing as { models?: Record<string, unknown> } | null;
        return {
          version: 1,
          revision,
          publishedAt: metadata.publishedAt,
          manifest: createModelManifest({
            gameId: 'gunship', algorithm: 'tabular-q', modelVersion: 9,
            observationSchemaVersion: 1, rewardSchemaVersion: 1,
          }, { revision, trainingSteps: metadata.trainingSteps, publishedAt: metadata.publishedAt }),
          models: { ...(previous?.models ?? {}), [airframeId]: model },
        };
      },
    },
  };
}

function environmentFor(spec: ExperimentSpec): GunshipEnvironmentSpec {
  return {
    capSeconds: spec.budget.capSeconds,
    density: spec.environment.density ?? DEFAULT_GUNSHIP_ENVIRONMENT.density,
    hp: spec.environment.hp ?? DEFAULT_GUNSHIP_ENVIRONMENT.hp,
    fireRate: spec.environment.fireRate ?? DEFAULT_GUNSHIP_ENVIRONMENT.fireRate,
    maxChasers: spec.environment.maxChasers ?? DEFAULT_GUNSHIP_ENVIRONMENT.maxChasers,
    rewards: { ...DEFAULT_GUNSHIP_ENVIRONMENT.rewards, ...spec.reward.weights },
  };
}

/** The champion by default: today's shipped agent, expressed as a spec. */
export function defaultGunshipSpec(): ExperimentSpec {
  const base = DEFAULT_GUNSHIP_ENVIRONMENT;
  return {
    gameId: 'gunship',
    observation: 'full',
    actions: 'full',
    reward: { mode: 'shaped', weights: { ...base.rewards } },
    environment: { density: base.density, hp: base.hp, fireRate: base.fireRate, maxChasers: base.maxChasers },
    learner: {},
    budget: { episodes: 6000, capSeconds: base.capSeconds, trainSeeds: 64, holdoutSeeds: 32, repeats: 4 },
  };
}

class GunshipSession implements RlExperimentSession {
  private readonly agent: GunshipAgent;
  private readonly environment: GunshipEnvironmentSpec;

  constructor(spec: ExperimentSpec, private readonly airframeId: AirframeId, random?: () => number) {
    this.agent = new GunshipAgent({
      observation: spec.observation as GunshipObservationVariant,
      actions: spec.actions as GunshipActionVariant,
      learner: spec.learner,
      random,
    });
    this.environment = environmentFor(spec);
  }

  train(seed: number): EpisodeOutcome {
    return outcome(runEpisode(this.agent, this.airframeId, this.environment, seed));
  }

  evaluate(seed: number): EpisodeOutcome {
    this.agent.setEvaluationMode(true);
    try {
      return outcome(runEpisode(this.agent, this.airframeId, this.environment, seed));
    } finally {
      this.agent.setEvaluationMode(false);
    }
  }

  serialize(): unknown { return this.agent.serialize(); }

  get trainingSteps(): number { return this.agent.steps; }
  get knownStates(): number { return this.agent.knownStates; }
}

function outcome(result: GunshipEpisodeResult): EpisodeOutcome {
  return {
    seed: result.seed,
    taskReturn: result.taskReturn,
    channels: result.channels,
    terminated: result.terminated,
    truncated: result.truncated,
    values: { kills: result.kills, wave: result.wave, fell: result.fell ? 1 : 0 },
  };
}
