import { applyShake, createSortingState, PIECE_COUNT, pileSummaries, sortedCount, sortingProgress, updateSortingState, type ShakeSize } from './sorting_warehouse_core.js';
import { renderSortingWarehouse } from './sorting_warehouse_render.js';

const canvas = document.getElementById('warehouse-canvas') as HTMLCanvasElement;
const progressFill = document.getElementById('progress-fill') as HTMLElement;
const progressText = document.getElementById('progress-text') as HTMLElement;
const sortedText = document.getElementById('sorted-count') as HTMLElement;
const remainingText = document.getElementById('remaining-count') as HTMLElement;
const roundText = document.getElementById('round-count') as HTMLElement;
const taskText = document.getElementById('robot-task') as HTMLElement;
const timerText = document.getElementById('timer') as HTMLElement;
const shakeNotice = document.getElementById('shake-notice') as HTMLElement;
const speedButton = document.getElementById('speed-button') as HTMLButtonElement;
const pauseButton = document.getElementById('pause-button') as HTMLButtonElement;
const phaseText = document.getElementById('phase-value') as HTMLElement;
const cursorText = document.getElementById('cursor-value') as HTMLElement;
const cargoText = document.getElementById('cargo-value') as HTMLElement;
const boardText = document.getElementById('board-value') as HTMLElement;
const pileGrid = document.getElementById('pile-grid') as HTMLElement;

let state = createSortingState();
let paused = false;
let timeScale = 1;
let previousTime = performance.now();
let uiCooldown = 0;

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function updateUi(force = false): void {
  if (!force && uiCooldown > 0) return;
  uiCooldown = .12;
  const count = sortedCount(state);
  const progress = sortingProgress(state);
  progressFill.style.width = `${progress * 100}%`;
  progressText.textContent = `${Math.floor(progress * 100)}%`;
  sortedText.textContent = `${count} / ${PIECE_COUNT}`;
  remainingText.textContent = String(PIECE_COUNT - count);
  roundText.textContent = `ROUND ${String(state.round).padStart(2, '0')}`;
  taskText.textContent = state.robot.thought;
  timerText.textContent = formatTime(state.elapsed);
  shakeNotice.textContent = state.shakeLabel;
  shakeNotice.dataset.active = String(state.shake > 0);
  phaseText.textContent = state.shakePhase !== 'idle' ? 'INTERRUPT' : state.phase.toUpperCase();
  cursorText.textContent = state.phase === 'build-piles' ? `${PIECE_COUNT - state.pending.length} / ${PIECE_COUNT}` : `${state.output.length} / ${PIECE_COUNT}`;
  cargoText.textContent = `${state.robot.carrying.length} / 3`;
  boardText.textContent = String(state.pending.length);
  document.querySelectorAll<HTMLElement>('[data-program-line]').forEach(line => {
    const isInterrupt = line.dataset.program === 'interrupt';
    const index = Number(line.dataset.programLine);
    line.dataset.active = String(isInterrupt ? state.interruptLine === index : state.shakePhase === 'idle' && line.dataset.program === state.phase && state.instruction === index);
  });
  const summaries = pileSummaries(state);
  pileGrid.replaceChildren(...summaries.map((summary, index) => {
    const pile = document.createElement('div');
    pile.className = 'pile-monitor';
    pile.dataset.active = String(summary.selected || summary.comparing);
    pile.dataset.selected = String(summary.selected);
    pile.innerHTML = `<span>P${String(index + 1).padStart(2, '0')}</span><b>${summary.topRank ?? '—'}</b><small>H ${summary.size}</small>`;
    return pile;
  }));
}

function triggerShake(size: ShakeSize): void {
  const affected = applyShake(state, size);
  shakeNotice.textContent = affected > 0 ? `${state.shakeLabel} // ${affected} PIECES` : 'SAFE STORAGE LIMIT';
  shakeNotice.dataset.active = 'true';
  updateUi(true);
}

document.querySelectorAll<HTMLButtonElement>('[data-shake]').forEach(button => {
  button.addEventListener('click', () => triggerShake(button.dataset.shake as ShakeSize));
});

speedButton.addEventListener('click', () => {
  timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 4 : 1;
  speedButton.textContent = `SPEED ×${timeScale}`;
});

pauseButton.addEventListener('click', () => {
  paused = !paused;
  pauseButton.textContent = paused ? 'RESUME' : 'PAUSE';
  taskText.textContent = paused ? '休憩中…' : state.robot.thought;
});

document.getElementById('new-round')?.addEventListener('click', () => {
  state = createSortingState(Date.now(), state.round + 1);
  updateUi(true);
});

function frame(now: number): void {
  const dt = Math.min(.05, (now - previousTime) / 1000);
  previousTime = now;
  if (!paused) updateSortingState(state, dt, timeScale);
  uiCooldown -= dt;
  updateUi();
  renderSortingWarehouse(canvas, state, now);
  requestAnimationFrame(frame);
}

updateUi(true);
requestAnimationFrame(frame);
