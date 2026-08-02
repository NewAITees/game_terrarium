import assert from 'node:assert/strict';
import test from 'node:test';
import { readTabularQSave, writeTabularQSave } from '../shared/rl/tabular_q_storage';
import type { TabularQSave } from '../shared/rl/rl_types';
import { fixedWidthBand } from '../shared/rl/discretize';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

test('migrates the legacy object-map Q-table format', () => {
  storage.setItem('legacy', JSON.stringify({ danger: [1, -2], safe: [0.5, 3] }));

  assert.deepEqual(readTabularQSave('legacy', { fallbackEpsilon: 0.2 }), {
    version: 1,
    qTable: [['danger', [1, -2]], ['safe', [0.5, 3]]],
    epsilon: 0.2,
    trainingSteps: 0,
  });
});

test('round-trips the versioned format and ignores corrupt data', () => {
  const save: TabularQSave = { version: 1, qTable: [['state', [1, 2]]], epsilon: 0.1, trainingSteps: 7 };
  assert.equal(writeTabularQSave('current', save), true);
  assert.deepEqual(readTabularQSave('current', { fallbackEpsilon: 0.2 }), save);

  storage.setItem('broken', '{not json');
  assert.equal(readTabularQSave('broken', { fallbackEpsilon: 0.2 }), null);
});

test('caps fixed-width state buckets without producing negative bands', () => {
  assert.equal(fixedWidthBand(-3, 10, 3), 0);
  assert.equal(fixedWidthBand(24, 10, 3), 2);
  assert.equal(fixedWidthBand(99, 10, 3), 3);
});
