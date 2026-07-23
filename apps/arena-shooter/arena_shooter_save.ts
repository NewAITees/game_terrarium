import type { ArenaMetaProgress } from './arena_shooter_progression.js';

export type ArenaPersistentSave = {
  schemaVersion: 2;
  updatedAt: string;
  data: number;
  damageResearch: number;
  hullResearch: number;
};

type LegacyArenaSave = {
  schemaVersion?: number;
  updatedAt?: string;
  meta?: Partial<ArenaMetaProgress>;
};

const STORAGE_KEY = 'rl-arena-save-v2';
const LEGACY_STORAGE_KEY = 'rl-arena-save-v1';
let pendingSave: Promise<void> = Promise.resolve();

function normalizeSave(value: unknown): ArenaPersistentSave | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ArenaPersistentSave> & LegacyArenaSave;
  const source = candidate.schemaVersion === 2 ? candidate : candidate.meta;
  if (!source) return null;
  const data = Number(source.data);
  const damageResearch = Number(source.damageResearch);
  const hullResearch = Number(source.hullResearch);
  if (![data, damageResearch, hullResearch].every((entry) => Number.isFinite(entry) && entry >= 0)) {
    return null;
  }
  return {
    schemaVersion: 2,
    updatedAt: typeof candidate.updatedAt === 'string'
      ? candidate.updatedAt
      : new Date(0).toISOString(),
    data: Math.floor(data),
    damageResearch: Math.floor(damageResearch),
    hullResearch: Math.floor(hullResearch),
  };
}

function loadLocalArenaSave(): ArenaPersistentSave | null {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const save = normalizeSave(JSON.parse(raw));
      if (save) return save;
    } catch {
      // Try the other storage generation.
    }
  }
  return null;
}

function newestSave(
  first: ArenaPersistentSave | null,
  second: ArenaPersistentSave | null,
): ArenaPersistentSave | null {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first.updatedAt) >= Date.parse(second.updatedAt) ? first : second;
}

export async function loadArenaSave(): Promise<ArenaPersistentSave | null> {
  const local = loadLocalArenaSave();
  try {
    const response = await fetch('/api/arena-shooter/save');
    if (!response.ok) return local;
    const result = await response.json() as { ok?: boolean; save?: unknown };
    const selected = newestSave(local, normalizeSave(result.save));
    if (selected) localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    return selected;
  } catch {
    return local;
  }
}

export function saveArenaState(save: ArenaPersistentSave): Promise<void> {
  // localStorage is synchronous, so even Cmd+R retains the latest permanent state.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  pendingSave = pendingSave
    .catch(() => undefined)
    .then(async () => {
      let response = await fetch('/api/arena-shooter/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(save),
      });
      if (response.status === 400) {
        response = await fetch('/api/arena-shooter/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: 1,
            updatedAt: save.updatedAt,
            meta: {
              data: save.data,
              damageResearch: save.damageResearch,
              hullResearch: save.hullResearch,
            },
            run: {},
            agent: {},
            episode: 1,
            wave: 1,
            waveTime: 0,
            score: 0,
            kills: 0,
          }),
        });
      }
      if (!response.ok) throw new Error(`Arena save failed: ${response.status}`);
    });
  return pendingSave;
}
