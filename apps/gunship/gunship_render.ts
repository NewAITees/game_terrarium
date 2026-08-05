import type { Enemy, EnemyShot } from './gunship_enemies.js';
import type { GunshipBody, GunshipAction } from './gunship_physics.js';
import { SEA_Y, WORLD_TOP, WORLD_W, altitudeMargin } from './gunship_physics.js';
import type { AirframeId } from './gunship_airframes.js';
import type { XpOrb } from './gunship_pickups.js';
import type { EffectParticle, GunshipEffects } from './gunship_effects.js';

const VIEW_H = 840;
const VIEW_W = 1200; // world-space width of the visible window; the world is wider than this, so the camera also pans horizontally.
let camY = 0; // world-space top of the visible window; the camera follows the craft vertically over the tall world.
let camX = 0; // world-space left of the visible window.
let prevShipX: number | null = null;

export function renderGunship(ctx: CanvasRenderingContext2D, width: number, height: number, ship: GunshipBody, action: GunshipAction, frameId: AirframeId, enemies: Enemy[], enemyShots: EnemyShot[], bullets: EnemyShot[], orbs: XpOrb[], effects: GunshipEffects, wave: number): void {
  const target = Math.max(WORLD_TOP, Math.min(0, ship.y - VIEW_H * .52));
  camY += (target - camY) * .12;
  // Same rule as the vertical camera above: smoothly follow the craft, but clamp the window to stay
  // inside the world span, so nearing either edge stops the follow and the craft visibly drifts toward
  // that screen edge instead of staying centered. The toroidal seam is the one break from that: the
  // craft's x can only change by its own speed in one frame, so a jump bigger than half the world means
  // physics just wrapped it — snap the window instantly (the craft reappears at the opposite screen
  // edge and the clamp holds it there) instead of panning across the whole world to follow.
  const targetX = Math.max(0, Math.min(WORLD_W - VIEW_W, ship.x - VIEW_W * .5));
  if (prevShipX !== null && Math.abs(ship.x - prevShipX) > WORLD_W / 2) camX = targetX;
  else camX += (targetX - camX) * .12;
  prevShipX = ship.x;
  const sx = width / VIEW_W; const sy = height / VIEW_H; const shakeX = Math.sin(performance.now() * .11) * effects.shake; const shakeY = Math.cos(performance.now() * .17) * effects.shake * .65; ctx.setTransform(sx, 0, 0, sy, (-camX + shakeX) * sx, (-camY + shakeY) * sy);
  // Sky/sea are drawn relative to the camera (not the absolute world span) so there is never a gap
  // at the toroidal seam — the gradient/color don't vary with x, so this is free to do.
  drawBackgroundAsset(ctx, camX, camY);
  const sky = ctx.createLinearGradient(0, WORLD_TOP, 0, SEA_Y); sky.addColorStop(0, 'rgba(34,64,95,.96)'); sky.addColorStop(.34, 'rgba(99,169,206,.34)'); sky.addColorStop(.72, 'rgba(23,61,90,.2)'); sky.addColorStop(1, 'rgba(10,33,49,.18)'); ctx.fillStyle = sky; ctx.fillRect(camX - 40, WORLD_TOP - 40, VIEW_W + 80, SEA_Y - WORLD_TOP + 120);
  ctx.fillStyle = '#08334d'; ctx.fillRect(camX, SEA_Y, VIEW_W, 400); ctx.strokeStyle = '#68cde7'; ctx.lineWidth = 3; ctx.beginPath(); for (let i = 0; i <= VIEW_W; i += 12) { const x = camX + i; const y = SEA_Y + Math.sin(x * .04 + performance.now() * .002) * 4; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  for (const enemy of enemies) drawEnemy(ctx, enemy);
  for (const enemy of enemies) drawSurfaceAssets(ctx, enemy);
  for (const enemy of enemies) drawEnemyAircraft(ctx, enemy);
  for (const shot of enemyShots) drawShot(ctx, shot, '#ff8964');
  for (const bullet of bullets) drawShot(ctx, bullet, '#e8f8a6');
  for (const orb of orbs) drawOrb(ctx, orb.x, orb.y, orb.life);
  for (const effect of effects.particles) drawEffectParticle(ctx, effect);
  const shipX = ship.x;
  ctx.save(); ctx.translate(shipX, ship.y);
  // The sprite is drawn nose-right in local space. Rotating straight through past +/-90deg would put
  // it belly-up once heading points leftward, since a plain rotation flips "up" to "down" past the
  // half-turn. Mirroring horizontally (and rotating by the supplementary angle) instead keeps the top
  // of the craft pointing up at any heading, including dead left.
  if (Math.cos(ship.angle) < 0) { ctx.scale(-1, 1); ctx.rotate(ship.angle + Math.PI); }
  else ctx.rotate(-ship.angle);
  drawShip(ctx, frameId, action); drawDamageSmoke(ctx, ship); ctx.restore();
  if (ship.y > SEA_Y - 90 && ship.vy > 40) drawWaterSpray(ctx, { ...ship, x: shipX });
  // Danger read-out and HUD text in screen space (unaffected by the camera scroll).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const danger = Math.max(0, 1 - altitudeMargin(ship) / 200);
  if (danger > 0) {
    const glow = ctx.createLinearGradient(0, height * .5, 0, height); glow.addColorStop(0, 'rgba(224,60,40,0)'); glow.addColorStop(1, `rgba(232,58,40,${(.28 + .18 * Math.sin(performance.now() * .008)) * danger})`);
    ctx.fillStyle = glow; ctx.fillRect(0, height * .5, width, height * .5);
    ctx.fillStyle = `rgba(255,120,96,${danger * .9})`; ctx.fillRect(0, height - 4, width, 4);
  }
  drawEffectBanners(ctx, width, height, effects);
  ctx.fillStyle = 'rgba(230,245,255,.6)'; ctx.font = '12px ui-monospace,monospace'; ctx.fillText(`WAVE ${wave}  //  ${enemies.length} HOSTILES`, 22, height - 16);
}

function drawEffectParticle(ctx: CanvasRenderingContext2D, effect: EffectParticle): void {
  const alpha = Math.max(0, effect.life / effect.maxLife);
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = effect.color;
  if (effect.kind === 'smoke') { ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.size * (1.3 - alpha * .3), 0, Math.PI * 2); ctx.fill(); }
  else if (effect.kind === 'splash') { ctx.strokeStyle = effect.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(effect.x, effect.y, effect.size * (1.5 - alpha * .5), effect.size * .35, 0, 0, Math.PI * 2); ctx.stroke(); }
  else { ctx.translate(effect.x, effect.y); ctx.rotate(Math.atan2(effect.vy, effect.vx)); ctx.fillRect(-effect.size, -effect.size * .35, effect.size * 2, effect.size * .7); }
  ctx.restore();
}
function drawDamageSmoke(ctx: CanvasRenderingContext2D, ship: GunshipBody): void {
  const damage = 1 - ship.hp / ship.maxHp;
  if (damage < .25) return;
  const pulse = .75 + Math.sin(performance.now() * .012) * .2;
  ctx.save(); ctx.globalAlpha = Math.min(.8, damage) * pulse; ctx.fillStyle = damage > .65 ? '#171719' : '#34434a';
  ctx.beginPath(); ctx.arc(-18, -5, 6 + damage * 8, 0, Math.PI * 2); ctx.arc(-28, -9, 5 + damage * 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
function drawEffectBanners(ctx: CanvasRenderingContext2D, width: number, height: number, effects: GunshipEffects): void {
  effects.banners.forEach((banner, index) => { const alpha = Math.max(0, banner.life / banner.maxLife); ctx.save(); ctx.globalAlpha = Math.min(1, alpha * 1.8); ctx.fillStyle = banner.color; ctx.textAlign = 'center'; ctx.font = `700 ${18 + index * 2}px ui-monospace,monospace`; ctx.fillText(banner.text, width / 2, height * .28 + index * 28); ctx.restore(); });
}
function drawEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy): void { ctx.save(); ctx.translate(enemy.x, enemy.y); const surface = ['destroyer', 'cruiser', 'carrier', 'battleship'].includes(enemy.kind); if (enemy.kind === 'battleship') { ctx.fillStyle = '#29394c'; ctx.fillRect(-76, -25, 152, 39); ctx.fillStyle = '#637b8d'; ctx.fillRect(-32, -54, 64, 30); } else if (surface) { ctx.fillStyle = '#3f5267'; ctx.fillRect(-44, -14, 88, 25); } else if (enemy.kind === 'mine') { drawImageCentered(ctx, mineArt, 52); } else if (enemy.kind === 'submarine') { ctx.globalAlpha = enemy.surfaced ? 1 : .35; ctx.fillStyle = '#33506b'; ctx.beginPath(); ctx.ellipse(0, 0, 34, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5f7d94'; ctx.fillRect(-7, -21, 14, 13); ctx.fillStyle = enemy.surfaced ? '#ff7a5f' : '#8fb0c4'; ctx.fillRect(-2, -27, 4, 8); ctx.globalAlpha = 1; } else { ctx.fillStyle = enemy.kind === 'diver' ? '#d89afa' : '#f27878'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-15, -11); ctx.lineTo(-8, 0); ctx.lineTo(-15, 11); ctx.closePath(); ctx.fill(); } ctx.fillStyle = 'rgba(8,15,24,.7)'; ctx.fillRect(-20, surface ? 22 : 20, 40, 4); ctx.fillStyle = enemy.kind === 'battleship' ? '#e0a5ff' : '#ffbc72'; ctx.fillRect(-20, surface ? 22 : 20, 40 * enemy.hp / enemy.maxHp, 4); ctx.restore(); }
// Blinks in its final ~3s so a fading pickup reads as "expiring soon", not just decoration.
function drawOrb(ctx: CanvasRenderingContext2D, x: number, y: number, life: number): void {
  const blink = life < 3 ? .4 + .6 * Math.abs(Math.sin(performance.now() * .015)) : 1;
  ctx.save(); ctx.globalAlpha = blink;
  ctx.fillStyle = '#c9ff6b'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(233,255,190,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawShot(ctx: CanvasRenderingContext2D, shot: EnemyShot, color: string): void { if (shot.weapon === 'laser' && shot.originX !== undefined && shot.originY !== undefined) { const alpha = Math.max(.25, Math.min(1, shot.life / .18)); ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = '#2db6ff'; ctx.lineWidth = 11; ctx.shadowColor = '#1fc8ff'; ctx.shadowBlur = 22; ctx.beginPath(); ctx.moveTo(shot.originX, shot.originY); ctx.lineTo(shot.x, shot.y); ctx.stroke(); ctx.strokeStyle = '#f2ffff'; ctx.lineWidth = 3; ctx.shadowBlur = 8; ctx.stroke(); ctx.fillStyle = '#d9ffff'; ctx.beginPath(); ctx.arc(shot.x, shot.y, 7 + (1 - alpha) * 13, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#66eaff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(shot.x, shot.y, 15 + (1 - alpha) * 22, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return; } if (shot.weapon === 'missile') { ctx.save(); ctx.strokeStyle = 'rgba(255,174,92,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(shot.x - shot.vx * .08, shot.y - shot.vy * .08); ctx.lineTo(shot.x, shot.y); ctx.stroke(); ctx.fillStyle = '#fff2bc'; ctx.beginPath(); ctx.arc(shot.x, shot.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; } if (shot.weapon === 'flak') { ctx.save(); ctx.fillStyle = '#ffe5a1'; ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 9; ctx.beginPath(); ctx.arc(shot.x, shot.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; } if (shot.weapon === 'explosive') { ctx.save(); ctx.fillStyle = '#ff8055'; ctx.strokeStyle = 'rgba(255,205,110,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(shot.x, shot.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); return; } if (shot.weapon === 'railgun' && shot.originX !== undefined && shot.originY !== undefined) { ctx.save(); ctx.strokeStyle = '#f5d7ff'; ctx.lineWidth = 5; ctx.shadowColor = '#d46cff'; ctx.shadowBlur = 18; ctx.beginPath(); ctx.moveTo(shot.originX, shot.originY); ctx.lineTo(shot.x, shot.y); ctx.stroke(); ctx.restore(); return; } ctx.fillStyle = color; ctx.beginPath(); ctx.arc(shot.x, shot.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
function drawWaterSpray(ctx: CanvasRenderingContext2D, ship: GunshipBody): void { ctx.save(); ctx.fillStyle = 'rgba(184,241,250,.6)'; const count = Math.min(22, Math.floor((ship.vy - 35) / 12)); for (let index = 0; index < count; index++) { const x = ship.x + Math.sin(index * 19.7) * (18 + index * 3); const y = SEA_Y - Math.abs(Math.cos(index * 7.3)) * (8 + index * 2); ctx.fillRect(x, y, 2, 2 + index % 3); } ctx.restore(); }

const surfaceArt = {
  destroyer: imageAsset('/assets/gunship/sprites/ships/destroyer.png'),
  cruiser: imageAsset('/assets/gunship/sprites/ships/cruiser.png'),
  battleship: imageAsset('/assets/gunship/sprites/ships/battleship_hull.png'),
  carrier: imageAsset('/assets/gunship/sprites/ships/carrier.png'),
  aa: imageAsset('/assets/gunship/sprites/ordnance/aa_rapid.png'),
  medium: imageAsset('/assets/gunship/sprites/ordnance/dual_medium.png'),
  heavy: imageAsset('/assets/gunship/sprites/ordnance/heavy_cannon.png'),
  vls: imageAsset('/assets/gunship/sprites/ordnance/vls_silo.png'),
  ciws: imageAsset('/assets/gunship/sprites/ordnance/ciws.png'),
};

const enemyAirArt = {
  chaser: imageAsset('/assets/gunship/sprites/enemies/raider.png'),
  diver: imageAsset('/assets/gunship/sprites/enemies/diver.png'),
};

const backgroundArt = imageAsset('/assets/gunship/backgrounds/sky_ocean.png');
const mineArt = imageAsset('/assets/gunship/sprites/air_mine.png');
const frameArt: Record<AirframeId, HTMLImageElement> = {
  interceptor: imageAsset('/assets/gunship/sprites/airframes/interceptor.png'),
  hauler: imageAsset('/assets/gunship/sprites/airframes/hauler.png'),
  darter: imageAsset('/assets/gunship/sprites/airframes/darter.png'),
  hoverer: imageAsset('/assets/gunship/sprites/airframes/hoverer.png'),
};

function imageAsset(src: string): HTMLImageElement { const image = new Image(); image.src = src; return image; }

// "Cover" fit (like CSS background-size:cover): scale to the larger axis ratio so the aspect ratio
// stays correct and the viewport is always fully covered, then crop the overhang evenly. The plain
// cameraX/VIEW_W stretch this replaced ignored the image's own aspect ratio and camY entirely, so it
// came out squashed and drifted out of alignment as soon as the craft gained altitude.
function drawBackgroundAsset(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number): void {
  if (!backgroundArt.complete || !backgroundArt.naturalWidth) return;
  const scale = Math.max(VIEW_W / backgroundArt.naturalWidth, VIEW_H / backgroundArt.naturalHeight) * 1.5;
  const drawW = backgroundArt.naturalWidth * scale;
  const drawH = backgroundArt.naturalHeight * scale;
  ctx.drawImage(backgroundArt, cameraX + (VIEW_W - drawW) / 2, cameraY + (VIEW_H - drawH) / 2, drawW, drawH);
}

function drawImageCentered(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number): boolean {
  if (!image.complete || !image.naturalWidth) return false;
  const height = width * image.naturalHeight / image.naturalWidth;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  return true;
}

function drawSurfaceAssets(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  if (enemy.kind !== 'destroyer' && enemy.kind !== 'cruiser' && enemy.kind !== 'carrier' && enemy.kind !== 'battleship') return;
  const hullKey = enemy.kind;
  const hull = surfaceArt[hullKey];
  if (!hull.complete || !hull.naturalWidth) return;
  const width = enemy.kind === 'battleship' ? 205 : hullKey === 'carrier' ? 145 : hullKey === 'cruiser' ? 132 : 118;
  const height = width * hull.naturalHeight / hull.naturalWidth;
  ctx.save(); ctx.translate(enemy.x, enemy.y + 13);
  ctx.drawImage(hull, -width / 2, -height, width, height);
  if (enemy.kind === 'battleship') {
    drawDeckPart(ctx, surfaceArt.heavy, -52, -height * .52, 42, 26);
    drawDeckPart(ctx, surfaceArt.heavy, 12, -height * .52, 42, 26);
    drawDeckPart(ctx, surfaceArt.medium, 54, -height * .42, 30, 19);
    drawDeckPart(ctx, surfaceArt.vls, -2, -height * .66, 31, 22);
    drawDeckPart(ctx, surfaceArt.ciws, -78, -height * .45, 22, 16);
  } else if (hullKey === 'carrier') {
    drawDeckPart(ctx, surfaceArt.vls, 38, -height * .52, 25, 18);
    drawDeckPart(ctx, surfaceArt.ciws, -48, -height * .48, 19, 14);
  } else if (hullKey === 'cruiser') {
    drawDeckPart(ctx, surfaceArt.medium, 20, -height * .54, 28, 18);
    drawDeckPart(ctx, surfaceArt.vls, -25, -height * .57, 23, 16);
    drawDeckPart(ctx, surfaceArt.aa, -48, -height * .46, 16, 12);
  } else {
    drawDeckPart(ctx, surfaceArt.aa, 25, -height * .5, 17, 12);
    drawDeckPart(ctx, surfaceArt.ciws, -26, -height * .47, 17, 12);
  }
  ctx.fillStyle = 'rgba(8,15,24,.78)'; ctx.fillRect(-width * .28, 18, width * .56, 4);
  ctx.fillStyle = enemy.kind === 'battleship' ? '#e0a5ff' : '#ffbc72'; ctx.fillRect(-width * .28, 18, width * .56 * enemy.hp / enemy.maxHp, 4);
  ctx.restore();
}

function drawEnemyAircraft(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
  if (enemy.kind !== 'chaser' && enemy.kind !== 'diver') return;
  const image = enemyAirArt[enemy.kind];
  if (!image.complete || !image.naturalWidth) return;
  const width = enemy.kind === 'diver' ? 58 : 46;
  const height = width * image.naturalHeight / image.naturalWidth;
  ctx.save();
  ctx.translate(enemy.x, enemy.y);
  if (enemy.vx < 0) ctx.scale(-1, 1);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.fillStyle = 'rgba(8,15,24,.78)'; ctx.fillRect(-20, height / 2 + 3, 40, 4);
  ctx.fillStyle = enemy.kind === 'diver' ? '#e0a5ff' : '#ff8e72'; ctx.fillRect(-20, height / 2 + 3, 40 * enemy.hp / enemy.maxHp, 4);
  ctx.restore();
}

function drawDeckPart(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number): void {
  if (!image.complete || !image.naturalWidth) return;
  ctx.drawImage(image, x - width / 2, y - height, width, height);
}

// Nose points +x in local space; the whole sprite is rotated by the craft angle. Thrust flame is
// always at the tail. The nose wedge/muzzle-glow/aim-line overlay that used to sit on top of the old
// vector hull is gone now that the airframe is a real sprite — it no longer lined up with the art.
type FrameArt = { flame: string; tailX: number; spriteWidth: number };
const FRAME_ART: Record<AirframeId, FrameArt> = {
  interceptor: { flame: '#ffbd5a', tailX: -34, spriteWidth: 76 },
  hauler: { flame: '#ff8a3d', tailX: -38, spriteWidth: 82 },
  darter: { flame: '#ff6fdd', tailX: -40, spriteWidth: 88 },
  hoverer: { flame: '#8affc0', tailX: -34, spriteWidth: 76 },
};

function drawShip(ctx: CanvasRenderingContext2D, frameId: AirframeId, action: GunshipAction): void {
  const art = FRAME_ART[frameId];
  if (action.thrust) {
    const len = 30 + Math.random() * 18;
    ctx.fillStyle = art.flame; ctx.beginPath(); ctx.moveTo(art.tailX, -7); ctx.lineTo(art.tailX - len, 0); ctx.lineTo(art.tailX, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(art.tailX, -3); ctx.lineTo(art.tailX - len * .55, 0); ctx.lineTo(art.tailX, 3); ctx.closePath(); ctx.fill();
  }
  drawImageCentered(ctx, frameArt[frameId], art.spriteWidth);
}
