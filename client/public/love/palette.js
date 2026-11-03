// A filterable list in a dialog: "Go to file", the command palette, and
// "Go to symbol".

import { h, icon, openDialog } from './ui.js';

export function fuzzyScore(query, text) {
  if (!query) return { score: 0, marks: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const marks = [];
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return null;
    score += i === ti ? 3 : 1;
    if (i === 0 || '/._- :'.includes(t[i - 1])) score += 2;
    marks.push(i);
    ti = i + 1;
  }
  return { score: score - t.length * 0.05, marks };
}

function highlighted(text, marks) {
  const el = h('span', { class: 'label' });
  if (!marks.length) {
    el.textContent = text;
    return el;
  }
  [...text].forEach((ch, i) => el.append(marks.includes(i) ? h('mark', {}, ch) : ch));
  return el;
}

/**
 * items: [{label, hint?, icon?, keys?: [[...combo], ...], run()}]
 * Items keep their order when the query is empty (put recent ones first).
 */
export function openPicker({ placeholder, items, emptyText = 'No matches', initialQuery = '' }) {
  const input = h('input', {
    class: 'input', type: 'text', placeholder, 'aria-label': placeholder, spellcheck: 'false', autocomplete: 'off',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'picker-list',
  });
  input.value = initialQuery;
  const listEl = h('div', { class: 'quick-list', role: 'listbox', id: 'picker-list' });
  let results = [];
  let sel = 0;
  let finish = null;

  const render = () => {
    const q = input.value.trim();
    results = items
      .map((item, order) => ({ item, order, r: fuzzyScore(q, item.label) }))
      .filter((x) => x.r)
      .sort((a, b) => (q ? b.r.score - a.r.score : 0) || a.order - b.order)
      .slice(0, 80);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    listEl.replaceChildren(...results.map(({ item, r }, i) => {
      const keys = item.keys?.length ? h('span', { class: 'hint' }, ...item.keys[0].map((k) => h('kbd', {}, k))) : null;
      return h('div', {
        class: 'quick-item', role: 'option', 'aria-selected': String(i === sel),
        onclick: () => choose(i), onmousemove: () => { if (sel !== i) { sel = i; mark(); } },
      },
      item.icon ? icon(item.icon, 15) : null,
      highlighted(item.label, r.marks),
      item.hint ? h('span', { class: 'hint' }, item.hint) : null,
      keys);
    }));
    if (!results.length) listEl.append(h('div', { class: 'quick-empty' }, emptyText));
    mark();
  };
  const mark = () => {
    [...listEl.children].forEach((el, i) => el.setAttribute?.('aria-selected', String(i === sel)));
    listEl.children[sel]?.scrollIntoView?.({ block: 'nearest' });
  };
  const choose = (i) => {
    const r = results[i];
    if (!r) return;
    finish?.(null);
    // Let the dialog close (and give focus back) before running the action.
    setTimeout(() => r.item.run(), 0);
  };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'PageDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 8); mark(); }
    else if (e.key === 'PageUp') { e.preventDefault(); sel = Math.max(0, sel - 8); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  render();
  return openDialog({
    title: placeholder, body: h('div', {}, input, listEl), className: 'quick-open',
    onOpen: (dlg, f) => { finish = f; input.focus(); input.select(); },
  });
}
