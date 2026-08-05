export type GunshipBody = { x: number; y: number; vx: number; vy: number; angle: number; hp: number; maxHp: number; fireCooldown: number; thrust: number; turn: number; thrustTurnK: number; drag: number };
export type GunshipAction = { turn: -1 | 0 | 1; thrust: boolean; fire: boolean; label: string };

export const SEA_Y = 790;
export const WORLD_W = 3600;
export const WORLD_TOP = -1415;   // hard backstop; the real ceiling is where thin air starves the engine (below this).
export const GRAVITY = 200;
const THIN_START = 80;           // above this altitude (smaller y) the air thins and thrust weakens.
const THIN_FULL = -520;
const MIN_EFF = .4;

// Realistic service ceiling: thrust falls off with altitude, so each airframe naturally tops out where thrust*eff = g.
export function thrustEfficiency(y: number): number {
  if (y >= THIN_START) return 1;
  const t = Math.min(1, (THIN_START - y) / (THIN_START - THIN_FULL));
  return 1 - t * (1 - MIN_EFF);
}

export function stepPhysics(body: GunshipBody, action: GunshipAction, dt: number): void {
  // Turning is slower under thrust (LUFTRAUSERS): a fast aim demands cutting the engine and accepting the fall.
  const turnRate = body.turn * (action.thrust ? body.thrustTurnK : 1);
  body.angle += action.turn * turnRate * dt;
  // Full 360°: the craft can face and thrust in any direction, including leftward. Normalize into
  // (-pi, pi] each step rather than clamp, so heading can't grow unbounded across many turns.
  body.angle = Math.atan2(Math.sin(body.angle), Math.cos(body.angle));
  const thrust = action.thrust ? body.thrust * thrustEfficiency(body.y) : 0;
  body.vx += (Math.cos(body.angle) * thrust - body.vx * body.drag) * dt;
  body.vy += (-Math.sin(body.angle) * thrust + GRAVITY - body.vy * body.drag) * dt;
  body.vx = Math.max(-290, Math.min(290, body.vx));
  body.vy = Math.max(-380, Math.min(470, body.vy));
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  // Horizontal screen wrap (toroidal) keeps the craft in view like LUFTRAUSERS.
  if (body.x < 0) body.x += WORLD_W; else if (body.x > WORLD_W) body.x -= WORLD_W;
  // Backstop ceiling: thin air usually stops the climb first, but never let the craft leave the world.
  if (body.y < WORLD_TOP) { body.y = WORLD_TOP; if (body.vy < 0) body.vy = 0; }
  body.fireCooldown = Math.max(0, body.fireCooldown - dt);
}

export function altitudeMargin(body: GunshipBody): number {
  // Braking distance under this airframe's real upward thrust gives the agent a readable, per-craft safety margin.
  const brake = Math.max(30, body.thrust - GRAVITY);
  const downward = Math.max(0, body.vy);
  const brakingDistance = downward * downward / (2 * brake);
  return SEA_Y - body.y - brakingDistance - 30;
}

// Room left before the engine-starving thin air; negative means the craft is loitering up in the dead zone.
export function ceilingMargin(body: GunshipBody): number {
  return body.y - THIN_START;
}
