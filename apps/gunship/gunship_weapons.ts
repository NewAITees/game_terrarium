import type { EnemyShot } from './gunship_enemies.js';
import type { GunshipBody } from './gunship_physics.js';
import type { GunshipRunProgress, WeaponFamily } from './gunship_progression.js';

export type WeaponKind = 'cannon' | WeaponFamily;
export type WeaponProfile = {
  label: string;
  role: string;
  baseCooldown: number;
  recoveryDelay: number;
  recoil: number;
};

const PROFILES: Record<WeaponKind, WeaponProfile> = {
  cannon: { label: 'CANNON', role: 'BALANCED', baseCooldown: .22, recoveryDelay: 1.25, recoil: 8 },
  laser: { label: 'LASER', role: 'PRECISION / SLOW REPAIR', baseCooldown: .1, recoveryDelay: 2.2, recoil: 0 },
  missile: { label: 'MISSILE', role: 'HOMING / LONG RELOAD', baseCooldown: 2.4, recoveryDelay: 1.5, recoil: 4 },
  flak: { label: 'FLAK', role: 'ANTI-AIR / WEAK VS SHIPS', baseCooldown: .3, recoveryDelay: 1.15, recoil: 11 },
  explosive: { label: 'BLAST', role: 'SPLASH / SLOW SHOT', baseCooldown: .5, recoveryDelay: 1.45, recoil: 18 },
  railgun: { label: 'RAILGUN', role: 'PIERCE / HEAVY RECOIL', baseCooldown: .9, recoveryDelay: 1.8, recoil: 55 },
};

export function weaponKind(run: Pick<GunshipRunProgress, 'weaponFamily'>): WeaponKind {
  return run.weaponFamily ?? 'cannon';
}

export function weaponProfile(run: Pick<GunshipRunProgress, 'weaponFamily'>): WeaponProfile {
  return PROFILES[weaponKind(run)];
}

export function weaponCooldown(run: GunshipRunProgress): number {
  const kind = weaponKind(run);
  const familyStack = kind === 'cannon' ? 1 : 1.15 ** Math.max(0, run[kind] - 1);
  return weaponProfile(run).baseCooldown / (1.16 ** run.fireRate * familyStack);
}

export function weaponDamage(run: GunshipRunProgress, weapon: EnemyShot['weapon'], surface: boolean): number {
  const generic = 1.2 ** run.damage;
  switch (weapon) {
    case 'missile': return 48 * generic * 1.15 ** Math.max(0, run.missile - 1);
    case 'flak': return (surface ? 3 : 8) * generic * 1.15 ** Math.max(0, run.flak - 1);
    case 'explosive': return 20 * generic * 1.15 ** Math.max(0, run.explosive - 1);
    default: return (surface ? 14 : 24) * generic;
  }
}

export function applyWeaponRecoil(body: GunshipBody, run: Pick<GunshipRunProgress, 'weaponFamily'>, recoilScale = 1): void {
  const recoil = weaponProfile(run).recoil * recoilScale;
  body.vx -= Math.cos(body.angle) * recoil;
  body.vy += Math.sin(body.angle) * recoil;
}
