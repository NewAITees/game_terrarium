"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanetWatchState = buildPlanetWatchState;
function buildPlanetWatchState(world) {
    const factories = (world.planets ?? []).filter((planet) => planet.type === 'factory' && planet.owner >= 0 && planet.structures?.factory > 0);
    const starved = factories.filter((planet) => planet.stalled || planet.stock < 20).sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))[0];
    if (starved) {
        const owner = (world.empires ?? []).find((empire) => empire.id === starved.owner);
        const ownerName = owner?.name ?? 'An empire';
        return {
            nextWatch: { kind: 'factory_starvation', headline: 'Next Watch: factory starvation', detail: `${starved.label} has only ${Math.floor(starved.stock ?? 0)} ore. ${ownerName} production is at risk.` },
            causal: [{ kind: 'factory_starvation', cause: `${starved.label} is short of inbound ore.`, impact: `${ownerName} production may stall.`, risk: 'A stalled factory leaves the sector open to pressure.' }],
        };
    }
    const attacking = (world.ships ?? []).filter((ship) => ship.kind !== 'transport' && ['launching', 'traveling', 'approaching', 'engaging'].includes(ship.status) && ship.targetPlanetId);
    if (attacking.length) {
        const lead = attacking[0];
        const attacker = (world.empires ?? []).find((empire) => empire.id === lead.owner);
        const target = (world.planets ?? []).find((planet) => planet.id === lead.targetPlanetId);
        const attackerName = attacker?.name ?? 'An empire';
        const targetName = target?.label ?? 'an enemy planet';
        return {
            nextWatch: { kind: 'incoming_attack', headline: 'Next Watch: incoming fleet', detail: `${attackerName} has ${attacking.length} combat ships committed toward ${targetName}.` },
            causal: [{ kind: 'incoming_attack', cause: `${attackerName} committed a fleet to ${targetName}.`, impact: 'The target sector is becoming contested.', risk: 'A broken factory or weak defense can turn this into a capture.' }],
        };
    }
    if (world.oreFalloffStart !== null && world.oreFalloffStart !== undefined && world.time - world.oreFalloffStart < 20) {
        const remaining = Math.max(0, Math.ceil(20 - (world.time - world.oreFalloffStart)));
        return {
            nextWatch: { kind: 'ore_falloff', headline: 'Next Watch: sector ore falloff', detail: `Ore mining is suppressed for about ${remaining}s; thin factory stocks matter now.` },
            causal: [{ kind: 'ore_falloff', cause: 'Sector ore veins are collapsing.', impact: 'Inbound stock will recover more slowly.', risk: 'The next factory to run dry may change the balance.' }],
        };
    }
    const contested = (world.planets ?? []).find((planet) => (world.ships ?? []).some((ship) => ship.status === 'engaging' && ship.targetPlanetId === planet.id));
    if (contested) {
        return {
            nextWatch: { kind: 'contested_sector', headline: 'Next Watch: contested sector', detail: `${contested.label} is under active pressure; watch for a factory loss or capture.` },
            causal: [{ kind: 'contested_sector', cause: 'Combat ships are engaging around the planet.', impact: 'Defenders and facilities are taking pressure.', risk: 'A local loss can open a new supply route.' }],
        };
    }
    return {
        nextWatch: { kind: 'steady_state', headline: 'Next Watch: logistics race', detail: 'No immediate collapse is visible. Watch which empire turns ore flow into its next fleet first.' },
        causal: [],
    };
}
