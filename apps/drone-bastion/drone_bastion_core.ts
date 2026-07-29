export type DroneKind = 'pawn' | 'rook' | 'bishop' | 'knight' | 'queen';
export type DroneMode = 'controlled' | 'braking' | 'turret' | 'disabled';
export type DroneWeapon = 'missile' | 'mortar' | 'pierce' | 'ricochet' | 'arc';
export type DroneChassis = 'light_heli' | 'tank' | 'robot' | 'heavy_heli' | 'heavy_robot';

export type DroneAction = {
  label: string;
  thrust: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  brake: boolean;
  fire: boolean;
  switch: -1 | 0 | 1;
};

export type BastionDrone = {
  id: number;
  kind: DroneKind;
  mode: DroneMode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
  throttle: number;
  hp: number;
  maxHp: number;
  fireCooldown: number;
  anchorTimer: number;
  respawnRemaining: number;
  powerLevel: number;
};

export type BastionEnemy = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  attackCooldown: number;
  kind: 'swarm' | 'brute';
};

export type BastionProjectile = {
  id: number;
  kind: Exclude<DroneWeapon, 'arc'>;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  life: number;
  maxLife: number;
  targetEnemyId: number | null;
  targetX: number;
  targetY: number;
  bounces: number;
  pierceRemaining: number;
  hitEnemyIds: number[];
};

export type BastionEffect = {
  kind: 'arc' | 'blast';
  x: number;
  y: number;
  angle: number;
  radius: number;
  life: number;
  maxLife: number;
};

export type BastionDamageNumber = {
  id: number;
  x: number;
  y: number;
  amount: number;
  target: 'enemy' | 'drone' | 'tower';
  life: number;
  maxLife: number;
};

export type BastionWall = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
};

export type DroneBastionState = {
  width: number;
  height: number;
  seed: number;
  rngState: number;
  elapsed: number;
  episode: number;
  episodeTime: number;
  score: number;
  kills: number;
  tower: { x: number; y: number; hp: number; maxHp: number; radius: number };
  drones: BastionDrone[];
  selectedDrone: number;
  enemies: BastionEnemy[];
  projectiles: BastionProjectile[];
  effects: BastionEffect[];
  damageNumbers: BastionDamageNumber[];
  walls: BastionWall[];
  wave: number;
  waveRemaining: number;
  waveSpawned: number;
  spawnTimer: number;
  waveCooldown: number;
  nextEnemyId: number;
  nextDroneId: number;
  nextProjectileId: number;
  nextDamageNumberId: number;
  gameOver: boolean;
  pendingUpgrade: boolean;
  lastUpgrade: string;
  lastReward: number;
  episodeReward: number;
};

export type DroneBastionObservation = {
  towerHpBand: number;
  selectedKind: DroneKind;
  speedBand: number;
  aimSector: number;
  distanceBand: number;
  threatSector: number;
  threatBand: number;
  wallBand: number;
  droneCountBand: number;
  selectedHpBand: number;
  /**
   * Fixed 96-value observation for scalable policies:
   * tower threat 24, local threat 16, wall health 8, fleet slots 42, globals 6.
   * The tabular learner deliberately encodes only the coarse fields above.
   */
  dense: readonly number[];
};

export type DroneBastionStepResult = {
  reward: number;
  towerDamage: number;
  hits: number;
  kills: number;
  waveAdvanced: boolean;
  switched: boolean;
};

type WeaponResult = {
  hits: number;
  kills: number;
  reward: number;
};

const DRONE_SPECS = {
  pawn: {
    chassis: 'light_heli' as const,
    weapon: 'missile' as const,
    radius: 10,
    maxHp: 70,
    thrust: 230,
    reverse: 165,
    brake: 275,
    drag: 0.32,
    turn: 3.1,
    maxSpeed: 150,
    projectileSpeed: 330,
    damage: 6,
    cooldown: 0.85,
    range: 280,
    minRange: 0,
  },
  rook: {
    chassis: 'tank' as const,
    weapon: 'mortar' as const,
    radius: 15,
    maxHp: 150,
    thrust: 105,
    reverse: 65,
    brake: 82,
    drag: 0.08,
    turn: 1.25,
    maxSpeed: 84,
    projectileSpeed: 230,
    damage: 44,
    cooldown: 1.18,
    range: 350,
    minRange: 105,
  },
  bishop: {
    chassis: 'robot' as const,
    weapon: 'pierce' as const,
    radius: 13,
    maxHp: 105,
    thrust: 145,
    reverse: 92,
    brake: 145,
    drag: 0.16,
    turn: 1.75,
    maxSpeed: 105,
    projectileSpeed: 470,
    damage: 31,
    cooldown: 0.7,
    range: 410,
    minRange: 0,
  },
  knight: {
    chassis: 'heavy_heli' as const,
    weapon: 'ricochet' as const,
    radius: 12,
    maxHp: 90,
    thrust: 205,
    reverse: 145,
    brake: 205,
    drag: 0.22,
    turn: 2.65,
    maxSpeed: 132,
    projectileSpeed: 390,
    damage: 12,
    cooldown: 0.3,
    range: 330,
    minRange: 0,
  },
  queen: {
    chassis: 'heavy_robot' as const,
    weapon: 'arc' as const,
    radius: 18,
    maxHp: 185,
    thrust: 72,
    reverse: 42,
    brake: 54,
    drag: 0.055,
    turn: 0.82,
    maxSpeed: 62,
    projectileSpeed: 0,
    damage: 58,
    cooldown: 1.4,
    range: 230,
    minRange: 0,
  },
} as const;

export function createDroneBastionState(
  width = 1200,
  height = 760,
  seed = 1,
): DroneBastionState {
  const tower = { x: width / 2, y: height / 2, hp: 320, maxHp: 320, radius: 50 };
  const state: DroneBastionState = {
    width,
    height,
    seed,
    rngState: seed >>> 0,
    elapsed: 0,
    episode: 1,
    episodeTime: 0,
    score: 0,
    kills: 0,
    tower,
    drones: [],
    selectedDrone: 0,
    enemies: [],
    projectiles: [],
    effects: [],
    damageNumbers: [],
    walls: createWalls(tower.x, tower.y),
    wave: 1,
    waveRemaining: waveEnemyTotal(1),
    waveSpawned: 0,
    spawnTimer: 0.6,
    waveCooldown: 0,
    nextEnemyId: 1,
    nextDroneId: 1,
    nextProjectileId: 1,
    nextDamageNumberId: 1,
    gameOver: false,
    pendingUpgrade: false,
    lastUpgrade: 'INITIAL FLEET',
    lastReward: 0,
    episodeReward: 0,
  };
  addDrone(state, 'pawn');
  addDrone(state, 'rook');
  addDrone(state, 'bishop');
  selectDrone(state, 0);
  return state;
}

export function stepDroneBastion(
  state: DroneBastionState,
  action: DroneAction,
  dt: number,
): DroneBastionStepResult {
  if (state.gameOver || state.pendingUpgrade || dt <= 0) {
    return { reward: 0, towerDamage: 0, hits: 0, kills: 0, waveAdvanced: false, switched: false };
  }
  state.elapsed += dt;
  state.episodeTime += dt;
  let reward = dt * 0.018;
  let towerDamage = 0;
  let hits = 0;
  let kills = 0;
  let waveAdvanced = false;
  let switched = false;

  if (action.switch !== 0 && state.drones.length > 1) {
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
      reward -= 0.04;
      switched = true;
    }
  }

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
        hits += weapon.hits;
        kills += weapon.kills;
        reward += weapon.reward;
      }
    } else {
      const weapon = updateAutomaticDrone(state, drone, dt);
      hits += weapon.hits;
      kills += weapon.kills;
      reward += weapon.reward;
    }
    containDrone(state, drone);
  }

  state.spawnTimer -= dt;
  if (state.waveRemaining > 0 && state.spawnTimer <= 0 && state.enemies.length < 240) {
    spawnEnemy(state);
    state.spawnTimer = Math.max(0.1, 0.82 - state.wave * 0.028) + random(state) * 0.26;
  }

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
        reward -= 0.08;
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
        reward -= 0.45;
        if (drone.hp <= 0) {
          drone.mode = 'disabled';
          drone.respawnRemaining = respawnDuration(drone);
          drone.vx = 0;
          drone.vy = 0;
          reward -= 4;
          ensureSelectedDrone(state);
        }
      }
    }

    if (Math.hypot(enemy.x - state.tower.x, enemy.y - state.tower.y) <= enemy.radius + state.tower.radius) {
      if (enemy.attackCooldown <= 0) {
        const damage = enemy.damage * (enemy.kind === 'brute' ? 1.25 : 1);
        state.tower.hp = Math.max(0, state.tower.hp - damage);
        addDamageNumber(state, state.tower.x, state.tower.y, damage, 'tower');
        towerDamage += damage;
        enemy.attackCooldown = 0.68;
        reward -= damage * 0.22;
      }
    }
  }

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
        hits += 1;
        kills += result.killed;
        reward += result.reward;
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
      hits += 1;
      kills += result.killed;
      reward += result.reward;
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
  for (let index = state.effects.length - 1; index >= 0; index -= 1) {
    state.effects[index].life -= dt;
    if (state.effects[index].life <= 0) state.effects.splice(index, 1);
  }
  for (let index = state.damageNumbers.length - 1; index >= 0; index -= 1) {
    state.damageNumbers[index].life -= dt;
    if (state.damageNumbers[index].life <= 0) state.damageNumbers.splice(index, 1);
  }

  state.enemies = state.enemies.filter((enemy) => (
    enemy.x > -80 && enemy.x < state.width + 80 && enemy.y > -80 && enemy.y < state.height + 80
  ));

  if (state.waveRemaining === 0 && state.enemies.length === 0) {
    state.pendingUpgrade = true;
    state.waveCooldown = 1.2;
    waveAdvanced = true;
    reward += 8;
  }
  if (state.tower.hp <= 0) {
    state.gameOver = true;
    reward -= 30;
  }
  state.lastReward = reward;
  state.episodeReward += reward;
  return { reward, towerDamage, hits, kills, waveAdvanced, switched };
}

export function applyBastionUpgrade(state: DroneBastionState, choice: 'deploy' | 'upgrade'): void {
  if (choice === 'deploy' && state.drones.length < 6) {
    const kinds: DroneKind[] = ['pawn', 'rook', 'bishop', 'knight', 'queen'];
    const kind = kinds.reduce((least, candidate) => (
      state.drones.filter((drone) => drone.kind === candidate).length
        < state.drones.filter((drone) => drone.kind === least).length ? candidate : least
    ), kinds[0]);
    addDrone(state, kind);
    state.lastUpgrade = `DEPLOY ${state.drones.at(-1)?.kind.toUpperCase()}`;
  } else {
    const alive = state.drones.filter((drone) => drone.mode !== 'disabled');
    const target = alive.reduce((lowest, drone) => (
      drone.powerLevel < lowest.powerLevel ? drone : lowest
    ), alive[0] ?? state.drones[0]);
    target.powerLevel += 1;
    target.maxHp = Math.round(target.maxHp * 1.12);
    target.hp = target.maxHp;
    state.lastUpgrade = `UPGRADE ${target.kind.toUpperCase()} P${target.powerLevel}`;
  }
  for (const wall of state.walls) wall.hp = Math.min(wall.maxHp, wall.hp + wall.maxHp * 0.18);
  state.tower.hp = Math.min(state.tower.maxHp, state.tower.hp + 32);
  state.wave += 1;
  state.waveRemaining = waveEnemyTotal(state.wave);
  state.waveSpawned = 0;
  state.spawnTimer = 1;
  state.pendingUpgrade = false;
}

export function resetDroneBastionEpisode(state: DroneBastionState): void {
  const next = createDroneBastionState(state.width, state.height, state.seed + state.episode);
  next.episode = state.episode + 1;
  Object.assign(state, next);
}

export function observeDroneBastion(state: DroneBastionState): DroneBastionObservation {
  const drone = state.drones[state.selectedDrone] ?? state.drones[0];
  const nearest = nearestEnemy(state, drone.x, drone.y);
  const dx = nearest ? nearest.x - drone.x : Math.cos(drone.angle);
  const dy = nearest ? nearest.y - drone.y : Math.sin(drone.angle);
  const relative = normalizeAngle(Math.atan2(dy, dx) - drone.angle);
  const distance = nearest ? Math.hypot(dx, dy) : Infinity;
  const sectorCounts = [0, 0, 0, 0];
  for (const enemy of state.enemies) {
    const angle = Math.atan2(enemy.y - state.tower.y, enemy.x - state.tower.x);
    sectorCounts[cardinalSector(angle)] += enemy.kind === 'brute' ? 2 : 1;
  }
  let threatSector = 0;
  for (let index = 1; index < sectorCounts.length; index += 1) {
    if (sectorCounts[index] > sectorCounts[threatSector]) threatSector = index;
  }
  const wallRatio = state.walls.reduce((sum, wall) => sum + wall.hp / wall.maxHp, 0)
    / Math.max(1, state.walls.length);
  return {
    towerHpBand: ratioBand(state.tower.hp / state.tower.maxHp),
    selectedKind: drone.kind,
    speedBand: valueBand(Math.hypot(drone.vx, drone.vy), [8, 45, 100]),
    aimSector: directionBand(relative),
    distanceBand: valueBand(distance, [75, 170, 300]),
    threatSector,
    threatBand: valueBand(sectorCounts[threatSector], [1, 4, 9]),
    wallBand: ratioBand(wallRatio),
    droneCountBand: Math.min(4, state.drones.filter((candidate) => candidate.mode !== 'disabled').length - 1),
    selectedHpBand: ratioBand(drone.hp / drone.maxHp),
    dense: createDenseObservation(state, drone),
  };
}

export function encodeDroneBastionObservation(observation: DroneBastionObservation): string {
  const aimBand = observation.aimSector === 3 || observation.aimSector === 4
    ? 1
    : observation.aimSector < 3 ? 0 : 2;
  return [
    observation.towerHpBand <= 1 ? 0 : 1,
    observation.selectedKind,
    observation.speedBand >= 2 ? 1 : 0,
    aimBand,
    Math.min(2, observation.distanceBand),
    observation.threatBand >= 2 ? 1 : 0,
  ].join(':');
}

export function getDroneRadius(kind: DroneKind): number {
  return DRONE_SPECS[kind].radius;
}

export function getDroneVisualProfile(kind: DroneKind): {
  chassis: DroneChassis;
  weapon: DroneWeapon;
  range: number;
  minRange: number;
  maxSpeed: number;
} {
  const spec = DRONE_SPECS[kind];
  return {
    chassis: spec.chassis,
    weapon: spec.weapon,
    range: spec.range,
    minRange: spec.minRange,
    maxSpeed: spec.maxSpeed,
  };
}

function createDenseObservation(
  state: DroneBastionState,
  selected: BastionDrone,
): readonly number[] {
  const towerThreat = Array<number>(24).fill(0);
  const localThreat = Array<number>(16).fill(0);
  for (const enemy of state.enemies) {
    const weight = enemy.kind === 'brute' ? 1.8 : 1;
    const towerDx = enemy.x - state.tower.x;
    const towerDy = enemy.y - state.tower.y;
    const towerDistance = Math.hypot(towerDx, towerDy);
    const towerRing = towerDistance < 140 ? 0 : towerDistance < 280 ? 1 : 2;
    const towerSector = octantSector(Math.atan2(towerDy, towerDx));
    towerThreat[towerRing * 8 + towerSector] += weight;

    const localDx = enemy.x - selected.x;
    const localDy = enemy.y - selected.y;
    const localDistance = Math.hypot(localDx, localDy);
    if (localDistance < 360) {
      const localRing = localDistance < 150 ? 0 : 1;
      const relativeAngle = Math.atan2(localDy, localDx) - selected.angle;
      localThreat[localRing * 8 + octantSector(relativeAngle)] += weight;
    }
  }
  normalizeDensity(towerThreat, 8);
  normalizeDensity(localThreat, 5);

  const wallHealth = Array<number>(8).fill(0);
  const wallCounts = Array<number>(8).fill(0);
  for (const wall of state.walls) {
    const sector = octantSector(Math.atan2(wall.y - state.tower.y, wall.x - state.tower.x));
    wallHealth[sector] += wall.hp / wall.maxHp;
    wallCounts[sector] += 1;
  }
  for (let index = 0; index < wallHealth.length; index += 1) {
    wallHealth[index] /= Math.max(1, wallCounts[index]);
  }

  const kindValues: Record<DroneKind, number> = {
    pawn: 0,
    knight: 0.25,
    bishop: 0.5,
    rook: 0.75,
    queen: 1,
  };
  const fleet: number[] = [];
  for (let slot = 0; slot < 6; slot += 1) {
    const drone = state.drones[slot];
    if (!drone) {
      fleet.push(0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    const mode = drone.mode === 'controlled' ? 1 : drone.mode === 'turret' ? 0.66
      : drone.mode === 'braking' ? 0.33 : 0;
    fleet.push(
      1,
      kindValues[drone.kind],
      drone.hp / drone.maxHp,
      mode,
      clamp((drone.x - state.tower.x) / (state.width / 2), -1, 1),
      clamp((drone.y - state.tower.y) / (state.height / 2), -1, 1),
      clamp(Math.hypot(drone.vx, drone.vy) / DRONE_SPECS[drone.kind].maxSpeed, 0, 1.5),
    );
  }

  return [
    ...towerThreat,
    ...localThreat,
    ...wallHealth,
    ...fleet,
    state.tower.hp / state.tower.maxHp,
    clamp(state.wave / 20, 0, 1),
    clamp(state.enemies.length / 240, 0, 1),
    clamp(state.waveRemaining / 240, 0, 1),
    clamp(selected.throttle, -1, 1),
    clamp(selected.angularVelocity / Math.PI, -1, 1),
  ];
}

function normalizeDensity(values: number[], saturation: number): void {
  for (let index = 0; index < values.length; index += 1) {
    values[index] = Math.min(1, Math.log1p(values[index]) / Math.log1p(saturation));
  }
}

function createWalls(cx: number, cy: number): BastionWall[] {
  const walls: BastionWall[] = [];
  const offset = 126;
  const segment = 58;
  const gap = 9;
  let id = 1;
  for (const side of [-1, 1]) {
    for (let index = -2; index <= 2; index += 1) {
      if (index === 0) continue;
      walls.push({
        id: id++,
        x: cx + index * (segment + gap),
        y: cy + side * offset,
        width: segment,
        height: 18,
        hp: 105,
        maxHp: 105,
      });
      walls.push({
        id: id++,
        x: cx + side * offset,
        y: cy + index * (segment + gap),
        width: 18,
        height: segment,
        hp: 105,
        maxHp: 105,
      });
    }
  }
  return walls;
}

function addDrone(state: DroneBastionState, kind: DroneKind): void {
  const index = state.drones.length;
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  const spec = DRONE_SPECS[kind];
  state.drones.push({
    id: state.nextDroneId++,
    kind,
    mode: 'braking',
    x: state.tower.x + Math.cos(angle) * 88,
    y: state.tower.y + Math.sin(angle) * 88,
    vx: 0,
    vy: 0,
    angle,
    angularVelocity: 0,
    throttle: 0,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    fireCooldown: 0,
    anchorTimer: 0.35,
    respawnRemaining: 0,
    powerLevel: 1,
  });
}

function selectDrone(state: DroneBastionState, index: number): void {
  const previous = state.drones[state.selectedDrone];
  if (previous && previous.mode !== 'disabled') {
    previous.mode = 'braking';
    previous.anchorTimer = 0.35;
  }
  state.selectedDrone = index;
  state.drones[index].mode = 'controlled';
}

function ensureSelectedDrone(state: DroneBastionState): void {
  if (state.drones[state.selectedDrone]?.mode !== 'disabled') return;
  const next = state.drones.findIndex((drone) => drone.mode !== 'disabled');
  if (next >= 0) selectDrone(state, next);
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
  if (enemy.hp > 0) return { killed: 0, reward: 0.16 };
  state.enemies.splice(enemyIndex, 1);
  state.kills += 1;
  state.score += enemy.kind === 'brute' ? 220 : 70;
  return { killed: 1, reward: enemy.kind === 'brute' ? 4.5 : 2.2 };
}

function addDamageNumber(
  state: DroneBastionState,
  x: number,
  y: number,
  amount: number,
  target: BastionDamageNumber['target'],
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

function respawnDuration(drone: BastionDrone): number {
  const weight = DRONE_SPECS[drone.kind].maxHp / 70;
  return 5.5 + weight * 2.2;
}

function respawnDrone(state: DroneBastionState, drone: BastionDrone, index: number): void {
  const angle = index * Math.PI * (3 - Math.sqrt(5)) + state.elapsed * 0.08;
  drone.x = state.tower.x + Math.cos(angle) * 92;
  drone.y = state.tower.y + Math.sin(angle) * 92;
  drone.angle = angle;
  drone.angularVelocity = 0;
  drone.throttle = 0;
  drone.vx = 0;
  drone.vy = 0;
  drone.hp = drone.maxHp;
  drone.fireCooldown = 0.8;
  drone.anchorTimer = 0;
  drone.respawnRemaining = 0;
  if (state.drones.every((candidate) => candidate === drone || candidate.mode === 'disabled')) {
    state.selectedDrone = index;
    drone.mode = 'controlled';
  } else {
    drone.mode = 'turret';
  }
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

function nearestEnemy(
  state: DroneBastionState,
  x: number,
  y: number,
  maximum = Infinity,
  minimum = 0,
): BastionEnemy | null {
  let nearest: BastionEnemy | null = null;
  let best = maximum;
  for (const enemy of state.enemies) {
    const distance = Math.hypot(enemy.x - x, enemy.y - y);
    if (distance >= minimum && distance < best) {
      nearest = enemy;
      best = distance;
    }
  }
  return nearest;
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

function circleHitsRect(x: number, y: number, radius: number, wall: BastionWall): boolean {
  const nearestX = clamp(x, wall.x - wall.width / 2, wall.x + wall.width / 2);
  const nearestY = clamp(y, wall.y - wall.height / 2, wall.y + wall.height / 2);
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function capVelocity(drone: BastionDrone, maximum: number): void {
  const speed = Math.hypot(drone.vx, drone.vy);
  if (speed <= maximum) return;
  drone.vx *= maximum / speed;
  drone.vy *= maximum / speed;
}

function rotateToward(current: number, target: number, maximum: number): number {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + clamp(delta, -maximum, maximum));
}

function normalizeAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function directionBand(angle: number): number {
  const normalized = (normalizeAngle(angle) + Math.PI) / (Math.PI * 2);
  return Math.min(7, Math.floor(normalized * 8));
}

function cardinalSector(angle: number): number {
  const normalized = (angle + Math.PI * 2 + Math.PI / 4) % (Math.PI * 2);
  return Math.floor(normalized / (Math.PI / 2)) % 4;
}

function octantSector(angle: number): number {
  const normalized = (normalizeAngle(angle) + Math.PI * 2 + Math.PI / 8) % (Math.PI * 2);
  return Math.floor(normalized / (Math.PI / 4)) % 8;
}

function ratioBand(value: number): number {
  return value < 0.25 ? 0 : value < 0.5 ? 1 : value < 0.75 ? 2 : 3;
}

function valueBand(value: number, thresholds: readonly number[]): number {
  for (let index = 0; index < thresholds.length; index += 1) {
    if (value < thresholds[index]) return index;
  }
  return thresholds.length;
}

function waveEnemyTotal(wave: number): number {
  return Math.min(240, 8 + wave * 4 + Math.floor(Math.pow(wave, 1.32)));
}

function random(state: DroneBastionState): number {
  state.rngState += 0x6D2B79F5;
  let value = state.rngState;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

function wrapIndex(value: number, length: number): number {
  return (value % length + length) % length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(target, current + maximumDelta);
  return Math.max(target, current - maximumDelta);
}
