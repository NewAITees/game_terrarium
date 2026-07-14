import type {
  PlanetStrategyHudEmpireRow,
  PlanetStrategyHudScoreRow,
  PlanetStrategyHudView,
  PlanetStrategyLogType,
  PlanetStrategyUi,
} from '../../shared/types/planet_strategy.js';

export function createPlanetStrategyUi(): PlanetStrategyUi {
  const empireColors = new Map<string, string>([
    ['Aster Union', '#7de8ff'],
    ['Red Meridian', '#ff9f80'],
    ['Verdant Ring', '#c8ff8a'],
  ]);
  const el = {
    elapsed: document.getElementById('elapsed'),
    planets: document.getElementById('planets'),
    ships: document.getElementById('ships'),
    mined: document.getElementById('mined'),
    moved: document.getElementById('moved'),
    kills: document.getElementById('kills'),
    summaryText: document.getElementById('summary-text'),
    summaryDetail: document.getElementById('summary-detail'),
    busiestRoute: document.getElementById('busiest-route'),
    phaseLine: document.getElementById('phase-line'),
    winnerLine: document.getElementById('winner-line'),
    statusDetail: document.getElementById('status-detail'),
    scoreList: document.getElementById('score-list'),
    finalHeadline: document.getElementById('final-headline'),
    finalDetail: document.getElementById('final-detail'),
    finalMeta: document.getElementById('final-meta'),
    empireList: document.getElementById('empire-list'),
    nextWatchHeadline: document.getElementById('next-watch-headline'),
    nextWatchDetail: document.getElementById('next-watch-detail'),
    causalFeed: document.getElementById('causal-feed'),
    sectorTimeline: document.getElementById('sector-timeline'),
    logEntries: document.getElementById('log-entries'),
    resourceBurstBtn: document.getElementById('resource-burst-btn'),
    panicRepairBtn: document.getElementById('panic-repair-btn'),
    routeJamBtn: document.getElementById('route-jam-btn'),
    nextCycleBtn: document.getElementById('next-cycle-btn'),
    autoRunBtn: document.getElementById('auto-run-btn'),
    cycleLabel: document.getElementById('cycle-label'),
    doctrineList: document.getElementById('doctrine-list'),
    historyList: document.getElementById('history-list'),
    analysisVictory: document.getElementById('analysis-victory'),
    analysisDefeat: document.getElementById('analysis-defeat'),
    analysisMutation: document.getElementById('analysis-mutation'),
    observationMeta: document.getElementById('observation-meta'),
    worldModifier: document.getElementById('world-modifier'),
    turningPointList: document.getElementById('turning-point-list'),
    scoreTrend: document.getElementById('score-trend'),
    uiScaleBtn: document.getElementById('ui-scale-btn'),
    lowFpsBtn: document.getElementById('low-fps-btn'),
    worldModeBtn: document.getElementById('world-mode-btn'),
    worldSelectBtn: document.getElementById('world-select-btn'),
    cycleLimitBtn: document.getElementById('cycle-limit-btn'),
    setupMeta: document.getElementById('setup-meta'),
    lineageList: document.getElementById('lineage-list'),
  };
  const uiState = {
    firstStalledFactory: null,
    timelineEntries: [] as string[],
  };

  el.resourceBurstBtn?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('planet-strategy-intervention', { detail: { type: 'resource_burst' } }));
  });
  el.panicRepairBtn?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('planet-strategy-intervention', { detail: { type: 'panic_repair' } }));
  });
  el.routeJamBtn?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('planet-strategy-intervention', { detail: { type: 'route_jam' } }));
  });
  let uiScale = Number(localStorage.getItem('planet-strategy-ui-scale') ?? '1');
  let lowFps = localStorage.getItem('planet-strategy-low-fps') === 'true';
  function applySettings() {
    document.documentElement.style.setProperty('--planet-ui-scale', String(uiScale));
    if (el.uiScaleBtn) el.uiScaleBtn.textContent = `UI Scale: ${Math.round(uiScale * 100)}%`;
    if (el.lowFpsBtn) el.lowFpsBtn.textContent = `Low FPS: ${lowFps ? 'On' : 'Off'}`;
    window.dispatchEvent(new CustomEvent('planet-strategy-render-settings', { detail: { lowFps } }));
  }
  el.uiScaleBtn?.addEventListener('click', () => { uiScale = uiScale >= 1.2 ? 0.85 : uiScale + 0.05; localStorage.setItem('planet-strategy-ui-scale', String(uiScale)); applySettings(); });
  el.lowFpsBtn?.addEventListener('click', () => { lowFps = !lowFps; localStorage.setItem('planet-strategy-low-fps', String(lowFps)); applySettings(); });
  applySettings();
  el.nextCycleBtn?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('planet-strategy-next-cycle')));
  el.autoRunBtn?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('planet-strategy-toggle-auto-run')));
  el.worldModeBtn?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('planet-strategy-cycle-world-mode')));
  el.worldSelectBtn?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('planet-strategy-cycle-world')));
  el.cycleLimitBtn?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('planet-strategy-cycle-limit')));

  function update(view: PlanetStrategyHudView): void {
    if (el.elapsed) el.elapsed.textContent = String(view.elapsed ?? '');
    if (el.planets) el.planets.textContent = String(view.planets ?? '');
    if (el.ships) el.ships.textContent = String(view.ships ?? '');
    if (el.mined) el.mined.textContent = String(view.mined ?? '');
    if (el.moved) el.moved.textContent = String(view.moved ?? '');
    if (el.kills) el.kills.textContent = String(view.kills ?? '');
    if (el.summaryText) el.summaryText.textContent = view.summaryText ?? '';
    if (el.summaryDetail) el.summaryDetail.textContent = view.summaryDetail ?? '';
    if (el.busiestRoute) el.busiestRoute.textContent = view.busiestRoute ?? '';
    if (el.phaseLine) el.phaseLine.textContent = view.phaseLine ?? '';
    if (el.winnerLine) el.winnerLine.textContent = view.winnerLine ?? '';
    if (el.statusDetail) el.statusDetail.textContent = view.statusDetail ?? '';
    if (el.cycleLabel) el.cycleLabel.textContent = `Cycle ${view.cycleNumber ?? 1}${view.autoRun ? ' · auto' : ''}`;
    if (el.autoRunBtn) el.autoRunBtn.textContent = view.autoRun ? 'Auto Run: On' : 'Auto Run: Off';
    if (el.analysisVictory) el.analysisVictory.textContent = view.analysis?.victory ?? 'Finish a cycle to identify the winner\'s advantage.';
    if (el.analysisDefeat) el.analysisDefeat.textContent = view.analysis?.defeat ?? 'Defeat causes will appear here.';
    if (el.analysisMutation) el.analysisMutation.textContent = view.analysis?.mutation ?? 'Doctrine changes are applied between cycles.';
    if (el.observationMeta) el.observationMeta.textContent = `${view.observatory?.points ?? 0} Observation Points · ${view.observatory?.charges ?? 2}/2 interventions`;
    if (el.worldModifier) el.worldModifier.textContent = view.observatory?.world ?? 'Standard sector';
    if (el.setupMeta) el.setupMeta.textContent = view.observatory?.setup ?? '';
    if (el.lineageList) el.lineageList.innerHTML = (view.observatory?.lineage ?? []).map((lineage) => `<div class="history-row">${lineage}</div>`).join('');
    if (el.turningPointList) el.turningPointList.innerHTML = (view.observatory?.turningPoints ?? []).map((point) => `<div class="history-row">${point}</div>`).join('') || '<div class="feed-empty">Telemetry samples every 10 seconds.</div>';
    renderScoreTrend(view.scoreTrend ?? []);
    if (el.finalHeadline) el.finalHeadline.textContent = buildHeadline(view);
    if (el.finalDetail) el.finalDetail.textContent = buildDetail(view);
    if (el.finalMeta) el.finalMeta.textContent = buildMeta(view);
    if (el.nextWatchHeadline) el.nextWatchHeadline.textContent = view.nextWatch?.headline ?? 'Next Watch: logistics race';
    if (el.nextWatchDetail) el.nextWatchDetail.textContent = view.nextWatch?.detail ?? 'No immediate collapse is visible. Watch the next fleet and ore lane.';
    renderCausalFeed(view);
    if (el.scoreList) {
      el.scoreList.innerHTML = (view.scoreRows ?? []).map((score: PlanetStrategyHudScoreRow) => [
        '<div class="score-row">',
        `<div class="score-name">${score.name}${score.collapsed ? ' [collapsed]' : ''}</div>`,
        `<div class="score-value">${score.value}</div>`,
        '</div>',
      ].join('')).join('');
    }
    if (el.empireList) {
      el.empireList.innerHTML = (view.empireRows ?? []).map((empire: PlanetStrategyHudEmpireRow) => [
        '<div class="empire-row">',
        `<div class="empire-dot" style="background:${empire.color}"></div>`,
        `<div class="empire-meta"><div class="empire-name">${empire.name}</div><div class="empire-intent">${empire.intent}</div></div>`,
        `<div class="empire-numbers">${empire.numbers}</div>`,
        '</div>',
      ].join('')).join('');
    }
    if (el.doctrineList) el.doctrineList.innerHTML = (view.doctrineRows ?? []).map((row) =>
      `<div class="doctrine-row"><span>${row.name} G${row.generation}</span><span>${row.summary}</span></div>`
    ).join('');
    if (el.historyList) el.historyList.innerHTML = (view.historyRows ?? []).map((row) =>
      `<div class="history-row">C${row.cycleNumber}: ${row.winnerName ?? 'No winner'} — ${row.detail}</div>`
    ).join('') || '<div class="feed-empty">No completed cycles yet.</div>';
  }

  function renderScoreTrend(series: NonNullable<PlanetStrategyHudView['scoreTrend']>): void {
    if (!el.scoreTrend) return;
    const max = Math.max(1, ...series.flatMap((entry) => entry.values));
    const paths = series.map((entry) => {
      const values = entry.values.length ? entry.values : [0];
      const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * 100},${34 - value / max * 30}`).join(' ');
      return `<polyline points="${points}" fill="none" stroke="${entry.color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
    }).join('');
    el.scoreTrend.innerHTML = `<svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-label="Victory score trend">${paths}</svg>`;
  }

  function log(text: string, type: PlanetStrategyLogType): void {
    if (!el.logEntries) return;
    if (!uiState.firstStalledFactory && /factory stalling for ore/i.test(text)) {
      const match = text.match(/\]\s(.+?) factory stalling for ore/i);
      uiState.firstStalledFactory = match?.[1] ?? 'Unknown factory';
    }
    const div = document.createElement('div');
    div.className = `le le-${type}`;
    const matchedColor = pickEmpireColor(text, empireColors);
    if (matchedColor) {
      div.style.color = matchedColor;
      div.style.textShadow = `0 0 10px ${matchedColor}33`;
    } else {
      div.textContent = text;
    }
    if (matchedColor) appendColoredText(div, text, empireColors);
    el.logEntries.appendChild(div);
    while (el.logEntries.children.length > 220) el.logEntries.removeChild(el.logEntries.firstChild);
    el.logEntries.scrollTop = el.logEntries.scrollHeight;

    if (isTimelineEvent(text)) {
      uiState.timelineEntries.unshift(text);
      uiState.timelineEntries = uiState.timelineEntries.slice(0, 8);
      renderSectorTimeline();
    }
  }

  function renderCausalFeed(view: PlanetStrategyHudView): void {
    if (!el.causalFeed) return;
    el.causalFeed.replaceChildren();
    const cards = view.causal ?? [];
    if (!cards.length) {
      const empty = document.createElement('div');
      empty.className = 'feed-empty';
      empty.textContent = 'No critical chain is visible yet.';
      el.causalFeed.appendChild(empty);
      return;
    }
    for (const card of cards) {
      const entry = document.createElement('div');
      entry.className = 'causal-card';
      for (const [label, text] of [['Cause', card.cause], ['Impact', card.impact], ['Risk', card.risk]] as const) {
        const line = document.createElement('div');
        line.className = 'causal-line';
        line.textContent = `${label}: ${text}`;
        entry.appendChild(line);
      }
      el.causalFeed.appendChild(entry);
    }
  }

  function isTimelineEvent(text: string): boolean {
    return /launches \d+ attackers|captured .+ from |factory stalling for ore|recovered from ore starvation|collapsed after it |ore veins exhausted/i.test(text);
  }

  function renderSectorTimeline(): void {
    if (!el.sectorTimeline) return;
    el.sectorTimeline.replaceChildren();
    if (!uiState.timelineEntries.length) {
      const empty = document.createElement('div');
      empty.className = 'feed-empty';
      empty.textContent = 'No sector turning points yet.';
      el.sectorTimeline.appendChild(empty);
      return;
    }
    for (const text of uiState.timelineEntries) {
      const entry = document.createElement('div');
      entry.className = 'timeline-entry';
      entry.textContent = text;
      el.sectorTimeline.appendChild(entry);
    }
  }

  function buildHeadline(view: PlanetStrategyHudView): string {
    if (view.gameOver && view.winnerName) {
      return `${view.winnerName} closed the match by outlasting the other sectors.`;
    }
    if (view.topDeliveryEmpire) {
      return `${view.topDeliveryEmpire} is moving the most ore through the sector.`;
    }
    return 'Watching early logistics spread across the sector.';
  }

  function buildDetail(view: PlanetStrategyHudView): string {
    if (view.gameOver && view.summaryDetail) return view.summaryDetail;
    if (uiState.firstStalledFactory) {
      return `${uiState.firstStalledFactory} was the first factory to stall under pressure.`;
    }
    return 'No final result yet.';
  }

  function buildMeta(view: PlanetStrategyHudView): string {
    const parts = [];
    if (view.busiestRouteLabel) parts.push(`Busiest: ${view.busiestRouteLabel}`);
    if (typeof view.depletedCount === 'number') parts.push(`Depleted: ${view.depletedCount}`);
    if (view.topDeliveryEmpire) parts.push(`Top delivery: ${view.topDeliveryEmpire}`);
    return parts.join(' / ') || 'Waiting for more movement.';
  }

  function pickEmpireColor(text: string, colors: Map<string, string>): string | null {
    for (const [name, color] of colors) {
      if (text.includes(name)) return color;
    }
    return null;
  }

  function appendColoredText(container: HTMLDivElement, text: string, colors: Map<string, string>): void {
    const names = Array.from(colors.keys()).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g');
    let lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue;
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const name = match[0];
      const span = document.createElement('span');
      span.style.color = colors.get(name) ?? '';
      span.textContent = name;
      container.appendChild(span);
      lastIndex = match.index + name.length;
    }
    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return { update, log };
}
