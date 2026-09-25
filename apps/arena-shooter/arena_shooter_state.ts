import { clamp } from './arena_shooter_math.js';
import type { ArenaRewardWeights, ArenaState, CraftPreference, CraftType, Ship } from './arena_shooter_types.js';
import { DEFAULT_ARENA_REWARD_WEIGHTS } from './arena_shooter_types.js';

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

export function craftDefinition(craftType: CraftType): typeof CRAFT_DEFINITIONS[CraftType] {
  return CRAFT_DEFINITIONS[craftType];
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

export function createArenaState(
  width = 1280,
  height = 720,
  rewards: ArenaRewardWeights = DEFAULT_ARENA_REWARD_WEIGHTS,
): ArenaState {
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
    rewards,
  };
  randomizeCraft(state);
  return state;
}

export function createShip(width: number, height: number): Ship {
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

export function randomizeCraft(state: ArenaState): void {
  const craftType = CRAFT_TYPES[Math.floor(random(state) * CRAFT_TYPES.length)];
  setCraftType(state.ship, craftType);
}

export function setCraftType(ship: Ship, craftType: CraftType): void {
  ship.craftType = craftType;
  ship.turretAngle = ship.angle;
}

export function waveEnemyTotal(wave: number): number {
  const trialBonus = wave % 5 === 0 ? 6 : 0;
  return Math.min(60, 6 + wave * 2 + trialBonus);
}

export function random(state: ArenaState): number {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let value = state.rngState;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}

/** Shares the environment's seeded stream with episode-level choices such as upgrade offers. */
export function nextArenaRandom(state: ArenaState): number { return random(state); }
