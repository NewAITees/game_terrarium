import type { AgentDecision } from './arena_shooter_agent.js';
import type { ArenaObservation, ArenaState, Enemy } from './arena_shooter_core.js';

export function renderArena(
  context: CanvasRenderingContext2D,
  state: ArenaState,
  observation: ArenaObservation,
  decision: AgentDecision,
): void {
  const { width, height } = state;
  context.save();
  context.clearRect(0, 0, width, height);
  const background = context.createRadialGradient(
    state.ship.x, state.ship.y, 20,
    state.ship.x, state.ship.y, Math.max(width, height) * 0.7,
  );
  background.addColorStop(0, '#101c2c');
  background.addColorStop(0.58, '#080d18');
  background.addColorStop(1, '#03050b');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.translate(
    state.shake ? (Math.random() - 0.5) * state.shake : 0,
    state.shake ? (Math.random() - 0.5) * state.shake : 0,
  );
  drawGrid(context, width, height, state.elapsed);
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
  for (const projectile of state.projectiles) {
    context.fillStyle = projectile.hostile
      ? '#ff496c'
      : projectile.kind === 'missile'
        ? '#ffd166'
        : '#64f5ff';
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 13;
    context.beginPath();
    context.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;
  context.globalCompositeOperation = 'source-over';

  for (const enemy of state.enemies) drawEnemy(context, enemy);
  drawShip(context, state, decision);

  context.globalCompositeOperation = 'lighter';
  for (const particle of state.particles) {
    context.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    context.fillStyle = particle.color;
    context.fillRect(particle.x - 1.5, particle.y - 1.5, 3, 3);
  }
  context.globalAlpha = 1;
  context.restore();
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
  context.shadowBlur = 13;
  context.strokeStyle = color;
  context.fillStyle = `${color}30`;
  context.lineWidth = enemy.kind === 'brute' ? 4 : 2;
  const sides = enemy.kind === 'brute' ? 6 : enemy.kind === 'gunner' ? 4 : 3;
  context.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = index / sides * Math.PI * 2;
    const radius = enemy.radius;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}
