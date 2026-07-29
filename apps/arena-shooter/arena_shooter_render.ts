import type { AgentDecision } from './arena_shooter_agent.js';
import { getArenaCamera, type ArenaObservation, type ArenaState, type Enemy } from './arena_shooter_core.js';

let starfieldTile: HTMLCanvasElement | null = null;

export function renderArena(
  context: CanvasRenderingContext2D,
  state: ArenaState,
  observation: ArenaObservation,
  decision: AgentDecision,
): void {
  const camera = getArenaCamera(state);
  const { width, height } = camera;
  context.save();
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#02040a';
  context.fillRect(0, 0, width, height);
  drawStarfield(context, width, height, camera.x, camera.y);

  const shipScreenX = state.ship.x - camera.x;
  const shipScreenY = state.ship.y - camera.y;
  const background = context.createRadialGradient(
    shipScreenX, shipScreenY, 20,
    shipScreenX, shipScreenY, Math.max(width, height) * 0.7,
  );
  background.addColorStop(0, 'rgba(16,28,44,.7)');
  background.addColorStop(0.58, 'rgba(8,13,24,.48)');
  background.addColorStop(1, 'rgba(3,5,11,.2)');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.translate(
    -camera.x + (state.shake ? (Math.random() - 0.5) * state.shake : 0),
    -camera.y + (state.shake ? (Math.random() - 0.5) * state.shake : 0),
  );
  drawGrid(context, state.width, state.height, state.elapsed);
  context.strokeStyle = 'rgba(93,244,255,.24)';
  context.lineWidth = 2;
  context.strokeRect(1, 1, state.width - 2, state.height - 2);
  drawThreatRadar(context, state, observation);
  if (state.novaPulse > 0) {
    context.strokeStyle = `rgba(184,108,255,${state.novaPulse})`;
    context.lineWidth = 5;
    context.beginPath();
    context.arc(
      state.ship.x,
      state.ship.y,
      (120 + state.novaLevel * 15) * (1 - state.novaPulse * 0.45),
      0,
      Math.PI * 2,
    );
    context.stroke();
  }

  context.globalCompositeOperation = 'lighter';
  for (const trail of state.trails) {
    const alpha = Math.max(0, trail.life / trail.maxLife);
    const gradient = context.createRadialGradient(
      trail.x, trail.y, 0,
      trail.x, trail.y, trail.radius,
    );
    gradient.addColorStop(0, `rgba(255,240,125,${alpha * 0.7})`);
    gradient.addColorStop(0.42, `rgba(255,128,42,${alpha * 0.52})`);
    gradient.addColorStop(0.78, `rgba(255,67,91,${alpha * 0.28})`);
    gradient.addColorStop(1, 'rgba(150,24,70,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(trail.x, trail.y, trail.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = `rgba(255,173,64,${alpha * 0.72})`;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(trail.x, trail.y, trail.radius * 0.78, 0, Math.PI * 2);
    context.stroke();
  }

  context.globalCompositeOperation = 'lighter';
  for (const projectile of state.projectiles) {
    drawProjectile(context, projectile);
  }
  context.shadowBlur = 0;
  context.globalCompositeOperation = 'source-over';

  for (const enemy of state.enemies) drawEnemy(context, enemy);
  context.globalCompositeOperation = 'lighter';
  for (const beam of state.beams) {
    const alpha = Math.max(0, beam.life / beam.maxLife);
    const points = beam.points ?? [
      { x: beam.x1, y: beam.y1 },
      { x: beam.x2, y: beam.y2 },
    ];
    if (beam.style === 'pulse') {
      const angle = beam.angle ?? 0;
      const arc = beam.arc ?? Math.PI / 2;
      const range = beam.range ?? Math.hypot(beam.x2 - beam.x1, beam.y2 - beam.y1);
      const expansion = 1 - alpha;
      const radius = range * (0.08 + expansion * 0.92);
      context.save();
      context.globalAlpha = Math.min(1, alpha * 1.8);
      context.strokeStyle = '#74f8ff';
      context.shadowColor = '#4defff';
      context.shadowBlur = 24;
      context.lineWidth = beam.width * 2.8;
      context.beginPath();
      context.arc(beam.x1, beam.y1, radius, angle - arc / 2, angle + arc / 2);
      context.stroke();
      context.strokeStyle = '#f4ffff';
      context.shadowBlur = 7;
      context.lineWidth = Math.max(2, beam.width * 0.55);
      context.beginPath();
      context.arc(beam.x1, beam.y1, radius, angle - arc / 2, angle + arc / 2);
      context.stroke();
      for (const trailScale of [0.78, 0.56]) {
        context.globalAlpha = alpha * trailScale * 0.45;
        context.strokeStyle = '#42cfe8';
        context.lineWidth = beam.width * trailScale;
        context.beginPath();
        context.arc(
          beam.x1,
          beam.y1,
          Math.max(1, radius - range * (1 - trailScale) * 0.12),
          angle - arc / 2,
          angle + arc / 2,
        );
        context.stroke();
      }
      context.restore();
      continue;
    }
    context.strokeStyle = `rgba(105,246,255,${alpha * 0.65})`;
    context.shadowColor = '#66efff';
    context.shadowBlur = 18;
    context.lineWidth = beam.width * 2.3;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
    context.strokeStyle = `rgba(240,255,255,${alpha})`;
    context.shadowBlur = 5;
    context.lineWidth = Math.max(2, beam.width * 0.45);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.shadowBlur = 0;
  context.globalCompositeOperation = 'source-over';
  drawShip(context, state, decision);

  context.globalCompositeOperation = 'lighter';
  for (const particle of state.particles) {
    context.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    context.fillStyle = particle.color;
    context.fillRect(particle.x - 1.5, particle.y - 1.5, 3, 3);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (const number of state.damageNumbers) {
    const progress = number.life / number.maxLife;
    const scale = 0.85 + Math.min(0.25, (1 - progress) * 1.8);
    context.save();
    context.translate(number.x, number.y);
    context.scale(scale, scale);
    context.globalAlpha = Math.min(1, progress * 2.5);
    context.lineWidth = 4;
    context.strokeStyle = 'rgba(4,7,14,.9)';
    const label = formatDamage(number.amount);
    context.strokeText(label, 0, 0);
    context.fillStyle = number.friendly ? '#ffe36e' : '#ff5577';
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 7;
    context.fillText(label, 0, 0);
    context.restore();
  }
  context.globalAlpha = 1;
  context.restore();
}

function formatDamage(amount: number): string {
  if (amount >= 100) return Math.round(amount).toLocaleString();
  if (amount >= 10) return Math.round(amount).toString();
  return amount.toFixed(1).replace(/\.0$/, '');
}

function drawProjectile(
  context: CanvasRenderingContext2D,
  projectile: ArenaState['projectiles'][number],
): void {
  if (projectile.kind === 'missile' && !projectile.hostile) {
    drawMissile(context, projectile);
    return;
  }
  const color = projectile.hostile
    ? '#ff496c'
    : projectile.kind === 'ricochet'
      ? '#ffe36e'
      : '#64f5ff';
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 13;
  context.beginPath();
  context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
  context.fill();
  if (projectile.kind === 'ricochet') {
    context.strokeStyle = '#fff8bd';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(projectile.x - projectile.vx * 0.025, projectile.y - projectile.vy * 0.025);
    context.lineTo(projectile.x, projectile.y);
    context.stroke();
  }
  if (projectile.hostile) {
    context.strokeStyle = '#ffb1c0';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(projectile.x - projectile.vx * 0.035, projectile.y - projectile.vy * 0.035);
    context.lineTo(projectile.x, projectile.y);
    context.stroke();
  }
}

function drawMissile(
  context: CanvasRenderingContext2D,
  missile: ArenaState['projectiles'][number],
): void {
  const angle = Math.atan2(missile.vy, missile.vx);
  const length = Math.max(17, missile.radius * 3.4);
  const halfWidth = Math.max(3.5, missile.radius * 0.72);
  context.save();
  context.translate(missile.x, missile.y);
  context.rotate(angle);

  const flameLength = length * (0.42 + Math.sin(performance.now() * 0.025) * 0.08);
  const exhaust = context.createLinearGradient(-length, 0, -length * 0.2, 0);
  exhaust.addColorStop(0, 'rgba(255,70,35,0)');
  exhaust.addColorStop(0.35, '#ff6633');
  exhaust.addColorStop(1, '#fff3a1');
  context.fillStyle = exhaust;
  context.shadowColor = '#ff7a32';
  context.shadowBlur = 12;
  context.beginPath();
  context.moveTo(-length * 0.5, -halfWidth * 0.55);
  context.lineTo(-length * 0.5 - flameLength, 0);
  context.lineTo(-length * 0.5, halfWidth * 0.55);
  context.closePath();
  context.fill();

  context.shadowColor = '#ffd166';
  context.shadowBlur = 7;
  context.fillStyle = '#dce9ef';
  context.strokeStyle = '#ffd166';
  context.lineWidth = 1.4;
  context.beginPath();
  context.moveTo(length * 0.58, 0);
  context.quadraticCurveTo(length * 0.35, -halfWidth, -length * 0.34, -halfWidth);
  context.lineTo(-length * 0.5, -halfWidth * 0.45);
  context.lineTo(-length * 0.5, halfWidth * 0.45);
  context.lineTo(-length * 0.34, halfWidth);
  context.quadraticCurveTo(length * 0.35, halfWidth, length * 0.58, 0);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = '#ff496c';
  context.beginPath();
  context.moveTo(length * 0.58, 0);
  context.lineTo(length * 0.22, -halfWidth * 0.86);
  context.lineTo(length * 0.22, halfWidth * 0.86);
  context.closePath();
  context.fill();
  context.fillStyle = '#637b89';
  context.beginPath();
  context.moveTo(-length * 0.3, -halfWidth * 0.7);
  context.lineTo(-length * 0.62, -halfWidth * 1.7);
  context.lineTo(-length * 0.52, -halfWidth * 0.2);
  context.closePath();
  context.fill();
  context.beginPath();
  context.moveTo(-length * 0.3, halfWidth * 0.7);
  context.lineTo(-length * 0.62, halfWidth * 1.7);
  context.lineTo(-length * 0.52, halfWidth * 0.2);
  context.closePath();
  context.fill();
  context.restore();
}

function drawStarfield(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  cameraX: number,
  cameraY: number,
): void {
  const tile = getStarfieldTile();
  const tileSize = tile.width;
  const parallaxX = cameraX * 0.18;
  const parallaxY = cameraY * 0.18;
  const offsetX = -positiveModulo(parallaxX, tileSize);
  const offsetY = -positiveModulo(parallaxY, tileSize);
  for (let y = offsetY - tileSize; y < height + tileSize; y += tileSize) {
    for (let x = offsetX - tileSize; x < width + tileSize; x += tileSize) {
      context.drawImage(tile, x, y);
    }
  }
}

function getStarfieldTile(): HTMLCanvasElement {
  if (starfieldTile) return starfieldTile;
  const size = 512;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tileContext = tile.getContext('2d');
  if (!tileContext) return tile;
  let randomState = 0x51f15e;
  const random = (): number => {
    randomState = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
    randomState ^= randomState + Math.imul(randomState ^ randomState >>> 7, 61 | randomState);
    return ((randomState ^ randomState >>> 14) >>> 0) / 4294967296;
  };
  for (let index = 0; index < 130; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const bright = random() > 0.92;
    const radius = bright ? 1.8 : random() > 0.72 ? 1.15 : 0.72;
    const colorRoll = random();
    tileContext.globalAlpha = 0.55 + random() * 0.4;
    tileContext.fillStyle = colorRoll > 0.9 ? '#8ed8ff' : colorRoll < 0.06 ? '#ffe3a3' : '#edf8ff';
    tileContext.shadowColor = tileContext.fillStyle;
    tileContext.shadowBlur = bright ? 7 : 1.5;
    tileContext.beginPath();
    tileContext.arc(x, y, radius, 0, Math.PI * 2);
    tileContext.fill();
    if (bright) {
      tileContext.lineWidth = 0.7;
      tileContext.strokeStyle = tileContext.fillStyle;
      tileContext.beginPath();
      tileContext.moveTo(x - 3.5, y);
      tileContext.lineTo(x + 3.5, y);
      tileContext.moveTo(x, y - 3.5);
      tileContext.lineTo(x, y + 3.5);
      tileContext.stroke();
    }
  }
  tileContext.globalAlpha = 1;
  tileContext.shadowBlur = 0;
  starfieldTile = tile;
  return tile;
}

function positiveModulo(value: number, divisor: number): number {
  return (value % divisor + divisor) % divisor;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, elapsed: number): void {
  context.strokeStyle = 'rgba(93, 145, 184, .075)';
  context.lineWidth = 1;
  const size = 64;
  const offset = (elapsed * 6) % size;
  context.beginPath();
  for (let x = -size + offset; x < width + size; x += size) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = -size + offset; y < height + size; y += size) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();
}

function drawThreatRadar(
  context: CanvasRenderingContext2D,
  state: ArenaState,
  observation: ArenaObservation,
): void {
  context.save();
  context.translate(state.ship.x, state.ship.y);
  context.rotate(state.ship.angle);
  context.lineWidth = 1;
  for (let sector = 0; sector < 8; sector += 1) {
    const centerAngle = sector * Math.PI / 4;
    const startAngle = centerAngle - Math.PI / 8;
    const endAngle = centerAngle + Math.PI / 8;
    const intensity = 1 - observation.sectorDistances[sector];
    const innerRadius = 44;
    const outerRadius = 66 + intensity * 24;
    context.strokeStyle = sector === observation.dangerSector
      ? `rgba(255, 72, 110, ${0.2 + intensity * 0.55})`
      : `rgba(83, 227, 255, ${0.04 + intensity * 0.15})`;
    context.beginPath();
    context.arc(0, 0, outerRadius, startAngle, endAngle);
    context.arc(0, 0, innerRadius, endAngle, startAngle, true);
    context.closePath();
    context.stroke();

    const projectileIntensity = 1 - observation.sectorProjectileDistances[sector];
    if (projectileIntensity > 0) {
      context.strokeStyle = `rgba(255, 209, 102, ${0.25 + projectileIntensity * 0.7})`;
      context.lineWidth = sector === observation.projectileDangerSector ? 3 : 1.5;
      context.beginPath();
      context.arc(0, 0, 36, startAngle, endAngle);
      context.stroke();
      context.lineWidth = 1;
    }
  }
  context.restore();
}

function drawShip(context: CanvasRenderingContext2D, state: ArenaState, decision: AgentDecision): void {
  const ship = state.ship;
  context.save();
  context.translate(ship.x, ship.y);
  context.rotate(ship.angle);
  if (decision.action.thrust > 0) {
    const flame = 14 + Math.random() * 13;
    const gradient = context.createLinearGradient(-flame, 0, -10, 0);
    gradient.addColorStop(0, 'rgba(61, 130, 255, 0)');
    gradient.addColorStop(0.5, '#4be7ff');
    gradient.addColorStop(1, '#fff');
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(-12, -6);
    context.lineTo(-flame, 0);
    context.lineTo(-12, 6);
    context.fill();
  }
  if (decision.action.thrust < 0) {
    context.strokeStyle = '#4be7ff';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(11, -7);
    context.lineTo(20 + Math.random() * 7, -7);
    context.moveTo(11, 7);
    context.lineTo(20 + Math.random() * 7, 7);
    context.stroke();
  }
  if (decision.action.strafe !== 0) {
    const nozzleY = decision.action.strafe > 0 ? -11 : 11;
    context.strokeStyle = '#ffd166';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(-4, nozzleY);
    context.lineTo(-4, nozzleY - decision.action.strafe * (10 + Math.random() * 7));
    context.stroke();
  }
  context.globalAlpha = ship.invulnerability > 0 && Math.floor(ship.invulnerability * 20) % 2 ? 0.35 : 1;
  context.shadowColor = '#5df4ff';
  context.shadowBlur = 20;
  context.fillStyle = '#d9fbff';
  context.strokeStyle = '#38d7ee';
  context.lineWidth = 2;
  context.beginPath();
  if (ship.craftType === 'strafer') {
    context.moveTo(18, 0);
    context.lineTo(7, -10);
    context.lineTo(-15, -14);
    context.lineTo(-9, 0);
    context.lineTo(-15, 14);
    context.lineTo(7, 10);
  } else if (ship.craftType === 'turret') {
    context.moveTo(15, -11);
    context.lineTo(-13, -11);
    context.lineTo(-17, 0);
    context.lineTo(-13, 11);
    context.lineTo(15, 11);
    context.lineTo(18, 0);
  } else {
    context.moveTo(21, 0);
    context.lineTo(-12, -12);
    context.lineTo(-7, 0);
    context.lineTo(-12, 12);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = '#174b6b';
  context.beginPath();
  context.arc(1, 0, 5, 0, Math.PI * 2);
  context.fill();
  if (ship.craftType === 'turret') {
    context.rotate(ship.turretAngle - ship.angle);
    context.strokeStyle = '#ffd166';
    context.shadowColor = '#ffd166';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(25, 0);
    context.stroke();
    context.fillStyle = '#fff0b3';
    context.beginPath();
    context.arc(0, 0, 7, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawEnemy(context: CanvasRenderingContext2D, enemy: Enemy): void {
  context.save();
  context.translate(enemy.x, enemy.y);
  context.rotate(enemy.angle);
  const color = enemy.kind === 'brute' ? '#ff9c42' : enemy.kind === 'gunner' ? '#b86cff' : '#ff477e';
  context.shadowColor = color;
  context.shadowBlur = 10;
  context.strokeStyle = color;
  context.lineJoin = 'round';
  if (enemy.kind === 'scout') drawScout(context, enemy.radius, color);
  else if (enemy.kind === 'gunner') drawGunner(context, enemy.radius, color);
  else drawBrute(context, enemy.radius, color);
  context.restore();
}

function drawScout(context: CanvasRenderingContext2D, radius: number, color: string): void {
  context.fillStyle = '#29101f';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(radius * 1.25, 0);
  context.lineTo(-radius * 0.75, -radius * 0.72);
  context.lineTo(-radius * 0.35, 0);
  context.lineTo(-radius * 0.75, radius * 0.72);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(radius * 0.5, 0);
  context.lineTo(-radius * 0.1, -radius * 0.28);
  context.lineTo(-radius * 0.1, radius * 0.28);
  context.closePath();
  context.fill();
  context.strokeStyle = '#ffb2cb';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-radius * 0.65, -radius * 0.38);
  context.lineTo(-radius * 1.05, -radius * 0.56);
  context.moveTo(-radius * 0.65, radius * 0.38);
  context.lineTo(-radius * 1.05, radius * 0.56);
  context.stroke();
}

function drawGunner(context: CanvasRenderingContext2D, radius: number, color: string): void {
  context.fillStyle = '#1d1531';
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(radius * 0.85, -radius * 0.62);
  context.lineTo(radius * 0.85, radius * 0.62);
  context.lineTo(-radius * 0.7, radius * 0.82);
  context.lineTo(-radius, 0);
  context.lineTo(-radius * 0.7, -radius * 0.82);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.arc(0, 0, radius * 0.44, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#e3c9ff';
  context.fillRect(radius * 0.12, -radius * 0.14, radius * 1.18, radius * 0.28);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(radius * 0.12, -radius * 0.14, radius * 1.18, radius * 0.28);
  context.fillStyle = '#0e0819';
  context.beginPath();
  context.arc(0, 0, radius * 0.2, 0, Math.PI * 2);
  context.fill();
}

function drawBrute(context: CanvasRenderingContext2D, radius: number, color: string): void {
  context.fillStyle = '#302016';
  context.lineWidth = 3.5;
  context.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2;
    const scale = index % 2 === 0 ? 1.08 : 0.86;
    const x = Math.cos(angle) * radius * scale;
    const y = Math.sin(angle) * radius * scale;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.strokeStyle = '#ffd09a';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(radius * 0.72, 0);
  context.lineTo(radius * 0.2, -radius * 0.46);
  context.lineTo(-radius * 0.48, -radius * 0.38);
  context.lineTo(-radius * 0.48, radius * 0.38);
  context.lineTo(radius * 0.2, radius * 0.46);
  context.closePath();
  context.stroke();
  context.fillStyle = color;
  context.beginPath();
  context.arc(radius * 0.12, 0, radius * 0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#fff0c9';
  context.fillRect(radius * 0.58, -radius * 0.12, radius * 0.58, radius * 0.24);
}
