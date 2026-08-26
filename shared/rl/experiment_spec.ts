import type { RewardBreakdown, RewardMode } from './runtime_types.js';

/**
 * The one description of "an experiment" that every game shares.
 *
 * An automated search is only ever as wide as the knobs a game exposes, so the search space is
 * declared by the game itself (`RlSearchSpace`) rather than hard-coded into the searcher. The
 * searcher stays ignorant of what a gunship or a colony is; it reads the declaration, proposes
 * specs, and compares them on the task outcome alone.
 *
 * Two rules are enforced structurally rather than by convention, because both have already gone
 * wrong here once:
 *
 *  - **Reward weights can be tuned, but never scored.** Every weight in `reward` is a knob the
 *    experiment itself may have turned, so `EpisodeOutcome.taskReturn` — which no knob can reach —
 *    is the only thing a champion comparison is allowed to read.
 *  - **A spec change is a model change.** Varying the observation or the action set alters the
 *    Q-table's key shape or its width, so a table trained under one spec is not merely stale under
 *    another, it is wrong. `specHash` is what keeps their stored models apart.
 */

export type LearnerSpec = {
  learningRate: number;
  discount: number;
  initialEpsilon: number;
  minimumEpsilon: number;
  maximumEpsilon: number;
  epsilonDecay: number;
  episodeEpsilonBoost: number;
  episodeMaximumEpsilon: number;
  terminalBlame: number;
  maximumStates: number;
};

export type BudgetSpec = {
  episodes: number;
  capSeconds: number;
  trainSeeds: number;
  holdoutSeeds: number;
  /** Independent agents averaged per spec. One agent's curve is noise. */
  repeats: number;
};

export type ExperimentSpec = {
  gameId: string;
  /** Structural learning algorithm; unlike numeric learner settings this changes update semantics. */
  learnerVariant: string;
  /** Named observation encoding — decides the Q-table's key shape. */
  observation: string;
  /** Named action set — decides the Q-table's width. */
  actions: string;
  reward: { mode: RewardMode; weights: Readonly<Record<string, number>> };
  /** Environment difficulty knobs. Named per game via `RlSearchSpace.environment`. */
  environment: Readonly<Record<string, number>>;
  learner: Partial<LearnerSpec>;
  budget: BudgetSpec;
  /**
   * Diagnostic runs answer "why is this failing" by means a shipped agent may not use —
   * demonstrations, privileged state, a hand-held curriculum. They are legitimate experiments and
   * illegitimate champions, so the searcher must never promote one. See the no-hand-authored-policy
   * rule in CLAUDE.md: a prior that looks like competence is what prevents competence.
   */
  diagnostic?: boolean;
};

/** What a game lets an experiment vary. The searcher proposes nothing outside this. */
export type RlSearchSpace = {
  gameId: string;
  learnerVariants: readonly string[];
  observations: readonly string[];
  actions: readonly string[];
  /** Reward formulations this game can execute (for example sparse versus shaped). */
  rewardModes: readonly RewardMode[];
  /** Tunable shaping/reward weight keys. */
  rewardWeights: readonly string[];
  /** Tunable environment keys, with the range the searcher may sample from. */
  environment: Readonly<Record<string, { min: number; max: number }>>;
};

export type EpisodeOutcome = {
  seed: number;
  /** The score. No weight, no knob — nothing an experiment can turn up. */
  taskReturn: number;
  /** What the learner was paid, by channel. Diagnostic only; never a promotion criterion. */
  channels: RewardBreakdown;
  terminated: boolean;
  truncated: boolean;
  values: Record<string, number>;
};

export interface RlExperimentSession {
  /**
   * The trained model, in whatever shape the game's own agent restores.
   *
   * A ledger row records what a configuration scored; without the model that produced it, acting on
   * a champion means retraining and hoping to land in the same place. The searcher stores this
   * beside the row so the winning agent is the thing that ships, not a recipe for one.
   */
  serialize(): unknown;
  /** One learning episode on a training seed. */
  train(seed: number): EpisodeOutcome;
  /** One greedy episode on a hold-out seed, with learning and exploration off. */
  evaluate(seed: number): EpisodeOutcome;
  readonly trainingSteps: number;
  readonly knownStates: number;
}

export interface RlGameAdapter {
  readonly searchSpace: RlSearchSpace;
  /** The champion-by-default: what the game ships with today. */
  defaultSpec(): ExperimentSpec;
  /**
   * `random` is the exploration stream. It is supplied by the caller rather than taken from
   * `Math.random` so that a ledger row can be replayed exactly, which is the difference between a
   * result that can be audited and one that has to be taken on trust.
   */
  createSession(spec: ExperimentSpec, random?: () => number): RlExperimentSession;
  /**
   * A fingerprint of the world a seed produces, sampled without a learned policy.
   *
   * The contract needs to know that hold-out seeds describe different episodes, and it cannot learn
   * that by running a policy: an untrained agent flies into the sea in five seconds without meeting
   * an enemy, so identical outcomes prove nothing about the environment. Each game answers in
   * whatever way suits it — an opening layout where the seed shapes one, a short fixed-action
   * rollout where the seed only shows up in what spawns — as long as no learned behaviour is
   * involved. Build it from the same code the real episode uses, or the check will keep passing
   * after the real environment has stopped varying.
   */
  environmentFingerprint(spec: ExperimentSpec, seed: number): string;
  /**
   * How a champion reaches the running game, when the game has a live player at all.
   *
   * `stem` is the model file the player reads. `bundle` wraps a trained model in whatever envelope
   * that file expects. Publication is refused when the champion's observation or action variant is
   * not the one the live player constructs — the player would reject the table and fall back to an
   * untrained agent, which looks like a bad champion rather than a mismatched one.
   */
  readonly livePublication?: {
    stem: string;
    liveLearnerVariant: string;
    liveObservation: string;
    liveActions: string;
    bundle(
      model: unknown,
      revision: number,
      metadata: { publishedAt: string; trainingSteps: number },
      existing: unknown,
    ): unknown;
  };
}

export function validateSpec(spec: ExperimentSpec, space: RlSearchSpace): void {
  if (spec.gameId !== space.gameId) throw new Error(`spec is for ${spec.gameId}, search space is for ${space.gameId}`);
  if (!space.learnerVariants.includes(spec.learnerVariant)) {
    throw new Error(`unknown learner variant '${spec.learnerVariant}' (have: ${space.learnerVariants.join(', ')})`);
  }
  if (!space.observations.includes(spec.observation)) {
    throw new Error(`unknown observation variant '${spec.observation}' (have: ${space.observations.join(', ')})`);
  }
  if (!space.actions.includes(spec.actions)) {
    throw new Error(`unknown action variant '${spec.actions}' (have: ${space.actions.join(', ')})`);
  }
  if (!space.rewardModes.includes(spec.reward.mode)) {
    throw new Error(`unknown reward mode '${spec.reward.mode}' (have: ${space.rewardModes.join(', ')})`);
  }
  for (const key of Object.keys(spec.reward.weights)) {
    if (!space.rewardWeights.includes(key)) throw new Error(`unknown reward weight '${key}'`);
  }
  for (const [key, value] of Object.entries(spec.environment)) {
    const range = space.environment[key];
    if (!range) throw new Error(`unknown environment knob '${key}'`);
    if (value < range.min || value > range.max) {
      throw new Error(`environment knob '${key}' = ${value} is outside [${range.min}, ${range.max}]`);
    }
  }
  for (const [key, value] of Object.entries(spec.reward.weights)) {
    if (!Number.isFinite(value)) throw new Error(`reward weight '${key}' must be finite`);
  }
  if (spec.budget.episodes < 1 || spec.budget.repeats < 1) throw new Error('budget needs at least one episode and one repeat');
}

/**
 * A stable fingerprint of everything that makes two runs incomparable. Budget is excluded on
 * purpose: the same spec trained longer is the *same* spec with more evidence behind it, which is
 * exactly the case a searcher must be able to recognise instead of discarding as a late bloomer.
 */
export function specHash(spec: ExperimentSpec): string {
  const canonical = canonicalize({
    gameId: spec.gameId,
    learnerVariant: spec.learnerVariant,
    observation: spec.observation,
    actions: spec.actions,
    reward: spec.reward,
    environment: spec.environment,
    learner: spec.learner,
    // Episode count/repeats add evidence. The cap changes the task itself: surviving 60 seconds is
    // not the same experiment as surviving 120 seconds and must never reuse its ledger identity.
    capSeconds: spec.budget.capSeconds,
    diagnostic: spec.diagnostic ?? false,
  });
  // FNV-1a: dependency-free and identical in Node and the browser, which `node:crypto` is not.
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function sameEnvironment(left: ExperimentSpec, right: ExperimentSpec): boolean {
  return canonicalize(left.environment) === canonicalize(right.environment)
    && left.budget.capSeconds === right.budget.capSeconds;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}
