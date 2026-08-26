import { createSeedPlan, holdoutSeed, isHoldoutSeed, trainingSeed } from '../../shared/rl/seed_plan.js';
import { mulberry32 } from '../../shared/rl/random.js';
import { specHash, validateSpec, type ExperimentSpec, type RlGameAdapter } from '../../shared/rl/experiment_spec.js';
import { compareSeal } from './protected_surface.js';

/**
 * The invariants that make an unattended search trustworthy, and the boundary that says who may
 * change what.
 *
 * The search is meant to be extended from outside — by a person, or by a model reading the ledger
 * and proposing a new observation encoding. That is only safe if the extension surface is small,
 * explicit, and if everything the *scoring* depends on is verified before any result is written.
 * `verifyContract` runs at the start of every search, and a violation stops the run rather than
 * producing a ledger full of results that quietly mean nothing.
 */

/**
 * Where new hypotheses go. Editing these widens what the search can reach, and the contract check
 * below is what proves the widening did not break the comparison.
 */
export const EXTENSION_SURFACE = [
  { file: 'apps/gunship/gunship_rl.ts', change: 'add an entry to OBSERVATION_FIELDS or ACTION_SETS, and list it in GUNSHIP_OBSERVATIONS / GUNSHIP_ACTION_SETS' },
  { file: 'apps/gunship/gunship_core.ts', change: 'add a shaping term to an existing RewardBreakdown channel' },
  { file: 'scripts/rl/gunship_experiment.ts', change: 'declare the new variant or reward weight in GUNSHIP_SEARCH_SPACE' },
  { file: 'scripts/rl/candidate_sampler.ts', change: 'change how candidates are proposed' },
] as const;

/**
 * What a hypothesis may never touch. Every item here is load-bearing for the claim "this
 * configuration is better": change any of it and past ledger rows stop being comparable with new
 * ones, which is worse than a wrong result because it is invisible.
 */
export const PROTECTED_SURFACE = [
  // Listed here for readers; enforced by content hash in protected_surface.ts, because a list is
  // documentation and an unattended loop cannot read documentation.
  { file: 'shared/rl/seed_plan.ts', why: 'the train/hold-out split is the only defence against a search scoring itself on its own training episodes' },
  { file: 'scripts/rl/research_stats.ts', why: 'weakening the promotion test lets noise ratchet the champion upward' },
  { file: 'scripts/rl/research_ledger.ts', why: 'the ledger is append-only and is the sole record a champion can be recomputed from' },
  { file: 'scripts/rl/research_runner.ts', why: 'it enforces train-on-training-seeds, score-on-hold-out-seeds ordering' },
  { term: 'EpisodeOutcome.taskReturn', why: 'the score must stay unreachable from any tunable weight' },
] as const;

export type ContractViolation = { check: string; detail: string };

export function verifyContract(adapter: RlGameAdapter): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const fail = (check: string, detail: string): void => { violations.push({ check, detail }); };
  const spec = adapter.defaultSpec();

  // The rules the comparison rests on must be the rules the ledger's existing rows were measured
  // under. A silent edit here would not change any output — it would change what every number means.
  try {
    const { sealed, drift } = compareSeal();
    if (!sealed) {
      fail('protected-surface', 'no seal on record for the protected files; run `npm run research:seal` to record one');
    }
    for (const entry of drift) {
      fail('protected-surface', `${entry.file} has changed since the ledger's rows were measured`
        + ` (sealed ${entry.expected}, now ${entry.actual}); re-read the change, then run \`npm run research:seal\` to accept it`);
    }
  } catch (error) {
    fail('protected-surface', message(error));
  }

  try {
    validateSpec(spec, adapter.searchSpace);
  } catch (error) {
    fail('default-spec-valid', `the game's own default spec is outside its declared search space: ${message(error)}`);
  }

  // Seeds: the split has to hold for the exact plan this spec will run under.
  const seeds = createSeedPlan(spec.budget.trainSeeds, spec.budget.holdoutSeeds);
  const training = new Set(Array.from({ length: spec.budget.trainSeeds * 2 }, (_, index) => trainingSeed(seeds, index)));
  for (let index = 0; index < spec.budget.holdoutSeeds; index += 1) {
    const seed = holdoutSeed(seeds, index);
    if (training.has(seed)) fail('seed-split', `hold-out seed ${seed} also appears in the training range`);
    if (!isHoldoutSeed(seed)) fail('seed-split', `seed ${seed} is evaluated but is not in the hold-out range`);
  }

  // Inspect the pre-policy world directly. Episode outcomes are a bad proxy: an untrained policy
  // can crash at the same time in several genuinely different worlds without ever meeting them.
  try {
    const fingerprints = [0, 1, 2, 3].map((index) => adapter.environmentFingerprint(spec, holdoutSeed(seeds, index)));
    if (new Set(fingerprints).size === 1) {
      fail('seed-reaches-environment', 'four different seeds produced the identical initial world;'
        + ' the seed is not varying the environment, so hold-out evaluation measures nothing');
    }
  } catch (error) {
    fail('seed-reaches-environment', message(error));
  }

  // Every declared variant must actually run. An outside contributor adding a name to the search
  // space without wiring it up would otherwise show up as a mysteriously weak configuration.
  const probe: ExperimentSpec = { ...spec, budget: { ...spec.budget, capSeconds: 3, episodes: 1, repeats: 1 } };
  for (const learnerVariant of adapter.searchSpace.learnerVariants) {
    for (const observation of adapter.searchSpace.observations) {
      for (const actions of adapter.searchSpace.actions) {
        const label = `${learnerVariant}/${observation}/${actions}`;
        try {
          const session = adapter.createSession({ ...probe, learnerVariant, observation, actions }, mulberry32(1));
          const outcome = session.train(trainingSeed(seeds, 0));
          if (!Number.isFinite(outcome.taskReturn)) fail('variant-runs', `${label} produced a non-finite task return`);
        } catch (error) {
          fail('variant-runs', `${label} is declared but does not run: ${message(error)}`);
        }
      }
    }
  }

  // The score must not move when only the pay moves. Evaluation is greedy and does not learn, so
  // the same seed under wildly different reward weights must produce the identical episode.
  try {
    const cheap = adapter.createSession(zeroReward(probe), mulberry32(7));
    const rich = adapter.createSession(inflatedReward(probe, adapter), mulberry32(7));
    const seed = holdoutSeed(seeds, 0);
    const left = cheap.evaluate(seed).taskReturn;
    const right = rich.evaluate(seed).taskReturn;
    if (left !== right) {
      fail('score-independent-of-reward', `the same greedy episode scored ${left} and ${right} under different reward weights;`
        + ' task return has become reachable from a tunable weight');
    }
  } catch (error) {
    fail('score-independent-of-reward', message(error));
  }

  // Identity: more budget is the same experiment, a different encoding is not.
  if (specHash({ ...spec, budget: { ...spec.budget, episodes: spec.budget.episodes * 3 } }) !== specHash(spec)) {
    fail('spec-identity', 'a larger budget changed the spec hash, so a late bloomer would be filed as a new experiment');
  }
  for (const observation of adapter.searchSpace.observations) {
    if (observation === spec.observation) continue;
    if (specHash({ ...spec, observation }) === specHash(spec)) {
      fail('spec-identity', `observation '${observation}' collides with '${spec.observation}', so their models would share a file`);
    }
  }
  for (const learnerVariant of adapter.searchSpace.learnerVariants) {
    if (learnerVariant === spec.learnerVariant) continue;
    if (specHash({ ...spec, learnerVariant }) === specHash(spec)) {
      fail('spec-identity', `learner '${learnerVariant}' collides with '${spec.learnerVariant}', so their models would share a file`);
    }
  }

  return violations;
}

function zeroReward(spec: ExperimentSpec): ExperimentSpec {
  const weights = Object.fromEntries(Object.keys(spec.reward.weights).map((key) => [key, 0]));
  return { ...spec, reward: { mode: spec.reward.mode, weights } };
}

function inflatedReward(spec: ExperimentSpec, adapter: RlGameAdapter): ExperimentSpec {
  const weights = Object.fromEntries(adapter.searchSpace.rewardWeights.map((key, index) => [key, (index + 1) * 37]));
  return { ...spec, reward: { mode: spec.reward.mode, weights } };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
