// The file tree in the sidebar. It only renders and reports user intent;
// the app performs the actual file operations.

import { h, icon } from './ui.js';
import { iconFor, dirName } from './file-types.js';

const INTERNAL_TYPE = 'application/x-lws-path';

export class FileTree {
  /**
   * opts: {
   *   onOpen(path), onContextMenu(path, kind, point), onMove(from, toDir),
   *   onDropFiles(dataTransfer, toDir), isDirty(path), onEmptyAction(action)
   * }
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.entries = [];
    this.expanded = new Set();
    this.active = null;
    this.focusPath = null;
    this.storageKey = null;

    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('dblclick', (e) => {
      const row = e.target.closest('.tree-row');
      if (row?.dataset.kind === 'file') this.opts.onOpen(row.dataset.path, { pin: true });
    });
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const row = e.target.closest('.tree-row');
      this.opts.onContextMenu(row?.dataset.path ?? '', row?.dataset.kind ?? 'root', { x: e.clientX, y: e.clientY });
    });
    root.addEventListener('keydown', (e) => this.onKey(e));
    this.setupDragDrop();
  }

  /** Restore expanded folders for a project. */
  setProject(projectId) {
    this.storageKey = `lws.expanded.${projectId}`;
    try {
      this.expanded = new Set(JSON.parse(localStorage.getItem(this.storageKey) || '[]'));
    } catch {
      this.expanded = new Set();
    }
  }

  saveExpanded() {
    if (!this.storageKey) return;
    try { localStorage.setItem(this.storageKey, JSON.stringify([...this.expanded])); } catch { /* ignore */ }
  }

  /** entries: [{path, kind: 'file'|'dir', data}] */
  setEntries(entries) {
    this.entries = entries;
    this.render();
  }

  setActive(path) {
    this.active = path;
    if (path) this.reveal(path, false);
    this.render();
  }

  reveal(path, render = true) {
    let d = dirName(path);
    while (d) {
      this.expanded.add(d);
      d = dirName(d);
    }
    this.saveExpanded();
    if (render) this.render();
  }

  toggle(path, open = !this.expanded.has(path)) {
    if (open) this.expanded.add(path);
    else this.expanded.delete(path);
    this.saveExpanded();
    this.render();
  }

  buildTree() {
    const rootNode = { path: '', kind: 'dir', children: new Map() };
    const nodes = new Map([['', rootNode]]);
    const ensureDir = (path) => {
      if (nodes.has(path)) return nodes.get(path);
      const parent = ensureDir(dirName(path));
      const node = { path, name: path.split('/').pop(), kind: 'dir', children: new Map() };
      parent.children.set(node.name, node);
      nodes.set(path, node);
      return node;
    };
    for (const e of this.entries) {
      if (e.kind === 'dir') ensureDir(e.path);
      else {
        const parent = ensureDir(dirName(e.path));
        const name = e.path.split('/').pop();
        parent.children.set(name, { path: e.path, name, kind: 'file', data: e.data });
      }
    }
    return rootNode;
  }

  render() {
    const tree = this.buildTree();
    const rows = [];
    const walk = (node, depth) => {
      const kids = [...node.children.values()].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
      });
      for (const child of kids) {
        rows.push(this.renderRow(child, depth));
        if (child.kind === 'dir' && this.expanded.has(child.path)) walk(child, depth + 1);
      }
    };
    walk(tree, 0);

    if (!rows.length) {
      this.root.replaceChildren(h('div', { class: 'tree-empty' },
        h('p', {}, 'This project has no files yet.'),
        h('button', { type: 'button', class: 'btn small', onclick: () => this.opts.onEmptyAction?.('new-file') }, icon('filePlus'), 'New file'),
        h('p', { class: 'hint' }, 'or drop files and folders here')));
      return;
    }
    this.root.replaceChildren(...rows);
    // Roving tabindex: one focusable row.
    const focusRow = this.rowFor(this.focusPath) || this.rowFor(this.active) || rows[0];
    focusRow.tabIndex = 0;
  }

  renderRow(node, depth) {
    const isDir = node.kind === 'dir';
    const open = isDir && this.expanded.has(node.path);
    const dirty = !isDir && this.opts.isDirty?.(node.path);
    const row = h('div', {
      class: `tree-row ${isDir ? 'dir' : 'file'} ${node.path === this.active ? 'active' : ''}`,
      role: 'treeitem',
      'aria-level': depth + 1,
      'aria-expanded': isDir ? String(open) : null,
      'aria-selected': String(node.path === this.active),
      tabindex: '-1',
      draggable: 'true',
      title: node.path,
      style: `--depth: ${depth}`,
      dataset: { path: node.path, kind: node.kind },
    },
    h('span', { class: 'twisty' }, isDir ? icon(open ? 'chevronDown' : 'chevronRight', 14) : null),
    icon(isDir ? (open ? 'folderOpen' : 'folder') : iconFor(node.path, node.data), 15),
    h('span', { class: 'name' }, node.name),
    dirty ? h('span', { class: 'dirty-dot', title: 'Unsaved changes', 'aria-label': 'Unsaved changes' }) : null,
    h('button', { type: 'button', class: 'row-menu icon-btn', tabindex: '-1', title: 'More actions', 'aria-label': `Actions for ${node.name}` }, icon('more', 14)));
    if (node.path === this.active) row.setAttribute('aria-current', 'true');
    return row;
  }

  rowFor(path) {
    if (path == null) return null;
    return [...this.root.querySelectorAll('.tree-row')].find((r) => r.dataset.path === path) || null;
  }

  onClick(e) {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    this.focusPath = row.dataset.path;
    if (e.target.closest('.row-menu')) {
      const r = e.target.closest('.row-menu').getBoundingClientRect();
      this.opts.onContextMenu(row.dataset.path, row.dataset.kind, { x: r.left, y: r.bottom + 2 });
      return;
    }
    if (row.dataset.kind === 'dir') this.toggle(row.dataset.path);
    else this.opts.onOpen(row.dataset.path);
    this.rowFor(this.focusPath)?.focus();
  }

  onKey(e) {
    const rows = [...this.root.querySelectorAll('.tree-row')];
    const row = e.target.closest('.tree-row');
    if (!row || !rows.length) return;
    const i = rows.indexOf(row);
    const path = row.dataset.path;
    const isDir = row.dataset.kind === 'dir';
    const focus = (r) => {
      if (!r) return;
      for (const x of rows) x.tabIndex = -1;
      r.tabIndex = 0;
      r.focus();
      this.focusPath = r.dataset.path;
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focus(rows[i + 1]); break;
      case 'ArrowUp': e.preventDefault(); focus(rows[i - 1]); break;
      case 'Home': e.preventDefault(); focus(rows[0]); break;
      case 'End': e.preventDefault(); focus(rows[rows.length - 1]); break;
      case 'ArrowRight':
        e.preventDefault();
        if (isDir && !this.expanded.has(path)) { this.toggle(path, true); this.rowFor(path)?.focus(); } else focus(rows[i + 1]);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (isDir && this.expanded.has(path)) { this.toggle(path, false); this.rowFor(path)?.focus(); } else focus(this.rowFor(dirName(path)));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isDir) { this.toggle(path); this.rowFor(path)?.focus(); } else this.opts.onOpen(path, { focusEditor: e.key === 'Enter' });
        break;
      case 'F2':
        e.preventDefault();
        this.opts.onKeyAction?.('rename', path, row.dataset.kind);
        break;
      case 'Delete':
      case 'Backspace':
        if (e.key === 'Backspace' && !e.metaKey) break;
        e.preventDefault();
        this.opts.onKeyAction?.('delete', path, row.dataset.kind);
        break;
      case 'ContextMenu': {
        e.preventDefault();
        const r = row.getBoundingClientRect();
        this.opts.onContextMenu(path, row.dataset.kind, { x: r.left + 24, y: r.bottom });
        break;
      }
      default: break;
    }
  }

  setupDragDrop() {
    const root = this.root;
    let hoverEl = null;
    const setHover = (el) => {
      if (hoverEl === el) return;
      hoverEl?.classList.remove('drop-target');
      hoverEl = el;
      hoverEl?.classList.add('drop-target');
    };
    const targetFor = (e) => {
      const row = e.target.closest('.tree-row');
      if (!row) return { dir: '', el: root };
      if (row.dataset.kind === 'dir') return { dir: row.dataset.path, el: row };
      const dir = dirName(row.dataset.path);
      return { dir, el: dir ? this.rowFor(dir) : root };
    };

    root.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.tree-row');
      if (!row) return;
      e.dataTransfer.setData(INTERNAL_TYPE, row.dataset.path);
      e.dataTransfer.setData('text/plain', row.dataset.path);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    root.addEventListener('dragend', (e) => {
      e.target.closest?.('.tree-row')?.classList.remove('dragging');
      setHover(null);
    });
    root.addEventListener('dragover', (e) => {
      const types = [...e.dataTransfer.types];
      if (!types.includes(INTERNAL_TYPE) && !types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = types.includes(INTERNAL_TYPE) ? 'move' : 'copy';
      setHover(targetFor(e).el);
    });
    root.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget)) setHover(null);
    });
    root.addEventListener('drop', (e) => {
      const types = [...e.dataTransfer.types];
      if (!types.includes(INTERNAL_TYPE) && !types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      const { dir } = targetFor(e);
      setHover(null);
      document.body.classList.remove('dragging-files');
      if (types.includes(INTERNAL_TYPE)) {
        const from = e.dataTransfer.getData(INTERNAL_TYPE);
        if (from && dirName(from) !== dir && from !== dir) this.opts.onMove(from, dir);
      } else {
        this.opts.onDropFiles(e.dataTransfer, dir);
      }
    });
  }
}

/**
 * Read dropped files and folders. Returns [{path, file}] where path is
 * relative (folders keep their name as the first path component).
 */
export async function readDataTransfer(dataTransfer) {
  const out = [];
  const items = [...(dataTransfer.items || [])].filter((i) => i.kind === 'file');
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) {
    for (const file of dataTransfer.files || []) out.push({ path: file.name, file });
    return out;
  }
  const readEntry = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries returns results in batches until it returns an empty list.
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await readEntry(entry, '');
  return out;
}
