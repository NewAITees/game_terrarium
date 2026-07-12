import type { PlanetStrategyEmpire, PlanetStrategyShip } from './types/planet_strategy.js';

const ACTIVE_ATTACK_STATUSES = new Set(['launching', 'traveling', 'approaching', 'engaging']);

export function getFleetSyncSpeed(ships: Pick<PlanetStrategyShip, 'kind' | 'speed'>[]): number | null {
  const speeds = ships.filter((ship) => ship.kind !== 'transport').map((ship) => ship.speed);
  return speeds.length ? Math.min(...speeds) : null;
}

export function synchronizeFleetSpeed(ships: Pick<PlanetStrategyShip, 'kind' | 'speed'>[]): number | null {
  const speed = getFleetSyncSpeed(ships);
  if (speed === null) return null;
  for (const ship of ships) {
    if (ship.kind !== 'transport') ship.speed = speed;
  }
  return speed;
}

export function getActiveAttackRoutes(
  ships: Pick<PlanetStrategyShip, 'kind' | 'status' | 'targetPlanetId' | 'fromPlanetId' | 'toPlanetId' | 'owner'>[],
  empires: Pick<PlanetStrategyEmpire, 'id' | 'color'>[],
  routeKey: (fromPlanetId: string, toPlanetId: string) => string,
): Map<string, { owner: number; color: string; shipCount: number }> {
  const counts = new Map<string, Map<number, number>>();
  for (const ship of ships) {
    if (ship.kind === 'transport' || !ACTIVE_ATTACK_STATUSES.has(ship.status) || !ship.targetPlanetId || !ship.fromPlanetId || !ship.toPlanetId) continue;
    const key = routeKey(ship.fromPlanetId, ship.toPlanetId);
    const owners = counts.get(key) ?? new Map<number, number>();
    owners.set(ship.owner, (owners.get(ship.owner) ?? 0) + 1);
    counts.set(key, owners);
  }

  const colors = new Map(empires.map((empire) => [empire.id, empire.color]));
  const activeRoutes = new Map<string, { owner: number; color: string; shipCount: number }>();
  for (const [key, owners] of counts) {
    const winner = [...owners.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (!winner) continue;
    activeRoutes.set(key, { owner: winner[0], color: colors.get(winner[0]) ?? '#ffffff', shipCount: winner[1] });
  }
  return activeRoutes;
}
