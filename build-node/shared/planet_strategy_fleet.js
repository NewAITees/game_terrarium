"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFleetSyncSpeed = getFleetSyncSpeed;
exports.synchronizeFleetSpeed = synchronizeFleetSpeed;
exports.getActiveAttackRoutes = getActiveAttackRoutes;
const ACTIVE_ATTACK_STATUSES = new Set(['launching', 'traveling', 'approaching', 'engaging']);
function getFleetSyncSpeed(ships) {
    const speeds = ships.filter((ship) => ship.kind !== 'transport').map((ship) => ship.speed);
    return speeds.length ? Math.min(...speeds) : null;
}
function synchronizeFleetSpeed(ships) {
    const speed = getFleetSyncSpeed(ships);
    if (speed === null)
        return null;
    for (const ship of ships) {
        if (ship.kind !== 'transport')
            ship.speed = speed;
    }
    return speed;
}
function getActiveAttackRoutes(ships, empires, routeKey) {
    const counts = new Map();
    for (const ship of ships) {
        if (ship.kind === 'transport' || !ACTIVE_ATTACK_STATUSES.has(ship.status) || !ship.targetPlanetId || !ship.fromPlanetId || !ship.toPlanetId)
            continue;
        const key = routeKey(ship.fromPlanetId, ship.toPlanetId);
        const owners = counts.get(key) ?? new Map();
        owners.set(ship.owner, (owners.get(ship.owner) ?? 0) + 1);
        counts.set(key, owners);
    }
    const colors = new Map(empires.map((empire) => [empire.id, empire.color]));
    const activeRoutes = new Map();
    for (const [key, owners] of counts) {
        const winner = [...owners.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
        if (!winner)
            continue;
        activeRoutes.set(key, { owner: winner[0], color: colors.get(winner[0]) ?? '#ffffff', shipCount: winner[1] });
    }
    return activeRoutes;
}
