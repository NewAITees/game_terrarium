type Box = { x: number; y: number; hp: number; kind: string };
type Projectile = { x: number; y: number; vx: number; vy: number; color: string };
type Effect = { x: number; y: number; color: string; life: number; size: number };
type Drop = { x: number; y: number; kind: string };

export function drawZombieEffects(
  context: CanvasRenderingContext2D,
  boxes: readonly Box[],
  projectiles: readonly Projectile[],
  effects: readonly Effect[],
  drops: readonly Drop[],
): void {
  for (const box of boxes) drawBox(context, box);
  for (const projectile of projectiles) drawProjectile(context, projectile);
  for (const effect of effects) drawEffect(context, effect);
  for (const drop of drops) drawDrop(context, drop);
}

function drawBox(context: CanvasRenderingContext2D, box: Box): void {
  context.save();
  context.translate(box.x, box.y);
  context.shadowColor = box.kind === 'supply' ? '#d48cff' : '#a97747';
  context.shadowBlur = 10;
  context.fillStyle = box.kind === 'supply' ? '#684477' : box.kind === 'car' ? '#2f6670' : '#704a32';
  context.fillRect(-15, -11, 30, 22);
  context.shadowBlur = 0;
  context.strokeStyle = box.hp < 3 ? '#ff9b69' : '#d4a76c';
  context.strokeRect(-15, -11, 30, 22);
  context.strokeStyle = '#d5b27b';
  context.beginPath();
  context.moveTo(-12, -7); context.lineTo(12, 7);
  context.moveTo(12, -7); context.lineTo(-12, 7);
  context.stroke();
  context.restore();
}

function drawProjectile(context: CanvasRenderingContext2D, projectile: Projectile): void {
  context.save();
  context.strokeStyle = projectile.color;
  context.shadowColor = projectile.color;
  context.shadowBlur = 14;
  context.lineWidth = projectile.color === '#ffd166' ? 7 : 4;
  context.beginPath();
  context.moveTo(projectile.x, projectile.y);
  context.lineTo(projectile.x - projectile.vx * 0.045, projectile.y - projectile.vy * 0.045);
  context.stroke();
  context.restore();
}

function drawEffect(context: CanvasRenderingContext2D, effect: Effect): void {
  const alpha = Math.max(0, effect.life / 0.65);
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = effect.color;
  context.shadowColor = effect.color;
  context.shadowBlur = 16;
  context.lineWidth = 3;
  context.beginPath();
  context.arc(effect.x, effect.y, effect.size * (1 - alpha), 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = effect.color;
  context.globalAlpha = alpha * 0.28;
  context.beginPath();
  context.arc(effect.x, effect.y, effect.size * (1 - alpha) * 0.65, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawDrop(context: CanvasRenderingContext2D, drop: Drop): void {
  const color = drop.kind === 'ammo' ? '#65c9ff' : drop.kind === 'scrap' ? '#c58cff' : drop.kind === 'weapon' ? '#ff73a8' : '#ffd166';
  context.save();
  context.translate(drop.x, drop.y);
  context.shadowColor = color;
  context.shadowBlur = 15;
  context.fillStyle = color;
  context.rotate(Math.PI / 4);
  context.fillRect(-5, -5, 10, 10);
  context.restore();
}
