import type { Enemy, EnemyShot } from './gunship_enemies.js';
import type { GunshipBody, GunshipAction } from './gunship_physics.js';
import { SEA_Y, WORLD_TOP, altitudeMargin } from './gunship_physics.js';
import type { AirframeId } from './gunship_airframes.js';

const VIEW_H = 840;
let camY = 0; // world-space top of the visible window; the camera follows the craft vertically over the tall world.

export function renderGunship(ctx: CanvasRenderingContext2D, width: number, height: number, ship: GunshipBody, action: GunshipAction, frameId: AirframeId, enemies: Enemy[], enemyShots: EnemyShot[], bullets: EnemyShot[], wave: number): void {
  const target = Math.max(WORLD_TOP, Math.min(0, ship.y - VIEW_H * .52));
  camY += (target - camY) * .12;
  const sx = width / 1200; const sy = height / VIEW_H; ctx.setTransform(sx, 0, 0, sy, 0, -camY * sy);
  // Sky spans the whole tall world: darker/thinner up high (dead air), bright mid, deepening toward the sea.
  const sky = ctx.createLinearGradient(0, WORLD_TOP, 0, SEA_Y); sky.addColorStop(0, '#22405f'); sky.addColorStop(.34, '#63a9ce'); sky.addColorStop(.72, '#173d5a'); sky.addColorStop(1, '#0a2131'); ctx.fillStyle = sky; ctx.fillRect(0, WORLD_TOP - 40, 1200, SEA_Y - WORLD_TOP + 120);
  drawClouds(ctx);
  ctx.fillStyle = 'rgba(255,205,125,.16)'; ctx.beginPath(); ctx.arc(975, 105, 65, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#08334d'; ctx.fillRect(0, SEA_Y, 1200, 400); ctx.strokeStyle = '#68cde7'; ctx.lineWidth = 3; ctx.beginPath(); for (let x = 0; x <= 1200; x += 12) { const y = SEA_Y + Math.sin(x * .04 + performance.now() * .002) * 4; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  for (const enemy of enemies) drawEnemy(ctx, enemy);
  for (const shot of enemyShots) drawShot(ctx, shot, '#ff8964');
  for (const bullet of bullets) drawShot(ctx, bullet, '#e8f8a6');
  ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(-ship.angle); drawShip(ctx, frameId, action); ctx.restore();
  if (ship.y > SEA_Y - 90 && ship.vy > 40) drawWaterSpray(ctx, ship);
  // Danger read-out and HUD text in screen space (unaffected by the camera scroll).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const danger = Math.max(0, 1 - altitudeMargin(ship) / 200);
  if (danger > 0) {
    const glow = ctx.createLinearGradient(0, height * .5, 0, height); glow.addColorStop(0, 'rgba(224,60,40,0)'); glow.addColorStop(1, `rgba(232,58,40,${(.28 + .18 * Math.sin(performance.now() * .008)) * danger})`);
    ctx.fillStyle = glow; ctx.fillRect(0, height * .5, width, height * .5);
    ctx.fillStyle = `rgba(255,120,96,${danger * .9})`; ctx.fillRect(0, height - 4, width, 4);
  }
  ctx.fillStyle = 'rgba(230,245,255,.6)'; ctx.font = '12px ui-monospace,monospace'; ctx.fillText(`WAVE ${wave}  //  ${enemies.length} HOSTILES`, 22, height - 16);
}

function drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void { ctx.save(); ctx.translate(enemy.x, enemy.y); const surface = enemy.kind === 'ship' || enemy.kind === 'dreadnought'; if (enemy.kind === 'dreadnought') { ctx.fillStyle = '#29394c'; ctx.fillRect(-76, -25, 152, 39); ctx.fillStyle = '#637b8d'; ctx.fillRect(-32, -54, 64, 30); ctx.fillStyle = '#f56f63'; [-48, 0, 48].forEach((x) => ctx.fillRect(x, -62, 5, 34)); } else if (enemy.kind === 'ship') { ctx.fillStyle = '#2c3b4a'; ctx.beginPath(); ctx.moveTo(-44, -8); ctx.lineTo(46, -8); ctx.lineTo(39, 11); ctx.lineTo(-39, 11); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#3f5267'; ctx.fillRect(-44, -14, 88, 6); ctx.fillStyle = '#72899a'; ctx.fillRect(-14, -30, 28, 16); ctx.fillStyle = '#93a7b6'; ctx.fillRect(-5, -39, 11, 9); ctx.save(); ctx.translate(23, -13); ctx.fillStyle = '#556b7d'; ctx.fillRect(-8, -5, 16, 9); ctx.strokeStyle = '#243441'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(15, -17); ctx.stroke(); ctx.restore(); ctx.fillStyle = '#fc8068'; ctx.fillRect(-1, -46, 4, 8); } else if (enemy.kind === 'mine') { ctx.strokeStyle = '#ffd66b'; ctx.fillStyle = '#3e4559'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); for (let i = 0; i < 8; i++) { const angle = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(angle) * 15, Math.sin(angle) * 15); ctx.lineTo(Math.cos(angle) * 23, Math.sin(angle) * 23); ctx.stroke(); } } else if (enemy.kind === 'submarine') { ctx.globalAlpha = enemy.surfaced ? 1 : .35; ctx.fillStyle = '#33506b'; ctx.beginPath(); ctx.ellipse(0, 0, 34, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5f7d94'; ctx.fillRect(-7, -21, 14, 13); ctx.fillStyle = enemy.surfaced ? '#ff7a5f' : '#8fb0c4'; ctx.fillRect(-2, -27, 4, 8); ctx.globalAlpha = 1; } else { ctx.fillStyle = enemy.kind === 'diver' ? '#d89afa' : '#f27878'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-15, -11); ctx.lineTo(-8, 0); ctx.lineTo(-15, 11); ctx.closePath(); ctx.fill(); } ctx.fillStyle = 'rgba(8,15,24,.7)'; ctx.fillRect(-20, surface ? 22 : 20, 40, 4); ctx.fillStyle = enemy.kind === 'dreadnought' ? '#e0a5ff' : '#ffbc72'; ctx.fillRect(-20, surface ? 22 : 20, 40 * enemy.hp / enemy.maxHp, 4); ctx.restore(); }
function drawShot(ctx: CanvasRenderingContext2D, shot: EnemyShot, color: string): void { if (shot.weapon === 'laser' && shot.originX !== undefined && shot.originY !== undefined) { ctx.save(); ctx.strokeStyle = '#a8faff'; ctx.lineWidth = 4; ctx.shadowColor = '#52e9ff'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.moveTo(shot.originX, shot.originY); ctx.lineTo(shot.x, shot.y); ctx.stroke(); ctx.restore(); return; } if (shot.weapon === 'missile') { ctx.save(); ctx.strokeStyle = 'rgba(255,174,92,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(shot.x - shot.vx * .08, shot.y - shot.vy * .08); ctx.lineTo(shot.x, shot.y); ctx.stroke(); ctx.fillStyle = '#fff2bc'; ctx.beginPath(); ctx.arc(shot.x, shot.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; } ctx.fillStyle = color; ctx.beginPath(); ctx.arc(shot.x, shot.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
function drawClouds(ctx: CanvasRenderingContext2D): void { const time = performance.now() * .000015; ctx.save(); ctx.fillStyle = 'rgba(225,244,247,.13)'; for (let index = 0; index < 6; index++) { const x = ((index * 265 + time * (22 + index * 5)) % 1450) - 130; const y = 80 + (index % 3) * 110; ctx.beginPath(); ctx.ellipse(x, y, 90, 19, 0, 0, Math.PI * 2); ctx.ellipse(x + 54, y + 8, 65, 15, 0, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
function drawWaterSpray(ctx: CanvasRenderingContext2D, ship: GunshipBody): void { ctx.save(); ctx.fillStyle = 'rgba(184,241,250,.6)'; const count = Math.min(22, Math.floor((ship.vy - 35) / 12)); for (let index = 0; index < count; index++) { const x = ship.x + Math.sin(index * 19.7) * (18 + index * 3); const y = SEA_Y - Math.abs(Math.cos(index * 7.3)) * (8 + index * 2); ctx.fillRect(x, y, 2, 2 + index % 3); } ctx.restore(); }

// Nose points +x in local space; the whole sprite is rotated by the craft angle. Each airframe has a distinct
// silhouette AND an unmistakable front: bright nose wedge + muzzle glow + a faint forward aim line. Thrust flame
// is always at the tail, so heading reads doubly (bright nose ahead, flame behind).
type FrameArt = { body: string; accent: string; nose: string; flame: string; noseX: number; tailX: number };
const FRAME_ART: Record<AirframeId, FrameArt> = {
  interceptor: { body: '#d6eaf1', accent: '#49d9eb', nose: '#ffd15a', flame: '#ffbd5a', noseX: 30, tailX: -20 },
  hauler: { body: '#c3ccd2', accent: '#8fd0ff', nose: '#ff9f4a', flame: '#ff8a3d', noseX: 26, tailX: -28 },
  darter: { body: '#efc2ea', accent: '#ff7ce0', nose: '#fff07a', flame: '#ff6fdd', noseX: 42, tailX: -18 },
  hoverer: { body: '#bbedc6', accent: '#57e39a', nose: '#eaff7a', flame: '#8affc0', noseX: 22, tailX: -16 },
};

function drawShip(ctx: CanvasRenderingContext2D, frameId: AirframeId, action: GunshipAction): void {
  const art = FRAME_ART[frameId];
  if (action.thrust) {
    const len = 30 + Math.random() * 18;
    ctx.fillStyle = art.flame; ctx.beginPath(); ctx.moveTo(art.tailX, -7); ctx.lineTo(art.tailX - len, 0); ctx.lineTo(art.tailX, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(art.tailX, -3); ctx.lineTo(art.tailX - len * .55, 0); ctx.lineTo(art.tailX, 3); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#102935'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.fillStyle = art.body;
  drawHull(ctx, frameId);
  ctx.fillStyle = art.accent; ctx.beginPath(); ctx.ellipse(frameId === 'darter' ? 8 : 3, 0, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
  // Bright nose wedge + muzzle glow: this end is the front, and it fires this way.
  ctx.fillStyle = art.nose; ctx.beginPath(); ctx.moveTo(art.noseX, 0); ctx.lineTo(art.noseX - 11, -4.5); ctx.lineTo(art.noseX - 11, 4.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,244,196,.95)'; ctx.beginPath(); ctx.arc(art.noseX, 0, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,222,150,.3)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(art.noseX + 4, 0); ctx.lineTo(art.noseX + 32, 0); ctx.stroke(); ctx.setLineDash([]);
}

function drawHull(ctx: CanvasRenderingContext2D, frameId: AirframeId): void {
  ctx.beginPath();
  if (frameId === 'interceptor') {
    // Sleek balanced dart with mid swept wings.
    const p = [[30, 0], [4, -7], [-14, -6], [-20, -16], [-24, -16], [-18, -4], [-22, 0], [-18, 4], [-24, 16], [-20, 16], [-14, 6], [4, 7]];
    trace(ctx, p);
  } else if (frameId === 'hauler') {
    // Heavy gunship: fat fuselage, twin tail fins, belly weight.
    trace(ctx, [[26, 0], [14, -9], [-24, -12], [-28, -6], [-28, 6], [-24, 12], [14, 9]]); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); trace(ctx, [[-18, -11], [-31, -23], [-23, -11]]); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); trace(ctx, [[-18, 11], [-31, 23], [-23, 11]]); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.fillStyle = '#9aa6ad'; ctx.fillRect(-6, -4, 22, 8); return;
  } else if (frameId === 'darter') {
    // Long low-drag needle with sharply swept-back wings.
    trace(ctx, [[42, 0], [-2, -4], [-8, -4], [-18, -13], [-20, -12], [-14, -3], [-18, 0], [-14, 3], [-20, 12], [-18, 13], [-8, 4], [-2, 4]]);
  } else {
    // Hoverer: short body, very wide vertical wingspan for lift and quick turns.
    trace(ctx, [[6, -6], [-2, -27], [-15, -25], [-9, -6]]); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); trace(ctx, [[6, 6], [-2, 27], [-15, 25], [-9, 6]]); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); trace(ctx, [[22, 0], [8, -8], [-16, -7], [-16, 7], [8, 8]]);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

function trace(ctx: CanvasRenderingContext2D, points: readonly (readonly number[])[]): void {
  points.forEach((point, index) => (index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1])));
}
