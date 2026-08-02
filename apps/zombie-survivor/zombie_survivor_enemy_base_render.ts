type Enemy = { x: number; y: number; kind: string };

export function drawZombieEnemyBases(
  context: CanvasRenderingContext2D,
  enemies: readonly Enemy[],
  sprite: HTMLImageElement,
): void {
  for (const enemy of enemies) {
    const color = enemy.kind === 'runner' ? '#e8bb72' : enemy.kind === 'brute' ? '#c96d73' : '#76bf8a';
    context.save();
    context.translate(enemy.x, enemy.y);
    context.globalAlpha = 0.35;
    context.fillStyle = '#020605';
    context.beginPath();
    context.ellipse(0, 17, enemy.kind === 'brute' ? 22 : 15, 6, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    context.shadowColor = color;
    context.shadowBlur = enemy.kind === 'brute' ? 16 : 7;
    if (sprite.complete && sprite.naturalWidth) {
      context.globalAlpha = 0.9;
      context.drawImage(sprite, -22, -28, 44, 56);
      context.globalAlpha = 0.42;
      context.fillStyle = color;
      context.globalCompositeOperation = 'screen';
      context.fillRect(-22, -28, 44, 56);
    } else {
      context.fillStyle = color;
      context.beginPath();
      context.arc(0, 0, enemy.kind === 'brute' ? 16 : 12, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    if (enemy.kind === 'runner') drawMarker(context, '#ffd166', 2, 19, -0.8, 0.8);
    if (enemy.kind === 'brute') drawMarker(context, '#ff8b92', 3, 23, 0, Math.PI * 2);
    context.restore();
  }
}

function drawMarker(context: CanvasRenderingContext2D, color: string, width: number, radius: number, start: number, end: number): void {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.arc(0, 0, radius, start, end);
  context.stroke();
}
