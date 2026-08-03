import type { TabularQSave } from "./rl_types.js";

type StorageOptions = {
  fallbackEpsilon: number;
};

/**
 * Reads both the current serialized Q-table and the original object-map form
 * used by early browser games. Invalid data is deliberately ignored so a bad
 * localStorage entry never prevents a simulation from starting.
 */
export function readTabularQSave(
  key: string,
  options: StorageOptions,
): TabularQSave | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return normalizeSave(JSON.parse(raw), options);
  } catch {
    return null;
  }
}

export function writeTabularQSave(key: string, save: TabularQSave): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

function normalizeSave(
  value: unknown,
  options: StorageOptions,
): TabularQSave | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TabularQSave>;
  if (candidate.version === 1 && Array.isArray(candidate.qTable)) {
    return {
      version: 1,
      qTable: candidate.qTable,
      epsilon: finiteOr(candidate.epsilon, options.fallbackEpsilon),
      trainingSteps: Math.max(
        0,
        Math.floor(finiteOr(candidate.trainingSteps, 0)),
      ),
    };
  }

  const qTable = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number[]] => (
      Array.isArray(entry[1]) &&
      entry[1].every((score) => Number.isFinite(score))
    ));
  return qTable.length
    ? {
      version: 1,
      qTable,
      epsilon: options.fallbackEpsilon,
      trainingSteps: 0,
    }
    : null;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
