import type { GunshipBody } from './gunship_physics.js';
import { GRAVITY } from './gunship_physics.js';
import type { GunshipRunProgress } from './gunship_progression.js';

export type AirframeId = 'interceptor' | 'hauler' | 'darter' | 'hoverer';

// A machine type IS a set of physics constants — the problem the RL agent must solve, not a cosmetic skin.
// thrust sets TWR (÷ GRAVITY), thrustTurnK is the LUFTRAUSERS turn penalty while the engine burns.
export type Airframe = { id: AirframeId; label: string; blurb: string; thrust: number; turn: number; thrustTurnK: number; drag: number; maxHp: number; recoilScale: number };

export const AIRFRAMES: readonly Airframe[] = [
  { id: 'interceptor', label: 'INTERCEPTOR', blurb: '軽量万能・基準機。ジレンマが最も穏やか', thrust: 408, turn: 2.9, thrustTurnK: .6, drag: .64, maxHp: 100, recoilScale: 1 },
  { id: 'hauler', label: 'HAULER', blurb: '重量ガンシップ・低TWR。貯めて一度に薙ぐ', thrust: 344, turn: 2.15, thrustTurnK: .4, drag: .84, maxHp: 132, recoilScale: .65 },
  { id: 'darter', label: 'DARTER', blurb: '高速一撃離脱・低抵抗。止まれない', thrust: 459, turn: 2.6, thrustTurnK: .5, drag: .4, maxHp: 86, recoilScale: 1.2 },
  { id: 'hoverer', label: 'HOVERER', blurb: '低推力精密・高旋回。最も落ちやすい', thrust: 331, turn: 3.25, thrustTurnK: .68, drag: .88, maxHp: 92, recoilScale: .9 },
] as const;

export function airframeById(id: AirframeId): Airframe { return AIRFRAMES.find((frame) => frame.id === id) ?? AIRFRAMES[0]; }
export function randomAirframe(random: () => number = Math.random): Airframe { return AIRFRAMES[Math.min(AIRFRAMES.length - 1, Math.floor(random() * AIRFRAMES.length))]; }
export function twrOf(frame: Airframe): number { return frame.thrust / GRAVITY; }

// Fold airframe base stats with run upgrades and permanent research into the body's live physics values.
export function configureShip(body: GunshipBody, run: GunshipRunProgress, frame: Airframe, thrustResearch: number): void {
  body.thrust = frame.thrust * 1.14 ** run.thrust * 1.06 ** thrustResearch;
  body.turn = frame.turn * 1.12 ** run.turn;
  body.thrustTurnK = frame.thrustTurnK;
  body.drag = frame.drag;
}
