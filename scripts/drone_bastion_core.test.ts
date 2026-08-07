import assert from 'node:assert/strict';
import test from 'node:test';
import { DroneBastionAgent } from '../apps/drone-bastion/drone_bastion_agent';
import {
  applyBastionUpgrade,
  createDroneBastionState,
  observeDroneBastion,
  stepDroneBastion,
  type DroneAction,
} from '../apps/drone-bastion/drone_bastion_core';

const coast: DroneAction = {
  label: 'test',
  thrust: 0,
  turn: 0,
  brake: false,
  fire: false,
  switch: 0,
};

test('creates a central tower, wall ring, and three starter chess drones', () => {
  const state = createDroneBastionState(1200, 760, 42);
  assert.equal(state.tower.x, 600);
  assert.equal(state.tower.y, 380);
  assert.equal(state.drones.length, 3);
  assert.deepEqual(
    state.drones.map((drone) => drone.kind),
    ['pawn', 'rook', 'bishop'],
  );
  assert.equal(state.walls.length, 16);
  assert.equal(state.drones[state.selectedDrone].mode, 'controlled');
});

test('switching control makes the previous drone brake and become a turret', () => {
  const state = createDroneBastionState(1200, 760, 9);
  const previous = state.drones[0];
  previous.vx = 30;
  stepDroneBastion(state, { ...coast, switch: 1 }, 0.05);
  assert.equal(state.selectedDrone, 1);
  assert.equal(previous.mode, 'braking');
  for (let index = 0; index < 30; index += 1) stepDroneBastion(state, coast, 0.05);
  assert.equal(previous.mode, 'turret');
  assert.ok(Math.hypot(previous.vx, previous.vy) < 0.001);
});

test('the heavy Rook accelerates and brakes more slowly than the Pawn', () => {
  const pawnState = createDroneBastionState(1200, 760, 3);
  const rookState = createDroneBastionState(1200, 760, 3);
  rookState.drones[0].mode = 'braking';
  rookState.selectedDrone = 1;
  rookState.drones[1].mode = 'controlled';
  const thrust: DroneAction = { ...coast, thrust: 1 };
  for (let index = 0; index < 20; index += 1) {
    stepDroneBastion(pawnState, thrust, 0.05);
    stepDroneBastion(rookState, thrust, 0.05);
  }
  const pawnSpeed = Math.hypot(pawnState.drones[0].vx, pawnState.drones[0].vy);
  const rookSpeed = Math.hypot(rookState.drones[1].vx, rookState.drones[1].vy);
  assert.ok(pawnSpeed > rookSpeed * 1.5);

  for (let index = 0; index < 10; index += 1) {
    stepDroneBastion(pawnState, { ...coast, brake: true }, 0.05);
    stepDroneBastion(rookState, { ...coast, brake: true }, 0.05);
  }
  assert.ok(
    Math.hypot(rookState.drones[1].vx, rookState.drones[1].vy)
      > Math.hypot(pawnState.drones[0].vx, pawnState.drones[0].vy),
  );
});

test('tank tracks suppress lateral sliding while helicopters retain drift', () => {
  const heliState = createDroneBastionState(1200, 760, 14);
  const tankState = createDroneBastionState(1200, 760, 14);
  tankState.drones[0].mode = 'braking';
  tankState.selectedDrone = 1;
  tankState.drones[1].mode = 'controlled';
  heliState.drones[0].angle = 0;
  tankState.drones[1].angle = 0;
  heliState.drones[0].vy = 80;
  tankState.drones[1].vy = 80;
  stepDroneBastion(heliState, coast, 0.05);
  stepDroneBastion(tankState, coast, 0.05);
  assert.ok(Math.abs(heliState.drones[0].vy) > Math.abs(tankState.drones[1].vy) * 1.5);
});

test('the Queen has slower throttle response than the Bishop robot', () => {
  const bishopState = createDroneBastionState(1200, 760, 21);
  const queenState = createDroneBastionState(1200, 760, 21);
  queenState.pendingUpgrade = true;
  applyBastionUpgrade(queenState, 'deploy');
  queenState.pendingUpgrade = true;
  applyBastionUpgrade(queenState, 'deploy');
  bishopState.drones[0].mode = 'braking';
  bishopState.selectedDrone = 2;
  bishopState.drones[2].mode = 'controlled';
  queenState.drones[0].mode = 'braking';
  queenState.selectedDrone = 4;
  queenState.drones[4].mode = 'controlled';
  const thrust: DroneAction = { ...coast, thrust: 1 };
  stepDroneBastion(bishopState, thrust, 0.1);
  stepDroneBastion(queenState, thrust, 0.1);
  assert.ok(bishopState.drones[2].throttle > queenState.drones[4].throttle * 3);
});

test('fleet deployment is capped at six drones', () => {
  const state = createDroneBastionState(1200, 760, 5);
  for (let index = 0; index < 10; index += 1) {
    state.pendingUpgrade = true;
    applyBastionUpgrade(state, 'deploy');
  }
  assert.equal(state.drones.length, 6);
  assert.equal(observeDroneBastion(state).droneCountBand, 4);
});

test('the five chess frames expose five distinct weapon patterns', () => {
  const patterns = new Set<string>();
  const fleet = createDroneBastionState(1200, 760, 30);
  fleet.pendingUpgrade = true;
  applyBastionUpgrade(fleet, 'deploy');
  fleet.pendingUpgrade = true;
  applyBastionUpgrade(fleet, 'deploy');
  assert.deepEqual(
    fleet.drones.map((drone) => drone.kind),
    ['pawn', 'rook', 'bishop', 'knight', 'queen'],
  );
  for (let selected = 0; selected < 5; selected += 1) {
    const state = createDroneBastionState(1200, 760, 30 + selected);
    state.pendingUpgrade = true;
    applyBastionUpgrade(state, 'deploy');
    state.pendingUpgrade = true;
    applyBastionUpgrade(state, 'deploy');
    for (let index = 0; index < state.drones.length; index += 1) {
      state.drones[index].mode = index === selected ? 'controlled' : 'disabled';
    }
    state.selectedDrone = selected;
    const drone = state.drones[selected];
    drone.angle = 0;
    state.enemies.push({
      id: 999,
      x: drone.x + 120,
      y: drone.y,
      vx: 0,
      vy: 0,
      hp: 1000,
      maxHp: 1000,
      radius: 9,
      speed: 0,
      damage: 0,
      attackCooldown: 10,
      kind: 'swarm',
    });
    stepDroneBastion(state, { ...coast, fire: true }, 0.01);
    for (const projectile of state.projectiles) patterns.add(projectile.kind);
    for (const effect of state.effects) patterns.add(effect.kind);
  }
  assert.deepEqual(
    [...patterns].sort(),
    ['arc', 'missile', 'mortar', 'pierce', 'ricochet'],
  );
});

test('the Rook mortar cannot lock targets inside its minimum range', () => {
  const state = createDroneBastionState(1200, 760, 61);
  state.drones[0].mode = 'braking';
  state.selectedDrone = 1;
  const rook = state.drones[1];
  rook.mode = 'controlled';
  rook.angle = 0;
  state.enemies.push({
    id: 999,
    x: rook.x + 60,
    y: rook.y,
    vx: 0,
    vy: 0,
    hp: 100,
    maxHp: 100,
    radius: 9,
    speed: 0,
    damage: 0,
    attackCooldown: 10,
    kind: 'swarm',
  });
  stepDroneBastion(state, { ...coast, fire: true }, 0.01);
  assert.equal(state.projectiles[0]?.kind, 'mortar');
  assert.equal(state.projectiles[0]?.targetEnemyId, null);
  assert.ok(Math.hypot(
    state.projectiles[0].targetX - rook.x,
    state.projectiles[0].targetY - rook.y,
  ) > 105);
});

test('a destroyed chess drone returns at full HP after its respawn timer', () => {
  const state = createDroneBastionState(1200, 760, 73);
  const pawn = state.drones[0];
  pawn.mode = 'disabled';
  pawn.hp = 0;
  pawn.respawnRemaining = 0.08;
  state.selectedDrone = 1;
  state.drones[1].mode = 'controlled';
  stepDroneBastion(state, coast, 0.1);
  assert.notEqual(pawn.mode, 'disabled');
  assert.equal(pawn.hp, pawn.maxHp);
  assert.equal(pawn.respawnRemaining, 0);
});

test('dense observation stays fixed at 96 normalized values with a large enemy crowd', () => {
  const state = createDroneBastionState(1200, 760, 88);
  state.wave = 40;
  state.waveRemaining = 220;
  state.spawnTimer = 0;
  for (let index = 0; index < 2200; index += 1) {
    stepDroneBastion(state, coast, 0.05);
    if (state.gameOver) break;
  }
  const observation = observeDroneBastion(state);
  assert.equal(observation.dense.length, 96);
  assert.ok(observation.dense.every(Number.isFinite));
  assert.ok(observation.dense.every((value) => value >= -1 && value <= 1.5));
});

test('a fixed seed and action sequence produces the same simulation', () => {
  const first = createDroneBastionState(800, 600, 123);
  const second = createDroneBastionState(800, 600, 123);
  for (let index = 0; index < 300; index += 1) {
    stepDroneBastion(first, coast, 0.05);
    stepDroneBastion(second, coast, 0.05);
  }
  assert.deepEqual(first, second);
});

test('evaluation playback cannot mutate the Drone Bastion model', () => {
  const state = createDroneBastionState(800, 600, 321);
  const agent = new DroneBastionAgent();
  agent.setEvaluationMode(true);
  const before = agent.serialize();
  const decision = agent.decide(observeDroneBastion(state), 0.2, 5);
  stepDroneBastion(state, decision.action, 0.2);
  agent.chooseUpgrade(state);
  agent.finishEpisode(-30);
  assert.deepEqual(agent.serialize(), before);
});
