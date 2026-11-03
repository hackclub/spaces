// The settings dialog: sections on the left, rows of label + control on
// the right, and a search box that filters rows across all sections.

import { h, icon, openDialog, confirmDialog } from './ui.js';
import { settings } from './settings.js';

function switchControl(key) {
  const btn = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(settings.get(key)) });
  btn.addEventListener('click', () => settings.set(key, !settings.get(key)));
  return { el: btn, sync: () => btn.setAttribute('aria-checked', String(settings.get(key))) };
}

function selectControl(key, options) {
  const sel = h('select', { class: 'select' }, ...options.map(([value, label]) => h('option', { value: String(value) }, label)));
  sel.value = String(settings.get(key));
  sel.addEventListener('change', () => {
    const v = options.find(([value]) => String(value) === sel.value)?.[0];
    settings.set(key, v);
  });
  return { el: sel, sync: () => { sel.value = String(settings.get(key)); } };
}

function segmentedControl(key, options) {
  const wrap = h('div', { class: 'segmented', role: 'group' });
  const buttons = options.map(([value, label, iconName]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(settings.get(key) === value) }, iconName ? icon(iconName, 14) : null, label);
    b.addEventListener('click', () => settings.set(key, value));
    wrap.append(b);
    return [value, b];
  });
  return { el: wrap, sync: () => { for (const [value, b] of buttons) b.setAttribute('aria-pressed', String(settings.get(key) === value)); } };
}

function stepperControl(key, { min, max, step = 1, unit = '' }) {
  const out = h('output', {});
  const show = () => { out.textContent = `${settings.get(key)}${unit}`; };
  const change = (d) => settings.set(key, Math.min(max, Math.max(min, settings.get(key) + d)));
  const wrap = h('div', { class: 'number-stepper' },
    h('button', { type: 'button', 'aria-label': 'Decrease', onclick: () => change(-step) }, '−'),
    out,
    h('button', { type: 'button', 'aria-label': 'Increase', onclick: () => change(step) }, '+'));
  show();
  return { el: wrap, sync: show };
}

/**
 * sections: [{id, label, icon, rows: [{key?, label, desc?, control(): {el, sync}, keywords?}] | render()}]
 */
function buildSections(shortcutGroups) {
  return [
    {
      id: 'appearance', label: 'Appearance', icon: 'sun', rows: [
        { key: 'theme', label: 'Theme', desc: 'System follows your operating system.', control: () => segmentedControl('theme', [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']]) },
        { key: 'editorFontSize', label: 'Editor font size', desc: `Also ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + and ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} − in the editor.`, control: () => stepperControl('editorFontSize', { min: 9, max: 28, unit: ' px' }) },
      ],
    },
    {
      id: 'editor', label: 'Editor', icon: 'code', rows: [
        { key: 'tabSize', label: 'Tab size', control: () => selectControl('tabSize', [[2, '2 spaces'], [3, '3 spaces'], [4, '4 spaces'], [8, '8 spaces']]) },
        { key: 'insertSpaces', label: 'Indent with spaces', desc: 'Off inserts tab characters.', control: () => switchControl('insertSpaces') },
        { key: 'wordWrap', label: 'Word wrap', desc: 'Wrap long lines to the editor width (Alt+Z).', control: () => switchControl('wordWrap') },
        { key: 'lineNumbers', label: 'Line numbers', control: () => switchControl('lineNumbers') },
        { key: 'highlightActiveLine', label: 'Highlight current line', control: () => switchControl('highlightActiveLine') },
        { key: 'showWhitespace', label: 'Show whitespace', desc: 'Draw dots for spaces and arrows for tabs.', control: () => switchControl('showWhitespace') },
        { key: 'closeBrackets', label: 'Close brackets and quotes', control: () => switchControl('closeBrackets') },
        { key: 'autocomplete', label: 'Suggestions while typing', desc: 'LÖVE API, Lua keywords and names from your files. Ctrl+Space always shows them.', control: () => switchControl('autocomplete') },
      ],
    },
    {
      id: 'files', label: 'Files', icon: 'file', rows: [
        { key: 'autoSave', label: 'Auto save', desc: 'Files are kept in this browser either way.', control: () => selectControl('autoSave', [['off', 'Off'], ['delay', 'After a short delay'], ['blur', 'When leaving the editor']]) },
        { key: 'trimWhitespaceOnSave', label: 'Trim trailing whitespace on save', control: () => switchControl('trimWhitespaceOnSave') },
        { key: 'finalNewlineOnSave', label: 'End files with a newline on save', control: () => switchControl('finalNewlineOnSave') },
      ],
    },
    {
      id: 'run', label: 'Running', icon: 'play', rows: [
        { key: 'autorun', label: 'Run after saving', desc: 'Restart the game every time you save a file.', control: () => switchControl('autorun') },
        { key: 'focusGameOnRun', label: 'Focus the game when it starts', desc: 'Keyboard input goes to the game instead of the editor.', control: () => switchControl('focusGameOnRun') },
        { key: 'clearConsoleOnRun', label: 'Clear the console on run', control: () => switchControl('clearConsoleOnRun') },
        { key: 'compatCheck', label: 'Check web compatibility', desc: 'Before each run and export, list code that can\'t work in a browser.', control: () => switchControl('compatCheck') },
        { key: 'scaleMode', label: 'Game scaling', desc: 'How a fixed-size window fits the game panel. Pixel-perfect uses whole-number scales and sharp pixels.', control: () => selectControl('scaleMode', [['fit', 'Fit'], ['integer', 'Pixel-perfect'], ['none', 'Actual size']]) },
        { key: 'jit', label: 'Lua JIT compiler', desc: 'Compiles hot Lua code to WebAssembly. Turn off to compare speed or rule it out when debugging.', control: () => switchControl('jit') },
      ],
    },
    {
      id: 'console', label: 'Console', icon: 'terminal', rows: [
        { key: 'consoleTimestamps', label: 'Show timestamps', control: () => switchControl('consoleTimestamps') },
        { key: 'consoleWrap', label: 'Wrap long lines', control: () => switchControl('consoleWrap') },
      ],
    },
    {
      id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', searchable: false,
      render: () => {
        const body = h('div', { class: 'shortcuts' });
        for (const [title, rows] of shortcutGroups) {
          body.append(h('h3', {}, title));
          for (const { label, keys } of rows) {
            const k = h('span', {});
            keys.forEach((combo, i) => {
              if (i) k.append(h('span', { class: 'setting-desc', style: 'display:inline;margin:0 6px' }, 'or'));
              for (const key of combo) k.append(h('kbd', {}, key));
            });
            body.append(h('div', { class: 'shortcut' }, h('span', {}, label), k));
          }
        }
        return body;
      },
    },
  ];
}

/** shortcutGroups: [[title, [{label, keys: [[...combo]]}]]] */
export function openSettings({ section = 'appearance', shortcutGroups = [] } = {}) {
  const sections = buildSections(shortcutGroups);
  const nav = h('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' });
  const content = h('div', { class: 'settings-content' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', spellcheck: 'false' });
  const searchWrap = h('div', { class: 'settings-search' }, icon('search', 14), search);
  const syncs = [];
  let current = sections.some((s) => s.id === section) ? section : 'appearance';

  const row = (r) => {
    const c = r.control();
    syncs.push(c.sync);
    return h('div', { class: 'setting-row' },
      h('div', { class: 'setting-text' },
        h('div', { class: 'setting-label' }, r.label),
        r.desc ? h('div', { class: 'setting-desc' }, r.desc) : null),
      h('div', { class: 'setting-control' }, c.el));
  };

  const render = () => {
    syncs.length = 0;
    const q = search.value.trim().toLowerCase();
    for (const b of nav.querySelectorAll('button[data-id]')) b.setAttribute('aria-current', String(!q && b.dataset.id === current));
    const children = [searchWrap];
    if (q) {
      let any = false;
      for (const s of sections) {
        if (s.searchable === false) continue;
        const rows = s.rows.filter((r) => `${r.label} ${r.desc || ''} ${s.label}`.toLowerCase().includes(q));
        if (!rows.length) continue;
        any = true;
        children.push(h('div', { class: 'settings-section' }, h('h3', {}, s.label), ...rows.map(row)));
      }
      if (!any) children.push(h('div', { class: 'settings-empty' }, 'No settings match.'));
    } else {
      const s = sections.find((x) => x.id === current);
      children.push(h('div', { class: 'settings-section' }, h('h3', {}, s.label), ...(s.render ? [s.render()] : s.rows.map(row))));
    }
    content.replaceChildren(...children);
  };

  for (const s of sections) {
    nav.append(h('button', {
      type: 'button', 'data-id': s.id,
      onclick: () => { current = s.id; search.value = ''; render(); content.scrollTop = 0; },
    }, icon(s.icon, 15), s.label));
  }
  nav.append(h('div', { class: 'nav-spacer' }));
  nav.append(h('button', {
    type: 'button',
    onclick: async () => {
      if (await confirmDialog({ title: 'Reset settings', message: 'Put every setting back to its default?', okLabel: 'Reset' })) settings.reset();
    },
  }, icon('restart', 15), 'Reset to defaults'));

  search.addEventListener('input', render);
  const off = settings.onChange(() => { for (const s of syncs) s(); });
  render();
  return openDialog({
    title: 'Settings',
    body: h('div', { class: 'settings-layout' }, nav, content),
    className: 'settings-dialog',
    onOpen: () => search.focus(),
  }).finally(off);
}
