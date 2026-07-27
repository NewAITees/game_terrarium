type ActionName = 'generate' | 'charge' | 'repair' | 'mine' | 'grow' | 'scan' | 'deploy' | 'upgrade';
type Phase = 'human' | 'assist' | 'autonomous' | 'intervention';

type LearningSample = {
  action: ActionName;
  input: number[];
  result: number;
};

/** A tiny in-browser MLP: human clicks become one-hot labels and train the policy online. */
class ImitationNetwork {
  readonly inputSize = 8;
  readonly hiddenSize = 12;
  readonly outputSize = 8;
  readonly actions: ActionName[] = ['generate', 'charge', 'repair', 'mine', 'grow', 'scan', 'deploy', 'upgrade'];
  readonly w1 = Array.from({ length: this.hiddenSize }, () => Array.from({ length: this.inputSize }, () => (Math.random() - .5) * .45));
  readonly b1 = Array(this.hiddenSize).fill(0);
  readonly w2 = Array.from({ length: this.outputSize }, () => Array.from({ length: this.hiddenSize }, () => (Math.random() - .5) * .45));
  readonly b2 = Array(this.outputSize).fill(0);
  train(input: number[], target: ActionName): void {
    const targetIndex = this.actions.indexOf(target);
    if (targetIndex < 0) return;
    for (let repeat = 0; repeat < 4; repeat += 1) {
      const hidden = this.w1.map((weights, i) => Math.tanh(weights.reduce((sum, weight, j) => sum + weight * input[j], this.b1[i])));
      const logits = this.w2.map((weights, i) => weights.reduce((sum, weight, j) => sum + weight * hidden[j], this.b2[i]));
      const maxLogit = Math.max(...logits);
      const exp = logits.map(value => Math.exp(value - maxLogit));
      const total = exp.reduce((sum, value) => sum + value, 0);
      const probs = exp.map(value => value / total);
      const outputError = probs.map((probability, i) => probability - (i === targetIndex ? 1 : 0));
      const hiddenError = this.w1.map((_weights, hiddenIndex) => this.w2.reduce((sum, weights, outputIndex) => sum + outputError[outputIndex] * weights[hiddenIndex], 0) * (1 - hidden[hiddenIndex] ** 2));
      const rate = .045;
      this.w2.forEach((weights, i) => weights.forEach((_weight, j) => { this.w2[i][j] -= rate * outputError[i] * hidden[j]; }));
      this.b2.forEach((_bias, i) => { this.b2[i] -= rate * outputError[i]; });
      this.w1.forEach((weights, i) => weights.forEach((_weight, j) => { this.w1[i][j] -= rate * hiddenError[i] * input[j]; }));
      this.b1.forEach((_bias, i) => { this.b1[i] -= rate * hiddenError[i]; });
    }
  }
  predict(input: number[]): { action: ActionName; confidence: number } {
    const hidden = this.w1.map((weights, i) => Math.tanh(weights.reduce((sum, weight, j) => sum + weight * input[j], this.b1[i])));
    const logits = this.w2.map((weights, i) => weights.reduce((sum, weight, j) => sum + weight * hidden[j], this.b2[i]));
    const max = Math.max(...logits);
    const probabilities = logits.map(value => Math.exp(value - max));
    const total = probabilities.reduce((sum, value) => sum + value, 0);
    const normalized = probabilities.map(value => value / total);
    const index = normalized.indexOf(Math.max(...normalized));
    return { action: this.actions[index], confidence: normalized[index] };
  }
  serialize(): object { return { w1: this.w1, b1: this.b1, w2: this.w2, b2: this.b2 }; }
  restore(value: any): void {
    if (!value?.w1 || !value?.w2) return;
    value.w1.forEach((row: number[], i: number) => row.forEach((weight, j) => { if (this.w1[i]?.[j] !== undefined) this.w1[i][j] = weight; }));
    value.b1?.forEach((bias: number, i: number) => { if (this.b1[i] !== undefined) this.b1[i] = bias; });
    value.w2.forEach((row: number[], i: number) => row.forEach((weight, j) => { if (this.w2[i]?.[j] !== undefined) this.w2[i][j] = weight; }));
    value.b2?.forEach((bias: number, i: number) => { if (this.b2[i] !== undefined) this.b2[i] = bias; });
  }
}

/** Lightweight vision policy: a few convolution filters over a 32x24 control-deck image. */
class VisionPolicy {
  readonly width = 32;
  readonly height = 24;
  readonly filters = Array.from({ length: 4 }, () => Array.from({ length: 9 }, () => (Math.random() - .5) * .8));
  readonly weights = Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => (Math.random() - .5) * .3));
  readonly bias = Array(8).fill(0);
  readonly actions: ActionName[] = ['generate', 'charge', 'repair', 'mine', 'grow', 'scan', 'deploy', 'upgrade'];

  encode(pixels: Uint8ClampedArray): number[] {
    const features: number[] = [];
    for (const filter of this.filters) {
      for (let quadrant = 0; quadrant < 4; quadrant += 1) {
        const startX = quadrant % 2 === 0 ? 1 : Math.floor(this.width / 2);
        const startY = quadrant < 2 ? 1 : Math.floor(this.height / 2);
        let sum = 0;
        let count = 0;
        for (let y = startY; y < Math.min(startY + 10, this.height - 1); y += 1) {
          for (let x = startX; x < Math.min(startX + 14, this.width - 1); x += 1) {
            let activation = 0;
            for (let fy = -1; fy <= 1; fy += 1) for (let fx = -1; fx <= 1; fx += 1) {
              const pixel = ((y + fy) * this.width + (x + fx)) * 4;
              const luminance = (pixels[pixel] + pixels[pixel + 1] + pixels[pixel + 2]) / (3 * 255);
              activation += luminance * filter[(fy + 1) * 3 + fx + 1];
            }
            sum += Math.max(0, activation);
            count += 1;
          }
        }
        features.push(Math.min(1, sum / Math.max(count, 1) * 3));
      }
    }
    return features;
  }
  predict(features: number[]): { action: ActionName; confidence: number } {
    const logits = this.weights.map((weights, i) => weights.reduce((sum, weight, j) => sum + weight * features[j], this.bias[i]));
    const max = Math.max(...logits);
    const exp = logits.map(value => Math.exp(value - max));
    const total = exp.reduce((sum, value) => sum + value, 0);
    const probabilities = exp.map(value => value / total);
    const index = probabilities.indexOf(Math.max(...probabilities));
    return { action: this.actions[index], confidence: probabilities[index] };
  }
  train(features: number[], target: ActionName): void {
    const targetIndex = this.actions.indexOf(target);
    const prediction = this.predict(features);
    const predictedIndex = this.actions.indexOf(prediction.action);
    if (targetIndex < 0) return;
    const rate = .08;
    for (let i = 0; i < this.weights.length; i += 1) {
      const error = (i === targetIndex ? 1 : 0) - (i === predictedIndex ? 1 : 0) * .5;
      for (let j = 0; j < features.length; j += 1) this.weights[i][j] += rate * error * features[j];
      this.bias[i] += rate * error;
    }
  }
  serialize(): object { return { filters: this.filters, weights: this.weights, bias: this.bias }; }
  restore(value: any): void {
    if (!value?.filters || !value?.weights) return;
    value.filters.forEach((row: number[], i: number) => row.forEach((weight, j) => { if (this.filters[i]?.[j] !== undefined) this.filters[i][j] = weight; }));
    value.weights.forEach((row: number[], i: number) => row.forEach((weight, j) => { if (this.weights[i]?.[j] !== undefined) this.weights[i][j] = weight; }));
    value.bias?.forEach((bias: number, i: number) => { if (this.bias[i] !== undefined) this.bias[i] = bias; });
  }
}

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

const ui = {
  power: $('power'), recovery: $('recovery'), uptime: $('uptime'), learned: $('learned'),
  phase: $('phase'), phaseDetail: $('phase-detail'), confidence: $('confidence'),
  confidenceFill: $('confidence-fill'), drain: $('drain'), lastAction: $('last-action'),
  powerFill: $('power-fill'), recoveryFill: $('recovery-fill'), cursor: $('virtual-cursor'),
  feed: $('feed'), hint: $('hint'), generator: $('generator'), battery: $('battery'),
  workshop: $('workshop'), comms: $('comms'), generatorState: $('generator-state'),
  batteryState: $('battery-state'), workshopState: $('workshop-state'), commsState: $('comms-state'),
  hydroponics: $('hydroponics'), hydroponicsState: $('hydroponics-state'), mine: $('mine'), mineState: $('mine-state'),
  drones: $('drones'), dronesState: $('drones-state'), core: $('core'), coreState: $('core-state'),
  networkConfidence: $('network-confidence'), visionConfidence: $('vision-confidence'), milestone: $('milestone'), materials: $('materials'), parts: $('parts'), food: $('food'), data: $('data'), explore: $('explore'),
  nextNeed: $('next-need-text'), robot: $('robot'),
  controlRoom: $('control-room'), floaters: $('number-floaters'),
};

const actionLabels: Record<ActionName, string> = { generate: '発電', charge: '蓄電', repair: '修理', mine: '採掘', grow: '温室栽培', scan: '通信探索', deploy: 'ドローン展開', upgrade: '設備更新' };
const actionTargets: Record<ActionName, string> = {
  generate: '#city-map [data-action="generate"]', charge: '#city-map [data-facility-action="charge"]', repair: '#city-map [data-action="repair"]',
  mine: '#city-map [data-action="mine"]', grow: '#city-map [data-facility-action="grow"]', scan: '#city-map [data-action="scan"]',
  deploy: '#city-map [data-facility-action="deploy"]', upgrade: '#city-map [data-action="upgrade"]',
};
const samples: LearningSample[] = [];
const actionCounts: Record<ActionName, number> = { generate: 0, charge: 0, repair: 0, mine: 0, grow: 0, scan: 0, deploy: 0, upgrade: 0 };
const imitationNetwork = new ImitationNetwork();
const visionPolicy = new VisionPolicy();
let power = 12;
let powerCapacity = 25;
let materials = 8;
let food = 0;
let data = 0;
let explore = 0;
let recovery = 0;
let parts = 0;
let uptime = 0;
let phase: Phase = 'human';
let confidence = 0;
let lastAction = '—';
let aiCooldown = 0;
let pulse = 0;
let storyFlags = { workshop: false, comms: false, hydroponics: false, drones: false, core: false, autonomous: false };
let facilityLevel = 0;
const facilityLevels: Record<string, number> = { generator: 0, battery: 0, mine: 0, workshop: 0, hydroponics: 0, comms: 0, drones: 0 };
const facilityNames: Record<string, string> = { generator: '発電区画', battery: '蓄電池', mine: '採掘場', workshop: '修理工房', hydroponics: '温室区画', comms: '通信塔', drones: 'ドローン庫' };
const facilityCosts: Record<string, number> = { generator: 10, battery: 12, mine: 15, workshop: 20, hydroponics: 30, comms: 45, drones: 80 };
const SAVE_KEY = 'ai-restoration-alpha-save-v3';
let saveTimer = 5;
let lastSavedAt = 0;

function productionRate(facility: string): number {
  return facilityLevels[facility] * (facility === 'generator' ? 1.2 : facility === 'mine' ? .65 : facility === 'hydroponics' ? .35 : facility === 'comms' ? .18 : facility === 'drones' ? .12 : .2);
}

function getPowerCapacity(): number { return 25 + facilityLevels.battery * 40 + facilityLevels.generator * 10; }

function upgradeCost(facility: string): number { return Math.ceil(facilityCosts[facility] * (1.15 ** facilityLevels[facility])); }

function nextUpgradeFacility(): string {
  const order = ['generator', 'battery', 'mine', 'workshop', 'hydroponics', 'comms', 'drones'];
  return order.find(facility => facilityLevels[facility] === 0) ?? order.reduce((best, facility) => upgradeCost(facility) < upgradeCost(best) ? facility : best, order[0]);
}

function currentInput(): number[] {
  return [power / Math.max(powerCapacity, 1), clamp(recovery / 500, 0, 1), clamp(materials / 120, 0, 1), Number(storyFlags.workshop), Number(storyFlags.comms), clamp(parts / 40, 0, 1), Number(storyFlags.drones), clamp(facilityLevel / 12, 0, 1)];
}

function tickEconomy(dt: number, aiActive: boolean): void {
  const generatorRate = productionRate('generator');
  const mineRate = productionRate('mine');
  const workshopRate = productionRate('workshop');
  const foodRate = productionRate('hydroponics');
  const dataRate = productionRate('comms');
  const exploreRate = productionRate('drones');
  powerCapacity = getPowerCapacity();
  power = clamp(power + generatorRate * dt, 0, powerCapacity);
  materials += mineRate * dt;
  const partsMade = Math.min(materials, workshopRate * dt);
  materials -= partsMade;
  parts += partsMade;
  food += foodRate * dt;
  data += dataRate * dt;
  explore += exploreRate * dt;
  recovery += workshopRate * dt * .012 + foodRate * dt * .006 + exploreRate * dt * .02;
  if (aiActive) power = clamp(power - dt * (phase === 'autonomous' ? .55 : .18), 0, powerCapacity);
}

type SaveData = {
  savedAt: number;
  power: number;
  materials: number;
  parts: number;
  food: number;
  data: number;
  explore: number;
  recovery: number;
  uptime: number;
  phase: Phase;
  confidence: number;
  lastAction: string;
  storyFlags: typeof storyFlags;
  facilityLevels: Record<string, number>;
  facilityLevel: number;
  samples: LearningSample[];
  imitationNetwork: object;
  visionPolicy: object;
};

function saveGame(): void {
  try {
    const save: SaveData = { savedAt: Date.now(), power, materials, parts, food, data, explore, recovery, uptime, phase, confidence, lastAction, storyFlags, facilityLevels: { ...facilityLevels }, facilityLevel, samples: samples.slice(-800), imitationNetwork: imitationNetwork.serialize(), visionPolicy: visionPolicy.serialize() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    lastSavedAt = save.savedAt;
  } catch (error) { console.warn('[ai-restoration] save failed', error); }
}

function restoreGame(): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const save = JSON.parse(raw) as Partial<SaveData>;
    power = Number(save.power ?? power);
    materials = Number(save.materials ?? materials);
    parts = Number(save.parts ?? parts);
    food = Number(save.food ?? food);
    data = Number(save.data ?? data);
    explore = Number(save.explore ?? explore);
    recovery = Number(save.recovery ?? recovery);
    uptime = Number(save.uptime ?? uptime);
    phase = save.phase ?? phase;
    confidence = Number(save.confidence ?? confidence);
    lastAction = save.lastAction ?? lastAction;
    if (save.storyFlags) storyFlags = { ...storyFlags, ...save.storyFlags };
    if (save.facilityLevels) Object.assign(facilityLevels, save.facilityLevels);
    facilityLevel = Number(save.facilityLevel ?? facilityLevel);
    samples.push(...(save.samples ?? []));
    imitationNetwork.restore(save.imitationNetwork);
    visionPolicy.restore(save.visionPolicy);
    powerCapacity = getPowerCapacity();
    const awaySeconds = Math.min(8 * 60 * 60, Math.max(0, (Date.now() - Number(save.savedAt ?? Date.now())) / 1000));
    if (awaySeconds >= 10) {
      tickEconomy(awaySeconds, phase === 'assist' || phase === 'autonomous');
      addFeed(`オフライン生産 ${formatTime(awaySeconds)} // 資源とPartsを回収`, 'story');
    }
    lastSavedAt = Number(save.savedAt ?? Date.now());
  } catch (error) { console.warn('[ai-restoration] save restore failed', error); }
}

function upgradeFacility(facility: string, actor: 'human' | 'ai'): boolean {
  const cost = upgradeCost(facility);
  const inputBefore = currentInput();
  const visionBefore = observeControlDeckImage();
  if (materials < cost) {
    addFeed(`${actor === 'human' ? '人間' : 'AI'}が${facilityNames[facility]}を更新しようとした // 部品不足`, actor === 'human' ? 'human' : 'ai');
    if (actor === 'human') { samples.push({ action: 'upgrade', input: inputBefore, result: -1 }); imitationNetwork.train(inputBefore, 'upgrade'); visionPolicy.train(visionBefore, 'upgrade'); }
    return false;
  }
  materials -= cost;
  facilityLevels[facility] += 1;
  facilityLevel += 1;
  powerCapacity = getPowerCapacity();
  if (facility === 'workshop') storyFlags.workshop = true;
  if (facility === 'hydroponics') storyFlags.hydroponics = true;
  if (facility === 'comms') storyFlags.comms = true;
  if (facility === 'drones') storyFlags.drones = true;
  if (facility === 'battery' && facilityLevels.battery === 1) addFeed('蓄電池の容量拡張が完了。エネルギープールが広がった。', 'story');
  if (actor === 'human') {
    samples.push({ action: 'upgrade', input: inputBefore, result: 1 });
    imitationNetwork.train(inputBefore, 'upgrade');
    visionPolicy.train(visionBefore, 'upgrade');
    confidence = clamp(confidence + .06, 0, 1);
  }
  showNumber(`LV.${facilityLevels[facility]}`, actor);
  addFeed(`${actor === 'human' ? '人間' : 'AI'}が${facilityNames[facility]}をLv.${facilityLevels[facility]}へ更新`, actor === 'human' ? 'human' : 'ai');
  return true;
}

function addFeed(message: string, kind: 'human' | 'ai' | 'story' = 'ai'): void {
  const item = document.createElement('div');
  item.className = `event-${kind}`;
  item.textContent = `${formatTime(uptime)}  ${message}`;
  ui.feed.prepend(item);
  while (ui.feed.children.length > 28) ui.feed.lastElementChild?.remove();
}

function showNumber(value: string, kind: 'human' | 'ai' = 'ai'): void {
  const floater = document.createElement('span');
  floater.className = 'number-floater';
  floater.style.left = `${35 + Math.random() * 30}%`;
  floater.style.top = `${40 + Math.random() * 18}%`;
  floater.style.color = kind === 'human' ? 'var(--amber)' : 'var(--green)';
  floater.textContent = value;
  ui.floaters.appendChild(floater);
  window.setTimeout(() => floater.remove(), 1200);
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

function formatNumber(value: number): string {
  if (value < 1000) return Math.floor(value).toString();
  const units = ['', 'K', 'M', 'B', 'T'];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(Math.max(value, 1)) / 3));
  return `${(value / (1000 ** index)).toFixed(index === 0 ? 0 : 1)}${units[index]}`;
}

function currentSector(): number { return Math.floor(recovery / 100) + 1; }
function repairEnergyCost(): number { return Math.ceil(5 * (1.08 ** (currentSector() - 1))); }
function repairPartsCost(): number { return Math.ceil(2 * (1.15 ** (currentSector() - 1))); }
function repairYield(): number { return Math.ceil(5 * (1.05 ** (currentSector() - 1))); }

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

function markDistricts(): void {
  ui.generator.dataset.on = String(power > 0);
  ui.battery.dataset.on = String(facilityLevels.battery > 0);
  ui.workshop.dataset.on = String(storyFlags.workshop);
  ui.comms.dataset.on = String(storyFlags.comms);
  ui.hydroponics.dataset.on = String(storyFlags.hydroponics);
  ui.mine.dataset.on = String(storyFlags.workshop);
  ui.drones.dataset.on = String(storyFlags.drones);
  ui.core.dataset.on = String(storyFlags.core);
  ui.generatorState.textContent = power > 0 ? 'ONLINE' : 'OFFLINE';
  ui.batteryState.textContent = `${Math.round(power)} / ${Math.round(powerCapacity)}`;
  ui.workshopState.textContent = storyFlags.workshop ? `${Math.floor(parts)} PARTS` : 'DAMAGED';
  ui.commsState.textContent = storyFlags.comms ? 'SIGNAL FOUND' : 'SILENT';
  ui.hydroponicsState.textContent = storyFlags.hydroponics ? 'GROWING' : 'DORMANT';
  ui.mineState.textContent = storyFlags.workshop ? `${Math.floor(materials)} MATERIALS` : 'LOCKED';
  ui.dronesState.textContent = storyFlags.drones ? `${formatNumber(explore)} EXPLORE` : 'OFFLINE';
  ui.coreState.textContent = storyFlags.core ? 'AWAKE' : 'SLEEPING';
}

function moveCursor(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  ui.cursor.style.left = `${rect.left + rect.width / 2}px`;
  ui.cursor.style.top = `${rect.top + rect.height / 2}px`;
}

function moveRobotTo(target: HTMLElement): void {
  const roomRect = ui.controlRoom.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  ui.robot.style.left = `${targetRect.left - roomRect.left + targetRect.width / 2 - ui.robot.offsetWidth / 2}px`;
  ui.robot.style.top = `${targetRect.top - roomRect.top + targetRect.height / 2 - ui.robot.offsetHeight / 2}px`;
}

const visionCanvas = document.createElement('canvas');
visionCanvas.width = 32;
visionCanvas.height = 24;
const visionContext = visionCanvas.getContext('2d', { willReadFrequently: true });
const visionTargets = ['generator', 'battery', 'mine', 'workshop', 'hydroponics', 'comms', 'drones', 'core'];
function observeControlDeckImage(): number[] {
  if (!visionContext) return Array(16).fill(0);
  visionContext.fillStyle = '#02070c';
  visionContext.fillRect(0, 0, visionCanvas.width, visionCanvas.height);
  const room = ui.controlRoom.getBoundingClientRect();
  visionContext.strokeStyle = '#1e5662';
  visionContext.strokeRect(1, 1, 30, 22);
  for (const id of visionTargets) {
    const target = document.getElementById(id);
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    const x = clamp((rect.left - room.left) / Math.max(room.width, 1) * 32, 0, 31);
    const y = clamp((rect.top - room.top) / Math.max(room.height, 1) * 24, 0, 23);
    const w = clamp(rect.width / Math.max(room.width, 1) * 32, 1, 8);
    const h = clamp(rect.height / Math.max(room.height, 1) * 24, 1, 5);
    visionContext.fillStyle = target.dataset.on === 'true' ? '#55d99a' : '#164451';
    visionContext.fillRect(x, y, w, h);
  }
  return visionPolicy.encode(visionContext.getImageData(0, 0, 32, 24).data);
}

function chooseHumanLikeAction(): ActionName {
  if (power < Math.max(repairEnergyCost() + 2, powerCapacity * .22)) return 'generate';
  if (canApply('repair')) return 'repair';
  if (facilityLevels.workshop > 0 && parts < repairPartsCost()) return 'mine';
  if (facilityLevels.hydroponics > 0 && food < 8 && canApply('grow')) return 'grow';
  if (facilityLevels.drones > 0 && data >= 2 && canApply('deploy')) return 'deploy';
  if (facilityLevels.battery > 0 && power < powerCapacity * .65 && canApply('charge')) return 'charge';
  const prediction = samples.length >= 4 ? imitationNetwork.predict(currentInput()) : null;
  const visionPrediction = samples.length >= 4 ? visionPolicy.predict(observeControlDeckImage()) : null;
  if (visionPrediction && visionPrediction.action !== 'generate' && visionPrediction.confidence >= .28 && canApply(visionPrediction.action)) return visionPrediction.action;
  if (prediction && prediction.action !== 'generate' && prediction.confidence >= .34 && canApply(prediction.action)) return prediction.action;
  if (facilityLevels.hydroponics > 0 && food < 8 && canApply('grow')) return 'grow';
  if (facilityLevels.drones > 0 && data >= 2 && canApply('deploy')) return 'deploy';
  if (facilityLevels.battery > 0 && power < powerCapacity * .65 && canApply('charge')) return 'charge';
  if (canApply('repair')) return 'repair';
  if (recovery < 34 && power >= 3) return 'mine';
  if (!storyFlags.comms && recovery >= 34 && power >= 8) return 'scan';
  if (storyFlags.comms && facilityLevel < 5 && power >= 12) return 'upgrade';
  return 'generate';
}

function canApply(action: ActionName): boolean {
  if (action === 'generate') return true;
  if (action === 'charge') return facilityLevels.battery > 0 && facilityLevels.generator > 0;
  if (action === 'repair') return power >= repairEnergyCost() && (facilityLevels.workshop === 0 ? materials >= 4 : parts >= repairPartsCost());
  if (action === 'mine') return power >= 3;
  if (action === 'grow') return facilityLevels.hydroponics > 0 && power >= 4 && materials >= 5;
  if (action === 'scan') return power >= 8 && recovery >= 30;
  if (action === 'deploy') return facilityLevels.drones > 0 && power >= 6 && data >= 2;
  return power >= 5 && materials >= upgradeCost(nextUpgradeFacility()) && facilityLevel < 12;
}

function requirementFor(action: ActionName): string {
  if (action === 'charge') return facilityLevels.generator === 0 ? '発電区画Lv.1が必要' : '蓄電池が未解放';
  if (action === 'repair') return facilityLevels.workshop === 0
    ? `修理工房の初回修復に Energy 5 + Materials 4 が必要（現在 ${Math.floor(power)} / ${Math.floor(materials)}）`
    : `S${currentSector()}の修理に Energy ${repairEnergyCost()} + Parts ${repairPartsCost()} が必要（現在 ${Math.floor(power)} / ${Math.floor(parts)}）`;
  if (action === 'mine') return 'Energy 3 が必要';
  if (action === 'grow') return `温室Lv.1 + Energy 4 + Materials 5 が必要（現在 ${Math.floor(power)} / ${Math.floor(materials)}）`;
  if (action === 'scan') return 'Energy 8 と復興出力30が必要';
  if (action === 'deploy') return `ドローン庫Lv.1 + Energy 6 + Data 2 が必要（現在 ${Math.floor(power)} / ${Math.floor(data)}）`;
  if (action === 'upgrade') return `${facilityNames[nextUpgradeFacility()]}更新にMaterials ${upgradeCost(nextUpgradeFacility())} が必要`;
  return '';
}

function applyAction(action: ActionName, actor: 'human' | 'ai'): boolean {
  if (action === 'upgrade') {
    const facility = nextUpgradeFacility();
    const success = upgradeFacility(facility, actor);
    lastAction = `${actor === 'human' ? '人間' : 'AI'} / ${facilityNames[facility]}更新`;
    actionCounts[action] += actor === 'human' ? 1 : 0;
    if (actor === 'human') ui.learned.textContent = String(samples.length);
    return success;
  }
  const powerBefore = power;
  const inputBefore = currentInput();
  const visionBefore = observeControlDeckImage();
  const workshopWasReady = storyFlags.workshop;
  const commsWasReady = storyFlags.comms;
  let result = 0;
  let success = true;
  if (action === 'generate') {
    power = clamp(power + 5, 0, powerCapacity);
    result = 5;
  } else if (action === 'charge') {
    if (!canApply('charge')) success = false;
    else { power = clamp(power + 4, 0, powerCapacity); result = 4; }
  } else if (action === 'repair') {
    if (!canApply('repair')) success = false;
    else if (facilityLevels.workshop === 0) {
      power -= 5; materials -= 4; facilityLevels.workshop = 1; facilityLevel += 1; recovery += 2; result = 2; storyFlags.workshop = true;
      addFeed('修理工房が復旧。MaterialsからPartsを加工できるようになった。', 'story');
    } else {
      power -= repairEnergyCost(); parts -= repairPartsCost(); recovery += repairYield(); result = repairYield();
    }
  } else if (action === 'mine') {
    if (power < 3) success = false;
    else { power -= 3; materials += 5; recovery += 1; result = 5; }
  } else if (action === 'grow') {
    if (!canApply('grow')) success = false;
    else { power -= 4; materials -= 5; food += 6; recovery += 2; result = 6; }
  } else if (action === 'scan') {
    if (power < 8 || recovery < 30) success = false;
    else { power -= 8; data += 3; recovery += 3; result = 3; storyFlags.comms = true; }
  } else if (action === 'deploy') {
    if (!canApply('deploy')) success = false;
    else { power -= 6; data -= 2; explore += 1; recovery += 5; result = 5; }
  }

  lastAction = `${actor === 'human' ? '人間' : 'AI'} / ${actionLabels[action]}`;
  actionCounts[action] += actor === 'human' ? 1 : 0;
  if (actor === 'human') {
    samples.push({ action, input: inputBefore, result: success ? result : -1 });
    imitationNetwork.train(inputBefore, action);
    visionPolicy.train(visionBefore, action);
    confidence = clamp(confidence + (success ? 0.045 : 0.01), 0, 1);
    ui.learned.textContent = String(samples.length);
    addFeed(success ? `人間が${actionLabels[action]}を実行 // 操作を記録` : `${actionLabels[action]}は実行できない // ${requirementFor(action)}`, 'human');
  } else {
    addFeed(success ? `AIが${actionLabels[action]}を実行 // 結果を観測` : `AIが${actionLabels[action]}を試したが、${requirementFor(action)}`, 'ai');
  }
  showNumber(success ? (action === 'generate' || action === 'charge' ? '+ENERGY' : action === 'mine' ? '+MATERIALS' : action === 'scan' ? '+DATA' : action === 'deploy' ? '+EXPLORE' : action === 'grow' ? '+FOOD' : '+RECOVERY') : 'NO POWER', actor);
  if (success && facilityLevel >= 5 && !storyFlags.core) { storyFlags.core = true; addFeed('都市中枢が覚醒。復興計画をAI自身が書き換え始める。', 'story'); }
  if (success && action === 'repair' && !workshopWasReady) addFeed('修理工房が応答した。AIの計算区画を接続可能。', 'story');
  if (success && action === 'scan' && !commsWasReady) addFeed('遠方から微弱な信号。都市の復興記録が見つかった。', 'story');
  return success;
}

function humanAction(action: ActionName): void {
  if (phase === 'autonomous') {
    phase = 'intervention';
    addFeed('人間が一時介入。AIは操作を観察している。', 'story');
  }
  const target = document.querySelector<HTMLElement>(actionTargets[action]);
  if (target) { moveCursor(target); moveRobotTo(target); }
  applyAction(action, 'human');
  aiCooldown = Math.max(aiCooldown, .8);
  updateHud();
}

function humanFacilityAction(facility: string, action: ActionName, target: HTMLElement): void {
  if (phase === 'autonomous') {
    phase = 'intervention';
    addFeed('人間が一時介入。AIは施設アクションを観察している。', 'story');
  }
  moveCursor(target);
  moveRobotTo(target);
  applyAction(action, 'human');
  aiCooldown = Math.max(aiCooldown, .8);
  updateHud();
}

function humanUpgrade(facility: string, button: HTMLElement): void {
  if (phase === 'autonomous') phase = 'intervention';
  const target = document.getElementById(facility === 'battery' ? 'battery' : facility) ?? button;
  moveCursor(target);
  moveRobotTo(target);
  upgradeFacility(facility, 'human');
  lastAction = `人間 / ${facilityNames[facility]}更新`;
  ui.learned.textContent = String(samples.length);
  updateHud();
}

function aiAction(): void {
  const action = chooseHumanLikeAction();
  const target = document.querySelector<HTMLElement>(actionTargets[action]);
  if (target) { moveCursor(target); moveRobotTo(target); }
  window.setTimeout(() => applyAction(action, 'ai'), 260);
}

function updatePhase(): void {
  if (phase === 'human' && confidence >= .22 && power >= 25) {
    phase = 'assist';
    addFeed('AI CORE ONLINE // 発電操作の補助を開始', 'story');
  }
  if ((phase === 'assist' || phase === 'intervention') && confidence >= .48 && power >= 45) {
    phase = 'autonomous';
    if (!storyFlags.autonomous) { storyFlags.autonomous = true; addFeed('自律復興プロトコル開始 // AIが自分の電力を管理する', 'story'); }
  }
  if (phase === 'autonomous' && power < 8) {
    phase = 'intervention';
    addFeed('計算電力が危険域。人間の支援を待機中。', 'story');
  }
  if (phase === 'intervention' && power >= 26 && confidence >= .48) phase = 'autonomous';
}

function update(dt: number): void {
  uptime += dt;
  pulse += dt;
  tickEconomy(dt, phase === 'assist' || phase === 'autonomous');
  ui.controlRoom.dataset.aiActive = String(phase === 'assist' || phase === 'autonomous');
  aiCooldown -= dt;
  updatePhase();
  if ((phase === 'assist' || phase === 'autonomous') && aiCooldown <= 0) {
    aiAction();
    aiCooldown = phase === 'autonomous' ? 2.2 : 3.2;
  }
  if (recovery >= 100 && pulse > 0) {
    pulse = -999;
    addFeed('都市中枢が再起動。最初の区画に灯りが戻った。', 'story');
  }
  saveTimer -= dt;
  if (saveTimer <= 0) { saveGame(); saveTimer = 5; }
  markDistricts();
  updateHud();
}

function updateHud(): void {
  ui.power.innerHTML = `${Math.round(power)} / ${Math.round(powerCapacity)} <span>+${productionRate('generator').toFixed(1)}/s</span>`;
  ui.materials.innerHTML = `${Math.floor(materials)} <span>+${productionRate('mine').toFixed(1)}/s</span>`;
  ui.parts.innerHTML = `${Math.floor(parts)} <span>+${productionRate('workshop').toFixed(1)}/s</span>`;
  ui.food.innerHTML = `${Math.floor(food)} <span>+${productionRate('hydroponics').toFixed(1)}/s</span>`;
  ui.data.innerHTML = `${Math.floor(data)} <span>+${productionRate('comms').toFixed(1)}/s</span>`;
  ui.explore.innerHTML = `${formatNumber(explore)} <span>+${productionRate('drones').toFixed(1)}/s</span>`;
  const sector = Math.floor(recovery / 100) + 1;
  ui.recovery.textContent = `S${sector} / ${formatNumber(recovery)}`;
  ui.uptime.textContent = formatTime(uptime);
  ui.confidence.textContent = `${Math.round(confidence * 100)}%`;
  ui.powerFill.style.width = `${clamp(power / Math.max(powerCapacity, 1) * 100, 0, 100)}%`;
  ui.recoveryFill.style.width = `${recovery % 100}%`;
  ui.confidenceFill.style.width = `${confidence * 100}%`;
  ui.drain.textContent = phase === 'autonomous' ? '0.85 / sec' : phase === 'assist' ? '0.30 / sec' : '0 / sec';
  ui.lastAction.textContent = lastAction;
  const facilityIds = ['generator', 'battery', 'mine', 'workshop', 'hydroponics', 'comms', 'drones'];
  facilityIds.forEach((facility) => {
    const level = document.getElementById(`level-${facility}`);
    const rate = document.getElementById(`rate-${facility}`);
    const cost = document.getElementById(`cost-${facility}`);
    const card = document.getElementById(`facility-${facility}`);
    if (level) level.textContent = `Lv.${facilityLevels[facility]}`;
    if (rate) rate.textContent = facility === 'generator' ? `Energy +${productionRate(facility).toFixed(1)}/s` : facility === 'battery' ? `Capacity +${facilityLevels.battery * 40}` : facility === 'mine' ? `Materials +${productionRate(facility).toFixed(1)}/s` : facility === 'hydroponics' ? `Food +${productionRate(facility).toFixed(1)}/s` : facility === 'comms' ? `Data +${productionRate(facility).toFixed(1)}/s` : facility === 'workshop' ? `Parts +${productionRate(facility).toFixed(1)}/s` : `Explore +${productionRate(facility).toFixed(1)}/s`;
    if (cost) cost.textContent = String(upgradeCost(facility));
    if (card) card.dataset.ready = String(facilityLevels[facility] > 0);
  });
  const next = nextUpgradeFacility();
  ui.nextNeed.textContent = facilityLevels[next] === 0
    ? `${facilityNames[next]}を更新すると、${next === 'generator' ? 'エネルギー' : next === 'mine' ? '材料' : next === 'hydroponics' ? '食料' : next === 'comms' ? 'データ' : '都市復旧'}の自動生産が始まる。`
    : `${facilityNames[next]}をLv.${facilityLevels[next] + 1}にすると、生産量が増える。必要材料: ${upgradeCost(next)}`;
  const networkPrediction = samples.length >= 4 ? imitationNetwork.predict(currentInput()) : null;
  const visionPrediction = samples.length >= 4 ? visionPolicy.predict(observeControlDeckImage()) : null;
  ui.networkConfidence.textContent = networkPrediction ? `${actionLabels[networkPrediction.action]} / ${Math.round(networkPrediction.confidence * 100)}%` : '学習中';
  ui.visionConfidence.textContent = visionPrediction ? `${actionLabels[visionPrediction.action]} / ${Math.round(visionPrediction.confidence * 100)}%` : '待機中';
  const cityMilestone = facilityLevel >= 5 ? '都市中枢の再起動' : facilityLevel >= 3 ? '外縁区画の復旧' : facilityLevel >= 1 ? '生命維持の再開' : '手動発電の確立';
  ui.milestone.textContent = `${cityMilestone} // S${currentSector()}修理 E${repairEnergyCost()} P${repairPartsCost()}`;
  const phaseText: Record<Phase, [string, string]> = {
    human: ['HUMAN BOOTSTRAP', '人間が操作中。操作データを自動収集しています。'],
    assist: ['AI ASSIST', 'AIが発電と修理をまねし始めました。'],
    autonomous: ['AUTONOMOUS', 'AIは自分で電力を発電しながら復興しています。'],
    intervention: ['HUMAN INTERVENTION', 'AIが危険域に入りました。人間の操作を待っています。'],
  };
  ui.phase.textContent = phaseText[phase][0];
  ui.phase.style.color = phase === 'autonomous' ? 'var(--green)' : phase === 'intervention' ? 'var(--red)' : 'var(--amber)';
  ui.phaseDetail.textContent = phaseText[phase][1];
  ui.hint.textContent = phase === 'human'
    ? '最初は人間が操作します。発電してAIに電力を与えてください。'
    : phase === 'autonomous'
      ? 'AIは放置中も復興を続けます。仮想マウスの動きを観察できます。'
      : 'AIが操作をまねています。異なる状況で操作すると学習データが増えます。';
}

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
  button.addEventListener('click', () => humanAction(button.dataset.action as ActionName));
});
document.querySelectorAll<HTMLElement>('[data-facility-action]').forEach((facility) => {
  facility.addEventListener('click', () => humanFacilityAction(facility.id, facility.dataset.facilityAction as ActionName, facility));
});
document.querySelectorAll<HTMLButtonElement>('[data-facility]').forEach((button) => {
  button.addEventListener('click', () => humanUpgrade(button.dataset.facility ?? 'generator', button));
});

restoreGame();
window.addEventListener('beforeunload', saveGame);
addFeed('人間の入力を待機 // 制御盤はまだ手動です', 'story');
markDistricts();
updateHud();
let previous = performance.now();
function frame(now: number): void {
  const dt = Math.min(.25, (now - previous) / 1000);
  previous = now;
  update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
