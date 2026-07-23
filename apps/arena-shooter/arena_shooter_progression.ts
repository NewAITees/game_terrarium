import type { CraftType } from './arena_shooter_core.js';

export type WeaponId = 'pulse' | 'missile' | 'nova';
export type WeaponLevels = Record<WeaponId, number>;

export type ArenaMetaProgress = {
  data: number;
  ascendium: number;
  ascensions: number;
  highestWave: number;
  totalKills: number;
  totalEpisodes: number;
  damageResearch: number;
  hullResearch: number;
};

export type ArenaRunProgress = {
  xp: number;
  level: number;
  nextLevelXp: number;
  scrap: number;
  weapons: WeaponLevels;
  fireRateLevel: number;
  projectileCountLevel: number;
  projectileSpeedLevel: number;
  projectileInterceptLevel: number;
  turretTurnLevel: number;
  pendingUpgrades: number;
  lastUpgradeLabel: string;
};

export type UpgradeChoice = {
  id: WeaponId | 'hull' | 'rate' | 'projectiles' | 'velocity' | 'turret-turn';
  label: string;
  description: string;
  weight: number;
};

export const DEFAULT_META: ArenaMetaProgress = {
  data: 0,
  ascendium: 0,
  ascensions: 0,
  highestWave: 1,
  totalKills: 0,
  totalEpisodes: 0,
  damageResearch: 0,
  hullResearch: 0,
};

export function createRunProgress(): ArenaRunProgress {
  return {
    xp: 0,
    level: 1,
    nextLevelXp: 8,
    scrap: 0,
    weapons: { pulse: 1, missile: 0, nova: 0 },
    fireRateLevel: 0,
    projectileCountLevel: 0,
    projectileSpeedLevel: 0,
    projectileInterceptLevel: 1,
    turretTurnLevel: 0,
    pendingUpgrades: 0,
    lastUpgradeLabel: 'PULSE Mk.1',
  };
}

export function addKillProgress(
  run: ArenaRunProgress,
  enemyValue: number,
  wave: number,
): void {
  const multiplier = 1 + Math.floor((wave - 1) / 5) * 0.08;
  run.xp += Math.max(1, Math.round(enemyValue / 45));
  run.scrap += Math.round(enemyValue * 0.12 * multiplier);
  while (run.xp >= run.nextLevelXp) {
    run.xp -= run.nextLevelXp;
    run.level += 1;
    run.nextLevelXp = Math.floor(8 * 1.17 ** (run.level - 1));
    run.pendingUpgrades += 1;
  }
}

export function getUpgradeChoices(run: ArenaRunProgress, craftType?: CraftType): UpgradeChoice[] {
  const pool: UpgradeChoice[] = [
    {
      id: 'pulse',
      label: `PULSE Mk.${run.weapons.pulse + 1}`,
      description: '+28% damage for high-Wave armor',
      weight: 2.4,
    },
    {
      id: 'missile',
      label: run.weapons.missile ? `MISSILE Mk.${run.weapons.missile + 1}` : 'UNLOCK MISSILE',
      description: 'nearest target homing salvo',
      weight: run.weapons.missile ? 2.2 : 3.5,
    },
    {
      id: 'nova',
      label: run.weapons.nova ? `NOVA Mk.${run.weapons.nova + 1}` : 'UNLOCK NOVA',
      description: 'periodic 360° shockwave',
      weight: run.weapons.nova ? 1.8 : 2.8,
    },
    { id: 'hull', label: 'FIELD REPAIR', description: 'restore 30% hull', weight: 1.4 },
    {
      id: 'rate',
      label: `OVERCLOCK Lv.${run.fireRateLevel + 1}`,
      description: 'Pulse cooldown -10%',
      weight: 3.2,
    },
    {
      id: 'projectiles',
      label: `MULTI-SHOT Lv.${run.projectileCountLevel + 1}`,
      description: 'Add firing directions and improve hit coverage',
      weight: 3.4,
    },
    {
      id: 'velocity',
      label: `ACCELERATOR Lv.${run.projectileSpeedLevel + 1}`,
      description: 'Faster pulse projectiles improve accuracy',
      weight: 3,
    },
  ];
  if (craftType === 'turret') {
    pool.push({
      id: 'turret-turn',
      label: `TURRET DRIVE Lv.${run.turretTurnLevel + 1}`,
      description: 'Turret rotation speed +16%',
      weight: 3.4,
    });
  }
  const choices: UpgradeChoice[] = [];
  const candidates = [...pool];
  if (craftType === 'turret') {
    const turretChoiceIndex = candidates.findIndex((choice) => choice.id === 'turret-turn');
    if (turretChoiceIndex >= 0) choices.push(candidates.splice(turretChoiceIndex, 1)[0]);
  }
  while (choices.length < 3 && candidates.length) {
    let bestIndex = 0;
    let bestRoll = -Infinity;
    for (let index = 0; index < candidates.length; index += 1) {
      const roll = Math.random() * candidates[index].weight;
      if (roll > bestRoll) {
        bestRoll = roll;
        bestIndex = index;
      }
    }
    choices.push(candidates.splice(bestIndex, 1)[0]);
  }
  return choices;
}

export function applyUpgrade(
  run: ArenaRunProgress,
  choice: UpgradeChoice,
  healHull: () => void,
): void {
  if (choice.id === 'hull') healHull();
  else if (choice.id === 'rate') run.fireRateLevel += 1;
  else if (choice.id === 'projectiles') run.projectileCountLevel += 1;
  else if (choice.id === 'velocity') run.projectileSpeedLevel += 1;
  else if (choice.id === 'turret-turn') run.turretTurnLevel += 1;
  else run.weapons[choice.id] += 1;
  run.pendingUpgrades = Math.max(0, run.pendingUpgrades - 1);
  run.lastUpgradeLabel = choice.label;
}

export function collectEpisode(
  meta: ArenaMetaProgress,
  run: ArenaRunProgress,
  wave: number,
  kills: number,
): number {
  const earned = Math.max(1, Math.floor(wave * 2 + kills * 0.35 + run.scrap * 0.02));
  meta.data += earned;
  meta.highestWave = Math.max(meta.highestWave, wave);
  meta.totalKills += kills;
  meta.totalEpisodes += 1;
  return earned;
}

export function buyResearch(meta: ArenaMetaProgress, kind: 'damage' | 'hull'): boolean {
  const level = kind === 'damage' ? meta.damageResearch : meta.hullResearch;
  const cost = researchCost(level);
  if (meta.data < cost) return false;
  meta.data -= cost;
  if (kind === 'damage') meta.damageResearch += 1;
  else meta.hullResearch += 1;
  return true;
}

export function researchCost(level: number): number {
  return Math.floor(12 * 1.7 ** level);
}

export function canAscend(wave: number): boolean {
  return wave >= 25;
}

export function ascend(meta: ArenaMetaProgress, wave: number): number {
  if (!canAscend(wave)) return 0;
  const earned = Math.max(1, Math.floor((wave / 25) ** 1.65));
  meta.ascendium += earned;
  meta.ascensions += 1;
  return earned;
}

export function ascensionPower(meta: ArenaMetaProgress): number {
  return 1.35 ** meta.ascensions * 1.08 ** meta.ascendium;
}

export function formatIncremental(value: number): string {
  if (value < 1_000) return Math.floor(value).toLocaleString();
  const suffixes = ['K', 'M', 'B', 'T', 'Qa', 'Qi'];
  let scaled = value;
  let index = -1;
  while (scaled >= 1_000 && index < suffixes.length - 1) {
    scaled /= 1_000;
    index += 1;
  }
  if (index === suffixes.length - 1 && scaled >= 1_000) return value.toExponential(2);
  return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffixes[index]}`;
}
