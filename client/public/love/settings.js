// User preferences: defaults, persistence and change notifications.

const KEY = 'cupid.settings';
const OLD_KEYS = ['smitten.settings']; // the project's earlier name

export const DEFAULTS = {
  // Appearance
  theme: 'system',          // 'system' | 'light' | 'dark'
  editorFontSize: 13,       // px
  // Editor
  tabSize: 2,
  insertSpaces: true,
  wordWrap: false,
  lineNumbers: true,
  highlightActiveLine: true,
  closeBrackets: true,
  autocomplete: true,
  showWhitespace: false,
  autoSave: 'off',          // 'off' | 'delay' | 'blur'
  trimWhitespaceOnSave: true,
  finalNewlineOnSave: true,
  // Running
  autorun: false,
  focusGameOnRun: true,
  clearConsoleOnRun: true,
  compatCheck: true,
  scaleMode: 'fit',         // 'fit' | 'integer' | 'none'
  jit: true,
  // Console
  consoleTimestamps: false,
  consoleWrap: true,
};

let values = load();
const listeners = new Set();

function load() {
  let saved = {};
  try {
    const raw = localStorage.getItem(KEY) ?? OLD_KEYS.map((k) => localStorage.getItem(k)).find((v) => v != null);
    saved = JSON.parse(raw || '{}') || {};
  } catch { /* ignore */ }
  // Preferences from before there was a settings menu.
  const legacy = (k) => { try { const v = localStorage.getItem(k); return v === null ? undefined : JSON.parse(v); } catch { return localStorage.getItem(k); } };
  const migrated = {};
  if (saved.theme === undefined && ['light', 'dark'].includes(legacy('lws.theme'))) migrated.theme = legacy('lws.theme');
  if (saved.autorun === undefined && typeof legacy('lws.autorun') === 'boolean') migrated.autorun = legacy('lws.autorun');
  if (saved.clearConsoleOnRun === undefined && typeof legacy('lws.clearOnRun') === 'boolean') migrated.clearConsoleOnRun = legacy('lws.clearOnRun');
  const v = { ...DEFAULTS, ...migrated };
  for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) v[k] = saved[k];
  return v;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* ignore */ }
}

export const settings = {
  get(key) { return values[key]; },
  all() { return { ...values }; },
  set(key, value) {
    if (!(key in DEFAULTS) || values[key] === value) return;
    values[key] = value;
    persist();
    for (const fn of listeners) fn(key, value);
  },
  reset() {
    const old = values;
    values = { ...DEFAULTS };
    persist();
    for (const k of Object.keys(DEFAULTS)) if (old[k] !== values[k]) for (const fn of listeners) fn(k, values[k]);
  },
  /** fn(key, value) runs after every change. Returns an unsubscribe function. */
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

// ---------------------------------------------------------------------------
// Theme

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function resolvedTheme() {
  const t = values.theme;
  return t === 'system' ? (darkQuery.matches ? 'dark' : 'light') : t;
}

export function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
}

darkQuery.addEventListener('change', () => { if (values.theme === 'system') applyTheme(); });
settings.onChange((key) => { if (key === 'theme') applyTheme(); });
