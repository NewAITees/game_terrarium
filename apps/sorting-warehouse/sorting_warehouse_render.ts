import { CARRY_CAPACITY, GRID_COLUMNS, GRID_ROWS, type Piece, type SortingState, slotPosition } from './sorting_warehouse_core.js';

type Metrics = { x: number; y: number; cell: number; width: number; height: number };

function pixelRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
  context.fillStyle = color;
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function metricsFor(canvas: HTMLCanvasElement): Metrics {
  const logicalRows = 28;
  const cell = Math.floor(Math.min((canvas.clientWidth - 54) / GRID_COLUMNS, (canvas.clientHeight - 58) / logicalRows));
  const width = cell * GRID_COLUMNS;
  const height = cell * logicalRows;
  return { x: Math.floor((canvas.clientWidth - width) / 2), y: Math.floor((canvas.clientHeight - height) / 2) + 6, cell, width, height };
}

function pilePosition(state: SortingState, pileIndex: number, depth: number, metrics: Metrics): { x: number; y: number } {
  const count = Math.max(1, state.piles.length);
  const spread = Math.min(19, count - 1);
  const logicalX = count <= 1 ? 9.5 : pileIndex / (count - 1) * spread + (19 - spread) / 2;
  return {
    x: metrics.x + (logicalX + .5) * metrics.cell,
    y: metrics.y + (17.3 + Math.min(9, depth * .42)) * metrics.cell,
  };
}

function drawPiece(context: CanvasRenderingContext2D, piece: Piece, x: number, y: number, size: number, showRank = false): void {
  context.save();
  context.translate(Math.round(x), Math.round(y));
  context.rotate(piece.rotation);
  pixelRect(context, -size / 2 + 2, -size / 2 + 3, size, size, 'rgba(0,0,0,.38)');
  pixelRect(context, -size / 2, -size / 2, size, size, `hsl(${piece.hue} 70% ${piece.lightness - 8}%)`);
  pixelRect(context, -size / 2 + 2, -size / 2 + 2, size - 4, size - 4, `hsl(${piece.hue} 76% ${piece.lightness}%)`);
  pixelRect(context, -size / 2 + 3, -size / 2 + 3, size - 6, 2, 'rgba(255,255,255,.26)');
  if (showRank && size >= 15) {
    context.fillStyle = '#16262d';
    context.font = `bold ${Math.max(7, Math.floor(size * .3))}px monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(piece.rank), 0, 1);
  }
  if (!piece.identified && piece.outputSlot === null && piece.pile === null) {
    pixelRect(context, -2, -5, 4, 7, 'rgba(26,37,44,.75)');
    pixelRect(context, -2, 4, 4, 3, 'rgba(26,37,44,.75)');
  }
  context.restore();
}

function drawRobot(context: CanvasRenderingContext2D, state: SortingState, metrics: Metrics, now: number): void {
  const robot = state.robot;
  const x = metrics.x + (robot.x + .5) * metrics.cell;
  const y = metrics.y + (robot.y + .5) * metrics.cell + Math.round(Math.sin(now * .008) * 2);
  const scale = Math.max(1, Math.floor(metrics.cell / 9));
  context.save();
  context.translate(Math.round(x), Math.round(y));
  context.shadowColor = '#fff2a8';
  context.shadowBlur = 7;
  pixelRect(context, -5 * scale, -6 * scale, 10 * scale, 9 * scale, '#f4df9a');
  pixelRect(context, -4 * scale, -5 * scale, 8 * scale, 5 * scale, '#69b7a9');
  pixelRect(context, -3 * scale, -4 * scale, 2 * scale, 2 * scale, '#102b34');
  pixelRect(context, 1 * scale, -4 * scale, 2 * scale, 2 * scale, '#102b34');
  pixelRect(context, -5 * scale, 3 * scale, 3 * scale, 3 * scale, '#c97e63');
  pixelRect(context, 2 * scale, 3 * scale, 3 * scale, 3 * scale, '#c97e63');
  state.robot.carrying.slice(0, CARRY_CAPACITY).forEach((id, index) => {
    const piece = state.pieces[id];
    pixelRect(context, (-5 + index * 4) * scale, (-11 - index * 2) * scale, 5 * scale, 5 * scale, `hsl(${piece.hue} 72% ${piece.lightness}%)`);
  });
  context.restore();
}

export function resizeCanvas(canvas: HTMLCanvasElement): void {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

export function renderSortingWarehouse(canvas: HTMLCanvasElement, state: SortingState, now: number): void {
  resizeCanvas(canvas);
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = canvas.width / canvas.clientWidth;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.imageSmoothingEnabled = false;
  const metrics = metricsFor(canvas);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  context.save();
  if (state.shake > 0) context.translate((Math.random() - .5) * state.shake * 15, (Math.random() - .5) * state.shake * 11);

  pixelRect(context, metrics.x - 14, metrics.y - 15, metrics.width + 28, GRID_ROWS * metrics.cell + 28, '#8e5f62');
  pixelRect(context, metrics.x - 8, metrics.y - 9, metrics.width + 16, GRID_ROWS * metrics.cell + 16, '#2a3b47');
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const x = metrics.x + column * metrics.cell;
      const y = metrics.y + row * metrics.cell;
      pixelRect(context, x, y, metrics.cell - 1, metrics.cell - 1, (row + column) % 2 ? '#344b54' : '#30464f');
    }
  }
  context.fillStyle = '#b6c5b7';
  context.font = `bold ${Math.max(8, Math.floor(metrics.cell * .42))}px monospace`;
  context.textAlign = 'left';
  context.fillText(state.phase === 'build-piles' ? 'INPUT BUFFER // DRAINING' : 'SORTED OUTPUT // WRITING', metrics.x, metrics.y - 14);

  pixelRect(context, metrics.x - 14, metrics.y + 16.2 * metrics.cell, metrics.width + 28, 10.8 * metrics.cell, '#4d3747');
  pixelRect(context, metrics.x - 8, metrics.y + 16.7 * metrics.cell, metrics.width + 16, 10 * metrics.cell, '#2b2937');
  context.fillStyle = '#e5ce98';
  context.fillText(`PATIENCE TABLE // ${state.piles.filter(pile => pile.length).length} ACTIVE PILES`, metrics.x, metrics.y + 16.4 * metrics.cell);

  for (const piece of state.pieces) {
    if (state.robot.carrying.includes(piece.id) || piece.slot === null) continue;
    const slot = slotPosition(piece.slot);
    const x = metrics.x + (slot.x + piece.offsetX + .5) * metrics.cell;
    const y = metrics.y + (slot.y + piece.offsetY + .5 - piece.height) * metrics.cell;
    drawPiece(context, piece, x, y, Math.max(6, metrics.cell - 3), piece.outputSlot !== null);
  }

  state.piles.forEach((pile, pileIndex) => {
    pile.forEach((id, depth) => {
      const piece = state.pieces[id];
      const position = pilePosition(state, pileIndex, depth, metrics);
      const highlighted = state.comparePile === pileIndex || state.selectedPile === pileIndex;
      if (highlighted && depth === pile.length - 1) {
        context.strokeStyle = state.selectedPile === pileIndex ? '#ffe17c' : '#7ce9ff';
        context.lineWidth = 3;
        context.strokeRect(position.x - metrics.cell * .48, position.y - metrics.cell * .48, metrics.cell * .96, metrics.cell * .96);
      }
      drawPiece(context, piece, position.x, position.y, Math.max(7, metrics.cell - 2), depth === pile.length - 1);
    });
  });

  if (state.shakePhase === 'warning' || state.shakePhase === 'impact') {
    const progress = state.shakePhase === 'warning' ? 1 - state.shakeTimer / .55 : 1 + (1 - state.shakeTimer / .42) * 5;
    context.strokeStyle = state.shakePhase === 'warning' ? 'rgba(255,210,111,.8)' : 'rgba(255,109,105,.85)';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(metrics.x + (state.shockX + .5) * metrics.cell, metrics.y + (state.shockY + .5) * metrics.cell, metrics.cell * progress, 0, Math.PI * 2);
    context.stroke();
  }
  drawRobot(context, state, metrics, now);
  context.restore();
}
