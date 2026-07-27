type ActionName = 'generate' | 'repair' | 'mine' | 'scan' | 'upgrade';
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
  readonly outputSize = 5;
  readonly actions: ActionName[] = ['generate', 'repair', 'mine', 'scan', 'upgrade'];
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
  networkConfidence: $('network-confidence'), milestone: $('milestone'), materials: $('materials'), food: $('food'), data: $('data'),
  nextNeed: $('next-need-text'),
};

const actionLabels: Record<ActionName, string> = { generate: '発電', repair: '修理', mine: '採掘', scan: '通信探索', upgrade: '設備更新' };
const actionTargets: Record<ActionName, string> = {
  generate: '[data-action="generate"]', repair: '[data-action="repair"]',
  mine: '[data-action="mine"]', scan: '[data-action="scan"]', upgrade: '[data-action="upgrade"]',
};
const samples: LearningSample[] = [];
const actionCounts: Record<ActionName, number> = { generate: 0, repair: 0, mine: 0, scan: 0, upgrade: 0 };
const imitationNetwork = new ImitationNetwork();
let power = 12;
let materials = 8;
let food = 0;
let data = 0;
let recovery = 0;
let parts = 8;
let uptime = 0;
let phase: Phase = 'human';
let confidence = 0;
let lastAction = '—';
let aiCooldown = 0;
let pulse = 0;
let storyFlags = { workshop: false, comms: false, hydroponics: false, drones: false, core: false, autonomous: false };
let facilityLevel = 0;
const facilityLevels: Record<string, number> = { generator: 0, mine: 0, workshop: 0, hydroponics: 0, comms: 0, drones: 0 };
const facilityNames: Record<string, string> = { generator: '発電区画', mine: '採掘場', workshop: '修理工房', hydroponics: '温室区画', comms: '通信塔', drones: 'ドローン庫' };
const facilityCosts: Record<string, number> = { generator: 10, mine: 15, workshop: 20, hydroponics: 30, comms: 45, drones: 80 };

function productionRate(facility: string): number {
  return facilityLevels[facility] * (facility === 'generator' ? 1.2 : facility === 'mine' ? .65 : facility === 'hydroponics' ? .35 : facility === 'comms' ? .18 : facility === 'drones' ? .12 : .2);
}

function upgradeCost(facility: string): number { return Math.ceil(facilityCosts[facility] * (1.15 ** facilityLevels[facility])); }

function nextUpgradeFacility(): string {
  const order = ['generator', 'mine', 'workshop', 'hydroponics', 'comms', 'drones'];
  return order.find(facility => facilityLevels[facility] === 0) ?? order.reduce((best, facility) => upgradeCost(facility) < upgradeCost(best) ? facility : best, order[0]);
}

function currentInput(): number[] {
  return [power / 100, recovery / 100, clamp(parts / 40, 0, 1), Number(storyFlags.workshop), Number(storyFlags.comms), Number(storyFlags.hydroponics), Number(storyFlags.drones), facilityLevel / 5];
}

function addFeed(message: string, kind: 'human' | 'ai' | 'story' = 'ai'): void {
  const item = document.createElement('div');
  item.className = `event-${kind}`;
  item.textContent = `${formatTime(uptime)}  ${message}`;
  ui.feed.prepend(item);
  while (ui.feed.children.length > 28) ui.feed.lastElementChild?.remove();
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

function markDistricts(): void {
  ui.generator.dataset.on = String(power > 0);
  ui.battery.dataset.on = String(power >= 18);
  ui.workshop.dataset.on = String(storyFlags.workshop);
  ui.comms.dataset.on = String(storyFlags.comms);
  ui.hydroponics.dataset.on = String(storyFlags.hydroponics);
  ui.mine.dataset.on = String(storyFlags.workshop);
  ui.drones.dataset.on = String(storyFlags.drones);
  ui.core.dataset.on = String(storyFlags.core);
  ui.generatorState.textContent = power > 0 ? 'ONLINE' : 'OFFLINE';
  ui.batteryState.textContent = `${Math.round(power)}%`; 
  ui.workshopState.textContent = storyFlags.workshop ? 'READY' : 'DAMAGED';
  ui.commsState.textContent = storyFlags.comms ? 'SIGNAL FOUND' : 'SILENT';
  ui.hydroponicsState.textContent = storyFlags.hydroponics ? 'GROWING' : 'DORMANT';
  ui.mineState.textContent = storyFlags.workshop ? `${parts} PARTS` : 'LOCKED';
  ui.dronesState.textContent = storyFlags.drones ? 'PATROLLING' : 'OFFLINE';
  ui.coreState.textContent = storyFlags.core ? 'AWAKE' : 'SLEEPING';
}

function moveCursor(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  ui.cursor.style.left = `${rect.left + rect.width / 2}px`;
  ui.cursor.style.top = `${rect.top + rect.height / 2}px`;
}

function chooseHumanLikeAction(): ActionName {
  if (power < 20) return 'generate';
  const prediction = samples.length >= 4 ? imitationNetwork.predict(currentInput()) : null;
  if (prediction && prediction.confidence >= .34 && canApply(prediction.action)) return prediction.action;
  if (!storyFlags.workshop && parts >= 4 && power >= 5) return 'repair';
  if (recovery < 34 && power >= 3) return 'mine';
  if (!storyFlags.comms && recovery >= 34 && power >= 8) return 'scan';
  if (storyFlags.comms && facilityLevel < 5 && power >= 12) return 'upgrade';
  return 'generate';
}

function canApply(action: ActionName): boolean {
  if (action === 'generate') return true;
  if (action === 'repair') return power >= 5 && parts >= 4;
  if (action === 'mine') return power >= 3;
  if (action === 'scan') return power >= 8 && recovery >= 30;
  return power >= 12 && parts >= 8 && facilityLevel < 5;
}

function applyAction(action: ActionName, actor: 'human' | 'ai'): boolean {
  const powerBefore = power;
  const recoveryBefore = recovery;
  const inputBefore = currentInput();
  const workshopWasReady = storyFlags.workshop;
  const commsWasReady = storyFlags.comms;
  let result = 0;
  let success = true;
  if (action === 'generate') {
    power = clamp(power + 7, 0, 100);
    result = 7;
  } else if (action === 'repair') {
    if (power < 5 || parts < 4) success = false;
    else { power -= 5; parts -= 4; recovery = clamp(recovery + 12, 0, 100); result = 12; storyFlags.workshop = true; }
  } else if (action === 'mine') {
    if (power < 3) success = false;
    else { power -= 3; parts += 5; recovery = clamp(recovery + 6, 0, 100); result = 6; }
  } else if (action === 'scan') {
    if (power < 8 || recovery < 30) success = false;
    else { power -= 8; recovery = clamp(recovery + 20, 0, 100); result = 20; storyFlags.comms = true; }
  } else if (action === 'upgrade') {
    if (power < 12 || parts < 8 || facilityLevel >= 5) success = false;
    else { power -= 12; parts -= 8; facilityLevel += 1; recovery = clamp(recovery + 4, 0, 100); result = 4; }
  }

  lastAction = `${actor === 'human' ? '人間' : 'AI'} / ${actionLabels[action]}`;
  actionCounts[action] += actor === 'human' ? 1 : 0;
  if (actor === 'human') {
    samples.push({ action, input: inputBefore, result: success ? result : -1 });
    imitationNetwork.train(inputBefore, action);
    confidence = clamp(confidence + (success ? 0.045 : 0.01), 0, 1);
    ui.learned.textContent = String(samples.length);
    addFeed(success ? `人間が${actionLabels[action]}を実行 // 操作を記録` : `人間の操作は電力不足 // 失敗も記録`, 'human');
  } else {
    addFeed(success ? `AIが${actionLabels[action]}を実行 // 結果を観測` : `AIが${actionLabels[action]}を試したが、資源不足`, 'ai');
  }
  if (success && facilityLevel >= 1 && !storyFlags.hydroponics) { storyFlags.hydroponics = true; addFeed('温室区画が復旧。放置中も都市の生命維持が進む。', 'story'); }
  if (success && facilityLevel >= 2 && !storyFlags.drones) { storyFlags.drones = true; addFeed('探索ドローン格納庫が開いた。AIの視界が都市の外へ広がる。', 'story'); }
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
  if (target) moveCursor(target);
  applyAction(action, 'human');
  aiCooldown = Math.max(aiCooldown, .8);
  updateHud();
}

function aiAction(): void {
  const action = chooseHumanLikeAction();
  const target = document.querySelector<HTMLElement>(actionTargets[action]);
  if (target) moveCursor(target);
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
  if (phase === 'assist' || phase === 'autonomous') {
    power = clamp(power - dt * (phase === 'autonomous' ? .85 : .3), 0, 100);
    recovery = clamp(recovery + dt * (phase === 'autonomous' ? .11 : .03), 0, 100);
  }
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
  markDistricts();
  updateHud();
}

function updateHud(): void {
  ui.power.textContent = `${Math.round(power)} / 100`;
  ui.recovery.textContent = `${Math.round(recovery)}%`;
  ui.uptime.textContent = formatTime(uptime);
  ui.confidence.textContent = `${Math.round(confidence * 100)}%`;
  ui.powerFill.style.width = `${power}%`;
  ui.recoveryFill.style.width = `${recovery}%`;
  ui.confidenceFill.style.width = `${confidence * 100}%`;
  ui.drain.textContent = phase === 'autonomous' ? '0.85 / sec' : phase === 'assist' ? '0.30 / sec' : '0 / sec';
  ui.lastAction.textContent = lastAction;
  const networkPrediction = samples.length >= 4 ? imitationNetwork.predict(currentInput()) : null;
  ui.networkConfidence.textContent = networkPrediction ? `${actionLabels[networkPrediction.action]} / ${Math.round(networkPrediction.confidence * 100)}%` : '学習中';
  ui.milestone.textContent = facilityLevel >= 5 ? '都市中枢の再起動' : facilityLevel >= 3 ? '外縁区画の復旧' : facilityLevel >= 1 ? '生命維持の再開' : '手動発電の確立';
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
