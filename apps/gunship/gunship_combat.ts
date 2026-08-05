import type { Enemy } from './gunship_enemies.js';
import { WORLD_W, type GunshipBody } from './gunship_physics.js';

export const COMBO_TIMEOUT = 4.2;
const COMBO_CAP = 20;
const RECOVERY_DELAY = 1.25;
const RECOVERY_DISTANCE = 260;
const RECOVERY_PER_SECOND = 13;

export type CombatState = {
  combo: number;
  comboTimer: number;
  recoveryDelay: number;
  recovering: boolean;
};

export function createCombatState(): CombatState {
  return { combo: 0, comboTimer: 0, recoveryDelay: 0, recovering: false };
}

export function comboMultiplier(combo: number): number {
  return 1 + Math.min(COMBO_CAP, combo) * 0.15;
}

export function registerKill(state: CombatState): void {
  state.combo = Math.min(COMBO_CAP, state.combo + 1);
  state.comboTimer = COMBO_TIMEOUT;
}

export function stepCombatState(state: CombatState, ship: GunshipBody, enemies: readonly Enemy[], firing: boolean, dt: number, recoveryDelay = RECOVERY_DELAY): void {
  state.comboTimer = Math.max(0, state.comboTimer - dt);
  if (state.comboTimer === 0) state.combo = 0;
  state.recoveryDelay = firing ? recoveryDelay : Math.max(0, state.recoveryDelay - dt);
  const nearest = enemies.reduce((distance, enemy) => { const rawDx = Math.abs(enemy.x - ship.x); const dx = Math.min(rawDx, WORLD_W - rawDx); return Math.min(distance, Math.hypot(dx, enemy.y - ship.y)); }, Infinity);
  state.recovering = !firing && state.recoveryDelay === 0 && nearest >= RECOVERY_DISTANCE && ship.hp < ship.maxHp;
  if (state.recovering) ship.hp = Math.min(ship.maxHp, ship.hp + RECOVERY_PER_SECOND * dt);
}

export function intentLabel(action: { thrust: boolean; fire: boolean }, state: CombatState): string {
  if (state.recovering) return 'BREAK OFF // REPAIR';
  if (action.fire) return state.combo ? `PRESS ATTACK // x${comboMultiplier(state.combo).toFixed(2)}` : 'ENGAGE TARGET';
  if (action.thrust) return 'REPOSITION';
  return 'GLIDE / SETUP';
}
