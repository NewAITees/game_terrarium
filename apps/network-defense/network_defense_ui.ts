import type {
  NetworkDefenseObserverHotspot,
  NetworkDefenseObserverHudState,
  NetworkDefenseObserverSnapshot,
} from '../../shared/types/network_defense.js';

export function createObservationUi({
  onToggleLowLoadMode,
  onIntervenePulse,
  onInterveneBreach,
}: {
  onToggleLowLoadMode: () => void;
  onIntervenePulse: () => void;
  onInterveneBreach: () => void;
}) {
  const elements = {
    observerMode: document.getElementById('observer-mode'),
    observerModeState: document.getElementById('observer-mode-state'),
    eventName: document.getElementById('observer-event-name'),
    eventDetail: document.getElementById('observer-event-detail'),
    summaryText: document.getElementById('observer-summary-text'),
    summaryDetail: document.getElementById('observer-summary-detail'),
    hotspotList: document.getElementById('observer-hotspot-list'),
    pulseButton: document.getElementById('observer-pulse'),
    breachButton: document.getElementById('observer-breach'),
    rankRows: {
      senior: document.getElementById('observer-rank-senior'),
      mid: document.getElementById('observer-rank-mid'),
      junior: document.getElementById('observer-rank-junior'),
    },
  };

  elements.observerMode?.addEventListener('click', () => onToggleLowLoadMode());
  elements.pulseButton?.addEventListener('click', () => onIntervenePulse());
  elements.breachButton?.addEventListener('click', () => onInterveneBreach());

  function renderRankRow(entry: NetworkDefenseObserverSnapshot) {
    const row = elements.rankRows[entry.rank];
    if (!row) return;
    row.innerHTML =
      `<strong>${entry.rank}</strong>` +
      `<span>${entry.personality}</span>` +
      `<em>${entry.intent}</em>`;
    row.title = entry.summary;
  }

  function renderHotspots(hotspots: NetworkDefenseObserverHotspot[]) {
    if (!elements.hotspotList) return;
    elements.hotspotList.innerHTML = hotspots.length
      ? hotspots.map((entry) => `<div class="hotspot-item"><span>${entry.label}</span><span>${entry.value}</span></div>`).join('')
      : '<div class="hotspot-item"><span>stable grid</span><span>low</span></div>';
  }

  function update({ lowLoadMode, eventState, rankSnapshots, summary, hotspots }: NetworkDefenseObserverHudState) {
    if (elements.observerModeState) {
      elements.observerModeState.textContent = lowLoadMode ? 'low-load active' : 'full observation';
    }
    if (elements.observerMode) {
      elements.observerMode.classList.toggle('active', lowLoadMode);
    }
    if (elements.eventName) elements.eventName.textContent = eventState.label;
    if (elements.eventDetail) elements.eventDetail.textContent = eventState.detail;
    if (elements.summaryText) elements.summaryText.textContent = summary.text;
    if (elements.summaryDetail) elements.summaryDetail.textContent = summary.detail;
    renderHotspots(hotspots);
    for (const entry of rankSnapshots) renderRankRow(entry);
  }

  return { update };
}
