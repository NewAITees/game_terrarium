import { thresholdBand } from '../../shared/rl/discretize.js';
import { angleToFineSector, angleToSector, attackAngle, normalizeAngle, pulseProjectileCount } from './arena_shooter_math.js';
import type { ArenaObservation, ArenaObservationVariant, ArenaState } from './arena_shooter_types.js';

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

export function encodeObservationVariant(variant: ArenaObservationVariant, observation: ArenaObservation): string {
  if (variant === 'full') return encodeObservation(observation);
  if (variant === 'no-sensors') {
    // Drops the two sensor rings and the four-way edge vector: the fields that multiply the key
    // space fastest while describing the same situation the coarse sectors already summarise.
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
      observation.distanceBand,
      observation.hpBand,
      observation.enemyCountBand,
      observation.hostileProjectileCountBand,
      observation.canFire ? 1 : 0,
    ].join(':');
  }
  return [
    observation.craftType,
    observation.targetSector,
    observation.aimSector,
    observation.dangerSector,
    observation.distanceBand,
    observation.hpBand,
    observation.canFire ? 1 : 0,
  ].join(':');
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

function sensorDistanceBand(normalizedDistance: number): number { return thresholdBand(normalizedDistance, [0.12, 0.3]); }

function countBand(count: number): number { return thresholdBand(count, [1, 3, 6, 10]); }

function edgeDistanceBand(distance: number): number { return thresholdBand(distance, [55, 140]); }
