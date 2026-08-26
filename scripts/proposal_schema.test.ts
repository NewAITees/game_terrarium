import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProposals } from './rl/proposal_schema.js';
import { createGunshipAdapter, defaultGunshipSpec } from './rl/gunship_experiment.js';

const space = createGunshipAdapter().searchSpace;
const baseline = defaultGunshipSpec();

test('a valid spec proposal survives the prose a model wraps it in', () => {
  const reply = 'Sure! Here is my idea:\n```json\n'
    + '{"kind":"spec","spec":{"observation":"minimal","reward":{"weights":{"ceiling":0}}},"rationale":"fewer states"}\n'
    + '```\nHope that helps.';
  const { accepted, rejected } = parseProposals(reply, space, baseline);
  assert.deepEqual(rejected, []);
  assert.equal(accepted.length, 1);
  const proposal = accepted[0];
  assert.equal(proposal.kind, 'spec');
  if (proposal.kind !== 'spec') return;
  assert.equal(proposal.spec.observation, 'minimal');
  assert.equal(proposal.spec.learnerVariant, baseline.learnerVariant);
  assert.equal(proposal.spec.reward.weights.ceiling, 0);
  assert.equal(proposal.spec.reward.weights.kill, baseline.reward.weights.kill, 'unmentioned weights keep the champion value');
});

test('a proposal cannot invent a knob, an encoding, or a bigger budget', () => {
  const invented = parseProposals('{"kind":"spec","spec":{"reward":{"weights":{"charisma":5}}}}', space, baseline);
  assert.equal(invented.accepted.length, 0);
  assert.match(invented.rejected[0].reason, /unknown reward weight/);

  const hallucinated = parseProposals('{"kind":"spec","spec":{"observation":"omniscient"}}', space, baseline);
  assert.equal(hallucinated.accepted.length, 0);

  const unknownLearner = parseProposals('{"kind":"spec","spec":{"learnerVariant":"rainbow"}}', space, baseline);
  assert.equal(unknownLearner.accepted.length, 0);

  const greedy = parseProposals('{"kind":"spec","spec":{"budget":{"episodes":999999,"repeats":99,"capSeconds":9,"trainSeeds":1,"holdoutSeeds":1}}}', space, baseline);
  assert.equal(greedy.accepted.length, 1);
  const proposal = greedy.accepted[0];
  assert.equal(proposal.kind, 'spec');
  if (proposal.kind !== 'spec') return;
  assert.deepEqual(proposal.spec.budget, baseline.budget, 'the proposer must not be able to buy itself more evidence');
});

test('extension proposals are captured but stay separate from runnable specs', () => {
  const reply = '{"kind":"extension","target":"OBSERVATION_FIELDS","description":"add a variant with altitude and aim only","rationale":"minimal did best"}';
  const { accepted } = parseProposals(reply, space, baseline);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].kind, 'extension');
});

test('several proposals in one reply are all read', () => {
  const reply = '{"kind":"spec","spec":{"actions":"coarse"}}\nand also\n{"kind":"spec","spec":{"actions":"climb-only"}}';
  const { accepted } = parseProposals(reply, space, baseline);
  assert.equal(accepted.length, 2);
});
