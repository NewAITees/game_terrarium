import assert from 'node:assert/strict';
import test from 'node:test';
import { TabularQAgent } from '../shared/rl/tabular_q_agent';

type Observation = {
  state: string;
  blocked?: number;
};

const actions = ['wait', 'advance', 'guard'] as const;

function createAgent(random = () => 0.99): TabularQAgent<Observation, typeof actions[number]> {
  return new TabularQAgent({
    actions,
    encodeState: (observation) => observation.state,
    allowedActionIndices: (observation) => actions
      .map((_, index) => index === observation.blocked ? -1 : index)
      .filter((index) => index >= 0),
    initialValues: (_observation, actionCount) => {
      const values = Array<number>(actionCount).fill(0);
      values[1] = 1;
      return values;
    },
    initialEpsilon: 0,
    minimumEpsilon: 0,
    maximumEpsilon: 0.5,
    epsilonDecay: 1,
    random,
  });
}

test('selects the best seeded action and respects action masks', () => {
  const agent = createAgent();
  const openDecision = agent.decide({ state: 'open' });
  assert.equal(openDecision.action, 'advance');
  assert.equal(openDecision.exploratory, false);

  agent.finishEpisode(0);
  const blockedDecision = agent.decide({ state: 'blocked', blocked: 1 });
  assert.equal(blockedDecision.action, 'wait');
});

test('learns rewards across transitions and terminal updates', () => {
  const agent = createAgent();
  agent.decide({ state: 'start' });
  agent.observe({ state: 'next' }, 2);
  assert.ok(agent.valuesForState({ state: 'start' })[1] > 1);

  const beforeTerminal = agent.valuesForState({ state: 'start' })[1];
  agent.finishEpisode(-4);
  assert.ok(agent.valuesForState({ state: 'start' })[1] < beforeTerminal);
  assert.equal(agent.knownStates, 2);
  assert.equal(agent.trainingSteps, 1);
});

test('round-trips compatible version 1 saves', () => {
  const agent = createAgent();
  agent.decide({ state: 'start' });
  agent.observe({ state: 'next' }, 2);
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
  assert.equal(decision.action, 'advance');
  assert.equal(decision.exploratory, false);
  assert.equal(agent.trainingSteps, before.trainingSteps);
  assert.equal(agent.epsilon, before.epsilon);
  assert.deepEqual(agent.serialize(), before);
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
