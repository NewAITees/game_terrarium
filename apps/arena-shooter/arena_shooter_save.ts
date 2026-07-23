import type { QLearningAgentSave } from './arena_shooter_agent.js';
import {
  DEFAULT_META,
  createRunProgress,
  type ArenaMetaProgress,
  type ArenaRunProgress,
} from './arena_shooter_progression.js';

export type ArenaPersistentSave = {
  schemaVersion: 1;
  updatedAt: string;
  meta: ArenaMetaProgress;
  run: ArenaRunProgress;
  agent: QLearningAgentSave;
  episode: number;
  wave: number;
  waveTime: number;
  score: number;
  kills: number;
};

const STORAGE_KEY = 'rl-arena-save-v1';

function loadLocalArenaSave(): ArenaPersistentSave | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ArenaPersistentSave>;
    if (parsed.schemaVersion !== 1 || !parsed.meta || !parsed.run || !parsed.agent) return null;
    return parsed as ArenaPersistentSave;
  } catch {
    return null;
  }
}

export async function loadArenaSave(): Promise<ArenaPersistentSave | null> {
  const local = loadLocalArenaSave();
  try {
    const response = await fetch('/api/arena-shooter/save');
    if (!response.ok) return local;
    const result = await response.json() as { ok?: boolean; save?: ArenaPersistentSave | null };
    return result.save ?? local;
  } catch {
    return local;
  }
}

export async function saveArenaState(save: ArenaPersistentSave): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  try {
    const response = await fetch('/api/arena-shooter/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(save),
    });
    if (response.ok) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Browser fallback remains available until the server accepts a later checkpoint.
  }
}

export function sanitizeMeta(meta: Partial<ArenaMetaProgress> | undefined): ArenaMetaProgress {
  return {
    ...DEFAULT_META,
    ...meta,
  };
}

export function sanitizeRun(run: Partial<ArenaRunProgress> | undefined): ArenaRunProgress {
  const fallback = createRunProgress();
  return {
    ...fallback,
    ...run,
    weapons: {
      ...fallback.weapons,
      ...run?.weapons,
    },
  };
}
