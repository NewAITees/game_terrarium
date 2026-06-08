import type { NetworkDefenseRank } from '../../shared/types/network_defense.js';

export const EDGE_SPEED = { min: 0.42, max: 1.08 };
export const WIN_WAVE = 10;
export const RULE_UPDATE_RANKS: NetworkDefenseRank[] = ['senior', 'mid', 'junior'];

export const AGENT_RANKS = {
  senior: { color: 0xfff0a8, size: 1.65, cooldown: 1.8, label: 'senior' },
  mid: { color: 0x7de8ff, size: 1.25, cooldown: 1.1, label: 'mid' },
  junior: { color: 0x9df0a4, size: 0.95, cooldown: 0.75, label: 'junior' },
};

export const RANK_PROFILE = {
  senior: { moveSpeed: 0.42, heavy: [0.60, 0.50, 1.55], light: [1.45, 1.80, 0.60] },
  mid: { moveSpeed: 0.66, heavy: [1.00, 1.00, 1.00], light: [1.00, 1.00, 1.00] },
  junior: { moveSpeed: 0.98, heavy: [1.60, 2.10, 0.50], light: [0.60, 0.50, 1.60] },
};

export const DEFAULT_RULES = {
  senior: [
    { id: 'server_emergency', when: { serverNeighborInfection: 0.5 }, action: 'containServerNeighbor' },
    { id: 'intercept_enemy', when: { enemyCount: 2 }, action: 'interceptEnemy' },
    { id: 'recruit_mid_emerg', when: 'midCount < 6 && avgInfection > 0.3 && credits >= 160', action: 'recruitMid' },
    { id: 'recruit_mid', when: 'midCount < 4 && wave >= 2 && credits >= 240', action: 'recruitMid' },
    { id: 'recruit_junior_emerg', when: 'juniorCount < 4 && serverHp < 70 && credits >= 80', action: 'recruitJunior' },
    { id: 'recruit_junior', when: 'juniorCount < 2 && credits >= 160', action: 'recruitJunior' },
    { id: 'patrol', action: 'patrol' },
  ],
  mid: [
    { id: 'server_perimeter', when: { serverNeighborInfection: 0.3 }, action: 'containServerNeighbor' },
    { id: 'intercept_enemy', when: { enemyCount: 1, gameRuleNot: 'containment' }, action: 'interceptEnemy' },
    { id: 'recruit_junior', when: 'juniorCount < 3 && credits >= 160', action: 'recruitJunior' },
    { id: 'suppress_hottest', when: { hottestInfection: 0.15 }, action: 'suppressHottest' },
    { id: 'patrol', action: 'patrol' },
  ],
  junior: [
    { id: 'server_emergency', when: { serverNeighborInfection: 0.6 }, action: 'containServerNeighbor' },
    { id: 'clear_path', when: 'hottestInfection > 0.4', action: 'clearPathTo' },
    { id: 'repair_weakest', action: 'repairWeakest' },
    { id: 'patrol', action: 'patrol' },
  ],
};

export const AGENT_COSTS = { senior: 300, mid: 160, junior: 80 };

export function actionStats(rank: NetworkDefenseRank, key: string) {
  const ACTION_DEFS = {
    containServerNeighbor: { cost: 25, dur: 1.8, heavy: true },
    interceptEnemy: { cost: 20, dur: 1.5, heavy: true },
    suppressHottest: { cost: 20, dur: 2.0, heavy: true },
    deployFirewallGuard: { cost: 30, dur: 1.8, heavy: true },
    rebootNode: { cost: 40, dur: 2.5, heavy: true },
    rebootNeighbor: { cost: 35, dur: 2.0, heavy: true },
    clearPathTo: { cost: 25, dur: 1.8, heavy: true },
    repairWeakest: { cost: 8, dur: 0.8, heavy: false },
    hardenNode: { cost: 15, dur: 1.0, heavy: false },
    patrol: { cost: 0, dur: 0, heavy: false },
    repair: { cost: 10, dur: 1.2, heavy: false },
    recruitMid: { cost: 0, dur: 0, heavy: false },
    recruitJunior: { cost: 0, dur: 0, heavy: false },
    idle: { cost: 0, dur: 0, heavy: false },
  };
  const def = ACTION_DEFS[key] ?? { cost: 0, dur: 0, heavy: false };
  const prof = RANK_PROFILE[rank]?.[def.heavy ? 'heavy' : 'light'] ?? [1, 1, 1];
  return {
    cost: Math.round(def.cost * prof[0]),
    dur: def.dur * prof[1],
    eff: prof[2],
  };
}
