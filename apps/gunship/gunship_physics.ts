export type GunshipBody = { x: number; y: number; vx: number; vy: number; angle: number; hp: number; maxHp: number; fireCooldown: number; thrustScale: number; turnScale: number };
export type GunshipAction = { turn: -1 | 0 | 1; thrust: boolean; fire: boolean; label: string };

export const SEA_Y = 790;
const GRAVITY = 255;

export function stepPhysics(body: GunshipBody, action: GunshipAction, dt: number): void {
  body.angle += action.turn * 2.65 * body.turnScale * dt;
  body.angle = Math.max(-Math.PI * .92, Math.min(Math.PI * .92, body.angle));
  const thrust = action.thrust ? 440 * body.thrustScale : 0;
  body.vx += (Math.cos(body.angle) * thrust - body.vx * .32) * dt;
  body.vy += (-Math.sin(body.angle) * thrust + GRAVITY - body.vy * .32) * dt;
  body.vx = Math.max(-290, Math.min(290, body.vx));
  body.vy = Math.max(-380, Math.min(470, body.vy));
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.x = Math.max(35, Math.min(1165, body.x));
  body.fireCooldown = Math.max(0, body.fireCooldown - dt);
}

export function altitudeMargin(body: GunshipBody): number {
  // Braking distance under maximum upward thrust gives the agent a readable safety margin.
  const downward = Math.max(0, body.vy);
  const brakingDistance = downward * downward / (2 * 185);
  return SEA_Y - body.y - brakingDistance - 30;
}
