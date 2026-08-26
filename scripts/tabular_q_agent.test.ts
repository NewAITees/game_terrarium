import assert from 'node:assert/strict';
import test from 'node:test';
import { TabularQAgent } from '../shared/rl/tabular_q_agent';

type Observation = {
  state: string;
  blocked?: number;
};

const actions = ['wait', 'advance', 'guard'] as const;

// Every table starts at zero on purpose: hand-authored priors are banned because
// they pin the greedy policy to values the learner cannot out-earn. Preferences in
// these tests are therefore taught, never seeded.
function createAgent(random = () => 0.99, nStep = 1): TabularQAgent<Observation, typeof actions[number]> {
  return new TabularQAgent({
    actions,
    encodeState: (observation) => observation.state,
    allowedActionIndices: (observation) => actions
      .map((_, index) => index === observation.blocked ? -1 : index)
      .filter((index) => index >= 0),
    initialEpsilon: 0,
    minimumEpsilon: 0,
    maximumEpsilon: 0.5,
    epsilonDecay: 1,
    random,
    nStep,
  });
}

// random() === 0.5 makes the exploratory branch pick index 1 ("advance") out of
// three actions, which is how the tests hand it a preference to learn.
function createExplorer(): TabularQAgent<Observation, typeof actions[number]> {
  return new TabularQAgent({
    actions,
    encodeState: (observation) => observation.state,
    allowedActionIndices: (observation) => actions
      .map((_, index) => index === observation.blocked ? -1 : index)
      .filter((index) => index >= 0),
    initialEpsilon: 1,
    minimumEpsilon: 0,
    maximumEpsilon: 1,
    epsilonDecay: 1,
    random: () => 0.5,
  });
}

test('selects the best learned action and respects action masks', () => {
  const agent = createExplorer();
  assert.equal(agent.decide({ state: 'open' }).action, 'advance');
  agent.observe({ state: 'open' }, 5);
  agent.decide({ state: 'next' });

  agent.setEvaluationMode(true);
  const openDecision = agent.decide({ state: 'open' });
  assert.equal(openDecision.action, 'advance');
  assert.equal(openDecision.exploratory, false);

  // Same state key, but the mask removes the action it just learned to prefer.
  assert.equal(agent.decide({ state: 'open', blocked: 1 }).action, 'wait');
});

test('starts every state at zero rather than from an authored prior', () => {
  const agent = createAgent();
  assert.deepEqual([...agent.valuesForState({ state: 'fresh' })], [0, 0, 0]);
});

test('learns rewards across transitions and terminal updates', () => {
  const agent = createAgent();
  agent.decide({ state: 'start' });
  agent.observe({ state: 'next' }, 2);
  agent.decide({ state: 'next' });
  assert.ok(agent.valuesForState({ state: 'start' })[0] > 0);

  const beforeTerminal = agent.valuesForState({ state: 'next' })[0];
  agent.finishEpisode(-4);
  assert.ok(agent.valuesForState({ state: 'next' })[0] < beforeTerminal);
  assert.equal(agent.knownStates, 2);
  assert.equal(agent.trainingSteps, 2);
});

test('round-trips compatible version 1 saves', () => {
  const agent = createAgent();
  agent.decide({ state: 'start' });
  agent.observe({ state: 'next' }, 2);
  agent.decide({ state: 'next' });
  const save = agent.serialize();

  const restored = createAgent();
  restored.restore(save);
  assert.deepEqual(restored.serialize(), save);
  assert.equal(restored.knownStates, agent.knownStates);
});

test('can cap post-episode exploration below the restore ceiling', () => {
  const agent = new TabularQAgent({
    actions,
    encodeState: (observation: Observation) => observation.state,
    initialEpsilon: 0.23,
    minimumEpsilon: 0.03,
    maximumEpsilon: 0.5,
    episodeEpsilonBoost: 0.1,
    episodeMaximumEpsilon: 0.24,
    epsilonDecay: 1,
  });
  agent.decide({ state: 'start' });
  agent.finishEpisode(0);
  assert.equal(agent.epsilon, 0.24);
});

test('evaluation mode acts greedily without changing the model', () => {
  const agent = createAgent(() => 0);
  agent.setEvaluationMode(true);
  const before = agent.serialize();
  const decision = agent.decide({ state: 'evaluation' });
  agent.observe({ state: 'next' }, 20);
  agent.finishEpisode(-20);
  assert.equal(decision.exploratory, false);
  assert.equal(agent.trainingSteps, before.trainingSteps);
  assert.equal(agent.epsilon, before.epsilon);
  assert.deepEqual(agent.serialize(), before);
});

test('three-step return propagates a discounted reward sequence at decision cadence', () => {
  const agent = new TabularQAgent<Observation, string>({
    actions: ['only'],
    encodeState: (observation) => observation.state,
    learningRate: 1,
    discount: 0.5,
    initialEpsilon: 0,
    minimumEpsilon: 0,
    nStep: 3,
  });
  agent.decide({ state: 's0' });
  agent.observe({ state: 's1' }, 1);
  agent.decide({ state: 's1' });
  agent.observe({ state: 's2' }, 2);
  agent.decide({ state: 's2' });
  agent.observe({ state: 's3' }, 3);
  agent.decide({ state: 's3' });
  assert.equal(agent.valuesForState({ state: 's0' })[0], 2.75);
});

test('terminal flush updates every short n-step tail without bootstrapping', () => {
  const agent = new TabularQAgent<Observation, string>({
    actions: ['only'],
    encodeState: (observation) => observation.state,
    learningRate: 1,
    discount: 0.5,
    initialEpsilon: 0,
    minimumEpsilon: 0,
    nStep: 5,
  });
  agent.decide({ state: 's0' });
  agent.observe({ state: 's1' }, 2);
  agent.decide({ state: 's1' });
  agent.observe({ state: 'terminal' }, 4);
  agent.finishEpisode(6);
  assert.equal(agent.valuesForState({ state: 's0' })[0], 7);
  assert.equal(agent.valuesForState({ state: 's1' })[0], 10);
});

test('rejects invalid n-step horizons', () => {
  assert.throws(() => createAgent(() => 0, 0), /nStep/);
  assert.throws(() => createAgent(() => 0, 33), /nStep/);
});

test('rejects an action mask with no valid actions', () => {
  const agent = new TabularQAgent({
    actions,
    encodeState: (observation: Observation) => observation.state,
    allowedActionIndices: () => [],
    initialEpsilon: 0,
  });
  assert.throws(
    () => agent.decide({ state: 'blocked' }),
    /must allow at least one action/,
  );
});
