export function appendLogPanelEntry(context: {
  containerId?: string;
  text: string;
  type?: string;
  elapsedSeconds: number;
  maxEntries?: number;
  formatPrefix?: (elapsedSeconds: number) => string;
}): void {
  const el = document.getElementById(context.containerId ?? 'log-entries');
  if (!el) return;
  const div = document.createElement('div');
  div.className = `le le-${context.type ?? 'info'}`;
  const prefix = context.formatPrefix ? context.formatPrefix(context.elapsedSeconds) : formatMinuteSecondPrefix(context.elapsedSeconds);
  div.textContent = `${prefix} ${context.text}`;
  el.appendChild(div);
  while (el.children.length > (context.maxEntries ?? 400)) {
    el.removeChild(el.firstChild as Node);
  }
  el.scrollTop = el.scrollHeight;
}

export function formatMinuteSecondPrefix(elapsedSeconds: number): string {
  const time = Math.floor(elapsedSeconds);
  const mm = String(Math.floor(time / 60)).padStart(2, '0');
  const ss = String(time % 60).padStart(2, '0');
  return `[${mm}:${ss}]`;
}

export function formatPaddedSecondPrefix(elapsedSeconds: number): string {
  return `[${String(Math.floor(elapsedSeconds)).padStart(4)}s]`;
}
