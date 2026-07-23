import assert from 'node:assert/strict';
import { QLearningAgent } from '../apps/arena-shooter/arena_shooter_agent';
import {
  ACTIONS,
  createArenaState,
  getArenaCamera,
  isActionAllowed,
  observeArena,
  resetEpisode,
  resizeArena,
  setCraftPreference,
  stepArena,
} from '../apps/arena-shooter/arena_shooter_core';
import {
  addKillProgress,
  applyUpgrade,
  createRunProgress,
  getUpgradeChoices,
} from '../apps/arena-shooter/arena_shooter_progression';

const state = createArenaState(960, 540);
const agent = new QLearningAgent();
const run = createRunProgress();
let reward = 0;
const idleAction = { thrust: 0, turn: 0, strafe: 0, aimTurn: 0, fire: false, label: 'test' } as const;

for (let step = 0; step < 60 * 45; step += 1) {
  const observation = observeArena(state);
  const decision = agent.decide(observation, 1 / 60, reward);
  const result = stepArena(state, decision.action, 1 / 60);
  reward = result.reward;
  for (const value of result.killedValues) addKillProgress(run, value, state.wave);
  while (run.pendingUpgrades > 0) {
    applyUpgrade(run, getUpgradeChoices(run)[0], () => {
      state.ship.hp = state.ship.maxHp;
    });
  }
  state.pulseLevel = run.weapons.pulse;
  state.missileLevel = run.weapons.missile;
  state.novaLevel = run.weapons.nova;
  if (state.ship.hp <= 0) {
    agent.finishEpisode(reward - 12);
    resetEpisode(state);
  }
}

assert.ok(agent.trainingSteps > 100, 'agent should accumulate training steps');
assert.ok(agent.knownStates > 1, 'agent should learn multiple observation states');
assert.ok(state.nextEnemyId > 3, 'arena should spawn enemies over time');
assert.ok(Number.isFinite(state.episodeReward), 'episode reward should remain finite');
assert.ok(run.level > 1, 'kills should produce incremental levels');
assert.ok(state.wave >= 1, 'wave should remain valid across episodes');

const checkpoint = agent.serialize();
const restoredAgent = new QLearningAgent();
restoredAgent.restore(checkpoint);
assert.equal(restoredAgent.knownStates, agent.knownStates, 'agent model should survive save round-trip');
assert.equal(restoredAgent.trainingSteps, agent.trainingSteps, 'agent steps should survive save round-trip');

const targetingState = createArenaState(800, 600);
targetingState.ship.angle = 0;
targetingState.ship.craftType = 'turret';
targetingState.ship.turretAngle = Math.atan2(50, 100);
targetingState.enemies.push({
  id: 1,
  x: 500,
  y: 350,
  angle: 0,
  radius: 12,
  hp: 10,
  speed: 0,
  fireCooldown: 10,
  kind: 'scout',
});
stepArena(targetingState, { ...idleAction, fire: true }, 0);
const aimedProjectile = targetingState.projectiles.find((projectile) => !projectile.hostile);
assert.ok(aimedProjectile, 'firing should create a projectile');
assert.ok(aimedProjectile.vy > 0, 'turret fire should use its attack axis independently of the hull');

const pursuitState = createArenaState(800, 600);
pursuitState.enemies.push({
  id: 1,
  x: pursuitState.ship.x + 100,
  y: pursuitState.ship.y,
  angle: 0,
  radius: 12,
  hp: 10,
  speed: 100,
  fireCooldown: 10,
  kind: 'scout',
});
stepArena(pursuitState, idleAction, 0.1);
assert.ok(pursuitState.enemies[0].x < pursuitState.ship.x + 100, 'enemies should keep closing to contact range');

const waveState = createArenaState(800, 600);
waveState.waveTime = waveState.waveDuration * 2;
stepArena(waveState, idleAction, 0);
assert.equal(waveState.wave, 1, 'elapsed time alone must not advance a wave');
waveState.waveSpawned = waveState.waveTotal;
waveState.enemies = [];
const waveResult = stepArena(waveState, idleAction, 0);
assert.equal(waveState.wave, 2, 'defeating the complete wave should advance it');
assert.equal(waveResult.waveAdvanced, true, 'wave completion should be reported');

assert.equal(isActionAllowed('interceptor', ACTIONS[9]), false, 'interceptor must not strafe');
assert.equal(isActionAllowed('strafer', ACTIONS[9]), true, 'strafer should have lateral movement');
assert.equal(isActionAllowed('turret', ACTIONS[13]), true, 'turret should rotate its weapon independently');
assert.equal(isActionAllowed('strafer', ACTIONS[13]), false, 'strafer must not use turret-only actions');

const sensorState = createArenaState(800, 600);
sensorState.ship.angle = 0;
sensorState.projectiles.push({
  x: sensorState.ship.x + 60,
  y: sensorState.ship.y,
  vx: -200,
  vy: 0,
  radius: 4,
  life: 2,
  hostile: true,
  damage: 1,
  kind: 'enemy',
});
const sensorObservation = observeArena(sensorState);
assert.equal(sensorObservation.projectileDangerSector, 0, 'approaching fire should be observed by direction');
assert.equal(sensorObservation.projectileDistanceBand, 0, 'nearby approaching fire should be marked urgent');
assert.equal(sensorObservation.hostileProjectileCountBand, 1, 'hostile projectile count should be observed');

const physicsState = createArenaState(5000, 1000);
physicsState.ship.craftType = 'interceptor';
physicsState.ship.angle = 0;
const thrustAction = { ...idleAction, thrust: 1 as const };
for (let index = 0; index < 10; index += 1) stepArena(physicsState, thrustAction, 0.05);
const coastingSpeed = physicsState.ship.vx;
const coastStartX = physicsState.ship.x;
for (let index = 0; index < 10; index += 1) stepArena(physicsState, idleAction, 0.05);
assert.equal(physicsState.ship.vx, coastingSpeed, 'a ship without thrust should preserve velocity in space');
assert.ok(physicsState.ship.x > coastStartX, 'a coasting ship should continue moving');
for (let index = 0; index < 100; index += 1) stepArena(physicsState, thrustAction, 0.05);
assert.ok(Math.hypot(physicsState.ship.vx, physicsState.ship.vy) <= 270.0001, 'craft speed must respect its maximum');
const motionObservation = observeArena(physicsState);
assert.equal(motionObservation.velocitySector, 0, 'velocity direction should be observable relative to the hull');
assert.equal(motionObservation.speedBand, 2, 'high speed should be observable');

const cameraState = createArenaState(1600, 900);
resizeArena(cameraState, 600, 400);
assert.equal(cameraState.width, 1600, 'window resizing must not change world width');
assert.equal(cameraState.height, 900, 'window resizing must not change world height');
assert.deepEqual(getArenaCamera(cameraState), { x: 500, y: 250, width: 600, height: 400 }, 'small viewports should follow the ship');
cameraState.ship.x = 100;
cameraState.ship.y = 100;
assert.deepEqual(getArenaCamera(cameraState), { x: 0, y: 0, width: 600, height: 400 }, 'camera should preserve fixed world edges');
resizeArena(cameraState, 1800, 1000);
assert.deepEqual(getArenaCamera(cameraState), { x: -100, y: -50, width: 1800, height: 1000 }, 'large viewports should center the fixed world');

const edgeState = createArenaState(800, 600);
edgeState.ship.x = 35;
edgeState.ship.angle = 0;
const edgeObservation = observeArena(edgeState);
assert.equal(edgeObservation.edgeDistanceBand, 0, 'a nearby screen edge should be observed');
assert.equal(edgeObservation.edgeSector, 4, 'the closest edge direction should be relative to the hull');
assert.deepEqual(edgeObservation.edgeDistanceBands, [0, 2, 2, 2], 'all four edge distances should be observed');
edgeState.spawnTimer = 10;
edgeState.ship.vx = -100;
const boundaryResult = stepArena(edgeState, idleAction, 0.1);
assert.ok(boundaryResult.reward < 0, 'screen-edge collision should provide a negative learning signal');

const parityState = createArenaState(800, 600);
parityState.projectileCountLevel = 1;
const evenObservation = observeArena(parityState);
assert.equal(evenObservation.pulseProjectileCount, 2, 'multi-shot level should expose actual projectile count');
assert.equal(evenObservation.pulseProjectileParity, 0, 'two projectiles should be observed as even');
parityState.projectileCountLevel = 3;
const oddObservation = observeArena(parityState);
assert.equal(oddObservation.pulseProjectileCount, 3, 'higher multi-shot should expose its new count');
assert.equal(oddObservation.pulseProjectileParity, 1, 'three projectiles should be observed as odd');

const overlapState = createArenaState(800, 600);
overlapState.ship.angle = 0;
overlapState.enemies.push({
  id: 1,
  x: overlapState.ship.x,
  y: overlapState.ship.y,
  angle: 0,
  radius: 12,
  hp: 1,
  speed: 0,
  fireCooldown: 10,
  kind: 'scout',
});
const hpBeforeCollision = overlapState.ship.hp;
const overlapResult = stepArena(overlapState, idleAction, 0);
assert.equal(overlapState.enemies.length, 0, 'an enemy colliding with the ship should be destroyed');
assert.ok(overlapState.ship.hp < hpBeforeCollision, 'a collision should damage the ship');
assert.deepEqual(overlapResult.killedValues, [100], 'collision kills should award normal progress');

const selectedCraftState = createArenaState(800, 600);
setCraftPreference(selectedCraftState, 'turret');
assert.equal(selectedCraftState.ship.craftType, 'turret', 'manual craft selection should apply immediately');
selectedCraftState.wave = 7;
selectedCraftState.score = 900;
selectedCraftState.kills = 4;
resetEpisode(selectedCraftState);
assert.equal(selectedCraftState.ship.craftType, 'turret', 'manual craft selection should persist across episodes');
assert.equal(selectedCraftState.wave, 1, 'changing craft through a new episode should restart at wave one');
assert.equal(selectedCraftState.score, 0, 'a new craft episode should not inherit score');
assert.equal(selectedCraftState.kills, 0, 'a new craft episode should not inherit kills');
assert.equal(observeArena(selectedCraftState).craftType, 'turret', 'the selected craft must be part of model observation');

const turretRun = createRunProgress();
const turretChoices = getUpgradeChoices(turretRun, 'turret');
const turretUpgrade = turretChoices.find((choice) => choice.id === 'turret-turn');
assert.ok(turretUpgrade, 'turret craft should always receive a turret rotation upgrade choice');
applyUpgrade(turretRun, turretUpgrade, () => {});
assert.equal(turretRun.turretTurnLevel, 1, 'turret rotation upgrade should have its own level');
assert.deepEqual(turretRun.weapons, { pulse: 1, missile: 0, nova: 0 }, 'turret upgrade must preserve existing weapons');

const baseTurretState = createArenaState(800, 600);
setCraftPreference(baseTurretState, 'turret');
baseTurretState.ship.turretAngle = 0;
stepArena(baseTurretState, ACTIONS[14], 0.1);
const baseTurretRotation = baseTurretState.ship.turretAngle;
const upgradedTurretState = createArenaState(800, 600);
setCraftPreference(upgradedTurretState, 'turret');
upgradedTurretState.ship.turretAngle = 0;
upgradedTurretState.turretTurnLevel = 2;
stepArena(upgradedTurretState, ACTIONS[14], 0.1);
assert.ok(upgradedTurretState.ship.turretAngle > baseTurretRotation, 'turret drive levels should rotate the turret faster');

const upgradeChoices = getUpgradeChoices(run);
const upgradeDecision = agent.chooseUpgrade(state.ship.craftType, upgradeChoices, state.wave);
assert.ok(upgradeChoices.includes(upgradeDecision.choice), 'agent must choose from the offered upgrades');
const upgradedCheckpoint = agent.serialize();
assert.ok(upgradedCheckpoint.upgradeValues, 'upgrade policy should be stored with the shared model');

console.log(JSON.stringify({
  episode: state.episode,
  trainingSteps: agent.trainingSteps,
  knownStates: agent.knownStates,
  spawnedEnemies: state.nextEnemyId - 1,
  score: state.score,
  runLevel: run.level,
  weapons: run.weapons,
}));
