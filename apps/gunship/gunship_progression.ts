import type { GunshipBody } from './gunship_physics.js';

export type GunshipRunProgress = { level: number; xp: number; nextXp: number; pending: number; thrust: number; turn: number; damage: number; fireRate: number; laser: number; missile: number; lastUpgrade: string };
export type GunshipUpgrade = { id: 'thrust' | 'turn' | 'damage' | 'fireRate' | 'laser' | 'missile'; label: string; detail: string };

const UPGRADES: readonly GunshipUpgrade[] = [
  { id: 'thrust', label: 'THRUST VECTOR', detail: '推力 +14%' },
  { id: 'turn', label: 'RESPONSE VANES', detail: '回頭 +12%' },
  { id: 'damage', label: 'KINETIC CORE', detail: '主砲ダメージ +20%' },
  { id: 'fireRate', label: 'COOLING LOOP', detail: '主砲連射 +16%' },
  { id: 'laser', label: 'LASER ARRAY', detail: 'レーザー主砲を解放' },
  { id: 'missile', label: 'MISSILE RACK', detail: '追尾ミサイルを解放' },
];

export function createRunProgress(): GunshipRunProgress { return { level: 1, xp: 0, nextXp: 7, pending: 0, thrust: 0, turn: 0, damage: 0, fireRate: 0, laser: 0, missile: 0, lastUpgrade: 'BASELINE AIRFRAME' }; }
export function addXp(run: GunshipRunProgress, value: number): void { run.xp += value; while (run.xp >= run.nextXp) { run.xp -= run.nextXp; run.level++; run.nextXp = Math.ceil(run.nextXp * 1.28); run.pending++; } }
export function choicesFor(run: GunshipRunProgress): GunshipUpgrade[] { const available = UPGRADES.filter((upgrade) => upgrade.id !== 'laser' || run.laser === 0).filter((upgrade) => upgrade.id !== 'missile' || run.missile === 0); const offset = (run.level + run.thrust + run.damage) % available.length; return [available[offset], available[(offset + 1) % available.length], available[(offset + 2) % available.length]]; }
export function applyUpgrade(run: GunshipRunProgress, choice: GunshipUpgrade): void { run[choice.id]++; run.pending = Math.max(0, run.pending - 1); run.lastUpgrade = choice.label; }
export function configureShip(body: GunshipBody, run: GunshipRunProgress): void { body.thrustScale = 1.14 ** run.thrust; body.turnScale = 1.12 ** run.turn; }
