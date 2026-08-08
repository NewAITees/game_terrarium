import assert from 'node:assert/strict';
import test from 'node:test';
import { GunshipAgent } from '../apps/gunship/gunship_rl.js';
import { specHash, validateSpec } from '../shared/rl/experiment_spec.js';
import { createGunshipAdapter, defaultGunshipSpec, GUNSHIP_SEARCH_SPACE } from './rl/gunship_experiment.js';

test('the default spec is inside the search space the game declares', () => {
  validateSpec(defaultGunshipSpec(), GUNSHIP_SEARCH_SPACE);
});

test('a spec outside the declared space is rejected rather than silently run', () => {
  const space = GUNSHIP_SEARCH_SPACE;
  assert.throws(() => validateSpec({ ...defaultGunshipSpec(), observation: 'telepathy' }, space), /unknown observation/);
  assert.throws(() => validateSpec({ ...defaultGunshipSpec(), actions: 'teleport' }, space), /unknown action/);
  const spec = defaultGunshipSpec();
  assert.throws(() => validateSpec({ ...spec, environment: { ...spec.environment, density: 99 } }, space), /outside/);
  assert.throws(() => validateSpec({ ...spec, environment: { ...spec.environment, gravity: 1 } }, space), /unknown environment knob/);
  assert.throws(() => validateSpec({ ...spec, reward: { mode: 'shaped', weights: { charisma: 1 } } }, space), /unknown reward weight/);
});

test('spec hash separates incompatible models but not the same spec trained longer', () => {
  const spec = defaultGunshipSpec();
  const longer = { ...spec, budget: { ...spec.budget, episodes: spec.budget.episodes * 10 } };
  assert.equal(specHash(longer), specHash(spec), 'more evidence for the same spec must not look like a different spec');
  assert.notEqual(specHash({ ...spec, budget: { ...spec.budget, capSeconds: spec.budget.capSeconds / 2 } }), specHash(spec));
  assert.notEqual(specHash({ ...spec, observation: 'minimal' }), specHash(spec));
  assert.notEqual(specHash({ ...spec, actions: 'coarse' }), specHash(spec));
  assert.notEqual(specHash({ ...spec, diagnostic: true }), specHash(spec));
  assert.notEqual(specHash({ ...spec, reward: { mode: 'shaped', weights: { ...spec.reward.weights, kill: 2 } } }), specHash(spec));
  // Key order is an artefact of how a spec was assembled, not a difference between experiments.
  const reordered = { ...spec, reward: { mode: 'shaped' as const, weights: Object.fromEntries(Object.entries(spec.reward.weights).reverse()) } };
  assert.equal(specHash(reordered), specHash(spec));
});

test('a model never restores into an agent whose table has a different shape', () => {
  const trained = new GunshipAgent({ observation: 'full', actions: 'full' });
  trained.finishEpisode(-16);
  const save = trained.serialize();

  const sameSpec = new GunshipAgent({ observation: 'full', actions: 'full' });
  sameSpec.restore(save);
  assert.equal(sameSpec.episodes, trained.episodes);

  for (const mismatch of [{ observation: 'minimal' as const }, { actions: 'coarse' as const }]) {
    const other = new GunshipAgent(mismatch);
    other.restore(save);
    assert.equal(other.episodes, 0, `${JSON.stringify(mismatch)} must reject a table built under another spec`);
  }
});

test('a session runs episodes and keeps hold-out evaluation out of the training model', () => {
  const session = createGunshipAdapter().createSession({ ...defaultGunshipSpec(), budget: { ...defaultGunshipSpec().budget, capSeconds: 4 } });
  const trained = session.train(7);
  assert.ok(trained.taskReturn > 0);
  assert.equal(trained.terminated || trained.truncated, true);
  const stepsAfterTraining = session.trainingSteps;
  session.evaluate(1_000_000);
  assert.equal(session.trainingSteps, stepsAfterTraining, 'evaluation must not train the model it is scoring');
});
