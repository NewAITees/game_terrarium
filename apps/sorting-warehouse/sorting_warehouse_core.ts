export const GRID_COLUMNS = 20;
export const GRID_ROWS = 15;
export const TARGET_ROWS = GRID_ROWS;
export const PIECE_COUNT = GRID_COLUMNS * GRID_ROWS;
export const CARRY_CAPACITY = 3;

export type SortPhase = 'build-piles' | 'merge-piles' | 'complete';
export type RobotMode = 'scanning' | 'moving-to-piece' | 'lifting' | 'comparing' | 'moving-to-pile' | 'placing-pile' | 'loading-pile' | 'moving-to-output' | 'placing-output' | 'celebrating';
export type ShakePhase = 'idle' | 'warning' | 'impact' | 'settling';
export type ShakeSize = 'small' | 'medium' | 'large';

export type Piece = {
  id: number;
  rank: number;
  hue: number;
  lightness: number;
  slot: number | null;
  pile: number | null;
  pileDepth: number;
  outputSlot: number | null;
  offsetX: number;
  offsetY: number;
  rotation: number;
  height: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  identified: boolean;
  settled: boolean;
};

export type RobotState = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  mode: RobotMode;
  timer: number;
  carrying: number[];
  workPiece: number | null;
  targetPile: number | null;
  thought: string;
};

export type SortingState = {
  pieces: Piece[];
  piles: number[][];
  pending: number[];
  output: number[];
  robot: RobotState;
  phase: SortPhase;
  instruction: number;
  comparePile: number;
  compareLow: number;
  compareHigh: number;
  selectedPile: number;
  round: number;
  elapsed: number;
  moves: number;
  comparisons: number;
  shake: number;
  shakePhase: ShakePhase;
  shakeTimer: number;
  shakeLabel: string;
  shockX: number;
  shockY: number;
  interruptLine: number;
  completedAt: number | null;
  seed: number;
};

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

export function slotPosition(slot: number): { x: number; y: number } {
  return { x: slot % GRID_COLUMNS, y: Math.floor(slot / GRID_COLUMNS) };
}

export function createSortingState(seed = Date.now(), round = 1): SortingState {
  const random = mulberry32(seed + round * 997);
  const ranks = Array.from({ length: PIECE_COUNT }, (_, rank) => rank);
  shuffle(ranks, random);
  const pieces = ranks.map((rank, slot): Piece => ({
    id: slot,
    rank,
    hue: rank / PIECE_COUNT * 330,
    lightness: 48 + Math.floor(rank / GRID_COLUMNS) / (GRID_ROWS - 1) * 18,
    slot,
    pile: null,
    pileDepth: -1,
    outputSlot: null,
    offsetX: (random() - .5) * .42,
    offsetY: (random() - .5) * .42,
    rotation: (random() - .5) * .24,
    height: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    identified: false,
    settled: false,
  }));
  return {
    pieces,
    piles: [],
    pending: pieces.map(piece => piece.id),
    output: [],
    robot: { x: -1, y: 13.5, targetX: -1, targetY: 13.5, mode: 'scanning', timer: .4, carrying: [], workPiece: null, targetPile: null, thought: 'PATIENCE SORT // START' },
    phase: 'build-piles',
    instruction: 0,
    comparePile: -1,
    compareLow: 0,
    compareHigh: -1,
    selectedPile: -1,
    round,
    elapsed: 0,
    moves: 0,
    comparisons: 0,
    shake: 0,
    shakePhase: 'idle',
    shakeTimer: 0,
    shakeLabel: '',
    shockX: 0,
    shockY: 0,
    interruptLine: -1,
    completedAt: null,
    seed,
  };
}

export function sortedCount(state: SortingState): number {
  return state.output.length;
}

export function sortingProgress(state: SortingState): number {
  if (state.phase === 'build-piles') return (PIECE_COUNT - state.pending.length - state.robot.carrying.length) / PIECE_COUNT * .5;
  if (state.phase === 'merge-piles') return .5 + state.output.length / PIECE_COUNT * .5;
  return 1;
}

export function boardCount(state: SortingState): number {
  return state.pieces.filter(piece => piece.slot !== null).length;
}

export type PileSummary = { size: number; topRank: number | null; selected: boolean; comparing: boolean };

export function pileSummaries(state: SortingState): PileSummary[] {
  return state.piles.map((pile, index) => ({
    size: pile.length,
    topRank: pile.length ? state.pieces[pile[pile.length - 1]].rank : null,
    selected: state.selectedPile === index,
    comparing: state.comparePile === index,
  }));
}

function pilePosition(state: SortingState, pileIndex: number, depth = 0): { x: number; y: number } {
  const count = Math.max(1, state.piles.length + Number(pileIndex >= state.piles.length));
  const spread = Math.min(19, count - 1);
  const x = count <= 1 ? 9.5 : pileIndex / (count - 1) * spread + (19 - spread) / 2;
  return { x, y: 17 + Math.min(9, depth * .42) };
}

function advanceRobot(state: SortingState, dt: number): boolean {
  const robot = state.robot;
  const dx = robot.targetX - robot.x;
  const dy = robot.targetY - robot.y;
  const distance = Math.hypot(dx, dy);
  if (distance < .025) {
    robot.x = robot.targetX;
    robot.y = robot.targetY;
    return true;
  }
  const step = Math.min(distance, dt * (30 + Math.min(4, state.round * .2)));
  robot.x += dx / distance * step;
  robot.y += dy / distance * step;
  return false;
}

function setRobotTarget(state: SortingState, x: number, y: number): void {
  state.robot.targetX = x;
  state.robot.targetY = y;
}

function updatePiecePhysics(state: SortingState, dt: number): void {
  for (const piece of state.pieces) {
    if (piece.slot === null || state.robot.carrying.includes(piece.id)) continue;
    if (Math.abs(piece.offsetX) + Math.abs(piece.offsetY) + piece.height < .008) {
      piece.offsetX = 0;
      piece.offsetY = 0;
      piece.height = 0;
      piece.velocityX = 0;
      piece.velocityY = 0;
      piece.velocityZ = 0;
      continue;
    }
    piece.velocityZ -= dt * 9;
    piece.offsetX += piece.velocityX * dt;
    piece.offsetY += piece.velocityY * dt;
    piece.height += piece.velocityZ * dt;
    if (piece.height < 0) {
      piece.height = 0;
      piece.velocityZ = Math.abs(piece.velocityZ) * .25;
    }
    piece.velocityX *= Math.pow(.045, dt);
    piece.velocityY *= Math.pow(.045, dt);
    piece.offsetX *= Math.pow(.12, dt);
    piece.offsetY *= Math.pow(.12, dt);
    piece.rotation *= Math.pow(.2, dt);
  }
}

function updateShake(state: SortingState, dt: number): void {
  if (state.shakePhase === 'idle') return;
  state.shakeTimer -= dt;
  if (state.shakePhase === 'warning') state.interruptLine = 1;
  if (state.shakePhase === 'warning' && state.shakeTimer <= 0) {
    state.shakePhase = 'impact';
    state.shakeTimer = .42;
    state.shake = 1;
    state.interruptLine = 2;
  } else if (state.shakePhase === 'impact' && state.shakeTimer <= 0) {
    state.shakePhase = 'settling';
    state.shakeTimer = 1.5;
    state.interruptLine = 3;
  } else if (state.shakePhase === 'settling' && state.shakeTimer <= 0) {
    state.shakePhase = 'idle';
    state.shake = 0;
    state.shakeLabel = '';
    state.interruptLine = -1;
    state.robot.mode = 'scanning';
    state.robot.timer = .4;
    state.robot.thought = 'RESUME PATIENCE SORT';
  }
  state.shake = Math.max(0, state.shake - dt * .6);
}

function topRank(state: SortingState, pileIndex: number): number {
  const pile = state.piles[pileIndex];
  return state.pieces[pile[pile.length - 1]].rank;
}

function beginComparison(state: SortingState): void {
  state.compareLow = 0;
  state.compareHigh = state.piles.length - 1;
  state.comparePile = state.piles.length ? Math.floor(state.compareHigh / 2) : -1;
  state.selectedPile = -1;
  state.robot.mode = 'comparing';
  state.robot.timer = .08;
  state.instruction = 2;
}

function updateBuildPiles(state: SortingState): void {
  const robot = state.robot;
  if (robot.mode === 'scanning') {
    while (robot.carrying.length < CARRY_CAPACITY && state.pending.length > 0) {
      const nextId = state.pending[0];
      const piece = state.pieces[nextId];
      if (piece.slot === null) {
        state.pending.shift();
        robot.carrying.push(nextId);
        continue;
      }
      robot.workPiece = nextId;
      const position = slotPosition(piece.slot);
      setRobotTarget(state, position.x, position.y);
      robot.mode = 'moving-to-piece';
      robot.thought = `TAKE value ${piece.rank}`;
      state.instruction = 0;
      return;
    }
    if (robot.carrying.length > 0) {
      robot.workPiece = robot.carrying[0];
      beginComparison(state);
      return;
    }
    state.phase = 'merge-piles';
    state.instruction = 0;
    robot.timer = .8;
    robot.thought = `${state.piles.length} PILES // MERGE START`;
  } else if (robot.mode === 'lifting') {
    const piece = state.pieces[robot.workPiece ?? -1];
    if (piece?.slot !== null && piece) {
      piece.slot = null;
      piece.identified = true;
      state.pending.shift();
      robot.carrying.push(piece.id);
      state.moves += 1;
    }
    robot.workPiece = null;
    robot.mode = 'scanning';
    robot.timer = .1;
    state.instruction = 1;
    robot.thought = `PREFETCH ${robot.carrying.length}/3`;
  } else if (robot.mode === 'comparing') {
    const piece = state.pieces[robot.workPiece ?? -1];
    if (!piece) return;
    if (state.compareLow > state.compareHigh) {
      state.selectedPile = state.selectedPile >= 0 ? state.selectedPile : state.piles.length;
      robot.targetPile = state.selectedPile;
      const position = pilePosition(state, state.selectedPile, 0);
      setRobotTarget(state, position.x, position.y);
      robot.mode = 'moving-to-pile';
      robot.thought = state.selectedPile === state.piles.length ? `CREATE pile ${state.selectedPile + 1}` : `LEFTMOST FIT = P${state.selectedPile + 1}`;
      state.instruction = state.selectedPile === state.piles.length ? 5 : 4;
      return;
    }
    const candidate = topRank(state, state.comparePile);
    state.comparisons += 1;
    robot.thought = `${candidate} >= ${piece.rank} ?`;
    state.instruction = 3;
    if (candidate >= piece.rank) {
      state.selectedPile = state.comparePile;
      state.compareHigh = state.comparePile - 1;
    } else {
      state.compareLow = state.comparePile + 1;
    }
    state.comparePile = state.compareLow <= state.compareHigh ? Math.floor((state.compareLow + state.compareHigh) / 2) : -1;
    robot.timer = .06;
  } else if (robot.mode === 'placing-pile') {
    const id = robot.carrying.shift();
    if (id !== undefined && robot.targetPile !== null) {
      if (!state.piles[robot.targetPile]) state.piles[robot.targetPile] = [];
      const pile = state.piles[robot.targetPile];
      pile.push(id);
      const piece = state.pieces[id];
      piece.pile = robot.targetPile;
      piece.pileDepth = pile.length - 1;
      state.moves += 1;
    }
    robot.targetPile = null;
    state.comparePile = -1;
    state.compareLow = 0;
    state.compareHigh = -1;
    state.selectedPile = -1;
    robot.mode = 'scanning';
    robot.timer = .14;
    robot.thought = `PLACE // ${state.piles.length} piles`;
    state.instruction = 6;
  }
}

function selectMinimumPile(state: SortingState): number {
  let selected = -1;
  for (let index = 0; index < state.piles.length; index += 1) {
    if (state.piles[index].length === 0) continue;
    if (selected < 0 || topRank(state, index) < topRank(state, selected)) selected = index;
  }
  return selected;
}

function updateMergePiles(state: SortingState): void {
  const robot = state.robot;
  if (robot.mode === 'scanning') {
    const selected = selectMinimumPile(state);
    state.selectedPile = selected;
    if (selected < 0) {
      state.phase = 'complete';
      state.instruction = 5;
      state.completedAt = state.elapsed;
      robot.mode = 'celebrating';
      robot.timer = 5;
      robot.thought = 'SORT COMPLETE // HALT';
      return;
    }
    robot.targetPile = selected;
    const pile = state.piles[selected];
    const position = pilePosition(state, selected, pile.length - 1);
    setRobotTarget(state, position.x, position.y);
    robot.mode = 'loading-pile';
    robot.timer = .24;
    robot.thought = `MIN TOP = ${topRank(state, selected)}`;
    state.instruction = 0;
  } else if (robot.mode === 'loading-pile') {
    const pileIndex = robot.targetPile ?? -1;
    const pile = state.piles[pileIndex];
    const id = pile?.pop();
    if (id !== undefined) {
      const piece = state.pieces[id];
      piece.pile = null;
      piece.pileDepth = -1;
      robot.carrying.push(id);
      robot.workPiece = id;
      const target = slotPosition(state.output.length);
      setRobotTarget(state, target.x, target.y);
      robot.mode = 'moving-to-output';
      robot.thought = `EXTRACT ${piece.rank}`;
      state.instruction = 2;
    }
  } else if (robot.mode === 'placing-output') {
    const id = robot.carrying.shift();
    if (id !== undefined) {
      const piece = state.pieces[id];
      piece.outputSlot = state.output.length;
      piece.slot = piece.outputSlot;
      piece.settled = true;
      piece.offsetX = 0;
      piece.offsetY = 0;
      piece.rotation = 0;
      state.output.push(id);
      state.moves += 1;
    }
    state.selectedPile = -1;
    robot.targetPile = null;
    robot.workPiece = null;
    robot.mode = 'scanning';
    robot.timer = .12;
    robot.thought = `APPEND // ${state.output.length}/300`;
    state.instruction = 3;
  }
}

export function updateSortingState(state: SortingState, dt: number, timeScale = 1): void {
  const scaledDt = Math.min(dt, .05) * timeScale;
  state.elapsed += scaledDt;
  updatePiecePhysics(state, scaledDt);
  updateShake(state, scaledDt);
  if (state.shakePhase === 'warning' || state.shakePhase === 'impact') return;
  const robot = state.robot;
  if (robot.mode === 'moving-to-piece' || robot.mode === 'moving-to-pile' || robot.mode === 'moving-to-output') {
    if (!advanceRobot(state, scaledDt)) return;
    if (robot.mode === 'moving-to-piece') robot.mode = 'lifting';
    else if (robot.mode === 'moving-to-pile') robot.mode = 'placing-pile';
    else robot.mode = 'placing-output';
    robot.timer = .22;
    return;
  }
  robot.timer -= scaledDt;
  if (robot.timer > 0) return;
  if (state.phase === 'build-piles') updateBuildPiles(state);
  else if (state.phase === 'merge-piles') updateMergePiles(state);
  else if (robot.mode === 'celebrating') Object.assign(state, createSortingState(state.seed + 104729, state.round + 1));
}

function returnPieceToInput(state: SortingState, id: number, slot: number, random: () => number, impulse: number): void {
  const piece = state.pieces[id];
  piece.pile = null;
  piece.pileDepth = -1;
  piece.outputSlot = null;
  piece.slot = slot;
  piece.settled = false;
  piece.identified = false;
  piece.height = .15 + random() * .6;
  piece.velocityZ = impulse * (1 + random() * .4);
  piece.velocityX = (random() - .5) * impulse;
  piece.velocityY = (random() - .5) * impulse;
  piece.rotation = (random() - .5) * impulse;
}

export function applyShake(state: SortingState, size: ShakeSize): number {
  if (state.shakePhase !== 'idle') return 0;
  const random = mulberry32((state.seed ^ Math.floor(state.elapsed * 1000)) + state.moves * 31);
  const requested: Record<ShakeSize, number> = { small: 6, medium: 28, large: 60 };
  const impulse: Record<ShakeSize, number> = { small: .8, medium: 1.45, large: 2.3 };
  const returned: number[] = [];

  if (state.phase === 'build-piles') {
    const pileOrder = state.piles.map((_pile, index) => index);
    shuffle(pileOrder, random);
    while (returned.length < requested[size] && pileOrder.some(index => state.piles[index].length > 0)) {
      for (const index of pileOrder) {
        const id = state.piles[index].pop();
        if (id !== undefined) returned.push(id);
        if (returned.length >= requested[size]) break;
      }
    }
  } else {
    const retract = Math.min(requested[size], state.output.length);
    for (let count = 0; count < retract; count += 1) {
      const id = state.output.pop();
      if (id !== undefined) {
        state.pieces[id].slot = null;
        state.pieces[id].outputSlot = null;
        returned.push(id);
      }
    }
    if (returned.length > 0) state.phase = 'build-piles';
  }

  const bounceNeeded = Math.max(0, requested[size] - returned.length);
  const bounced = state.pieces.filter(piece => piece.slot !== null && !returned.includes(piece.id));
  shuffle(bounced, random);
  bounced.slice(0, bounceNeeded).forEach(piece => {
    piece.height = .08 + random() * .3;
    piece.velocityZ = impulse[size] * (1 + random() * .35);
    piece.velocityX = (random() - .5) * impulse[size];
    piece.velocityY = (random() - .5) * impulse[size];
    piece.rotation = (random() - .5) * impulse[size];
    piece.identified = false;
  });

  const emptySlots = Array.from({ length: PIECE_COUNT }, (_, slot) => slot).filter(slot => !state.pieces.some(piece => piece.slot === slot));
  returned.forEach((id, index) => {
    const slot = emptySlots[index] ?? index;
    returnPieceToInput(state, id, slot, random, impulse[size]);
  });
  state.pending.unshift(...returned.reverse());
  state.piles = state.piles.filter(pile => pile.length > 0);
  state.piles.forEach((pile, pileIndex) => pile.forEach((id, depth) => {
    state.pieces[id].pile = pileIndex;
    state.pieces[id].pileDepth = depth;
  }));
  state.output.forEach((id, index) => {
    state.pieces[id].outputSlot = index;
    state.pieces[id].slot = index;
  });
  state.shockX = random() * GRID_COLUMNS;
  state.shockY = random() * GRID_ROWS;
  state.robot.workPiece = null;
  state.robot.targetPile = null;
  state.robot.mode = 'scanning';
  state.robot.timer = .8;
  state.comparePile = -1;
  state.compareLow = 0;
  state.compareHigh = -1;
  state.selectedPile = -1;
  state.shakePhase = 'warning';
  state.shakeTimer = .55;
  state.interruptLine = 0;
  state.shakeLabel = size === 'large' ? 'PILE COLLAPSE INTERRUPT' : size === 'medium' ? 'TABLE SHAKE INTERRUPT' : 'PILE SLIP INTERRUPT';
  state.robot.thought = 'INTERRUPT // RETURN TOP PIECES';
  state.completedAt = null;
  return returned.length + Math.min(bounceNeeded, bounced.length);
}
