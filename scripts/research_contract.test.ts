import assert from 'node:assert/strict';
import test from 'node:test';
import { specHash } from '../shared/rl/experiment_spec.js';
import { verifyContract } from './rl/research_contract.js';
import { createGunshipAdapter, defaultGunshipSpec } from './rl/gunship_experiment.js';
import { proposeCandidate } from './rl/candidate_sampler.js';
import { mulberry32 } from '../shared/rl/random.js';
import { beats, describe } from './rl/research_stats.js';

test('the shipped gunship configuration satisfies the research contract', () => {
  assert.deepEqual(verifyContract(createGunshipAdapter()), []);
});

test('the contract rejects a search space that declares a variant it cannot run', () => {
  const adapter = createGunshipAdapter();
  const broken = {
    ...adapter,
    searchSpace: { ...adapter.searchSpace, observations: [...adapter.searchSpace.observations, 'clairvoyance'] },
  };
  const violations = verifyContract(broken);
  assert.ok(violations.some((violation) => violation.check === 'variant-runs'), JSON.stringify(violations));
});

test('proposed candidates always stay inside the declared search space', () => {
  const adapter = createGunshipAdapter();
  const random = mulberry32(11);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = proposeCandidate(defaultGunshipSpec(), adapter.searchSpace, random, { exploreEnvironment: true });
    // createSession validates; a proposal outside the space must throw rather than run.
    adapter.createSession(candidate, random);
    assert.ok(adapter.searchSpace.observations.includes(candidate.observation));
    assert.ok(adapter.searchSpace.actions.includes(candidate.actions));
  }
});

test('the sampler can reach zero for a reward weight, so "this channel was unnecessary" is sayable', () => {
  const adapter = createGunshipAdapter();
  const random = mulberry32(3);
  let sawZero = false;
  for (let attempt = 0; attempt < 400 && !sawZero; attempt += 1) {
    const candidate = proposeCandidate(defaultGunshipSpec(), adapter.searchSpace, random, {});
    sawZero = Object.values(candidate.reward.weights).some((weight) => weight === 0);
  }
  assert.equal(sawZero, true);
});

test('promotion needs separation, not a higher point estimate', () => {
  const champion = describe(Array.from({ length: 40 }, (_, index) => 10 + (index % 5)));
  const noisyTie = describe(Array.from({ length: 40 }, (_, index) => (index % 2 ? 2 : 22)));
  const clearlyBetter = describe(Array.from({ length: 40 }, (_, index) => 30 + (index % 5)));
  assert.equal(beats(noisyTie, champion), false, 'a wide sample that merely looks higher must not take the crown');
  assert.equal(beats(clearlyBetter, champion), true);
  assert.equal(beats(champion, champion), false, 'a tie goes to the incumbent');
});

test('a resumed search recognises work it has already done', () => {
  const spec = defaultGunshipSpec();
  const cheaper = { ...spec, budget: { ...spec.budget, episodes: 100 } };
  assert.equal(specHash(cheaper), specHash(spec), 'budget is not identity');
});
