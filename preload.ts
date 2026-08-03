import { ipcRenderer } from 'electron';

/**
 * Page switcher overlay, injected into every page by the main process.
 *
 * The registry outgrew the Ctrl+0-9 range, so the digit accelerators alone no
 * longer reach every experience. This palette is the one switching route that
 * works from any page, and it lives here rather than in the pages themselves so
 * that no experience has to carry navigation code.
 */

type PaletteEntry = {
  key: string;
  label: string;
  shortcut: string;
};

const OVERLAY_ID = 'terrarium-page-palette';

let entries: PaletteEntry[] = [];
let currentPage = '';
let visible = false;
let highlighted = 0;
let root: HTMLDivElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLDivElement | null = null;

function matches(entry: PaletteEntry, query: string): boolean {
  if (!query) return true;
  const haystack = `${entry.label} ${entry.key}`.toLowerCase();
  // Subsequence match so "psg" finds "Planet Strategy" without exact spelling.
  let cursor = 0;
  for (const character of query.toLowerCase()) {
    if (character === ' ') continue;
    cursor = haystack.indexOf(character, cursor) + 1;
    if (cursor === 0) return false;
  }
  return true;
}

function visibleEntries(): PaletteEntry[] {
  return entries.filter((entry) => matches(entry, input?.value ?? ''));
}

function renderList(): void {
  if (!list) return;
  const shown = visibleEntries();
  highlighted = Math.max(0, Math.min(highlighted, shown.length - 1));
  list.textContent = '';
  shown.forEach((entry, index) => {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:12px',
      'padding:9px 14px',
      'border-radius:7px',
      'cursor:pointer',
      'font-size:14px',
      'line-height:1.3',
      index === highlighted ? 'background:#1d4e63' : 'background:transparent',
    ].join(';');

    const dot = document.createElement('span');
    dot.textContent = entry.key === currentPage ? '●' : '○';
    dot.style.cssText = `color:${entry.key === currentPage ? '#5fd3f3' : '#3d4a56'};font-size:11px`;

    const name = document.createElement('span');
    name.textContent = entry.label;
    name.style.cssText = 'flex:1;color:#e8f2f7';

    const hint = document.createElement('span');
    hint.textContent = entry.shortcut;
    hint.style.cssText = 'color:#7b8b99;font-size:12px;font-variant-numeric:tabular-nums';

    row.append(dot, name, hint);
    row.addEventListener('mouseenter', () => {
      highlighted = index;
      renderList();
    });
    row.addEventListener('mousedown', (event) => {
      event.preventDefault();
      choose(entry);
    });
    list.append(row);
  });

  if (!shown.length) {
    const empty = document.createElement('div');
    empty.textContent = 'No matching page';
    empty.style.cssText = 'padding:9px 14px;color:#6b7b89;font-size:14px';
    list.append(empty);
  }
}

function build(): void {
  root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:none',
    'align-items:flex-start',
    'justify-content:center',
    'padding-top:12vh',
    'background:rgba(4,10,16,0.62)',
    'backdrop-filter:blur(3px)',
    'font-family:system-ui,-apple-system,"Segoe UI",sans-serif',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'width:min(520px,86vw)',
    'max-height:70vh',
    'display:flex',
    'flex-direction:column',
    'background:#0d1620',
    'border:1px solid #24333f',
    'border-radius:12px',
    'box-shadow:0 18px 50px rgba(0,0,0,0.55)',
    'overflow:hidden',
  ].join(';');

  input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Switch page…';
  input.style.cssText = [
    'padding:14px 16px',
    'border:0',
    'border-bottom:1px solid #24333f',
    'background:transparent',
    'color:#e8f2f7',
    'font-size:15px',
    'outline:none',
    'font-family:inherit',
  ].join(';');
  input.addEventListener('input', () => {
    highlighted = 0;
    renderList();
  });

  list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;padding:6px';

  panel.append(input, list);
  root.append(panel);
  root.addEventListener('mousedown', (event) => {
    if (event.target === root) close();
  });
  document.body.append(root);
}

function choose(entry: PaletteEntry): void {
  close();
  ipcRenderer.send('terrarium:switch-page', entry.key);
}

function open(): void {
  if (!root || !input) return;
  visible = true;
  input.value = '';
  highlighted = Math.max(0, entries.findIndex((entry) => entry.key === currentPage));
  root.style.display = 'flex';
  renderList();
  input.focus();
}

function close(): void {
  if (!root) return;
  visible = false;
  root.style.display = 'none';
  // Games listen on window/document, so hand focus back to the page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function onKeyDown(event: KeyboardEvent): void {
  const toggleModifier = process.platform === 'darwin' ? event.metaKey : event.ctrlKey;
  if (toggleModifier && !event.altKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    event.stopImmediatePropagation();
    visible ? close() : open();
    return;
  }
  if (!visible) return;

  // While open, the palette owns the keyboard; the page must not also react.
  event.stopImmediatePropagation();

  const shown = visibleEntries();
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    highlighted = shown.length ? (highlighted + 1) % shown.length : 0;
    renderList();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlighted = shown.length ? (highlighted - 1 + shown.length) % shown.length : 0;
    renderList();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    if (shown[highlighted]) choose(shown[highlighted]);
  }
}

async function install(): Promise<void> {
  try {
    const payload = await ipcRenderer.invoke('terrarium:pages') as {
      pages: PaletteEntry[];
      currentPage: string;
    };
    entries = payload.pages;
    currentPage = payload.currentPage;
  } catch {
    return;
  }
  build();
  // Capture phase keeps the palette reachable even from pages that swallow keys.
  window.addEventListener('keydown', onKeyDown, true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void install(), { once: true });
} else {
  void install();
}
