import assert from 'node:assert/strict';
import test from 'node:test';
import { comboMultiplier, createCombatState, registerKill, stepCombatState } from '../apps/gunship/gunship_combat.js';
import { encounterKindForWave, spawnWave } from '../apps/gunship/gunship_enemies.js';
import { collectOrbs, spawnOrb, stepOrbs } from '../apps/gunship/gunship_pickups.js';
import { GunshipAgent } from '../apps/gunship/gunship_rl.js';
import { airframeById } from '../apps/gunship/gunship_airframes.js';
import { createRunProgress } from '../apps/gunship/gunship_progression.js';
import { applyWeaponRecoil, weaponCooldown, weaponDamage, weaponProfile } from '../apps/gunship/gunship_weapons.js';
import { createGunshipEffects, emitKill, emitWeaponFire, stepGunshipEffects, updateCombatFeedback } from '../apps/gunship/gunship_effects.js';

test('combo raises rewards and expires after its timeout', () => {
  const state = createCombatState();
  registerKill(state);
  registerKill(state);
  assert.equal(comboMultiplier(state.combo), 1.3);
  const ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, fireCooldown: 0, thrust: 0, turn: 0, thrustTurnK: 0, drag: 0 };
  stepCombatState(state, ship, [], false, 4.3);
  assert.equal(state.combo, 0);
});

test('recovery requires firing to stop and threats to be distant', () => {
  const state = createCombatState();
  const ship = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: 50, maxHp: 100, fireCooldown: 0, thrust: 0, turn: 0, thrustTurnK: 0, drag: 0 };
  const nearEnemy = { id: 1, kind: 'chaser' as const, x: 100, y: 0, vx: 0, hp: 1, maxHp: 1, cooldown: 1, radius: 10, wave: 1 };
  stepCombatState(state, ship, [nearEnemy], false, 2);
  assert.equal(ship.hp, 50);
  ship.x = 3590; nearEnemy.x = 10;
  stepCombatState(state, ship, [nearEnemy], false, 1);
  assert.equal(ship.hp, 50);
  stepCombatState(state, ship, [], false, 1);
  assert.ok(ship.hp > 50);
  assert.equal(state.recovering, true);
});

test('waves rotate through readable enemy roles', () => {
  assert.deepEqual([1, 2, 3, 4].map(encounterKindForWave), ['AIR SWEEP', 'SURFACE RAID', 'MINE CORRIDOR', 'CAPITAL HUNT']);
  assert.ok(spawnWave(3, 1).some((enemy) => enemy.kind === 'mine'));
  assert.ok(spawnWave(4, 1).some((enemy) => enemy.kind === 'battleship'));
});

test('xp orbs expire, collect, and respect the horizontal world seam', () => {
  const expiring = [spawnOrb(100, 100, 2)];
  stepOrbs(expiring, 12.1);
  assert.equal(expiring.length, 0);
  const seamOrb = [spawnOrb(10, 100, 3)];
  assert.equal(collectOrbs(seamOrb, 3590, 100), 3);
  assert.equal(seamOrb.length, 0);
});

test('flight policy records orb presence as a distinct observation', () => {
  const agent = new GunshipAgent();
  const ship = { x: 1800, y: 260, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, fireCooldown: 0, thrust: 408, turn: 2.9, thrustTurnK: .6, drag: .64 };
  agent.decide(ship, [], [], [], { weapon: 'cannon', recoveryDelay: 0 }, .2, 0);
  const withoutOrb = agent.knownStates;
  agent.decide(ship, [], [], [{ x: 1850, y: 260 }], { weapon: 'cannon', recoveryDelay: 0 }, .2, 0);
  assert.ok(agent.knownStates > withoutOrb);
});

test('weapon families expose distinct costs instead of pure upgrades', () => {
  const cannon = createRunProgress();
  const laser = { ...createRunProgress(), weaponFamily: 'laser' as const, laser: 1 };
  const missile = { ...createRunProgress(), weaponFamily: 'missile' as const, missile: 1 };
  const flak = { ...createRunProgress(), weaponFamily: 'flak' as const, flak: 1 };
  assert.ok(weaponProfile(laser).recoveryDelay > weaponProfile(cannon).recoveryDelay);
  assert.ok(weaponCooldown(missile) > weaponCooldown(cannon) * 5);
  assert.ok(weaponDamage(flak, 'flak', false) > weaponDamage(flak, 'flak', true));
});

test('airframes change how strongly railgun recoil disrupts flight', () => {
  const railgun = { ...createRunProgress(), weaponFamily: 'railgun' as const, railgun: 1 };
  const heavy = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, fireCooldown: 0, thrust: 0, turn: 0, thrustTurnK: 0, drag: 0 };
  const light = { ...heavy };
  applyWeaponRecoil(heavy, railgun, airframeById('hauler').recoilScale);
  applyWeaponRecoil(light, railgun, airframeById('darter').recoilScale);
  assert.ok(Math.abs(light.vx) > Math.abs(heavy.vx));
});

test('flight policy separates weapon and recovery context', () => {
  const agent = new GunshipAgent();
  const ship = { x: 1800, y: 260, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, fireCooldown: 0, thrust: 408, turn: 2.9, thrustTurnK: .6, drag: .64 };
  agent.decide(ship, [], [], [], { weapon: 'cannon', recoveryDelay: 0 }, .2, 0);
  const cannonStates = agent.knownStates;
  agent.decide(ship, [], [], [], { weapon: 'railgun', recoveryDelay: 1.8 }, .2, 0);
  assert.ok(agent.knownStates > cannonStates);
  assert.equal(agent.serialize().version, 9);
});

test('only capital kills trigger hit stop and a destruction banner', () => {
  const small = createGunshipEffects();
  emitKill(small, { id: 1, kind: 'chaser', x: 100, y: 100, vx: 0, hp: 0, maxHp: 10, cooldown: 0, radius: 17, wave: 1 });
  assert.equal(small.hitStop, 0);
  const capital = createGunshipEffects();
  emitKill(capital, { id: 2, kind: 'battleship', x: 100, y: 700, vx: 20, hp: 0, maxHp: 100, cooldown: 0, radius: 78, wave: 4 });
  assert.ok(capital.hitStop > 0);
  assert.ok(capital.banners.some((entry) => entry.text.includes('BATTLESHIP')));
});

test('falling debris becomes a short-lived water splash', () => {
  const effects = createGunshipEffects();
  emitKill(effects, { id: 3, kind: 'destroyer', x: 100, y: 789, vx: 0, hp: 0, maxHp: 10, cooldown: 0, radius: 43, wave: 2 });
  const debris = effects.particles.find((entry) => entry.kind === 'debris');
  assert.ok(debris);
  debris.vy = 40;
  stepGunshipEffects(effects, .1);
  assert.equal(debris.kind, 'splash');
});

test('combat feedback and weapon fire remain temporary', () => {
  const effects = createGunshipEffects();
  const ship = { x: 100, y: 100, vx: 0, vy: 0, angle: 0, hp: 100, maxHp: 100, fireCooldown: 0, thrust: 0, turn: 0, thrustTurnK: 0, drag: 0 };
  emitWeaponFire(effects, ship, 'railgun');
  updateCombatFeedback(effects, 2, true);
  assert.ok(effects.shake > 0);
  assert.ok(effects.banners.length >= 2);
  stepGunshipEffects(effects, 2);
  assert.equal(effects.banners.length, 0);
});
