export type WeaponFamily = 'laser' | 'missile' | 'flak' | 'explosive' | 'railgun';
export type GunshipRunProgress = { level: number; xp: number; nextXp: number; pending: number; thrust: number; turn: number; damage: number; fireRate: number; laser: number; missile: number; flak: number; explosive: number; railgun: number; weaponFamily: WeaponFamily | null; lastUpgrade: string };
export type GunshipUpgrade = { id: 'thrust' | 'turn' | 'damage' | 'fireRate' | WeaponFamily; label: string; detail: string; family?: WeaponFamily };

const UPGRADES: readonly GunshipUpgrade[] = [
  { id: 'thrust', label: 'THRUST VECTOR', detail: '推力 +14%' },
  { id: 'turn', label: 'RESPONSE VANES', detail: '回頭 +12%' },
  { id: 'damage', label: 'KINETIC CORE', detail: '主砲ダメージ +20%' },
  { id: 'fireRate', label: 'COOLING LOOP', detail: '主砲連射 +16%' },
  { id: 'laser', label: 'LASER ARRAY', detail: 'レーザー系統を解放/強化', family: 'laser' },
  { id: 'missile', label: 'MISSILE RACK', detail: '追尾ミサイル系統を解放/強化', family: 'missile' },
  { id: 'flak', label: 'FLAK BATTERY', detail: 'フラック系統を解放/強化（拡散弾）', family: 'flak' },
  { id: 'explosive', label: 'BLAST WARHEAD', detail: '爆発系統を解放/強化（範囲ダメージ）', family: 'explosive' },
  { id: 'railgun', label: 'RAIL DRIVER', detail: '貫通系統を解放/強化（直線貫通）', family: 'railgun' },
];

export function createRunProgress(): GunshipRunProgress { return { level: 1, xp: 0, nextXp: 7, pending: 0, thrust: 0, turn: 0, damage: 0, fireRate: 0, laser: 0, missile: 0, flak: 0, explosive: 0, railgun: 0, weaponFamily: null, lastUpgrade: 'BASELINE AIRFRAME' }; }
export function addXp(run: GunshipRunProgress, value: number): void { run.xp += value; while (run.xp >= run.nextXp) { run.xp -= run.nextXp; run.level++; run.nextXp = Math.ceil(run.nextXp * 1.28); run.pending++; } }
// Weapon upgrades are mutually exclusive systems: the first one taken locks run.weaponFamily, after
// which every other family drops out of the offer pool and only the locked family keeps re-appearing
// (as a stacking power-up) alongside the generic airframe upgrades.
export function choicesFor(run: GunshipRunProgress): GunshipUpgrade[] {
  const available = UPGRADES.filter((upgrade) => !upgrade.family || upgrade.family === run.weaponFamily || run.weaponFamily === null);
  const offset = (run.level + run.thrust + run.damage) % available.length;
  return [available[offset], available[(offset + 1) % available.length], available[(offset + 2) % available.length]];
}
export function applyUpgrade(run: GunshipRunProgress, choice: GunshipUpgrade): void {
  run[choice.id]++;
  if (choice.family && !run.weaponFamily) run.weaponFamily = choice.family;
  run.pending = Math.max(0, run.pending - 1);
  run.lastUpgrade = choice.label;
}
