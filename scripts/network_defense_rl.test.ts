import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NetworkDefenseRlController,
  encodeNetworkDefenseObservation,
  observeNetworkDefense,
} from '../apps/network-defense/network_defense_rl';
import { runNetworkDefenseEpisode } from './network_defense_headless_sim';

function createContext() {
  const server = { id: 'server', isServer: true, hp: 90, maxHp: 120, infection: 0 };
  const hot = { id: 'hot', hp: 55, maxHp: 100, infection: 0.5 };
  const safe = { id: 'safe', hp: 100, maxHp: 100, infection: 0 };
  const game = {
    score: 0,
    elapsed: 0,
    kills: 0,
    wave: 2,
    credits: 200,
    gameOver: false,
    victory: false,
    rankIntents: {},
    waveActions: {},
  };
  const agent = { rank: 'senior' as const, actionKey: '' };
  const executed: string[] = [];
  const context = {
    game,
    topo: { server, nodes: [server, hot, safe] },
    agents: [agent],
    enemyPackets: [{ path: [safe, hot, server], seg: 0 }],
    firewalls: new Map(),
    now: () => 1,
    buildSnapshot: () => ({ serverNeighbors: [hot], now: 1 }),
    executeAction: (_agent: any, action: string) => {
      executed.push(action);
      return true;
    },
  };
  return { agent, context, executed, game, hot, server };
}

test('encodes a compact Network Defense observation', () => {
  const { agent, context } = createContext();
  const observation = observeNetworkDefense(context, agent, context.buildSnapshot());
  assert.equal(observation.rank, 'senior');
  assert.ok(observation.serverThreatBand > 0);
  assert.ok(observation.infectionBand > 0);
  assert.ok(observation.enemyBand > 0);
  assert.equal(encodeNetworkDefenseObservation(observation).split(':').length, 10);
  assert.equal(encodeNetworkDefenseObservation(observation, 'minimal').split(':').length, 6);
});

test('rejects a saved table built for another observation or reward contract', () => {
  const trainedFixture = createContext();
  const trained = new NetworkDefenseRlController(trainedFixture.context);
  trained.assignAgent(trainedFixture.agent);
  const checkpoint = trained.serialize();

  for (const spec of [{ observation: 'minimal' as const }, { rewardMode: 'sparse' as const }]) {
    const fixture = createContext();
    const controller = new NetworkDefenseRlController(fixture.context, spec);
    controller.restore(checkpoint);
    assert.equal(controller.trainingSteps, 0, `${JSON.stringify(spec)} must reject an incompatible table`);
  }
});

test('sparse reward learns only from terminal task outcome', () => {
  const shapedFixture = createContext();
  const shaped = new NetworkDefenseRlController(shapedFixture.context, { rewardMode: 'shaped', random: () => 0.99 });
  shaped.assignAgent(shapedFixture.agent);
  shapedFixture.game.kills += 2;
  shaped.assignAgent(shapedFixture.agent);

  const sparseFixture = createContext();
  const sparse = new NetworkDefenseRlController(sparseFixture.context, { rewardMode: 'sparse', random: () => 0.99 });
  sparse.assignAgent(sparseFixture.agent);
  sparseFixture.game.kills += 2;
  sparse.assignAgent(sparseFixture.agent);

  assert.notDeepEqual(shaped.serialize().policies, sparse.serialize().policies);
  sparse.finishEpisode(true);
  assert.ok(sparse.trainingSteps > 0);
});

test('headless episodes carry the selected observation and reward contract into the model', async () => {
  const result = await runNetworkDefenseEpisode(
    1,
    73,
    2,
    'rl',
    undefined,
    false,
    { observation: 'minimal', rewardMode: 'sparse', random: () => 0.99 },
  );
  assert.equal(result.model?.observation, 'minimal');
  assert.equal(result.model?.rewardMode, 'sparse');
  assert.ok(result.trainingSteps > 0);
});

test('uses the shared learner to assign actions and persist its model', () => {
  const { agent, context, executed, game, server } = createContext();
  const controller = new NetworkDefenseRlController(context);
  controller.assignAgent(agent);
  assert.equal(executed.length, 1);
  assert.ok(controller.trainingSteps >= 1);
  assert.ok(controller.knownStates >= 1);

  game.score += 20;
  game.kills += 1;
  server.hp -= 5;
  controller.assignAgent(agent);
  assert.ok(controller.trainingSteps >= 2);

  const save = controller.serialize();
  const restored = new NetworkDefenseRlController(context);
  restored.restore(save);
  assert.equal(restored.trainingSteps, controller.trainingSteps);
  assert.equal(restored.knownStates, controller.knownStates);
});

test('applies a terminal update only once', () => {
  const { agent, context, game } = createContext();
  const controller = new NetworkDefenseRlController(context);
  controller.assignAgent(agent);
  game.gameOver = true;
  controller.finishEpisode(false);
  const first = controller.serialize();
  controller.finishEpisode(false);
  assert.deepEqual(controller.serialize(), first);
  assert.equal(controller.finished, true);
});

test('keeps the Player controller inference-only in evaluation mode', () => {
  const trainedFixture = createContext();
  const trained = new NetworkDefenseRlController(trainedFixture.context);
  trained.assignAgent(trainedFixture.agent);
  const checkpoint = trained.serialize();

  const playerFixture = createContext();
  const player = new NetworkDefenseRlController(playerFixture.context);
  player.restore(checkpoint);
  player.setEvaluationMode(true);
  const before = player.serialize();
  player.assignAgent(playerFixture.agent);
  playerFixture.game.gameOver = true;
  player.finishEpisode(false);

  assert.deepEqual(player.serialize(), before);
  assert.equal(player.decision?.exploratory, false);
});
