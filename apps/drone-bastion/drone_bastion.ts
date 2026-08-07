import { DroneBastionAgent, type DroneBastionAgentSave } from './drone_bastion_agent.js';
import {
  applyBastionUpgrade,
  createDroneBastionState,
  getDroneRadius,
  observeDroneBastion,
  resetDroneBastionEpisode,
  stepDroneBastion,
  type BastionDrone,
  type DroneBastionState,
} from './drone_bastion_core.js';
import { DroneBastionScene } from './drone_bastion_scene.js';
import { isCompatibleModelManifest, type ModelManifest } from '../../shared/rl/model_manifest.js';

const STORAGE_KEY = 'drone-bastion-rl-v1';
type LiveModelBundle = {
  version: 1;
  revision: number;
  manifest?: ModelManifest;
  model?: DroneBastionAgentSave;
};
const liveModelCompatibility = {
  gameId: 'drone-bastion',
  algorithm: 'tabular-q',
  modelVersion: 1,
  observationSchemaVersion: 1,
  rewardSchemaVersion: 1,
} as const;
const canvas = requireElement<HTMLCanvasElement>('bastion');
const scene3d = new DroneBastionScene(canvas);

const ui = {
  towerHp: requireElement<HTMLElement>('tower-hp'),
  towerFill: requireElement<HTMLElement>('tower-fill'),
  wave: requireElement<HTMLElement>('wave'),
  episode: requireElement<HTMLElement>('episode'),
  score: requireElement<HTMLElement>('score'),
  fleet: requireElement<HTMLElement>('fleet'),
  selected: requireElement<HTMLElement>('selected'),
  action: requireElement<HTMLElement>('action'),
  policy: requireElement<HTMLElement>('policy'),
  epsilon: requireElement<HTMLElement>('epsilon'),
  states: requireElement<HTMLElement>('states'),
  steps: requireElement<HTMLElement>('steps'),
  reward: requireElement<HTMLElement>('reward'),
  upgrade: requireElement<HTMLElement>('upgrade'),
  banner: requireElement<HTMLElement>('banner'),
  pause: requireElement<HTMLButtonElement>('pause'),
  resetModel: requireElement<HTMLButtonElement>('reset-model'),
};

const state = createDroneBastionState(1200, 760, Math.floor(Date.now() / 1000));
let agent = new DroneBastionAgent();
restoreAgent();
agent.setEvaluationMode(true);
let loadedRevision = -1;
let modelReady = false;
let paused = false;
let previousTime = performance.now();
let upgradeTimer = 0;
let restartTimer = 0;
let episodeFinished = false;
let bannerTimer = 0;
let currentDecision = agent.decide(observeDroneBastion(state), 1, 0);
document.documentElement.dataset.rlModelStatus = 'loading';
void reloadLiveModel().finally(() => {
  modelReady = true;
  if (loadedRevision < 0 && document.documentElement.dataset.rlModelStatus === 'loading') {
    document.documentElement.dataset.rlModelStatus = 'fallback';
    showBanner('INFERENCE FALLBACK // NO SNAPSHOT');
  }
});

ui.pause.addEventListener('click', () => {
  paused = !paused;
  ui.pause.dataset.active = String(paused);
  ui.pause.textContent = paused ? 'RESUME' : 'PAUSE';
});
ui.resetModel.addEventListener('click', () => { void resetLearning(); });

function frame(now: number): void {
  const realDt = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
  previousTime = now;
  if (!paused && modelReady) update(realDt);
  scene3d.render(state);
  updateHud();
  requestAnimationFrame(frame);
}

function update(dt: number): void {
  if (state.gameOver) {
    if (!episodeFinished) {
      agent.finishEpisode(state.lastReward);
      episodeFinished = true;
      restartTimer = Number.POSITIVE_INFINITY;
      showBanner(`KING TOWER LOST // EP ${state.episode} // REDEPLOYING`);
      void reloadLiveModel().finally(() => { restartTimer = 1.8; });
    }
    restartTimer -= dt;
    if (restartTimer <= 0) {
      resetDroneBastionEpisode(state);
      episodeFinished = false;
      currentDecision = agent.decide(observeDroneBastion(state), 1, 0);
      showBanner(`EPISODE ${state.episode} // DEFENSE ONLINE`);
    }
    tickBanner(dt);
    return;
  }

  if (state.pendingUpgrade) {
    upgradeTimer -= dt;
    if (upgradeTimer <= 0) {
      const choice = agent.chooseUpgrade(state);
      applyBastionUpgrade(state, choice);
      showBanner(`${choice.toUpperCase()} // ${state.lastUpgrade} // WAVE ${state.wave}`);
    }
    tickBanner(dt);
    return;
  }

  const observation = observeDroneBastion(state);
  currentDecision = agent.decide(observation, dt, state.lastReward);
  const result = stepDroneBastion(state, currentDecision.action, dt);
  if (result.waveAdvanced) {
    upgradeTimer = 1.1;
    showBanner(`WAVE ${state.wave} CLEAR // FLEET DECISION`);
  }

  tickBanner(dt);
}

function render(ctx: CanvasRenderingContext2D, game: DroneBastionState): void {
  resizeCanvas();
  const scale = Math.min(canvas.width / game.width, canvas.height / game.height);
  const offsetX = (canvas.width - game.width * scale) / 2;
  const offsetY = (canvas.height - game.height * scale) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const gradient = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, 40,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.7,
  );
  gradient.addColorStop(0, '#10233a');
  gradient.addColorStop(0.48, '#07111e');
  gradient.addColorStop(1, '#02050a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

  drawGrid(ctx, game);
  for (const wall of game.walls) {
    const ratio = wall.hp / wall.maxHp;
    ctx.fillStyle = wall.hp <= 0 ? 'rgba(72,42,44,.25)' : ratio < 0.35 ? '#9f443f' : '#31506a';
    ctx.strokeStyle = wall.hp <= 0 ? '#4c292a' : '#6d99b4';
    ctx.lineWidth = 2;
    ctx.fillRect(wall.x - wall.width / 2, wall.y - wall.height / 2, wall.width, wall.height);
    ctx.strokeRect(wall.x - wall.width / 2, wall.y - wall.height / 2, wall.width, wall.height);
  }

  drawTower(ctx, game);
  for (const effect of game.effects) {
    const alpha = effect.life / effect.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = effect.kind === 'arc' ? '#e5a8ff' : '#ffb347';
    ctx.fillStyle = effect.kind === 'arc' ? 'rgba(205,105,255,.16)' : 'rgba(255,128,45,.2)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    if (effect.kind === 'arc') {
      ctx.moveTo(effect.x, effect.y);
      ctx.arc(effect.x, effect.y, effect.radius, effect.angle - Math.PI / 4, effect.angle + Math.PI / 4);
      ctx.closePath();
    } else {
      ctx.arc(effect.x, effect.y, effect.radius * (1.2 - alpha * 0.2), 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  for (const projectile of game.projectiles) {
    const colors = {
      missile: '#7cf7ff',
      mortar: '#ffb347',
      pierce: '#bd8cff',
      ricochet: '#ff75c8',
    } as const;
    ctx.fillStyle = colors[projectile.kind];
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 12;
    if (projectile.kind === 'mortar') {
      const progress = 1 - projectile.life / projectile.maxLife;
      ctx.strokeStyle = 'rgba(255,179,71,.35)';
      ctx.beginPath();
      ctx.arc(projectile.targetX, projectile.targetY, 72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.translate(projectile.x, projectile.y - Math.sin(progress * Math.PI) * 42);
    }
    ctx.beginPath();
    ctx.arc(
      projectile.kind === 'mortar' ? 0 : projectile.x,
      projectile.kind === 'mortar' ? 0 : projectile.y,
      projectile.radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    if (projectile.kind === 'mortar') ctx.restore();
  }
  ctx.shadowBlur = 0;

  for (const enemy of game.enemies) {
    const ratio = enemy.hp / enemy.maxHp;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(Math.atan2(enemy.vy, enemy.vx) + Math.PI / 4);
    ctx.fillStyle = enemy.kind === 'brute' ? '#ff7849' : '#ff3e62';
    ctx.strokeStyle = '#ffb09b';
    ctx.lineWidth = 2;
    ctx.fillRect(-enemy.radius * 0.7, -enemy.radius * 0.7, enemy.radius * 1.4, enemy.radius * 1.4);
    ctx.strokeRect(-enemy.radius * 0.7, -enemy.radius * 0.7, enemy.radius * 1.4, enemy.radius * 1.4);
    ctx.restore();
    ctx.fillStyle = '#32121d';
    ctx.fillRect(enemy.x - 13, enemy.y - enemy.radius - 8, 26, 3);
    ctx.fillStyle = '#ff5875';
    ctx.fillRect(enemy.x - 13, enemy.y - enemy.radius - 8, 26 * ratio, 3);
  }

  for (let index = 0; index < game.drones.length; index += 1) {
    drawDrone(ctx, game.drones[index], index === game.selectedDrone);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawGrid(ctx: CanvasRenderingContext2D, game: DroneBastionState): void {
  ctx.strokeStyle = 'rgba(65,125,160,.09)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= game.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, game.height);
    ctx.stroke();
  }
  for (let y = 0; y <= game.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(game.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(91,205,235,.16)';
  ctx.beginPath();
  ctx.arc(game.tower.x, game.tower.y, 220, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTower(ctx: CanvasRenderingContext2D, game: DroneBastionState): void {
  const pulse = 0.5 + Math.sin(game.elapsed * 2.2) * 0.12;
  ctx.save();
  ctx.translate(game.tower.x, game.tower.y);
  ctx.shadowColor = '#65e6ff';
  ctx.shadowBlur = 26;
  ctx.fillStyle = `rgba(31, 120, 154, ${pulse})`;
  ctx.strokeStyle = '#9befff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let side = 0; side < 8; side += 1) {
    const angle = side / 8 * Math.PI * 2 - Math.PI / 8;
    const radius = side % 2 ? 43 : 53;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (side === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#d9fbff';
  ctx.font = '700 13px SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('♔', 0, 6);
  ctx.restore();
}

function drawDrone(ctx: CanvasRenderingContext2D, drone: BastionDrone, selected: boolean): void {
  const radius = getDroneRadius(drone.kind);
  ctx.save();
  ctx.translate(drone.x, drone.y);
  if (selected) {
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.rotate(drone.angle);
  ctx.globalAlpha = drone.mode === 'disabled' ? 0.25 : 1;
  if (drone.kind === 'rook') {
    ctx.fillStyle = '#274d67';
    ctx.strokeStyle = '#9ddcff';
    ctx.lineWidth = 2;
    ctx.fillRect(-15, -11, 26, 22);
    ctx.strokeRect(-15, -11, 26, 22);
    ctx.fillStyle = '#07131e';
    ctx.fillRect(-17, -14, 27, 4);
    ctx.fillRect(-17, 10, 27, 4);
    ctx.fillStyle = '#d4f7ff';
    ctx.fillRect(0, -3, 24, 6);
  } else if (drone.kind === 'bishop' || drone.kind === 'queen') {
    ctx.fillStyle = drone.kind === 'queen' ? '#694f82' : '#3f5878';
    ctx.strokeStyle = drone.kind === 'queen' ? '#efb5ff' : '#a9c8ff';
    ctx.lineWidth = 2;
    const size = drone.kind === 'queen' ? 17 : 13;
    ctx.fillRect(-size, -size * 0.7, size * 1.7, size * 1.4);
    ctx.strokeRect(-size, -size * 0.7, size * 1.7, size * 1.4);
    ctx.beginPath();
    ctx.arc(size * 0.65, 0, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d9e8ff';
    ctx.fillRect(size * 0.65, -2, size * 1.3, 4);
  } else {
    ctx.fillStyle = '#2b6a70';
    ctx.strokeStyle = drone.kind === 'knight' ? '#ff9ee1' : '#8fffe8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-9, -9);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-7, -13);
    ctx.lineTo(4, 13);
    ctx.moveTo(4, -13);
    ctx.lineTo(-7, 13);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = drone.mode === 'turret' ? '#78ffac' : selected ? '#ffd166' : '#6f8796';
  ctx.font = '9px SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${drone.kind.toUpperCase()} · ${drone.mode.toUpperCase()}`, drone.x, drone.y + radius + 18);
}

function updateHud(): void {
  const hpRatio = state.tower.hp / state.tower.maxHp;
  ui.towerHp.textContent = `${Math.ceil(state.tower.hp)} / ${state.tower.maxHp}`;
  ui.towerFill.style.width = `${hpRatio * 100}%`;
  ui.towerFill.dataset.level = hpRatio < 0.3 ? 'danger' : hpRatio < 0.6 ? 'warn' : 'safe';
  ui.wave.textContent = String(state.wave);
  ui.episode.textContent = String(state.episode);
  ui.score.textContent = state.score.toLocaleString();
  ui.fleet.textContent = `${state.drones.filter((drone) => drone.mode !== 'disabled').length} / 6`;
  const selected = state.drones[state.selectedDrone];
  ui.selected.textContent = selected
    ? `${selected.kind.toUpperCase()} P${selected.powerLevel} · ${Math.round(Math.hypot(selected.vx, selected.vy))}u/s · T${Math.round(selected.throttle * 100)}%`
    : 'NONE';
  ui.action.textContent = currentDecision.action.label;
  ui.policy.textContent = currentDecision.exploratory ? 'EXPLORE' : 'POLICY';
  ui.policy.dataset.explore = String(currentDecision.exploratory);
  ui.epsilon.textContent = `${(agent.epsilon * 100).toFixed(1)}%`;
  ui.states.textContent = agent.knownStates.toLocaleString();
  ui.steps.textContent = agent.trainingSteps.toLocaleString();
  ui.reward.textContent = signed(state.lastReward);
  ui.upgrade.textContent = state.lastUpgrade;
}

function showBanner(message: string): void {
  ui.banner.textContent = message;
  ui.banner.dataset.open = 'true';
  bannerTimer = 2.2;
}

function tickBanner(dt: number): void {
  if (bannerTimer <= 0) return;
  bannerTimer -= dt;
  if (bannerTimer <= 0) ui.banner.dataset.open = 'false';
}

function resizeCanvas(): void {
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.floor(innerWidth * ratio);
  const height = Math.floor(innerHeight * ratio);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}

function restoreAgent(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) agent.restore(JSON.parse(raw) as DroneBastionAgentSave);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function reloadLiveModel(): Promise<void> {
  try {
    const response = await fetch('/api/rl/models/drone-bastion', { cache: 'no-store' });
    if (!response.ok) { document.documentElement.dataset.rlModelStatus = 'unavailable'; return; }
    const bundle = await response.json() as LiveModelBundle;
    if (bundle.manifest && !isCompatibleModelManifest(bundle.manifest, liveModelCompatibility)) { document.documentElement.dataset.rlModelStatus = 'incompatible'; return; }
    if (!bundle.model) { document.documentElement.dataset.rlModelStatus = 'fallback'; return; }
    if (bundle.revision <= loadedRevision) return;
    const next = new DroneBastionAgent();
    next.restore(bundle.model);
    next.setEvaluationMode(true);
    agent = next;
    loadedRevision = bundle.revision;
    document.documentElement.dataset.rlModelStatus = 'compatible';
    currentDecision = agent.decide(observeDroneBastion(state), 1, 0);
    showBanner(`INFERENCE MODEL r${bundle.revision}`);
  } catch {
    document.documentElement.dataset.rlModelStatus = 'unavailable';
    // Training is optional; keep the last compatible model.
  }
}

async function resetLearning(): Promise<void> {
  try {
    const response = await fetch('/api/rl/models/drone-bastion/reset', { method: 'POST' });
    if (!response.ok) throw new Error('reset rejected');
    localStorage.removeItem(STORAGE_KEY);
    agent = new DroneBastionAgent();
    agent.setEvaluationMode(true);
    loadedRevision = -1;
    resetDroneBastionEpisode(state);
    episodeFinished = false;
    restartTimer = 0;
    currentDecision = agent.decide(observeDroneBastion(state), 1, 0);
    showBanner('TRAINER RESET REQUESTED');
  } catch {
    showBanner('RESET FAILED');
  }
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

requestAnimationFrame(frame);
