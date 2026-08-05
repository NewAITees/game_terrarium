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
  kind: 'pulse' | 'missile' | 'ricochet' | 'enemy';
  bounces?: number;
  lastHitEnemyId?: number;
};

export type BeamEffect = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  points?: Vec2[];
  style: 'beam' | 'pulse' | 'wave';
  angle?: number;
  range?: number;
  arc?: number;
  width: number;
  life: number;
  maxLife: number;
};

export type TrailField = Vec2 & {
  radius: number;
  life: number;
  maxLife: number;
  damagePerSecond: number;
  tickCooldown: number;
};

export type DamageNumber = Vec2 & {
  amount: number;
  friendly: boolean;
  life: number;
  maxLife: number;
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
  viewportWidth: number;
  viewportHeight: number;
  craftPreference: CraftPreference;
  ship: Ship;
  enemies: Enemy[];
  projectiles: Projectile[];
  beams: BeamEffect[];
  trails: TrailField[];
  damageNumbers: DamageNumber[];
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
  laserCooldown: number;
  ricochetCooldown: number;
  trailCooldown: number;
  novaCooldown: number;
  novaPulse: number;
  damageMultiplier: number;
  pulseLevel: number;
  fireRateLevel: number;
  projectileCountLevel: number;
  projectileSpeedLevel: number;
  projectileInterceptLevel: number;
  turretTurnLevel: number;
  missileLevel: number;
  novaLevel: number;
  laserLevel: number;
  ricochetLevel: number;
  trailLevel: number;
  rngState: number;
};

export type ArenaStepResult = {
  reward: number;
  killedValues: number[];
  waveAdvanced: boolean;
};

const CONTROL_VALUES = [-1, 0, 1] as const;
const FIRE_VALUES = [false, true] as const;

function actionLabel(thrust: -1 | 0 | 1, turn: -1 | 0 | 1, strafe: -1 | 0 | 1, aimTurn: -1 | 0 | 1, fire: boolean): string {
  const parts: string[] = [];
  if (thrust === 1) parts.push('前進'); else if (thrust === -1) parts.push('後退');
  if (turn === 1) parts.push('右旋回'); else if (turn === -1) parts.push('左旋回');
  if (strafe === 1) parts.push('右平行移動'); else if (strafe === -1) parts.push('左平行移動');
  if (aimTurn === 1) parts.push('砲塔右'); else if (aimTurn === -1) parts.push('砲塔左');
  if (fire) parts.push('射撃');
  return parts.join('＋') || '停止';
}

export const ACTIONS: readonly ArenaAction[] = CONTROL_VALUES.flatMap((thrust) => CONTROL_VALUES.flatMap((turn) => CONTROL_VALUES.flatMap((strafe) => CONTROL_VALUES.flatMap((aimTurn) => FIRE_VALUES.map((fire) => ({
  thrust, turn, strafe, aimTurn, fire, label: actionLabel(thrust, turn, strafe, aimTurn, fire),
}))))));
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
    viewportWidth: width,
    viewportHeight: height,
    craftPreference: 'random',
    ship: createShip(width, height),
    enemies: [],
    projectiles: [],
    beams: [],
    trails: [],
    damageNumbers: [],
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
    laserCooldown: 0,
    ricochetCooldown: 0,
    trailCooldown: 0,
    novaCooldown: 0,
    novaPulse: 0,
    damageMultiplier: 1,
    pulseLevel: 1,
    fireRateLevel: 0,
    projectileCountLevel: 0,
    projectileSpeedLevel: 0,
    projectileInterceptLevel: 1,
    turretTurnLevel: 0,
    missileLevel: 0,
    novaLevel: 0,
    laserLevel: 0,
    ricochetLevel: 0,
    trailLevel: 0,
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
  state.viewportWidth = Math.max(1, width);
  state.viewportHeight = Math.max(1, height);
}

export function getArenaCamera(state: ArenaState): { x: number; y: number; width: number; height: number } {
  const width = state.viewportWidth;
  const height = state.viewportHeight;
  const x = state.width <= width
    ? (state.width - width) / 2
    : clamp(state.ship.x - width / 2, 0, state.width - width);
  const y = state.height <= height
    ? (state.height - height) / 2
    : clamp(state.ship.y - height / 2, 0, state.height - height);
  return { x, y, width, height };
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
    projectileDistanceBand: thresholdBand(nearestProjectileDistance, [90, 220]),
    velocitySector,
    speedBand: thresholdBand(speed, [45, 150]),
    edgeSector: angleToSector(normalizeAngle(nearestEdge.angle - state.ship.angle)),
    edgeDistanceBand: edgeDistanceBand(nearestEdge.distance),
    edgeDistanceBands: edges.map((edge) => edgeDistanceBand(edge.distance)),
    pulseProjectileCount: projectileCount,
    pulseProjectileParity: projectileCount % 2 as 0 | 1,
    distanceBand: thresholdBand(nearestDistance, [150, 340]),
    hpBand: thresholdBand(state.ship.hp, [35, 70]),
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
  state.laserCooldown -= dt;
  state.ricochetCooldown -= dt;
  state.trailCooldown -= dt;

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
      addDamageNumber(state, enemy.x, enemy.y, damage, true);
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

  if (state.laserLevel > 0 && state.laserCooldown <= 0) {
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
        reward += 0.12;
        if (enemy.hp <= 0) {
          const value = enemyValue(enemy);
          state.score += value;
          state.kills += 1;
          killedValues.push(value);
          reward += enemy.kind === 'brute' ? 4.5 : 3;
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
        reward += 0.08;
        burst(state, projectile.x, projectile.y, '#9ffcff', 6, 90);
      }
    }
    state.laserCooldown = Math.max(0.48, 1.65 * 0.92 ** state.laserLevel);
  }

  if (state.ricochetLevel > 0 && state.ricochetCooldown <= 0) {
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

  if (state.trailLevel > 0 && state.trailCooldown <= 0 && Math.hypot(ship.vx, ship.vy) > 28) {
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

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0 && state.waveSpawned < state.waveTotal && state.enemies.length < 42) {
    spawnEnemy(state);
    state.waveSpawned += 1;
    state.spawnTimer = Math.max(0.12, 0.9 * 0.985 ** state.wave);
  }

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
        reward -= 2.2;
        burst(state, ship.x, ship.y, '#ff526f', 16, 150);
      }
    }
  }

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
      reward += 0.01;
      if (enemy.hp <= 0) {
        const value = enemyValue(enemy);
        state.score += value;
        state.kills += 1;
        killedValues.push(value);
        reward += enemy.kind === 'brute' ? 4.5 : 3;
        burst(state, enemy.x, enemy.y, '#54e3a6', 16, 150);
      }
    }
  }
  state.trails = state.trails.filter((trail) => trail.life > 0);

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

  if (state.projectileInterceptLevel > 0) {
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
        reward += 0.12;
        burst(state, (shot.x + threat.x) / 2, (shot.y + threat.y) / 2, '#9ffcff', 8, 105);
        break;
      }
    }
  }

  for (const projectile of state.projectiles) {
    if (projectile.life <= 0) continue;
    if (projectile.hostile) {
      if (distanceSq(projectile, ship) < (projectile.radius + ship.radius) ** 2 && ship.invulnerability <= 0) {
        projectile.life = 0;
        ship.hp -= projectile.damage;
        addDamageNumber(state, ship.x, ship.y, projectile.damage, false);
        ship.invulnerability = 0.28;
        state.shake = 5;
        reward -= 1.6;
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
  state.lastReward = reward;
  state.episodeReward += reward;
  return { reward, killedValues, waveAdvanced };
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
  state.beams = [];
  state.trails = [];
  state.damageNumbers = [];
  state.particles = [];
  state.spawnTimer = 0.2;
  state.episodeReward = 0;
  state.missileCooldown = 0;
  state.laserCooldown = 0;
  state.ricochetCooldown = 0;
  state.trailCooldown = 0;
  state.novaCooldown = 0;
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

function sensorDistanceBand(normalizedDistance: number): number { return thresholdBand(normalizedDistance, [0.12, 0.3]); }

function countBand(count: number): number { return thresholdBand(count, [1, 3, 6, 10]); }

function edgeDistanceBand(distance: number): number { return thresholdBand(distance, [55, 140]); }

function pulseProjectileCount(level: number): number {
  return Math.min(5, 1 + Math.floor((level + 1) / 2));
}
import { thresholdBand } from '../../shared/rl/discretize.js';
