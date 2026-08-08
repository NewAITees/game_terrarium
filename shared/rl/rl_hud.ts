export type RlHudModelState = 'loading' | 'champion' | 'last-champion' | 'incompatible' | 'no-model';

export type RlHudState = {
  modelState: RlHudModelState;
  algorithm: string;
  revision: number;
  publishedAt?: string;
  trainingSteps: number;
  mode: 'training' | 'evaluation';
  action: string;
  exploratory: boolean;
  qValue?: number;
  trainerState: 'checking' | 'running' | 'stopped' | 'failed';
  intent: string;
  focus: string;
};

export type RlHud = {
  update(values: Partial<RlHudState>): void;
  watchTrainer(gameId: string): void;
  destroy(): void;
};

const DEFAULT_STATE: RlHudState = {
  modelState: 'loading',
  algorithm: 'unknown',
  revision: 0,
  trainingSteps: 0,
  mode: 'evaluation',
  action: 'WAITING',
  exploratory: false,
  trainerState: 'checking',
  intent: 'OBSERVE',
  focus: 'SCANNING',
};

export function createRlHud(label: string): RlHud {
  const root = document.createElement('section');
  root.dataset.rlHud = 'true';
  root.innerHTML = `
    <style>
      [data-rl-hud="true"]{position:fixed;left:12px;bottom:12px;z-index:9000;width:238px;padding:9px 10px;border:1px solid rgba(110,220,255,.28);border-radius:7px;background:rgba(5,12,20,.78);box-shadow:0 8px 30px rgba(0,0,0,.28);backdrop-filter:blur(5px);color:#c8dce8;font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;pointer-events:none}
      [data-rl-hud="true"] .rh-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;color:#7695a6;letter-spacing:.12em}
      [data-rl-hud="true"] .rh-status{color:#77e3a1}[data-rl-hud="true"][data-state="loading"] .rh-status{color:#ffd166}[data-rl-hud="true"][data-state="last-champion"] .rh-status,[data-rl-hud="true"][data-state="no-model"] .rh-status{color:#ffb86b}[data-rl-hud="true"][data-state="incompatible"] .rh-status{color:#ff6b7a}
      [data-rl-hud="true"] .rh-grid{display:grid;grid-template-columns:74px 1fr;gap:2px 7px}[data-rl-hud="true"] .rh-key{color:#617f90}[data-rl-hud="true"] .rh-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d9edf7}[data-rl-hud="true"] .rh-action{color:#70d9ff}[data-rl-hud="true"][data-explore="true"] .rh-action{color:#ffd166}
    </style>
    <div class="rh-head"><b>${escapeHtml(label)} · RL</b><b class="rh-status"></b></div>
    <div class="rh-grid">
      <span class="rh-key">POLICY</span><span class="rh-value rh-policy"></span>
      <span class="rh-key">TRAINER</span><span class="rh-value rh-trainer"></span>
      <span class="rh-key">MODEL</span><span class="rh-value rh-model"></span>
      <span class="rh-key">PUBLISHED</span><span class="rh-value rh-published"></span>
      <span class="rh-key">STEPS</span><span class="rh-value rh-steps"></span>
      <span class="rh-key">ACTION</span><span class="rh-value rh-action"></span>
      <span class="rh-key">VALUE</span><span class="rh-value rh-value-readout"></span>
      <span class="rh-key">INTENT</span><span class="rh-value rh-intent"></span>
      <span class="rh-key">FOCUS</span><span class="rh-value rh-focus"></span>
    </div>`;
  document.body.append(root);
  let state = { ...DEFAULT_STATE };
  let trainerTimer = 0;
  const node = (selector: string): HTMLElement => root.querySelector<HTMLElement>(selector)!;
  const render = (): void => {
    root.dataset.state = state.modelState;
    root.dataset.explore = String(state.exploratory);
    node('.rh-status').textContent = statusLabel(state.modelState);
    node('.rh-policy').textContent = `${state.algorithm} · ${state.mode.toUpperCase()}${state.exploratory ? ' · EXPLORE' : ''}`;
    node('.rh-trainer').textContent = state.trainerState.toUpperCase();
    node('.rh-model').textContent = state.revision > 0 ? `CHAMPION r${state.revision}` : '—';
    node('.rh-published').textContent = formatPublishedAt(state.publishedAt);
    node('.rh-steps').textContent = state.trainingSteps.toLocaleString();
    node('.rh-action').textContent = state.action;
    node('.rh-value-readout').textContent = state.qValue === undefined ? '—' : `Q ${state.qValue.toFixed(3)}`;
    node('.rh-intent').textContent = state.intent;
    node('.rh-focus').textContent = state.focus;
  };
  render();
  return {
    update(values) { state = { ...state, ...values }; render(); },
    watchTrainer(gameId) {
      window.clearInterval(trainerTimer);
      const refresh = async (): Promise<void> => {
        try {
          const response = await fetch(`/api/rl/trainers/${encodeURIComponent(gameId)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error('trainer status unavailable');
          const value = await response.json() as { state?: RlHudState['trainerState'] };
          state = { ...state, trainerState: value.state === 'running' || value.state === 'failed' || value.state === 'stopped' ? value.state : 'failed' };
        } catch {
          state = { ...state, trainerState: 'failed' };
        }
        render();
      };
      void refresh();
      trainerTimer = window.setInterval(() => { void refresh(); }, 2500);
    },
    destroy() { window.clearInterval(trainerTimer); root.remove(); },
  };
}

function statusLabel(state: RlHudModelState): string {
  if (state === 'champion') return 'CHAMPION LIVE';
  if (state === 'last-champion') return 'LAST CHAMPION';
  if (state === 'incompatible') return 'INCOMPATIBLE';
  if (state === 'no-model') return 'NO CHAMPION';
  return 'LOADING';
}

function formatPublishedAt(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
