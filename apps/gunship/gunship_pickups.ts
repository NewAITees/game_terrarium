import { WORLD_W } from './gunship_physics.js';

export type XpOrb = { x: number; y: number; value: number; life: number };

const PICKUP_RADIUS = 40;
// Unclaimed XP expires rather than sitting forever: a policy that merely wanders through orbs
// eventually would look identical to one that deliberately routes for them, so credit must lapse.
const ORB_LIFETIME = 12;

export function spawnOrb(x: number, y: number, value: number): XpOrb {
  return { x, y, value, life: ORB_LIFETIME };
}

export function stepOrbs(orbs: XpOrb[], dt: number): void {
  for (const orb of orbs) orb.life -= dt;
  for (let index = orbs.length - 1; index >= 0; index -= 1) if (orbs[index].life <= 0) orbs.splice(index, 1);
}

/** Removes any orb within pickup range of the ship and returns the total xp value collected. */
export function collectOrbs(orbs: XpOrb[], shipX: number, shipY: number): number {
  let collected = 0;
  for (let index = orbs.length - 1; index >= 0; index -= 1) {
    const rawDx = Math.abs(orbs[index].x - shipX); const dx = Math.min(rawDx, WORLD_W - rawDx);
    if (Math.hypot(dx, orbs[index].y - shipY) < PICKUP_RADIUS) {
      collected += orbs[index].value;
      orbs.splice(index, 1);
    }
  }
  return collected;
}
