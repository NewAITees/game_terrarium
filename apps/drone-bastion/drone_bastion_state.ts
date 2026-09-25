import type {
  BastionDrone,
  BastionWall,
  DroneBastionRewardWeights,
  DroneBastionState,
  DroneChassis,
  DroneKind,
  DroneWeapon,
} from './drone_bastion_types.js';
import { DEFAULT_DRONE_BASTION_REWARD_WEIGHTS } from './drone_bastion_types.js';

export const DRONE_SPECS = {
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
  rewards: DroneBastionRewardWeights = DEFAULT_DRONE_BASTION_REWARD_WEIGHTS,
): DroneBastionState {
  const tower = { x: width / 2, y: height / 2, hp: 320, maxHp: 320, radius: 50 };
  const state: DroneBastionState = {
    width,
    height,
    seed,
    rngState: seed >>> 0,
    rewards,
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
  const next = createDroneBastionState(state.width, state.height, state.seed + state.episode, state.rewards);
  next.episode = state.episode + 1;
  Object.assign(state, next);
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

export function addDrone(state: DroneBastionState, kind: DroneKind): void {
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

export function selectDrone(state: DroneBastionState, index: number): void {
  const previous = state.drones[state.selectedDrone];
  if (previous && previous.mode !== 'disabled') {
    previous.mode = 'braking';
    previous.anchorTimer = 0.35;
  }
  state.selectedDrone = index;
  state.drones[index].mode = 'controlled';
}

export function ensureSelectedDrone(state: DroneBastionState): void {
  if (state.drones[state.selectedDrone]?.mode !== 'disabled') return;
  const next = state.drones.findIndex((drone) => drone.mode !== 'disabled');
  if (next >= 0) selectDrone(state, next);
}

export function respawnDuration(drone: BastionDrone): number {
  const weight = DRONE_SPECS[drone.kind].maxHp / 70;
  return 5.5 + weight * 2.2;
}

export function respawnDrone(state: DroneBastionState, drone: BastionDrone, index: number): void {
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

export function waveEnemyTotal(wave: number): number {
  return Math.min(240, 8 + wave * 4 + Math.floor(Math.pow(wave, 1.32)));
}

export function random(state: DroneBastionState): number {
  state.rngState += 0x6D2B79F5;
  let value = state.rngState;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}
