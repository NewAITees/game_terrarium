import assert from 'node:assert/strict';
import test from 'node:test';
import { applyShake, createSortingState, PIECE_COUNT, sortedCount, updateSortingState } from '../apps/sorting-warehouse/sorting_warehouse_core';

function simulateUntilSorted(seed: number, maximumSeconds = 600): ReturnType<typeof createSortingState> {
  const state = createSortingState(seed);
  for (let elapsed = 0; elapsed < maximumSeconds && sortedCount(state) < PIECE_COUNT; elapsed += .05) {
    updateSortingState(state, .05, 4);
  }
  return state;
}

test('sorting robot deterministically converges all 300 pieces', () => {
  const state = simulateUntilSorted(4242);
  assert.equal(state.pieces.length, 300);
  assert.equal(sortedCount(state), PIECE_COUNT);
  assert.ok(state.moves > 200);
});

test('comment shake preserves a floor and robot repairs the damage', () => {
  const state = simulateUntilSorted(9191);
  const affected = applyShake(state, 'large');
  assert.ok(affected >= 50);
  assert.ok(sortedCount(state) >= Math.floor(PIECE_COUNT * .35));

  for (let elapsed = 0; elapsed < 360 && sortedCount(state) < PIECE_COUNT; elapsed += .05) {
    updateSortingState(state, .05, 4);
  }
  assert.equal(sortedCount(state), PIECE_COUNT);
});

test('comment shake is visible even before much has been sorted', () => {
  const state = createSortingState(7070);
  const before = state.pieces.map(piece => piece.slot);
  const affected = applyShake(state, 'medium');
  assert.ok(affected >= 25);
  assert.equal(state.shakePhase, 'warning');
  assert.ok(state.pieces.some((piece, index) => piece.slot !== before[index] || piece.height > 0));
});

test('patience sort builds legal piles before merging an ascending output', () => {
  const state = createSortingState(8080);
  let sawPilePhase = false;
  for (let step = 0; step < 12000 && sortedCount(state) < PIECE_COUNT; step += 1) {
    updateSortingState(state, .05, 4);
    if (state.phase === 'merge-piles') sawPilePhase = true;
  }
  assert.equal(sawPilePhase, true);
  assert.equal(sortedCount(state), PIECE_COUNT);
  assert.deepEqual(state.output.map(id => state.pieces[id].rank), Array.from({ length: PIECE_COUNT }, (_, rank) => rank));
});
