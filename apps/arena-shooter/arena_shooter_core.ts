export type Vec2 = { x: number; y: number };

export type CraftType = 'interceptor' | 'strafer' | 'turret';
export type CraftPreference = CraftType | 'random';

export type Ship = Vec2 & {
  craftType: CraftType;
  vx: number;
  vy: number;
  angle: number;
  turretAngle: number;
  radius: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  invulnerability: number;
};

export type Enemy = Vec2 & {
  id: number;
  angle: number;
  radius: number;
  hp: number;
  speed: number;
  fireCooldown: number;
  kind: 'scout' | 'gunner' | 'brute';
};

export type Projectile = Vec2 & {
  vx: number;
  vy: number;
  radius: number;
  life: number;
  hostile: boolean;
  damage: number;
  kind: 'pulse' | 'missile' | 'enemy';
};

export type Particle = Vec2 & {
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
};

export type ArenaAction = {
  thrust: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  strafe: -1 | 0 | 1;
  aimTurn: -1 | 0 | 1;
  fire: boolean;
  label: string;
};

export type ArenaObservation = {
  craftType: CraftType;
  dangerSector: number;
  targetSector: number;
  aimSector: number;
  projectileDangerSector: number;
  projectileDistanceBand: number;
  velocitySector: number;
  speedBand: number;
  edgeSector: number;
  edgeDistanceBand: number;
  edgeDistanceBands: readonly number[];
  pulseProjectileCount: number;
  pulseProjectileParity: 0 | 1;
  distanceBand: number;
  hpBand: number;
  enemyCountBand: number;
  hostileProjectileCountBand: number;
  canFire: boolean;
  sectorDistances: readonly number[];
  sectorProjectileDistances: readonly number[];
};

export type ArenaState = {
  width: number;
  height: number;
  craftPreference: CraftPreference;
  ship: Ship;
  enemies: Enemy[];
  projectiles: Projectile[];
  particles: Particle[];
  elapsed: number;
  episode: number;
  episodeTime: number;
  score: number;
  kills: number;
  wave: number;
  waveTime: number;
  waveDuration: number;
  waveSpawned: number;
  waveTotal: number;
  nextEnemyId: number;
  spawnTimer: number;
  shake: number;
  lastReward: number;
  episodeReward: number;
  bestScore: number;
  missileCooldown: number;
  novaCooldown: number;
  novaPulse: number;
  damageMultiplier: number;
  pulseLevel: number;
  fireRateLevel: number;
  projectileCountLevel: number;
  projectileSpeedLevel: number;
  turretTurnLevel: number;
  missileLevel: number;
  novaLevel: number;
  rngState: number;
};

export type ArenaStepResult = {
  reward: number;
  killedValues: number[];
  waveAdvanced: boolean;
};

export const ACTIONS: readonly ArenaAction[] = [
  { thrust: 1, turn: 0, strafe: 0, aimTurn: 0, fire: false, label: '前進' },
  { thrust: -1, turn: 0, strafe: 0, aimTurn: 0, fire: false, label: '後退' },
  { thrust: 0, turn: -1, strafe: 0, aimTurn: 0, fire: false, label: '左旋回' },
  { thrust: 0, turn: 1, strafe: 0, aimTurn: 0, fire: false, label: '右旋回' },
  { thrust: 1, turn: -1, strafe: 0, aimTurn: 0, fire: false, label: '前進＋左' },
  { thrust: 1, turn: 1, strafe: 0, aimTurn: 0, fire: false, label: '前進＋右' },
  { thrust: 0, turn: 0, strafe: 0, aimTurn: 0, fire: true, label: '射撃' },
  { thrust: 1, turn: 0, strafe: 0, aimTurn: 0, fire: true, label: '前進＋射撃' },
  { thrust: -1, turn: 0, strafe: 0, aimTurn: 0, fire: true, label: '後退＋射撃' },
  { thrust: 0, turn: 0, strafe: -1, aimTurn: 0, fire: false, label: '左平行移動' },
  { thrust: 0, turn: 0, strafe: 1, aimTurn: 0, fire: false, label: '右平行移動' },
  { thrust: 0, turn: 0, strafe: -1, aimTurn: 0, fire: true, label: '左平行移動＋射撃' },
  { thrust: 0, turn: 0, strafe: 1, aimTurn: 0, fire: true, label: '右平行移動＋射撃' },
  { thrust: 0, turn: 0, strafe: 0, aimTurn: -1, fire: false, label: '砲塔左旋回' },
  { thrust: 0, turn: 0, strafe: 0, aimTurn: 1, fire: false, label: '砲塔右旋回' },
  { thrust: 1, turn: 0, strafe: 0, aimTurn: -1, fire: true, label: '前進＋砲塔左＋射撃' },
  { thrust: 1, turn: 0, strafe: 0, aimTurn: 1, fire: true, label: '前進＋砲塔右＋射撃' },
] as const;

const TAU = Math.PI * 2;

const CRAFT_TYPES: readonly CraftType[] = ['interceptor', 'strafer', 'turret'];

const CRAFT_DEFINITIONS: Record<CraftType, {
  forwardAcceleration: number;
  reverseAcceleration: number;
  strafeAcceleration: number;
  maxSpeed: number;
  turnSpeed: number;
  turretTurnSpeed: number;
}> = {
  interceptor: {
    forwardAcceleration: 390,
    reverseAcceleration: 245,
    strafeAcceleration: 0,
    maxSpeed: 270,
    turnSpeed: 3.15,
    turretTurnSpeed: 0,
  },
  strafer: {
    forwardAcceleration: 270,
    reverseAcceleration: 205,
    strafeAcceleration: 135,
    maxSpeed: 205,
    turnSpeed: 2.25,
    turretTurnSpeed: 0,
  },
  turret: {
    forwardAcceleration: 255,
    reverseAcceleration: 165,
    strafeAcceleration: 0,
    maxSpeed: 190,
    turnSpeed: 1.8,
    turretTurnSpeed: 1.35,
  },
};

export function isActionAllowed(craftType: CraftType, action: ArenaAction): boolean {
  if (action.strafe !== 0 && craftType !== 'strafer') return false;
  if (action.aimTurn !== 0 && craftType !== 'turret') return false;
  return true;
}

export function craftLabel(craftType: CraftType): string {
  if (craftType === 'interceptor') return 'INTERCEPTOR';
  if (craftType === 'strafer') return 'STRAFER';
  return 'TURRET';
}

export function setCraftPreference(
  state: ArenaState,
  preference: CraftPreference,
  applyImmediately = true,
): void {
  state.craftPreference = preference;
  if (!applyImmediately) return;
  if (preference === 'random') randomizeCraft(state);
  else setCraftType(state.ship, preference);
}

export function createArenaState(width = 1280, height = 720): ArenaState {
  const state: ArenaState = {
    width,
    height,
    craftPreference: 'random',
    ship: createShip(width, height),
    enemies: [],
    projectiles: [],
    particles: [],
    elapsed: 0,
    episode: 1,
    episodeTime: 0,
    score: 0,
    kills: 0,
    wave: 1,
    waveTime: 0,
    waveDuration: 18,
    waveSpawned: 0,
    waveTotal: waveEnemyTotal(1),
    nextEnemyId: 1,
    spawnTimer: 0.2,
    shake: 0,
    lastReward: 0,
    episodeReward: 0,
    bestScore: 0,
    missileCooldown: 0,
    novaCooldown: 0,
    novaPulse: 0,
    damageMultiplier: 1,
    pulseLevel: 1,
    fireRateLevel: 0,
    projectileCountLevel: 0,
    projectileSpeedLevel: 0,
    turretTurnLevel: 0,
    missileLevel: 0,
    novaLevel: 0,
    rngState: 0x6d2b79f5,
  };
  randomizeCraft(state);
  return state;
}

function createShip(width: number, height: number): Ship {
  return {
    x: width / 2,
    y: height / 2,
    craftType: 'interceptor',
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    turretAngle: -Math.PI / 2,
    radius: 15,
    hp: 100,
    maxHp: 100,
    fireCooldown: 0,
    invulnerability: 0,
  };
}

export function resizeArena(state: ArenaState, width: number, height: number): void {
  state.width = width;
  state.height = height;
  state.ship.x = clamp(state.ship.x, 30, width - 30);
  state.ship.y = clamp(state.ship.y, 30, height - 30);
}

export function prepareArenaWave(state: ArenaState): void {
  state.waveTime = 0;
  state.waveSpawned = 0;
  state.waveTotal = waveEnemyTotal(state.wave);
  state.spawnTimer = 0.2;
}

export function observeArena(state: ArenaState): ArenaObservation {
  const distances = Array<number>(8).fill(1);
  const projectileDistances = Array<number>(8).fill(1);
  let nearestDistance = Infinity;
  let targetSector = 0;
  let aimSector = 0;
  let dangerSector = 0;
  let highestDanger = -1;
  let projectileDangerSector = 0;
  let nearestProjectileDistance = Infinity;
  let hostileProjectileCount = 0;
  const diagonal = Math.hypot(state.width, state.height);
  const speed = Math.hypot(state.ship.vx, state.ship.vy);
  const velocitySector = speed > 1
    ? angleToSector(normalizeAngle(Math.atan2(state.ship.vy, state.ship.vx) - state.ship.angle))
    : 0;
  const edges = [
    { distance: state.ship.x, angle: Math.PI },
    { distance: state.width - state.ship.x, angle: 0 },
    { distance: state.ship.y, angle: -Math.PI / 2 },
    { distance: state.height - state.ship.y, angle: Math.PI / 2 },
  ];
  const nearestEdge = edges.reduce((nearest, edge) =>
    edge.distance < nearest.distance ? edge : nearest
  );
  const projectileCount = pulseProjectileCount(state.projectileCountLevel);

  for (const enemy of state.enemies) {
    const dx = enemy.x - state.ship.x;
    const dy = enemy.y - state.ship.y;
    const distance = Math.hypot(dx, dy);
    const relative = normalizeAngle(Math.atan2(dy, dx) - state.ship.angle);
    const sector = angleToSector(relative);
    distances[sector] = Math.min(distances[sector], distance / diagonal);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      targetSector = sector;
      aimSector = angleToFineSector(normalizeAngle(Math.atan2(dy, dx) - attackAngle(state.ship)));
    }
    const danger = (enemy.kind === 'brute' ? 1.25 : 1) / Math.max(50, distance);
    if (danger > highestDanger) {
      highestDanger = danger;
      dangerSector = sector;
    }
  }

  for (const projectile of state.projectiles) {
    if (!projectile.hostile) continue;
    hostileProjectileCount += 1;
    const dx = projectile.x - state.ship.x;
    const dy = projectile.y - state.ship.y;
    const distance = Math.hypot(dx, dy);
    const relative = normalizeAngle(Math.atan2(dy, dx) - state.ship.angle);
    const sector = angleToSector(relative);
    projectileDistances[sector] = Math.min(projectileDistances[sector], distance / diagonal);
    const closingSpeed = -(dx * projectile.vx + dy * projectile.vy) / Math.max(1, distance);
    if (closingSpeed > 0 && distance < nearestProjectileDistance) {
      nearestProjectileDistance = distance;
      projectileDangerSector = sector;
    }
  }

  return {
    craftType: state.ship.craftType,
    dangerSector,
    targetSector,
    aimSector,
    projectileDangerSector,
    projectileDistanceBand: nearestProjectileDistance < 90 ? 0 : nearestProjectileDistance < 220 ? 1 : 2,
    velocitySector,
    speedBand: speed < 45 ? 0 : speed < 150 ? 1 : 2,
    edgeSector: angleToSector(normalizeAngle(nearestEdge.angle - state.ship.angle)),
    edgeDistanceBand: edgeDistanceBand(nearestEdge.distance),
    edgeDistanceBands: edges.map((edge) => edgeDistanceBand(edge.distance)),
    pulseProjectileCount: projectileCount,
    pulseProjectileParity: projectileCount % 2 as 0 | 1,
    distanceBand: nearestDistance < 150 ? 0 : nearestDistance < 340 ? 1 : 2,
    hpBand: state.ship.hp < 35 ? 0 : state.ship.hp < 70 ? 1 : 2,
    enemyCountBand: countBand(state.enemies.length),
    hostileProjectileCountBand: countBand(hostileProjectileCount),
    canFire: state.ship.fireCooldown <= 0,
    sectorDistances: distances,
    sectorProjectileDistances: projectileDistances,
  };
}

export function encodeObservation(observation: ArenaObservation): string {
  return [
    observation.craftType,
    observation.targetSector,
    observation.aimSector,
    observation.dangerSector,
    observation.projectileDangerSector,
    observation.projectileDistanceBand,
    observation.velocitySector,
    observation.speedBand,
    observation.edgeSector,
    observation.edgeDistanceBand,
    observation.edgeDistanceBands.join(''),
    observation.pulseProjectileCount,
    observation.pulseProjectileParity,
    observation.distanceBand,
    observation.hpBand,
    observation.enemyCountBand,
    observation.hostileProjectileCountBand,
    observation.canFire ? 1 : 0,
    observation.sectorDistances.map(sensorDistanceBand).join(''),
    observation.sectorProjectileDistances.map(sensorDistanceBand).join(''),
  ].join(':');
}

export function stepArena(state: ArenaState, action: ArenaAction, dt: number): ArenaStepResult {
  const ship = state.ship;
  const killedValues: number[] = [];
  let waveAdvanced = false;
  state.elapsed += dt;
  state.episodeTime += dt;
  state.waveTime += dt;
  state.shake = Math.max(0, state.shake - dt * 18);
  state.novaPulse = Math.max(0, state.novaPulse - dt * 2.2);
  ship.fireCooldown -= dt;
  ship.invulnerability -= dt;
  state.missileCooldown -= dt;
  state.novaCooldown -= dt;

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

  let reward = dt * 0.035;
  if (edgeDistanceAfterMove < 140) {
    reward -= dt * 0.12;
    reward += clamp((edgeDistanceAfterMove - edgeDistanceBeforeMove) * 0.02, -0.25, 0.25);
  }
  if (hitBoundary) reward -= 0.8;
  if (action.fire && ship.fireCooldown <= 0) {
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
    reward -= 0.006;
  }

  if (state.missileLevel > 0 && state.missileCooldown <= 0 && state.enemies.length) {
    const target = nearestEnemy(state);
    if (target) {
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
  }

  if (state.novaLevel > 0 && state.novaCooldown <= 0) {
    const range = 120 + state.novaLevel * 15;
    const damage = state.damageMultiplier * 0.85 * 1.35 ** (state.novaLevel - 1);
    for (const enemy of state.enemies) {
      if (distanceSq(enemy, ship) > range * range) continue;
      enemy.hp -= damage;
      if (enemy.hp <= 0) {
        const value = enemyValue(enemy);
        state.score += value;
        state.kills += 1;
        killedValues.push(value);
        reward += enemy.kind === 'brute' ? 4.5 : 3;
        burst(state, enemy.x, enemy.y, '#b86cff', 18, 180);
      }
    }
    state.novaCooldown = Math.max(2.2, 6.5 * 0.94 ** state.novaLevel);
    state.novaPulse = 1;
    burst(state, ship.x, ship.y, '#b86cff', 22, range);
  }

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0 && state.waveSpawned < state.waveTotal && state.enemies.length < 42) {
    spawnEnemy(state);
    state.waveSpawned += 1;
    state.spawnTimer = Math.max(0.12, 0.9 * 0.985 ** state.wave);
  }

  for (const enemy of state.enemies) {
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
        ship.hp -= enemy.kind === 'brute' ? 18 : 10;
        ship.invulnerability = 0.5;
        state.shake = 7;
        reward -= 2.2;
        burst(state, ship.x, ship.y, '#ff526f', 16, 150);
      }
    }
  }

  for (const projectile of state.projectiles) {
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;
    projectile.life -= dt;
    if (projectile.hostile) {
      if (distanceSq(projectile, ship) < (projectile.radius + ship.radius) ** 2 && ship.invulnerability <= 0) {
        projectile.life = 0;
        ship.hp -= projectile.damage;
        ship.invulnerability = 0.28;
        state.shake = 5;
        reward -= 1.6;
        burst(state, ship.x, ship.y, '#ff526f', 10, 120);
      }
      continue;
    }
    for (const enemy of state.enemies) {
      const projectileHit = distanceSq(projectile, enemy) < (projectile.radius + enemy.radius) ** 2;
      const overlappingShip = distanceSq(ship, enemy) < (ship.radius + enemy.radius) ** 2;
      if (enemy.hp <= 0 || (!projectileHit && !overlappingShip)) continue;
      projectile.life = 0;
      enemy.hp -= projectile.damage;
      reward += 0.18;
      burst(state, projectile.x, projectile.y, '#ffd166', 5, 80);
      if (enemy.hp <= 0) {
        const value = enemyValue(enemy);
        state.score += value;
        state.kills += 1;
        killedValues.push(value);
        reward += enemy.kind === 'brute' ? 4.5 : 3;
        burst(state, enemy.x, enemy.y, enemy.kind === 'brute' ? '#ff8c42' : '#ff4d8d', 26, 210);
      }
      break;
    }
  }

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
  state.lastReward = reward;
  state.episodeReward += reward;
  return { reward, killedValues, waveAdvanced };
}

export function resetEpisode(state: ArenaState): void {
  state.bestScore = Math.max(state.bestScore, state.score);
  state.episode += 1;
  state.episodeTime = 0;
  state.score = 0;
  state.kills = 0;
  state.wave = 1;
  prepareArenaWave(state);
  state.ship = createShip(state.width, state.height);
  if (state.craftPreference === 'random') randomizeCraft(state);
  else setCraftType(state.ship, state.craftPreference);
  state.enemies = [];
  state.projectiles = [];
  state.particles = [];
  state.spawnTimer = 0.2;
  state.episodeReward = 0;
  state.missileCooldown = 0;
  state.novaCooldown = 0;
}

function spawnEnemy(state: ArenaState): void {
  const edge = Math.floor(random(state) * 4);
  const margin = 34;
  const position = edge === 0
    ? { x: random(state) * state.width, y: margin }
    : edge === 1
      ? { x: state.width - margin, y: random(state) * state.height }
      : edge === 2
        ? { x: random(state) * state.width, y: state.height - margin }
        : { x: margin, y: random(state) * state.height };
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

function craftDefinition(craftType: CraftType): typeof CRAFT_DEFINITIONS[CraftType] {
  return CRAFT_DEFINITIONS[craftType];
}

function attackAngle(ship: Ship): number {
  return ship.craftType === 'turret' ? ship.turretAngle : ship.angle;
}

function randomizeCraft(state: ArenaState): void {
  const craftType = CRAFT_TYPES[Math.floor(random(state) * CRAFT_TYPES.length)];
  setCraftType(state.ship, craftType);
}

function setCraftType(ship: Ship, craftType: CraftType): void {
  ship.craftType = craftType;
  ship.turretAngle = ship.angle;
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

function waveEnemyTotal(wave: number): number {
  const trialBonus = wave % 5 === 0 ? 6 : 0;
  return Math.min(60, 6 + wave * 2 + trialBonus);
}

function random(state: ArenaState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let value = state.rngState;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
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

function angleToSector(angle: number): number {
  return Math.floor((normalizeAngle(angle) + Math.PI / 8) / (Math.PI / 4)) % 8;
}

function angleToFineSector(angle: number): number {
  return Math.floor((normalizeAngle(angle) + Math.PI / 16) / (Math.PI / 8)) % 16;
}

function normalizeAngle(angle: number): number {
  return (angle % TAU + TAU) % TAU;
}

function distanceSq(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function sensorDistanceBand(normalizedDistance: number): number {
  if (normalizedDistance < 0.12) return 0;
  if (normalizedDistance < 0.3) return 1;
  return 2;
}

function countBand(count: number): number {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

function edgeDistanceBand(distance: number): number {
  if (distance < 55) return 0;
  if (distance < 140) return 1;
  return 2;
}

function pulseProjectileCount(level: number): number {
  return Math.min(5, 1 + Math.floor((level + 1) / 2));
}
