import type { EmpireDoctrine, PlanetStrategyMatchResult } from '../../shared/types/planet_strategy.js';

const STORAGE_KEY = 'ai-planet-observatory-profile-v1';
const MAX_HISTORY = 10;

export interface EmpireLineage {
  name: string;
  generation: number;
  doctrine: EmpireDoctrine;
  totalWins: number;
  totalLosses: number;
}

interface ObservatoryProfile {
  cycleNumber: number;
  autoRun: boolean;
  lineages: Record<string, EmpireLineage>;
  history: PlanetStrategyMatchResult[];
  observationPoints: number;
  unlockedModifierIds: string[];
  worldMode: 'fixed' | 'random';
  selectedModifierId: string;
  maxCycles: number | null;
}

export interface WorldModifier { id: string; name: string; description: string; resourceMultiplier: number; mineRateMultiplier: number; factoryCostMultiplier: number; }
export const WORLD_MODIFIERS: WorldModifier[] = [
  { id: 'abundant', name: 'Resource Rich', description: 'More ore, slightly hungrier factories.', resourceMultiplier: 1.3, mineRateMultiplier: 1, factoryCostMultiplier: 1.1 },
  { id: 'depleted', name: 'Dry System', description: 'Less ore but fast early extraction.', resourceMultiplier: 0.65, mineRateMultiplier: 1.15, factoryCostMultiplier: 1 },
  { id: 'high_maintenance', name: 'High Maintenance Economy', description: 'Factories cost more to sustain.', resourceMultiplier: 1, mineRateMultiplier: 1, factoryCostMultiplier: 1.4 },
];

export const DEFAULT_DOCTRINES: Record<string, EmpireDoctrine> = {
  'Aster Union': { expansionBias: 0.72, logisticsBias: 0.56, stockpileBias: 0.46, riskTolerance: 0.62, factoryPriority: 0.55, repairPriority: 0.42, routeDiversity: 0.48 },
  'Red Meridian': { expansionBias: 0.46, logisticsBias: 0.44, stockpileBias: 0.38, riskTolerance: 0.74, factoryPriority: 0.78, repairPriority: 0.34, routeDiversity: 0.36 },
  'Verdant Ring': { expansionBias: 0.34, logisticsBias: 0.76, stockpileBias: 0.72, riskTolerance: 0.32, factoryPriority: 0.45, repairPriority: 0.72, routeDiversity: 0.8 },
};

function cloneDoctrine(doctrine: EmpireDoctrine): EmpireDoctrine {
  return { ...doctrine };
}

function defaultProfile(): ObservatoryProfile {
  const lineages: Record<string, EmpireLineage> = {};
  for (const [name, doctrine] of Object.entries(DEFAULT_DOCTRINES)) {
    lineages[name] = { name, generation: 1, doctrine: cloneDoctrine(doctrine), totalWins: 0, totalLosses: 0 };
  }
  return { cycleNumber: 1, autoRun: false, lineages, history: [], observationPoints: 0, unlockedModifierIds: ['abundant'], worldMode: 'random', selectedModifierId: 'abundant', maxCycles: null };
}

export function createPlanetStrategyCycle() {
  let profile = loadProfile();
  let restartTimer: number | null = null;

  function loadProfile(): ObservatoryProfile {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaultProfile();
      const parsed = JSON.parse(saved) as ObservatoryProfile;
      const fallback = defaultProfile();
      return {
        cycleNumber: Math.max(1, parsed.cycleNumber ?? fallback.cycleNumber),
        autoRun: Boolean(parsed.autoRun),
        lineages: { ...fallback.lineages, ...(parsed.lineages ?? {}) },
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, MAX_HISTORY) : [],
        observationPoints: Math.max(0, parsed.observationPoints ?? 0),
        unlockedModifierIds: Array.isArray(parsed.unlockedModifierIds) ? parsed.unlockedModifierIds : ['abundant'],
        worldMode: parsed.worldMode === 'fixed' ? 'fixed' : 'random',
        selectedModifierId: typeof parsed.selectedModifierId === 'string' ? parsed.selectedModifierId : 'abundant',
        maxCycles: typeof parsed.maxCycles === 'number' ? parsed.maxCycles : null,
      };
    } catch {
      return defaultProfile();
    }
  }

  function save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  function getDoctrine(name: string): EmpireDoctrine {
    return cloneDoctrine(profile.lineages[name]?.doctrine ?? DEFAULT_DOCTRINES[name] ?? DEFAULT_DOCTRINES['Aster Union']);
  }

  function getGeneration(name: string): number {
    return profile.lineages[name]?.generation ?? 1;
  }

  function record(result: PlanetStrategyMatchResult): Array<{ name: string; reason: string }> {
    const mutations: Array<{ name: string; reason: string }> = [];
    for (const empire of result.empireResults) {
      const lineage = profile.lineages[empire.empireName] ?? {
        name: empire.empireName, generation: 1, doctrine: getDoctrine(empire.empireName), totalWins: 0, totalLosses: 0,
      };
      if (empire.empireId === result.winnerEmpireId) lineage.totalWins++;
      else lineage.totalLosses++;
      const mutation = mutate(lineage.doctrine, empire);
      if (mutation) {
        lineage.generation++;
        mutations.push({ name: lineage.name, reason: mutation });
      }
      profile.lineages[lineage.name] = lineage;
    }
    profile.history.unshift(result);
    profile.history = profile.history.slice(0, MAX_HISTORY);
    const newCollapse = result.firstCollapsedEmpireId !== null && !profile.history.slice(1).some((match) => match.firstCollapsedEmpireId === result.firstCollapsedEmpireId);
    profile.observationPoints += 10 + (newCollapse ? 5 : 0) + (result.depletedPlanetCount > 0 ? 3 : 0);
    if (profile.observationPoints >= 30 && !profile.unlockedModifierIds.includes('depleted')) profile.unlockedModifierIds.push('depleted');
    if (profile.observationPoints >= 60 && !profile.unlockedModifierIds.includes('high_maintenance')) profile.unlockedModifierIds.push('high_maintenance');
    profile.cycleNumber++;
    save();
    return mutations;
  }

  function mutate(doctrine: EmpireDoctrine, result: PlanetStrategyMatchResult['empireResults'][number]): string | null {
    if (result.factoryStalledSeconds >= 20) {
      doctrine.stockpileBias = cap(doctrine.stockpileBias + 0.08);
      doctrine.logisticsBias = cap(doctrine.logisticsBias + 0.05);
      doctrine.factoryPriority = cap(doctrine.factoryPriority - 0.03);
      return 'learned to protect factory reserves';
    }
    if (result.collapseReason?.includes('transport')) {
      doctrine.repairPriority = cap(doctrine.repairPriority + 0.07);
      doctrine.routeDiversity = cap(doctrine.routeDiversity + 0.06);
      return 'learned to replace and diversify transport lanes';
    }
    if (result.planetsControlled >= 4 && result.collapsed) {
      doctrine.expansionBias = cap(doctrine.expansionBias - 0.06);
      doctrine.riskTolerance = cap(doctrine.riskTolerance - 0.05);
      return 'learned to slow unsupported expansion';
    }
    return null;
  }

  function cap(value: number): number { return Math.max(0.15, Math.min(0.9, value)); }

  function scheduleNext(start: () => void): void {
    if (!profile.autoRun) return;
    if (profile.maxCycles !== null && profile.cycleNumber > profile.maxCycles) return;
    restartTimer = window.setTimeout(start, 30000);
  }

  function cancelScheduledNext(): void {
    if (restartTimer !== null) window.clearTimeout(restartTimer);
    restartTimer = null;
  }

  function pickWorldModifier(): WorldModifier {
    const available = WORLD_MODIFIERS.filter((modifier) => profile.unlockedModifierIds.includes(modifier.id));
    if (profile.worldMode === 'fixed') return available.find((modifier) => modifier.id === profile.selectedModifierId) ?? available[0] ?? WORLD_MODIFIERS[0];
    return available[Math.floor(Math.random() * available.length)] ?? WORLD_MODIFIERS[0];
  }

  return {
    cancelScheduledNext,
    cycleNumber: () => profile.cycleNumber,
    getDoctrine,
    getGeneration,
    history: () => profile.history,
    lineages: () => profile.lineages,
    isAutoRun: () => profile.autoRun,
    observationPoints: () => profile.observationPoints,
    pickWorldModifier,
    record,
    scheduleNext,
    setAutoRun: (enabled: boolean) => { profile.autoRun = enabled; save(); },
    cycleWorldMode: () => { profile.worldMode = profile.worldMode === 'fixed' ? 'random' : 'fixed'; save(); return profile.worldMode; },
    cycleSelectedModifier: () => { const available = WORLD_MODIFIERS.filter((modifier) => profile.unlockedModifierIds.includes(modifier.id)); const index = available.findIndex((modifier) => modifier.id === profile.selectedModifierId); profile.selectedModifierId = available[(index + 1) % available.length]?.id ?? 'abundant'; save(); return profile.selectedModifierId; },
    cycleMaxCycles: () => { profile.maxCycles = profile.maxCycles === null ? profile.cycleNumber + 3 : profile.maxCycles === profile.cycleNumber + 3 ? profile.cycleNumber + 10 : null; save(); return profile.maxCycles; },
    setup: () => ({ worldMode: profile.worldMode, selectedModifierId: profile.selectedModifierId, maxCycles: profile.maxCycles, unlockedModifierIds: profile.unlockedModifierIds }),
  };
}
