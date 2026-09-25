import { rewardBreakdown } from '../../shared/rl/runtime_types.js';
import { approach, capVelocity, circleHitsRect, clamp, nearestEnemy, normalizeAngle, rotateToward, wrapIndex } from './drone_bastion_math.js';
import { DRONE_SPECS, random, respawnDrone, respawnDuration, waveEnemyTotal } from './drone_bastion_state.js';
import { ensureSelectedDrone, selectDrone } from './drone_bastion_state.js';
import type { BastionDrone, BastionEnemy, BastionProjectile, DroneAction, DroneBastionState, DroneBastionStepResult, WeaponResult } from './drone_bastion_types.js';

type RewardParts = { task: number; progress: number; safety: number; behavior: number };
type StepOutcome = { towerDamage: number; hits: number; kills: number; waveAdvanced: boolean; switched: boolean };

export function stepDroneBastion(
  state: DroneBastionState,
  action: DroneAction,
  dt: number,
): DroneBastionStepResult {
  const parts: RewardParts = { task: 0, progress: 0, safety: 0, behavior: 0 };
  if (state.gameOver || state.pendingUpgrade || dt <= 0) {
    return { reward: rewardBreakdown(parts), towerDamage: 0, hits: 0, kills: 0, waveAdvanced: false, switched: false };
  }
  const weights = state.rewards;
  state.elapsed += dt;
  state.episodeTime += dt;
  parts.task += dt * weights.survival;
  const outcome: StepOutcome = { towerDamage: 0, hits: 0, kills: 0, waveAdvanced: false, switched: false };

  advanceSwitching(state, action, parts, outcome);
  updateDronesAndFire(state, action, dt, parts, outcome);
  spawnWaveEnemyIfDue(state, dt);
  updateEnemiesAndCollisions(state, dt, parts, outcome);
  updateProjectiles(state, dt, parts, outcome);
  advanceEffectsAndDamageNumbers(state, dt);
  finalizeWaveAndDefeat(state, parts, outcome);

  const reward = rewardBreakdown(parts);
  state.lastReward = reward.total;
  state.episodeReward += reward.total;
  return {
    reward,
    towerDamage: outcome.towerDamage,
    hits: outcome.hits,
    kills: outcome.kills,
    waveAdvanced: outcome.waveAdvanced,
    switched: outcome.switched,
  };
}

function advanceSwitching(state: DroneBastionState, action: DroneAction, parts: RewardParts, outcome: StepOutcome): void {
  const weights = state.rewards;
  if (!(action.switch !== 0 && state.drones.length > 1)) return;
  let next = state.selectedDrone;
  for (let offset = 1; offset < state.drones.length; offset += 1) {
    const candidate = wrapIndex(state.selectedDrone + action.switch * offset, state.drones.length);
    if (state.drones[candidate].mode !== 'disabled') {
      next = candidate;
      break;
    }
  }
  if (next !== state.selectedDrone && state.drones[next].mode !== 'disabled') {
    selectDrone(state, next);
    parts.behavior -= weights.switchCost;
    outcome.switched = true;
  }
}

function updateDronesAndFire(state: DroneBastionState, action: DroneAction, dt: number, parts: RewardParts, outcome: StepOutcome): void {
  for (let index = 0; index < state.drones.length; index += 1) {
    const drone = state.drones[index];
    if (drone.mode === 'disabled') {
      drone.respawnRemaining = Math.max(0, drone.respawnRemaining - dt);
      if (drone.respawnRemaining > 0) continue;
      respawnDrone(state, drone, index);
    }
    drone.fireCooldown = Math.max(0, drone.fireCooldown - dt);
    if (index === state.selectedDrone) {
      updateControlledDrone(state, drone, action, dt);
      if (action.fire) {
        const weapon = fireDrone(state, drone);
        outcome.hits += weapon.hits;
        outcome.kills += weapon.kills;
        parts.progress += weapon.reward;
      }
    } else {
      const weapon = updateAutomaticDrone(state, drone, dt);
      outcome.hits += weapon.hits;
      outcome.kills += weapon.kills;
      parts.progress += weapon.reward;
    }
    containDrone(state, drone);
  }
}

function spawnWaveEnemyIfDue(state: DroneBastionState, dt: number): void {
  state.spawnTimer -= dt;
  if (state.waveRemaining > 0 && state.spawnTimer <= 0 && state.enemies.length < 240) {
    spawnEnemy(state);
    state.spawnTimer = Math.max(0.1, 0.82 - state.wave * 0.028) + random(state) * 0.26;
  }
}

function updateEnemiesAndCollisions(state: DroneBastionState, dt: number, parts: RewardParts, outcome: StepOutcome): void {
  const weights = state.rewards;
  for (const enemy of state.enemies) {
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    const target = chooseEnemyTarget(state, enemy);
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    enemy.vx = dx / distance * enemy.speed;
    enemy.vy = dy / distance * enemy.speed;
    const nextX = enemy.x + enemy.vx * dt;
    const nextY = enemy.y + enemy.vy * dt;
    const wall = state.walls.find((candidate) => candidate.hp > 0 && circleHitsRect(nextX, nextY, enemy.radius, candidate));
    if (wall) {
      enemy.vx = 0;
      enemy.vy = 0;
      if (enemy.attackCooldown <= 0) {
        wall.hp = Math.max(0, wall.hp - enemy.damage * 0.72);
        enemy.attackCooldown = enemy.kind === 'brute' ? 0.72 : 0.92;
        parts.safety -= weights.wallHit;
      }
    } else {
      enemy.x = nextX;
      enemy.y = nextY;
    }

    for (const drone of state.drones) {
      if (drone.mode === 'disabled') continue;
      const spec = DRONE_SPECS[drone.kind];
      if (Math.hypot(enemy.x - drone.x, enemy.y - drone.y) > enemy.radius + spec.radius) continue;
      if (enemy.attackCooldown <= 0) {
        const damage = Math.min(drone.hp, enemy.damage);
        drone.hp = Math.max(0, drone.hp - damage);
        addDamageNumber(state, drone.x, drone.y, damage, 'drone');
        enemy.attackCooldown = 0.75;
        parts.safety -= weights.droneHit;
        if (drone.hp <= 0) {
          drone.mode = 'disabled';
          drone.respawnRemaining = respawnDuration(drone);
          drone.vx = 0;
          drone.vy = 0;
          parts.safety -= weights.droneLost;
          ensureSelectedDrone(state);
        }
      }
    }

    if (Math.hypot(enemy.x - state.tower.x, enemy.y - state.tower.y) <= enemy.radius + state.tower.radius) {
      if (enemy.attackCooldown <= 0) {
        const damage = enemy.damage * (enemy.kind === 'brute' ? 1.25 : 1);
        state.tower.hp = Math.max(0, state.tower.hp - damage);
        addDamageNumber(state, state.tower.x, state.tower.y, damage, 'tower');
        outcome.towerDamage += damage;
        enemy.attackCooldown = 0.68;
        parts.task -= damage * weights.towerDamage;
      }
    }
  }
}

function updateProjectiles(state: DroneBastionState, dt: number, parts: RewardParts, outcome: StepOutcome): void {
  for (let projectileIndex = state.projectiles.length - 1; projectileIndex >= 0; projectileIndex -= 1) {
    const projectile = state.projectiles[projectileIndex];
    if (projectile.kind === 'missile' && projectile.targetEnemyId !== null) {
      const target = state.enemies.find((enemy) => enemy.id === projectile.targetEnemyId);
      if (target) {
        const speed = Math.hypot(projectile.vx, projectile.vy);
        const current = Math.atan2(projectile.vy, projectile.vx);
        const desired = Math.atan2(target.y - projectile.y, target.x - projectile.x);
        const angle = rotateToward(current, desired, 3.8 * dt);
        projectile.vx = Math.cos(angle) * speed;
        projectile.vy = Math.sin(angle) * speed;
      }
    }
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    if (projectile.kind === 'ricochet') bounceProjectile(state, projectile);
    if (projectile.kind === 'mortar' && projectile.life <= 0) {
      const blast = 72;
      state.effects.push({
        kind: 'blast',
        x: projectile.targetX,
        y: projectile.targetY,
        angle: 0,
        radius: blast,
        life: 0.3,
        maxLife: 0.3,
      });
      for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
        const enemy = state.enemies[enemyIndex];
        if (Math.hypot(projectile.targetX - enemy.x, projectile.targetY - enemy.y) > blast + enemy.radius) continue;
        const result = damageEnemy(state, enemyIndex, projectile.damage);
        outcome.hits += 1;
        outcome.kills += result.killed;
        parts.progress += result.reward;
      }
      state.projectiles.splice(projectileIndex, 1);
      continue;
    }
    let consumed = projectile.life <= 0;
    for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0 && !consumed; enemyIndex -= 1) {
      const enemy = state.enemies[enemyIndex];
      if (projectile.kind === 'mortar' || projectile.hitEnemyIds.includes(enemy.id)) continue;
      if (Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y) > projectile.radius + enemy.radius) continue;
      projectile.hitEnemyIds.push(enemy.id);
      const result = damageEnemy(state, enemyIndex, projectile.damage);
      outcome.hits += 1;
      outcome.kills += result.killed;
      parts.progress += result.reward;
      if (projectile.kind === 'pierce') {
        projectile.pierceRemaining -= 1;
        consumed = projectile.pierceRemaining < 0;
      } else if (projectile.kind === 'ricochet') {
        projectile.bounces -= 1;
        const nx = projectile.x - enemy.x;
        const ny = projectile.y - enemy.y;
        const length = Math.max(0.001, Math.hypot(nx, ny));
        const dot = projectile.vx * nx / length + projectile.vy * ny / length;
        projectile.vx -= 2 * dot * nx / length;
        projectile.vy -= 2 * dot * ny / length;
        consumed = projectile.bounces < 0;
      } else {
        consumed = true;
      }
    }
    if (consumed) state.projectiles.splice(projectileIndex, 1);
  }
}

function advanceEffectsAndDamageNumbers(state: DroneBastionState, dt: number): void {
  for (let index = state.effects.length - 1; index >= 0; index -= 1) {
    state.effects[index].life -= dt;
    if (state.effects[index].life <= 0) state.effects.splice(index, 1);
  }
  for (let index = state.damageNumbers.length - 1; index >= 0; index -= 1) {
    state.damageNumbers[index].life -= dt;
    if (state.damageNumbers[index].life <= 0) state.damageNumbers.splice(index, 1);
  }
}

function finalizeWaveAndDefeat(state: DroneBastionState, parts: RewardParts, outcome: StepOutcome): void {
  const weights = state.rewards;
  state.enemies = state.enemies.filter((enemy) => (
    enemy.x > -80 && enemy.x < state.width + 80 && enemy.y > -80 && enemy.y < state.height + 80
  ));

  if (state.waveRemaining === 0 && state.enemies.length === 0) {
    state.pendingUpgrade = true;
    state.waveCooldown = 1.2;
    outcome.waveAdvanced = true;
    parts.progress += weights.wave;
  }
  if (state.tower.hp <= 0) {
    state.gameOver = true;
    parts.task -= weights.defeat;
  }
}

function updateControlledDrone(
  state: DroneBastionState,
  drone: BastionDrone,
  action: DroneAction,
  dt: number,
): void {
  const spec = DRONE_SPECS[drone.kind];
  const speed = Math.hypot(drone.vx, drone.vy);
  const isHeli = spec.chassis === 'light_heli' || spec.chassis === 'heavy_heli';
  const isTank = spec.chassis === 'tank';
  const isHeavyRobot = spec.chassis === 'heavy_robot';
  const turnResponse = isHeli ? 7.5 : isTank ? 4.2 : isHeavyRobot ? 0.9 : 2.4;
  const movingTurnScale = isTank ? clamp(1.15 - speed / spec.maxSpeed * 0.55, 0.55, 1.15) : 1;
  const desiredTurn = action.turn * spec.turn * movingTurnScale;
  drone.angularVelocity = approach(drone.angularVelocity, desiredTurn, turnResponse * dt);
  drone.angle = normalizeAngle(drone.angle + drone.angularVelocity * dt);

  const throttleResponse = isHeli ? 4.8 : isTank ? 1.8 : isHeavyRobot ? 0.62 : 2.25;
  drone.throttle = approach(drone.throttle, action.thrust, throttleResponse * dt);
  const acceleration = drone.throttle >= 0 ? spec.thrust : spec.reverse;
  drone.vx += Math.cos(drone.angle) * drone.throttle * acceleration * dt;
  drone.vy += Math.sin(drone.angle) * drone.throttle * acceleration * dt;

  if (!isHeli) {
    const forwardX = Math.cos(drone.angle);
    const forwardY = Math.sin(drone.angle);
    const forwardSpeed = drone.vx * forwardX + drone.vy * forwardY;
    const lateralX = drone.vx - forwardX * forwardSpeed;
    const lateralY = drone.vy - forwardY * forwardSpeed;
    const grip = isTank ? 8.5 : isHeavyRobot ? 4.8 : 5.8;
    const lateralRetention = Math.max(0, 1 - grip * dt);
    drone.vx = forwardX * forwardSpeed + lateralX * lateralRetention;
    drone.vy = forwardY * forwardSpeed + lateralY * lateralRetention;
  }
  const brakeSpeed = Math.hypot(drone.vx, drone.vy);
  if (action.brake && brakeSpeed > 0) {
    const nextSpeed = Math.max(0, brakeSpeed - spec.brake * dt);
    drone.vx *= nextSpeed / brakeSpeed;
    drone.vy *= nextSpeed / brakeSpeed;
    drone.throttle = approach(drone.throttle, 0, spec.chassis === 'heavy_robot' ? dt : 4 * dt);
  }
  const drag = Math.max(0, 1 - spec.drag * dt);
  drone.vx *= drag;
  drone.vy *= drag;
  capVelocity(drone, spec.maxSpeed);
  drone.x += drone.vx * dt;
  drone.y += drone.vy * dt;
}

function updateAutomaticDrone(
  state: DroneBastionState,
  drone: BastionDrone,
  dt: number,
): WeaponResult {
  const spec = DRONE_SPECS[drone.kind];
  if (drone.mode === 'braking') {
    const speed = Math.hypot(drone.vx, drone.vy);
    const nextSpeed = Math.max(0, speed - spec.brake * 0.72 * dt);
    if (speed > 0) {
      drone.vx *= nextSpeed / speed;
      drone.vy *= nextSpeed / speed;
    }
    drone.x += drone.vx * dt;
    drone.y += drone.vy * dt;
    drone.anchorTimer -= dt;
    drone.throttle = approach(drone.throttle, 0, 3.5 * dt);
    drone.angularVelocity = approach(drone.angularVelocity, 0, 4 * dt);
    if (nextSpeed < 4 && drone.anchorTimer <= 0) {
      drone.vx = 0;
      drone.vy = 0;
      drone.mode = 'turret';
    }
  }
  if (drone.mode !== 'turret') return { hits: 0, kills: 0, reward: 0 };
  const target = nearestEnemy(state, drone.x, drone.y, spec.range, spec.minRange);
  if (!target) return { hits: 0, kills: 0, reward: 0 };
  drone.angle = rotateToward(
    drone.angle,
    Math.atan2(target.y - drone.y, target.x - drone.x),
    spec.turn * 0.52 * dt,
  );
  const error = Math.abs(normalizeAngle(Math.atan2(target.y - drone.y, target.x - drone.x) - drone.angle));
  if (error < 0.18) return fireDrone(state, drone, target);
  return { hits: 0, kills: 0, reward: 0 };
}

function fireDrone(
  state: DroneBastionState,
  drone: BastionDrone,
  automaticTarget: BastionEnemy | null = null,
): WeaponResult {
  if (drone.fireCooldown > 0) return { hits: 0, kills: 0, reward: 0 };
  const spec = DRONE_SPECS[drone.kind];
  const damageScale = 1 + (drone.powerLevel - 1) * 0.22;
  const target = automaticTarget ?? enemyNearAim(state, drone, spec.range, spec.minRange);
  if (spec.weapon === 'arc') {
    let hits = 0;
    let kills = 0;
    let reward = 0;
    const halfArc = Math.PI / 4;
    for (let enemyIndex = state.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
      const enemy = state.enemies[enemyIndex];
      const distance = Math.hypot(enemy.x - drone.x, enemy.y - drone.y);
      const error = Math.abs(normalizeAngle(Math.atan2(enemy.y - drone.y, enemy.x - drone.x) - drone.angle));
      if (distance <= spec.range && error <= halfArc) {
        const result = damageEnemy(state, enemyIndex, spec.damage * damageScale);
        hits += 1;
        kills += result.killed;
        reward += result.reward;
      }
    }
    state.effects.push({
      kind: 'arc',
      x: drone.x,
      y: drone.y,
      angle: drone.angle,
      radius: spec.range,
      life: 0.34,
      maxLife: 0.34,
    });
    drone.fireCooldown = spec.cooldown / (1 + (drone.powerLevel - 1) * 0.08);
    return { hits, kills, reward };
  } else {
    const shots = spec.weapon === 'missile' ? 6 : 1;
    for (let shot = 0; shot < shots; shot += 1) {
      const centeredShot = shot - (shots - 1) / 2;
      const spread = shots === 1 ? 0 : centeredShot * 0.045;
      const angle = drone.angle + spread;
      const maxLife = spec.weapon === 'mortar'
        ? 0.82
        : spec.range / spec.projectileSpeed;
      const targetX = target?.x ?? drone.x + Math.cos(angle) * spec.range * 0.76;
      const targetY = target?.y ?? drone.y + Math.sin(angle) * spec.range * 0.76;
      const mortarSpeed = Math.hypot(targetX - drone.x, targetY - drone.y) / maxLife;
      const speed = spec.weapon === 'mortar' ? mortarSpeed : spec.projectileSpeed;
      const fireAngle = spec.weapon === 'mortar'
        ? Math.atan2(targetY - drone.y, targetX - drone.x)
        : angle;
      const rearOffset = spec.weapon === 'missile' ? spec.radius + 12 : -(spec.radius + 5);
      const lateralOffset = spec.weapon === 'missile' ? centeredShot * 4.2 : 0;
      state.projectiles.push({
        id: state.nextProjectileId++,
        kind: spec.weapon,
        x: drone.x
          - Math.cos(drone.angle) * rearOffset
          - Math.sin(drone.angle) * lateralOffset,
        y: drone.y
          - Math.sin(drone.angle) * rearOffset
          + Math.cos(drone.angle) * lateralOffset,
        vx: Math.cos(fireAngle) * speed + drone.vx * 0.2,
        vy: Math.sin(fireAngle) * speed + drone.vy * 0.2,
        damage: spec.damage * damageScale,
        radius: spec.weapon === 'mortar' ? 7 : spec.weapon === 'pierce' ? 4 : 3,
        life: maxLife,
        maxLife,
        targetEnemyId: target?.id ?? null,
        targetX,
        targetY,
        bounces: spec.weapon === 'ricochet' ? 3 : 0,
        pierceRemaining: spec.weapon === 'pierce' ? 3 : 0,
        hitEnemyIds: [],
      });
    }
  }
  drone.fireCooldown = spec.cooldown / (1 + (drone.powerLevel - 1) * 0.08);
  return { hits: 0, kills: 0, reward: 0 };
}

function enemyNearAim(
  state: DroneBastionState,
  drone: BastionDrone,
  range: number,
  minRange = 0,
): BastionEnemy | null {
  let best: BastionEnemy | null = null;
  let bestScore = Infinity;
  for (const enemy of state.enemies) {
    const distance = Math.hypot(enemy.x - drone.x, enemy.y - drone.y);
    if (distance > range || distance < minRange) continue;
    const error = Math.abs(normalizeAngle(Math.atan2(enemy.y - drone.y, enemy.x - drone.x) - drone.angle));
    if (error > 0.62) continue;
    const score = distance + error * 180;
    if (score < bestScore) {
      best = enemy;
      bestScore = score;
    }
  }
  return best;
}

function damageEnemy(
  state: DroneBastionState,
  enemyIndex: number,
  damage: number,
): { killed: number; reward: number } {
  const enemy = state.enemies[enemyIndex];
  if (!enemy) return { killed: 0, reward: 0 };
  const appliedDamage = Math.min(enemy.hp, damage);
  enemy.hp -= appliedDamage;
  addDamageNumber(state, enemy.x, enemy.y, appliedDamage, 'enemy');
  if (enemy.hp > 0) return { killed: 0, reward: state.rewards.chip };
  state.enemies.splice(enemyIndex, 1);
  state.kills += 1;
  state.score += enemy.kind === 'brute' ? 220 : 70;
  return { killed: 1, reward: enemy.kind === 'brute' ? state.rewards.bruteKill : state.rewards.kill };
}

function addDamageNumber(
  state: DroneBastionState,
  x: number,
  y: number,
  amount: number,
  target: 'enemy' | 'drone' | 'tower',
): void {
  state.damageNumbers.push({
    id: state.nextDamageNumberId++,
    x,
    y,
    amount,
    target,
    life: 0.85,
    maxLife: 0.85,
  });
}

function bounceProjectile(state: DroneBastionState, projectile: BastionProjectile): void {
  let bounced = false;
  if (projectile.x <= 0 || projectile.x >= state.width) {
    projectile.x = clamp(projectile.x, 0, state.width);
    projectile.vx *= -1;
    bounced = true;
  }
  if (projectile.y <= 0 || projectile.y >= state.height) {
    projectile.y = clamp(projectile.y, 0, state.height);
    projectile.vy *= -1;
    bounced = true;
  }
  if (bounced) projectile.bounces -= 1;
  if (projectile.bounces < 0) projectile.life = 0;
}

function spawnEnemy(state: DroneBastionState): void {
  const edge = Math.floor(random(state) * 4);
  const margin = 28;
  let x = random(state) * state.width;
  let y = random(state) * state.height;
  if (edge === 0) y = -margin;
  else if (edge === 1) x = state.width + margin;
  else if (edge === 2) y = state.height + margin;
  else x = -margin;
  const brute = state.wave >= 3 && random(state) < Math.min(0.32, 0.08 + state.wave * 0.025);
  const hpScale = 1 + (state.wave - 1) * 0.12;
  const maxHp = (brute ? 95 : 34) * hpScale;
  state.enemies.push({
    id: state.nextEnemyId++,
    x,
    y,
    vx: 0,
    vy: 0,
    hp: maxHp,
    maxHp,
    radius: brute ? 15 : 9,
    speed: (brute ? 34 : 54) + state.wave * 1.4,
    damage: (brute ? 19 : 8) * (1 + state.wave * 0.035),
    attackCooldown: 0,
    kind: brute ? 'brute' : 'swarm',
  });
  state.waveRemaining -= 1;
  state.waveSpawned += 1;
}

function chooseEnemyTarget(state: DroneBastionState, enemy: BastionEnemy): { x: number; y: number } {
  const nearby = state.drones
    .filter((drone) => drone.mode !== 'disabled')
    .map((drone) => ({ drone, distance: Math.hypot(drone.x - enemy.x, drone.y - enemy.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearby && nearby.distance < 72) return nearby.drone;
  return state.tower;
}

function containDrone(state: DroneBastionState, drone: BastionDrone): void {
  const radius = DRONE_SPECS[drone.kind].radius;
  if (drone.x < radius) {
    drone.x = radius;
    drone.vx = Math.abs(drone.vx) * 0.25;
  } else if (drone.x > state.width - radius) {
    drone.x = state.width - radius;
    drone.vx = -Math.abs(drone.vx) * 0.25;
  }
  if (drone.y < radius) {
    drone.y = radius;
    drone.vy = Math.abs(drone.vy) * 0.25;
  } else if (drone.y > state.height - radius) {
    drone.y = state.height - radius;
    drone.vy = -Math.abs(drone.vy) * 0.25;
  }
}
