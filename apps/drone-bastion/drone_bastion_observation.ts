import { thresholdBand } from '../../shared/rl/discretize.js';
import { cardinalSector, clamp, directionBand, nearestEnemy, normalizeAngle, octantSector } from './drone_bastion_math.js';
import { DRONE_SPECS } from './drone_bastion_state.js';
import type { BastionDrone, DroneBastionObservation, DroneBastionState, DroneKind } from './drone_bastion_types.js';

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
    towerHpBand: thresholdBand(state.tower.hp / state.tower.maxHp, [0.25, 0.5, 0.75]),
    selectedKind: drone.kind,
    speedBand: thresholdBand(Math.hypot(drone.vx, drone.vy), [8, 45, 100]),
    aimSector: directionBand(relative),
    distanceBand: thresholdBand(distance, [75, 170, 300]),
    threatSector,
    threatBand: thresholdBand(sectorCounts[threatSector], [1, 4, 9]),
    wallBand: thresholdBand(wallRatio, [0.25, 0.5, 0.75]),
    droneCountBand: Math.min(4, state.drones.filter((candidate) => candidate.mode !== 'disabled').length - 1),
    selectedHpBand: thresholdBand(drone.hp / drone.maxHp, [0.25, 0.5, 0.75]),
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
