import { QLearningAgent } from './arena_shooter_agent.js';
import {
  createArenaState,
  craftLabel,
  observeArena,
  prepareArenaWave,
  resetEpisode,
  resizeArena,
  setCraftPreference,
  stepArena,
  type ArenaObservation,
  type CraftPreference,
} from './arena_shooter_core.js';
import {
  DEFAULT_META,
  addKillProgress,
  ascend,
  ascensionPower,
  applyUpgrade,
  buyResearch,
  canAscend,
  collectEpisode,
  createRunProgress,
  formatIncremental,
  getUpgradeChoices,
  researchCost,
  type ArenaMetaProgress,
  type ArenaRunProgress,
  type UpgradeChoice,
} from './arena_shooter_progression.js';
import { loadArenaSave, sanitizeMeta, sanitizeRun, saveArenaState } from './arena_shooter_save.js';
import { renderArena } from './arena_shooter_render.js';

const canvas = requireElement<HTMLCanvasElement>('arena');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D context is unavailable');

const loaded = await loadArenaSave();
const state = createArenaState(window.innerWidth, window.innerHeight);
const craftPreference = loadCraftPreference();
setCraftPreference(state, craftPreference);
const agent = new QLearningAgent();
let meta: ArenaMetaProgress = loaded ? sanitizeMeta(loaded.meta) : { ...DEFAULT_META };
let run: ArenaRunProgress = loaded ? sanitizeRun(loaded.run) : createRunProgress();
if (loaded) {
  agent.restore(loaded.agent);
}
if (loaded) {
  state.episode = Math.max(1, loaded.episode);
  state.wave = Math.max(1, loaded.wave);
  prepareArenaWave(state);
  state.score = Math.max(0, loaded.score);
  state.kills = Math.max(0, loaded.kills);
}
let previousTime = performance.now();
let accumulatedReward = 0;
let paused = false;
let saveTimer = 0;
let upgradeTimer = 0;
let upgradeChoices: UpgradeChoice[] = [];
let upgradeSelection: UpgradeChoice | null = null;
let bannerTimer = loaded ? 3 : 0;

const ui = {
  hpFill: requireElement<HTMLElement>('hp-fill'),
  hpText: requireElement<HTMLElement>('hp-text'),
  score: requireElement<HTMLElement>('score'),
  kills: requireElement<HTMLElement>('kills'),
  wave: requireElement<HTMLElement>('wave'),
  waveProgress: requireElement<HTMLElement>('wave-progress-fill'),
  cycle: requireElement<HTMLElement>('cycle'),
  episode: requireElement<HTMLElement>('episode'),
  level: requireElement<HTMLElement>('level'),
  xp: requireElement<HTMLElement>('xp'),
  scrap: requireElement<HTMLElement>('scrap'),
  scrapConversion: requireElement<HTMLElement>('scrap-conversion'),
  data: requireElement<HTMLElement>('data'),
  ascendium: requireElement<HTMLElement>('ascendium'),
  action: requireElement<HTMLElement>('action'),
  policyMode: requireElement<HTMLElement>('policy-mode'),
  agentStatus: requireElement<HTMLElement>('agent-status'),
  reward: requireElement<HTMLElement>('reward'),
  epsilon: requireElement<HTMLElement>('epsilon'),
  states: requireElement<HTMLElement>('states'),
  steps: requireElement<HTMLElement>('steps'),
  edgeObservation: requireElement<HTMLElement>('edge-observation'),
  motionObservation: requireElement<HTMLElement>('motion-observation'),
  episodeReward: requireElement<HTMLElement>('episode-reward'),
  best: requireElement<HTMLElement>('best'),
  weaponPulse: requireElement<HTMLElement>('weapon-pulse'),
  weaponRate: requireElement<HTMLElement>('weapon-rate'),
  weaponProjectiles: requireElement<HTMLElement>('weapon-projectiles'),
  weaponVelocity: requireElement<HTMLElement>('weapon-velocity'),
  weaponTurret: requireElement<HTMLElement>('weapon-turret'),
  weaponMissile: requireElement<HTMLElement>('weapon-missile'),
  weaponNova: requireElement<HTMLElement>('weapon-nova'),
  lastUpgrade: requireElement<HTMLElement>('last-upgrade'),
  upgradePanel: requireElement<HTMLElement>('upgrade-panel'),
  upgradeButtons: requireElement<HTMLElement>('upgrade-buttons'),
  banner: requireElement<HTMLElement>('banner'),
  damageResearch: requireElement<HTMLButtonElement>('research-damage'),
  hullResearch: requireElement<HTMLButtonElement>('research-hull'),
  damageResearchEffect: requireElement<HTMLElement>('research-damage-effect'),
  hullResearchEffect: requireElement<HTMLElement>('research-hull-effect'),
  ascend: requireElement<HTMLButtonElement>('ascend'),
  pause: requireElement<HTMLButtonElement>('pause'),
  mode: requireElement<HTMLElement>('runtime-mode'),
  craft: requireElement<HTMLElement>('craft'),
  craftSelect: requireElement<HTMLSelectElement>('craft-select'),
};
ui.craftSelect.value = craftPreference;
ui.mode.textContent = 'LIVE EVOLUTION';
ui.mode.dataset.training = 'false';
ui.agentStatus.textContent = 'LIVE LEARNING';

function resize(): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  resizeArena(state, window.innerWidth, window.innerHeight);
}

function frame(now: number): void {
  const dt = Math.min(0.033, (now - previousTime) / 1000);
  previousTime = now;
  configureShipFromProgress();
  const observation = observeArena(state);
  const decision = agent.decide(observation, dt, accumulatedReward);
  accumulatedReward = 0;

  if (!paused) {
    const result = stepArena(state, decision.action, dt);
    accumulatedReward = result.reward;
    for (const value of result.killedValues) addKillProgress(run, value, state.wave);
    if (result.waveAdvanced) {
      meta.highestWave = Math.max(meta.highestWave, state.wave);
      showBanner(state.wave % 5 === 0 ? `TRIAL WAVE ${state.wave}` : `WAVE ${state.wave}`);
      persist();
    }
    processUpgrade(dt);
    if (state.ship.hp <= 0) finishEpisode();
    saveTimer += dt;
    if (saveTimer >= 30) {
      saveTimer = 0;
      persist();
    }
  }

  bannerTimer -= dt;
  ui.banner.dataset.open = String(bannerTimer > 0);
  renderArena(context, state, observation, decision);
  updateHud(decision.action.label, decision.exploratory, observation);
  requestAnimationFrame(frame);
}

function configureShipFromProgress(): void {
  state.pulseLevel = run.weapons.pulse;
  state.fireRateLevel = run.fireRateLevel;
  state.projectileCountLevel = run.projectileCountLevel;
  state.projectileSpeedLevel = run.projectileSpeedLevel;
  state.turretTurnLevel = run.turretTurnLevel;
  state.missileLevel = run.weapons.missile;
  state.novaLevel = run.weapons.nova;
  state.damageMultiplier = 1.18 ** meta.damageResearch * ascensionPower(meta);
  const maxHp = Math.round(100 * 1.2 ** meta.hullResearch);
  if (state.ship.maxHp !== maxHp) {
    const ratio = state.ship.hp / state.ship.maxHp;
    state.ship.maxHp = maxHp;
    state.ship.hp = Math.max(1, Math.round(maxHp * ratio));
  }
}

function processUpgrade(dt: number): void {
  if (run.pendingUpgrades <= 0) {
    ui.upgradePanel.dataset.open = 'false';
    upgradeChoices = [];
    upgradeSelection = null;
    return;
  }
  if (!upgradeChoices.length) {
    upgradeChoices = getUpgradeChoices(run, state.ship.craftType);
    const selection = agent.chooseUpgrade(state.ship.craftType, upgradeChoices, state.wave);
    upgradeSelection = selection.choice;
    upgradeTimer = 0.8;
    renderUpgradeChoices();
  }
  upgradeTimer -= dt;
  if (upgradeTimer <= 0 && upgradeSelection) chooseUpgrade(upgradeSelection);
}

function renderUpgradeChoices(): void {
  ui.upgradePanel.dataset.open = 'true';
  ui.upgradeButtons.replaceChildren();
  for (const choice of upgradeChoices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<b>${choice.label}</b><span>${choice.description}</span>`;
    button.disabled = true;
    button.dataset.selected = String(choice === upgradeSelection);
    ui.upgradeButtons.append(button);
  }
}

function chooseUpgrade(choice: UpgradeChoice): void {
  applyUpgrade(run, choice, () => {
    state.ship.hp = Math.min(state.ship.maxHp, state.ship.hp + state.ship.maxHp * 0.3);
  });
  upgradeChoices = [];
  upgradeSelection = null;
  showBanner(choice.label);
  persist();
}

function finishEpisode(): void {
  accumulatedReward -= 12;
  agent.finishEpisode(accumulatedReward);
  const earned = collectEpisode(meta, run, state.wave, state.kills);
  showBanner(`RUN COMPLETE  +${earned} DATA`, 4);
  run = createRunProgress();
  resetEpisode(state);
  configureShipFromProgress();
  state.ship.hp = state.ship.maxHp;
  persist();
}

function persist(): void {
  void saveArenaState({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    meta,
    run,
    agent: agent.serialize(),
    episode: state.episode,
    wave: state.wave,
    waveTime: state.waveTime,
    score: state.score,
    kills: state.kills,
  });
}

function showBanner(message: string, duration = 2): void {
  ui.banner.textContent = message;
  bannerTimer = duration;
  ui.banner.dataset.open = 'true';
}

function updateHud(actionLabel: string, exploratory: boolean, observation: ArenaObservation): void {
  const hpRatio = Math.max(0, state.ship.hp / state.ship.maxHp);
  ui.hpFill.style.width = `${hpRatio * 100}%`;
  ui.hpFill.dataset.level = hpRatio < 0.35 ? 'danger' : hpRatio < 0.65 ? 'warn' : 'safe';
  ui.hpText.textContent = `${Math.max(0, Math.ceil(state.ship.hp))} / ${state.ship.maxHp}`;
  ui.score.textContent = formatIncremental(state.score);
  ui.kills.textContent = formatIncremental(state.kills);
  ui.wave.textContent = String(state.wave);
  const defeatedThisWave = Math.max(0, state.waveSpawned - state.enemies.length);
  ui.waveProgress.style.width = `${defeatedThisWave / state.waveTotal * 100}%`;
  ui.cycle.textContent = `${(state.wave - 1) % 5 + 1}/5`;
  ui.craft.textContent = craftLabel(state.ship.craftType);
  ui.episode.textContent = String(state.episode);
  ui.level.textContent = String(run.level);
  ui.xp.textContent = `${formatIncremental(run.xp)} / ${formatIncremental(run.nextLevelXp)}`;
  ui.scrap.textContent = formatIncremental(run.scrap);
  ui.scrapConversion.textContent = `+${formatIncremental(Math.floor(run.scrap * 0.02))} DATA`;
  ui.data.textContent = formatIncremental(meta.data);
  ui.ascendium.textContent = formatIncremental(meta.ascendium);
  ui.action.textContent = actionLabel;
  ui.policyMode.textContent = exploratory ? '探索' : '活用';
  ui.policyMode.dataset.explore = String(exploratory);
  ui.reward.textContent = signed(state.lastReward);
  ui.epsilon.textContent = `${(agent.epsilon * 100).toFixed(1)}%`;
  ui.states.textContent = agent.knownStates.toLocaleString();
  ui.steps.textContent = agent.trainingSteps.toLocaleString();
  const directionLabels = ['前', '右前', '右', '右後', '後', '左後', '左', '左前'];
  const edgeBands = ['NEAR', 'MID', 'FAR'];
  const speedBands = ['STOP/SLOW', 'CRUISE', 'FAST'];
  ui.edgeObservation.textContent = `${directionLabels[observation.edgeSector]} ${edgeBands[observation.edgeDistanceBand]}`;
  ui.motionObservation.textContent = `${directionLabels[observation.velocitySector]} ${speedBands[observation.speedBand]}`;
  ui.episodeReward.textContent = signed(state.episodeReward);
  ui.best.textContent = String(meta.highestWave);
  ui.weaponPulse.textContent = `Mk.${run.weapons.pulse}`;
  ui.weaponRate.textContent = `Lv.${run.fireRateLevel}`;
  const pulseCount = Math.min(5, 1 + Math.floor((run.projectileCountLevel + 1) / 2));
  ui.weaponProjectiles.textContent = `Lv.${run.projectileCountLevel} · ${pulseCount} ${pulseCount % 2 ? 'ODD' : 'EVEN'}`;
  ui.weaponVelocity.textContent = `Lv.${run.projectileSpeedLevel}`;
  ui.weaponTurret.textContent = `Lv.${run.turretTurnLevel}`;
  ui.weaponMissile.textContent = run.weapons.missile ? `Mk.${run.weapons.missile}` : 'LOCKED';
  ui.weaponNova.textContent = run.weapons.nova ? `Mk.${run.weapons.nova}` : 'LOCKED';
  ui.lastUpgrade.textContent = run.lastUpgradeLabel;
  updateResearchButton(ui.damageResearch, 'DMG', meta.damageResearch);
  updateResearchButton(ui.hullResearch, 'HULL', meta.hullResearch);
  ui.damageResearchEffect.textContent = `×${(1.18 ** meta.damageResearch).toFixed(2)}`;
  ui.hullResearchEffect.textContent = String(state.ship.maxHp);
  ui.ascend.hidden = false;
  ui.ascend.disabled = !canAscend(state.wave);
  ui.ascend.textContent = canAscend(state.wave)
    ? `ASCEND +${Math.max(1, Math.floor((state.wave / 25) ** 1.65))}`
    : `ASCEND AT WAVE 25`;
}

function updateResearchButton(button: HTMLButtonElement, label: string, level: number): void {
  const cost = researchCost(level);
  button.textContent = `${label} Lv.${level} — ${formatIncremental(cost)} DATA`;
  button.disabled = meta.data < cost;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function loadCraftPreference(): CraftPreference {
  const value = localStorage.getItem('rl-arena-craft-preference');
  return value === 'interceptor' || value === 'strafer' || value === 'turret' ? value : 'random';
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

ui.pause.addEventListener('click', () => {
  paused = !paused;
  ui.pause.textContent = paused ? '再開' : '一時停止';
  ui.pause.dataset.active = String(paused);
});
ui.craftSelect.addEventListener('change', () => {
  const preference = ui.craftSelect.value as CraftPreference;
  localStorage.setItem('rl-arena-craft-preference', preference);
  agent.finishEpisode(0);
  accumulatedReward = 0;
  run = createRunProgress();
  setCraftPreference(state, preference, false);
  resetEpisode(state);
  configureShipFromProgress();
  state.ship.hp = state.ship.maxHp;
  persist();
  showBanner(
    preference === 'random'
      ? `NEW RUN — AUTO ${craftLabel(state.ship.craftType)}`
      : `NEW RUN — ${craftLabel(state.ship.craftType)}`,
  );
});
ui.damageResearch.addEventListener('click', () => {
  if (buyResearch(meta, 'damage')) {
    showBanner('DAMAGE RESEARCH +18%');
    persist();
  }
});
ui.hullResearch.addEventListener('click', () => {
  if (buyResearch(meta, 'hull')) {
    showBanner('HULL RESEARCH +20%');
    persist();
  }
});
ui.ascend.addEventListener('click', () => {
  const earned = ascend(meta, state.wave);
  if (!earned) return;
  agent.finishEpisode(0);
  run = createRunProgress();
  resetEpisode(state);
  configureShipFromProgress();
  state.ship.hp = state.ship.maxHp;
  showBanner(`ASCENSION ${meta.ascensions}  +${earned} ASCENDIUM`, 5);
  persist();
});
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', persist);
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  ui.pause.click();
});

resize();
configureShipFromProgress();
showBanner(
  loaded
    ? `SAVE RESTORED — WAVE ${state.wave}`
    : 'LIVE RUN START',
);
requestAnimationFrame(frame);
