import { rewardBreakdown } from '../../shared/rl/runtime_types.js';
import { attackAngle, clamp, distanceSq, pulseProjectileCount } from './arena_shooter_math.js';
import { craftDefinition, random, waveEnemyTotal } from './arena_shooter_state.js';
import type { ArenaAction, ArenaState, ArenaStepResult, Enemy, Projectile, Ship, Vec2 } from './arena_shooter_types.js';

const TAU = Math.PI * 2;

type RewardParts = { task: number; progress: number; safety: number; behavior: number };

export function stepArena(state: ArenaState, action: ArenaAction, dt: number): ArenaStepResult {
  const parts: RewardParts = { task: 0, progress: 0, safety: 0, behavior: 0 };
  const killedValues: number[] = [];

  tickCooldownsAndTimers(state, dt);
  applyMovement(state, action, dt, parts);
  firePulse(state, action, parts);
  fireMissiles(state);
  fireNova(state, parts, killedValues);
  fireLaser(state, parts, killedValues);
  fireRicochet(state);
  emitTrail(state);
  spawnWaveEnemies(state, dt);
  updateEnemiesAndCollide(state, dt, parts, killedValues);
  updateTrailDamage(state, dt, parts, killedValues);
  advanceProjectilePositions(state, dt);
  interceptHostileProjectiles(state, dt, parts);
  resolveProjectileEnemyHits(state, dt, parts, killedValues);
  const waveAdvanced = finalizeStepState(state, dt);

  const reward = rewardBreakdown(parts);
  state.lastReward = reward.total;
  state.episodeReward += reward.total;
  return { reward, killedValues, waveAdvanced };
}

function tickCooldownsAndTimers(state: ArenaState, dt: number): void {
  const ship = state.ship;
  state.elapsed += dt;
  state.episodeTime += dt;
  state.waveTime += dt;
  state.shake = Math.max(0, state.shake - dt * 18);
  state.novaPulse = Math.max(0, state.novaPulse - dt * 2.2);
  ship.fireCooldown -= dt;
  ship.invulnerability -= dt;
  state.missileCooldown -= dt;
  state.novaCooldown -= dt;
  state.laserCooldown -= dt;
  state.ricochetCooldown -= dt;
  state.trailCooldown -= dt;
}

function applyMovement(state: ArenaState, action: ArenaAction, dt: number, parts: RewardParts): void {
  const ship = state.ship;
  const craft = craftDefinition(ship.craftType);
  const edgeDistanceBeforeMove = nearestEdgeDistance(ship, state.width, state.height);
  ship.angle += action.turn * craft.turnSpeed * dt;
  if (ship.craftType === 'turret') {
    const turretTurnSpeed = craft.turretTurnSpeed * 1.16 ** state.turretTurnLevel;
    ship.turretAngle += action.aimTurn * turretTurnSpeed * dt;
  } else {
    ship.turretAngle = ship.angle;
  }
  const thrustAcceleration = action.thrust < 0
    ? craft.reverseAcceleration
    : craft.forwardAcceleration;
  ship.vx += Math.cos(ship.angle) * action.thrust * thrustAcceleration * dt;
  ship.vy += Math.sin(ship.angle) * action.thrust * thrustAcceleration * dt;
  ship.vx += Math.cos(ship.angle + Math.PI / 2) * action.strafe * craft.strafeAcceleration * dt;
  ship.vy += Math.sin(ship.angle + Math.PI / 2) * action.strafe * craft.strafeAcceleration * dt;
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > craft.maxSpeed) {
    ship.vx = ship.vx / speed * craft.maxSpeed;
    ship.vy = ship.vy / speed * craft.maxSpeed;
  }
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  const hitBoundary = resolveArenaBoundaryCollision(ship, state.width, state.height);
  const edgeDistanceAfterMove = nearestEdgeDistance(ship, state.width, state.height);

  const weights = state.rewards;
  parts.task += dt * weights.survival;
  if (edgeDistanceAfterMove < 140) {
    parts.safety -= dt * weights.edgeLoiter;
    parts.safety += clamp((edgeDistanceAfterMove - edgeDistanceBeforeMove) * weights.edgeApproach, -0.25, 0.25);
  }
  if (hitBoundary) parts.safety -= weights.boundaryHit;
}

function firePulse(state: ArenaState, action: ArenaAction, parts: RewardParts): void {
  const ship = state.ship;
  const weights = state.rewards;
  if (!(action.fire && ship.fireCooldown <= 0)) return;
  const fireAngle = attackAngle(ship);
  const projectileCount = pulseProjectileCount(state.projectileCountLevel);
  const spreadStep = 0.1;
  const projectileSpeed = 620 * 1.08 ** state.projectileSpeedLevel;
  ship.fireCooldown = Math.max(0.055, 0.2 * 0.9 ** state.fireRateLevel);
  for (let index = 0; index < projectileCount; index += 1) {
    const spread = (index - (projectileCount - 1) / 2) * spreadStep;
    const angle = fireAngle + spread;
    state.projectiles.push({
      x: ship.x + Math.cos(angle) * 21,
      y: ship.y + Math.sin(angle) * 21,
      vx: Math.cos(angle) * projectileSpeed,
      vy: Math.sin(angle) * projectileSpeed,
      radius: 3,
      life: 1.15,
      hostile: false,
      damage: state.damageMultiplier * 1.28 ** (state.pulseLevel - 1),
      kind: 'pulse',
    });
  }
  burst(state, ship.x, ship.y, '#73f7ff', 3, 55);
  parts.behavior -= weights.shotCost;
}

function fireMissiles(state: ArenaState): void {
  const ship = state.ship;
  if (!(state.missileLevel > 0 && state.missileCooldown <= 0 && state.enemies.length)) return;
  const target = nearestEnemy(state);
  if (!target) return;
  const angle = Math.atan2(target.y - ship.y, target.x - ship.x);
  const count = 1 + Math.floor((state.missileLevel - 1) / 4);
  for (let index = 0; index < count; index += 1) {
    const spread = (index - (count - 1) / 2) * 0.12;
    state.projectiles.push({
      x: ship.x,
      y: ship.y,
      vx: Math.cos(angle + spread) * 410,
      vy: Math.sin(angle + spread) * 410,
      radius: 5,
      life: 1.8,
      hostile: false,
      damage: state.damageMultiplier * 1.8 * 1.32 ** (state.missileLevel - 1),
      kind: 'missile',
    });
  }
  state.missileCooldown = Math.max(0.42, 1.7 * 0.94 ** state.missileLevel);
}

function fireNova(state: ArenaState, parts: RewardParts, killedValues: number[]): void {
  const ship = state.ship;
  const weights = state.rewards;
  if (!(state.novaLevel > 0 && state.novaCooldown <= 0)) return;
  const range = 120 + state.novaLevel * 15;
  const damage = state.damageMultiplier * 0.85 * 1.35 ** (state.novaLevel - 1);
  for (const enemy of state.enemies) {
    if (distanceSq(enemy, ship) > range * range) continue;
    enemy.hp -= damage;
    addDamageNumber(state, enemy.x, enemy.y, damage, true);
    if (enemy.hp <= 0) {
      const value = enemyValue(enemy);
      state.score += value;
      state.kills += 1;
      killedValues.push(value);
      parts.progress += enemy.kind === 'brute' ? weights.bruteKill : weights.kill;
      burst(state, enemy.x, enemy.y, '#b86cff', 18, 180);
    }
  }
  state.novaCooldown = Math.max(2.2, 6.5 * 0.94 ** state.novaLevel);
  state.novaPulse = 1;
  burst(state, ship.x, ship.y, '#b86cff', 22, range);
}

function fireLaser(state: ArenaState, parts: RewardParts, killedValues: number[]): void {
  const ship = state.ship;
  const weights = state.rewards;
  if (!(state.laserLevel > 0 && state.laserCooldown <= 0)) return;
  const laserAngles = ship.craftType === 'strafer'
    ? [ship.angle + Math.PI / 2, ship.angle - Math.PI / 2]
    : [attackAngle(ship)];
  const length = 430 + state.laserLevel * 35;
  const width = 5 + state.laserLevel * 1.6;
  const damage = state.damageMultiplier * 0.72 * 1.3 ** (state.laserLevel - 1)
    / laserAngles.length;
  for (const angle of laserAngles) {
    const beamWidth = ship.craftType === 'interceptor' ? width * 1.35 : width;
    const points = ship.craftType === 'strafer'
      ? createLateralWave(ship, angle, length, state.laserLevel)
      : [
        { x: ship.x, y: ship.y },
        { x: ship.x + Math.cos(angle) * length, y: ship.y + Math.sin(angle) * length },
      ];
    const end = points[points.length - 1];
    state.beams.push({
      x1: ship.x,
      y1: ship.y,
      x2: end.x,
      y2: end.y,
      points,
      style: ship.craftType === 'interceptor'
        ? 'pulse'
        : ship.craftType === 'strafer'
          ? 'wave'
          : 'beam',
      angle,
      range: length,
      arc: ship.craftType === 'interceptor' ? Math.PI / 2 : undefined,
      width: beamWidth,
      life: ship.craftType === 'interceptor' ? 0.32 : 0.2,
      maxLife: ship.craftType === 'interceptor' ? 0.32 : 0.2,
    });
    for (const enemy of state.enemies) {
      const hit = ship.craftType === 'interceptor'
        ? pointInSector(enemy, ship, angle, Math.PI / 2, length, enemy.radius)
        : pointPathDistance(enemy, points) <= enemy.radius + beamWidth;
      if (enemy.hp <= 0 || !hit) {
        continue;
      }
      const appliedDamage = ship.craftType === 'interceptor' ? damage * 0.72 : damage;
      enemy.hp -= appliedDamage;
      addDamageNumber(state, enemy.x, enemy.y, appliedDamage, true);
      parts.progress += weights.beamHit;
      if (enemy.hp <= 0) {
        const value = enemyValue(enemy);
        state.score += value;
        state.kills += 1;
        killedValues.push(value);
        parts.progress += enemy.kind === 'brute' ? weights.bruteKill : weights.kill;
        burst(state, enemy.x, enemy.y, '#67f4ff', 18, 180);
      }
    }
    for (const projectile of state.projectiles) {
      if (!projectile.hostile || projectile.life <= 0) continue;
      const hit = ship.craftType === 'interceptor'
        ? pointInSector(projectile, ship, angle, Math.PI / 2, length, projectile.radius)
        : pointPathDistance(projectile, points) <= projectile.radius + beamWidth;
      if (!hit) continue;
      projectile.life = 0;
      parts.progress += weights.beamIntercept;
      burst(state, projectile.x, projectile.y, '#9ffcff', 6, 90);
    }
  }
  state.laserCooldown = Math.max(0.48, 1.65 * 0.92 ** state.laserLevel);
}

function fireRicochet(state: ArenaState): void {
  const ship = state.ship;
  if (!(state.ricochetLevel > 0 && state.ricochetCooldown <= 0)) return;
  const spread = (random(state) - 0.5) * 1.35;
  const angle = attackAngle(ship) + spread;
  const speed = 440 + state.ricochetLevel * 18;
  state.projectiles.push({
    x: ship.x + Math.cos(angle) * 18,
    y: ship.y + Math.sin(angle) * 18,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: 5,
    life: 5,
    hostile: false,
    damage: state.damageMultiplier * 0.82 * 1.27 ** (state.ricochetLevel - 1),
    kind: 'ricochet',
    bounces: 2 + Math.floor(state.ricochetLevel / 2),
  });
  state.ricochetCooldown = Math.max(0.55, 1.8 * 0.93 ** state.ricochetLevel);
}

function emitTrail(state: ArenaState): void {
  const ship = state.ship;
  if (!(state.trailLevel > 0 && state.trailCooldown <= 0 && Math.hypot(ship.vx, ship.vy) > 28)) return;
  const radius = 27 + state.trailLevel * 4;
  state.trails.push({
    x: ship.x,
    y: ship.y,
    radius,
    life: 2.4 + state.trailLevel * 0.18,
    maxLife: 2.4 + state.trailLevel * 0.18,
    damagePerSecond: state.damageMultiplier * 0.85 * 1.25 ** (state.trailLevel - 1),
    tickCooldown: 0,
  });
  if (state.trails.length > 36) state.trails.splice(0, state.trails.length - 36);
  state.trailCooldown = Math.max(0.16, 0.42 * 0.95 ** state.trailLevel);
}

function spawnWaveEnemies(state: ArenaState, dt: number): void {
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0 && state.waveSpawned < state.waveTotal && state.enemies.length < 42) {
    spawnEnemy(state);
    state.waveSpawned += 1;
    state.spawnTimer = Math.max(0.12, 0.9 * 0.985 ** state.wave);
  }
}

function spawnEnemy(state: ArenaState): void {
  const margin = 34;
  const minimumSpawnDistance = 320;
  let position: Vec2 | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = randomEdgePosition(state, margin);
    if (distanceSq(candidate, state.ship) < minimumSpawnDistance ** 2) continue;
    position = candidate;
    break;
  }
  if (!position) {
    const corners = [
      { x: margin, y: margin },
      { x: state.width - margin, y: margin },
      { x: state.width - margin, y: state.height - margin },
      { x: margin, y: state.height - margin },
    ];
    position = corners.reduce((farthest, candidate) =>
      distanceSq(candidate, state.ship) > distanceSq(farthest, state.ship) ? candidate : farthest
    );
  }
  const roll = random(state);
  const examBoost = state.wave % 5 === 0 ? 0.12 : 0;
  const kind: Enemy['kind'] = state.wave >= 5 && roll > 0.82 - examBoost
    ? 'brute'
    : state.wave >= 2 && roll > 0.55 - examBoost
      ? 'gunner'
      : 'scout';
  const hpScale = 1.07 ** (state.wave - 1);
  const baseHp = kind === 'brute' ? 5 : kind === 'gunner' ? 2 : 1;
  state.enemies.push({
    ...position,
    id: state.nextEnemyId++,
    angle: 0,
    radius: kind === 'brute' ? 21 : kind === 'gunner' ? 15 : 12,
    hp: baseHp * hpScale,
    speed: kind === 'brute' ? 55 : kind === 'gunner' ? 72 : 105,
    fireCooldown: 0.5 + random(state),
    kind,
  });
}

function updateEnemiesAndCollide(state: ArenaState, dt: number, parts: RewardParts, killedValues: number[]): void {
  const ship = state.ship;
  const weights = state.rewards;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const dx = ship.x - enemy.x;
    const dy = ship.y - enemy.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    enemy.angle = Math.atan2(dy, dx);
    enemy.x += dx / distance * enemy.speed * dt;
    enemy.y += dy / distance * enemy.speed * dt;
    enemy.fireCooldown -= dt;
    if (enemy.kind !== 'brute' && distance < 430 && enemy.fireCooldown <= 0) {
      const speed = enemy.kind === 'gunner' ? 285 : 235;
      enemy.fireCooldown = enemy.kind === 'gunner' ? 1.15 : 1.75;
      state.projectiles.push({
        x: enemy.x,
        y: enemy.y,
        vx: dx / distance * speed,
        vy: dy / distance * speed,
        radius: 4,
        life: 2.5,
        hostile: true,
        damage: 8 * 1.035 ** (state.wave - 1),
        kind: 'enemy',
      });
    }
    if (distance < ship.radius + enemy.radius) {
      enemy.hp = 0;
      const value = enemyValue(enemy);
      state.score += value;
      state.kills += 1;
      killedValues.push(value);
      burst(state, enemy.x, enemy.y, enemy.kind === 'brute' ? '#ff8c42' : '#ff4d8d', 18, 170);
      if (ship.invulnerability <= 0) {
        ship.hp -= enemy.kind === 'brute' ? 30 : enemy.kind === 'gunner' ? 20 : 16;
        addDamageNumber(
          state,
          ship.x,
          ship.y,
          enemy.kind === 'brute' ? 30 : enemy.kind === 'gunner' ? 20 : 16,
          false,
        );
        ship.invulnerability = 0.5;
        state.shake = 7;
        parts.safety -= weights.contactHit;
        burst(state, ship.x, ship.y, '#ff526f', 16, 150);
      }
    }
  }
}

function updateTrailDamage(state: ArenaState, dt: number, parts: RewardParts, killedValues: number[]): void {
  const weights = state.rewards;
  for (const trail of state.trails) {
    trail.life -= dt;
    trail.tickCooldown -= dt;
    if (trail.tickCooldown > 0) continue;
    trail.tickCooldown = 0.25;
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || distanceSq(trail, enemy) > (trail.radius + enemy.radius) ** 2) continue;
      const damage = trail.damagePerSecond * 0.25;
      enemy.hp -= damage;
      addDamageNumber(state, enemy.x, enemy.y, damage, true);
      parts.progress += weights.trailTick;
      if (enemy.hp <= 0) {
        const value = enemyValue(enemy);
        state.score += value;
        state.kills += 1;
        killedValues.push(value);
        parts.progress += enemy.kind === 'brute' ? weights.bruteKill : weights.kill;
        burst(state, enemy.x, enemy.y, '#54e3a6', 16, 150);
      }
    }
  }
  state.trails = state.trails.filter((trail) => trail.life > 0);
}

function advanceProjectilePositions(state: ArenaState, dt: number): void {
  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    if (projectile.kind === 'ricochet') {
      let bounced = false;
      if (projectile.x <= projectile.radius || projectile.x >= state.width - projectile.radius) {
        projectile.vx *= -1;
        projectile.x = clamp(projectile.x, projectile.radius, state.width - projectile.radius);
        bounced = true;
      }
      if (projectile.y <= projectile.radius || projectile.y >= state.height - projectile.radius) {
        projectile.vy *= -1;
        projectile.y = clamp(projectile.y, projectile.radius, state.height - projectile.radius);
        bounced = true;
      }
      if (bounced) {
        projectile.bounces = (projectile.bounces ?? 0) - 1;
        burst(state, projectile.x, projectile.y, '#ffe36e', 5, 70);
        if ((projectile.bounces ?? 0) < 0) projectile.life = 0;
      }
    }
  }
}

function interceptHostileProjectiles(state: ArenaState, dt: number, parts: RewardParts): void {
  const weights = state.rewards;
  if (!(state.projectileInterceptLevel > 0)) return;
  const interceptBonus = (state.projectileInterceptLevel - 1) * 2.5;
  const friendly = state.projectiles.filter((projectile) => !projectile.hostile && projectile.life > 0);
  const hostile = state.projectiles.filter((projectile) => projectile.hostile && projectile.life > 0);
  for (const shot of friendly) {
    if (shot.life <= 0) continue;
    for (const threat of hostile) {
      if (threat.life <= 0) continue;
      const collisionRadius = shot.radius + threat.radius + interceptBonus;
      if (!movingProjectilesCollide(shot, threat, dt, collisionRadius)) continue;
      shot.life = 0;
      threat.life = 0;
      parts.progress += weights.shotIntercept;
      burst(state, (shot.x + threat.x) / 2, (shot.y + threat.y) / 2, '#9ffcff', 8, 105);
      break;
    }
  }
}

function resolveProjectileEnemyHits(state: ArenaState, dt: number, parts: RewardParts, killedValues: number[]): void {
  const ship = state.ship;
  const weights = state.rewards;
  for (const projectile of state.projectiles) {
    if (projectile.life <= 0) continue;
    if (projectile.hostile) {
      if (distanceSq(projectile, ship) < (projectile.radius + ship.radius) ** 2 && ship.invulnerability <= 0) {
        projectile.life = 0;
        ship.hp -= projectile.damage;
        addDamageNumber(state, ship.x, ship.y, projectile.damage, false);
        ship.invulnerability = 0.28;
        state.shake = 5;
        parts.safety -= weights.projectileTaken;
        burst(state, ship.x, ship.y, '#ff526f', 10, 120);
      }
      continue;
    }
    for (const enemy of state.enemies) {
      if (projectile.kind === 'ricochet' && projectile.lastHitEnemyId === enemy.id) continue;
      const projectileHit = distanceSq(projectile, enemy) < (projectile.radius + enemy.radius) ** 2;
      const overlappingShip = distanceSq(ship, enemy) < (ship.radius + enemy.radius) ** 2;
      if (enemy.hp <= 0 || (!projectileHit && !overlappingShip)) continue;
      const ricochetContinues = projectile.kind === 'ricochet' && (projectile.bounces ?? 0) > 0;
      projectile.life = ricochetContinues ? projectile.life : 0;
      enemy.hp -= projectile.damage;
      addDamageNumber(state, enemy.x, enemy.y, projectile.damage, true);
      parts.progress += weights.projectileHit;
      burst(state, projectile.x, projectile.y, '#ffd166', 5, 80);
      if (enemy.hp <= 0) {
        const value = enemyValue(enemy);
        state.score += value;
        state.kills += 1;
        killedValues.push(value);
        parts.progress += enemy.kind === 'brute' ? weights.bruteKill : weights.kill;
        burst(state, enemy.x, enemy.y, enemy.kind === 'brute' ? '#ff8c42' : '#ff4d8d', 26, 210);
      }
      if (ricochetContinues) {
        projectile.bounces = (projectile.bounces ?? 1) - 1;
        projectile.lastHitEnemyId = enemy.id;
        reflectProjectileFromEnemy(projectile, enemy);
        projectile.x += projectile.vx * dt * 0.25;
        projectile.y += projectile.vy * dt * 0.25;
      }
      break;
    }
  }
}

function finalizeStepState(state: ArenaState, dt: number): boolean {
  let waveAdvanced = false;
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
  if (state.waveSpawned >= state.waveTotal && state.enemies.length === 0) {
    state.wave += 1;
    state.waveTime = 0;
    state.waveSpawned = 0;
    state.waveTotal = waveEnemyTotal(state.wave);
    state.spawnTimer = 0.65;
    waveAdvanced = true;
  }
  state.projectiles = state.projectiles.filter((projectile) =>
    projectile.life > 0
    && projectile.x > -30 && projectile.x < state.width + 30
    && projectile.y > -30 && projectile.y < state.height + 30
  );
  for (const particle of state.particles) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.96;
    particle.vy *= 0.96;
    particle.life -= dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);
  for (const number of state.damageNumbers) {
    number.y -= dt * 28;
    number.life -= dt;
  }
  state.damageNumbers = state.damageNumbers.filter((number) => number.life > 0);
  for (const beam of state.beams) beam.life -= dt;
  state.beams = state.beams.filter((beam) => beam.life > 0);
  return waveAdvanced;
}

function movingProjectilesCollide(
  first: Projectile,
  second: Projectile,
  dt: number,
  collisionRadius: number,
): boolean {
  const startX = (first.x - first.vx * dt) - (second.x - second.vx * dt);
  const startY = (first.y - first.vy * dt) - (second.y - second.vy * dt);
  const movementX = (first.vx - second.vx) * dt;
  const movementY = (first.vy - second.vy) * dt;
  const movementSq = movementX * movementX + movementY * movementY;
  const closestTime = movementSq > 0
    ? Math.max(0, Math.min(1, -(startX * movementX + startY * movementY) / movementSq))
    : 0;
  const closestX = startX + movementX * closestTime;
  const closestY = startY + movementY * closestTime;
  return closestX * closestX + closestY * closestY <= collisionRadius * collisionRadius;
}

function addDamageNumber(
  state: ArenaState,
  x: number,
  y: number,
  damage: number,
  friendly: boolean,
): void {
  state.damageNumbers.push({
    x,
    y: y - 12,
    amount: damage,
    friendly,
    life: 1,
    maxLife: 1,
  });
  if (state.damageNumbers.length > 80) {
    state.damageNumbers.splice(0, state.damageNumbers.length - 80);
  }
}

function pointSegmentDistance(point: Vec2, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0
    ? clamp(((point.x - x1) * dx + (point.y - y1) * dy) / lengthSq, 0, 1)
    : 0;
  return Math.hypot(point.x - (x1 + dx * t), point.y - (y1 + dy * t));
}

function pointPathDistance(point: Vec2, points: readonly Vec2[]): number {
  let nearest = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(
        point,
        points[index - 1].x,
        points[index - 1].y,
        points[index].x,
        points[index].y,
      ),
    );
  }
  return nearest;
}

function pointInSector(
  point: Vec2,
  origin: Vec2,
  direction: number,
  arc: number,
  range: number,
  radius = 0,
): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (Math.hypot(dx, dy) > range + radius) return false;
  const delta = Math.atan2(
    Math.sin(Math.atan2(dy, dx) - direction),
    Math.cos(Math.atan2(dy, dx) - direction),
  );
  return Math.abs(delta) <= arc / 2;
}

function createLateralWave(
  ship: Ship,
  lateralAngle: number,
  length: number,
  level: number,
): Vec2[] {
  const points: Vec2[] = [];
  const amplitude = 24 + level * 3;
  const forwardX = Math.cos(ship.angle);
  const forwardY = Math.sin(ship.angle);
  const lateralX = Math.cos(lateralAngle);
  const lateralY = Math.sin(lateralAngle);
  for (let index = 0; index <= 14; index += 1) {
    const progress = index / 14;
    const wave = Math.sin(progress * Math.PI * (3 + Math.min(3, level) * 0.35)) * amplitude * progress;
    points.push({
      x: ship.x + lateralX * length * progress + forwardX * wave,
      y: ship.y + lateralY * length * progress + forwardY * wave,
    });
  }
  return points;
}

function reflectProjectileFromEnemy(projectile: Projectile, enemy: Enemy): void {
  const normalLength = Math.max(1, Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y));
  const normalX = (projectile.x - enemy.x) / normalLength;
  const normalY = (projectile.y - enemy.y) / normalLength;
  const velocityAlongNormal = projectile.vx * normalX + projectile.vy * normalY;
  projectile.vx -= 2 * velocityAlongNormal * normalX;
  projectile.vy -= 2 * velocityAlongNormal * normalY;
  projectile.x = enemy.x + normalX * (enemy.radius + projectile.radius + 1);
  projectile.y = enemy.y + normalY * (enemy.radius + projectile.radius + 1);
}

function randomEdgePosition(state: ArenaState, margin: number): Vec2 {
  const edge = Math.floor(random(state) * 4);
  if (edge === 0) return { x: random(state) * state.width, y: margin };
  if (edge === 1) return { x: state.width - margin, y: random(state) * state.height };
  if (edge === 2) return { x: random(state) * state.width, y: state.height - margin };
  return { x: margin, y: random(state) * state.height };
}

function nearestEnemy(state: ArenaState): Enemy | null {
  let nearest: Enemy | null = null;
  let bestDistance = Infinity;
  for (const enemy of state.enemies) {
    const distance = distanceSq(enemy, state.ship);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = enemy;
    }
  }
  return nearest;
}

function enemyValue(enemy: Enemy): number {
  return enemy.kind === 'brute' ? 300 : enemy.kind === 'gunner' ? 180 : 100;
}

function resolveArenaBoundaryCollision(ship: Ship, width: number, height: number): boolean {
  const minimumX = ship.radius + 12;
  const maximumX = width - ship.radius - 12;
  const minimumY = ship.radius + 12;
  const maximumY = height - ship.radius - 12;
  let collided = false;
  if (ship.x < minimumX) {
    ship.x = minimumX;
    if (ship.vx < 0) ship.vx = 0;
    collided = true;
  } else if (ship.x > maximumX) {
    ship.x = maximumX;
    if (ship.vx > 0) ship.vx = 0;
    collided = true;
  }
  if (ship.y < minimumY) {
    ship.y = minimumY;
    if (ship.vy < 0) ship.vy = 0;
    collided = true;
  } else if (ship.y > maximumY) {
    ship.y = maximumY;
    if (ship.vy > 0) ship.vy = 0;
    collided = true;
  }
  return collided;
}

function nearestEdgeDistance(ship: Ship, width: number, height: number): number {
  return Math.min(ship.x, width - ship.x, ship.y, height - ship.y);
}

function burst(state: ArenaState, x: number, y: number, color: string, count: number, speed: number): void {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * TAU;
    const velocity = speed * (0.25 + Math.random() * 0.75);
    const life = 0.2 + Math.random() * 0.45;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life,
      maxLife: life,
      color,
    });
  }
}
