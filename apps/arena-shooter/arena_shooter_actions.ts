import type { ArenaAction, CraftType } from './arena_shooter_types.js';

const CONTROL_VALUES = [-1, 0, 1] as const;
const FIRE_VALUES = [false, true] as const;

function actionLabel(thrust: -1 | 0 | 1, turn: -1 | 0 | 1, strafe: -1 | 0 | 1, aimTurn: -1 | 0 | 1, fire: boolean): string {
  const parts: string[] = [];
  if (thrust === 1) parts.push('前進'); else if (thrust === -1) parts.push('後退');
  if (turn === 1) parts.push('右旋回'); else if (turn === -1) parts.push('左旋回');
  if (strafe === 1) parts.push('右平行移動'); else if (strafe === -1) parts.push('左平行移動');
  if (aimTurn === 1) parts.push('砲塔右'); else if (aimTurn === -1) parts.push('砲塔左');
  if (fire) parts.push('射撃');
  return parts.join('＋') || '停止';
}

export const ACTIONS: readonly ArenaAction[] = CONTROL_VALUES.flatMap((thrust) => CONTROL_VALUES.flatMap((turn) => CONTROL_VALUES.flatMap((strafe) => CONTROL_VALUES.flatMap((aimTurn) => FIRE_VALUES.map((fire) => ({
  thrust, turn, strafe, aimTurn, fire, label: actionLabel(thrust, turn, strafe, aimTurn, fire),
}))))));

export function isActionAllowed(craftType: CraftType, action: ArenaAction): boolean {
  if (action.strafe !== 0 && craftType !== 'strafer') return false;
  if (action.aimTurn !== 0 && craftType !== 'turret') return false;
  return true;
}

export function craftLabel(craftType: CraftType): string {
  if (craftType === 'interceptor') return 'INTERCEPTOR';
  if (craftType === 'strafer') return 'STRAFER';
  return 'TURRET';
}
