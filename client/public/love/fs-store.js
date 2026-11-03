// Project storage in IndexedDB.
//
// projects: {id, name, created, updated, tabs: [path], active: path}
// entries:  {project, path, kind: 'file' | 'dir', data: string | Uint8Array, mtime}
//
// Paths are relative, use '/' and never start with a slash. Text files are
// stored as strings and everything else as Uint8Array.

const DB_NAME = 'love-web-studio';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: ['project', 'path'] });
          s.createIndex('project', 'project');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('The project database is blocked by another tab.'));
    });
  }
  return dbPromise;
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Run fn(stores) inside a transaction; resolves with fn's result once committed. */
async function transact(names, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, tx.objectStore(n)]));
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    Promise.resolve(fn(stores)).then((r) => { result = r; }, (e) => {
      try { tx.abort(); } catch { /* already finished */ }
      reject(e);
    });
  });
}

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/');
}

function compact(data) {
  if (typeof data === 'string') return data;
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Don't store a whole shared buffer for a small view.
  return u8.byteOffset || u8.byteLength !== u8.buffer.byteLength ? u8.slice() : u8;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parentDirs(path) {
  const parts = path.split('/');
  const dirs = [];
  for (let i = 1; i < parts.length; i++) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
}

// ---------------------------------------------------------------------------
// Projects

export async function listProjects() {
  const all = await transact(['projects'], 'readonly', ({ projects }) => asPromise(projects.getAll()));
  return all.sort((a, b) => b.updated - a.updated);
}

export function getProject(id) {
  return transact(['projects'], 'readonly', ({ projects }) => asPromise(projects.get(id)));
}

/** files: {path: string | Uint8Array}; dirs: [path] for empty folders */
export async function createProject(name, files = {}, dirs = []) {
  const now = Date.now();
  const project = { id: uid(), name, created: now, updated: now, tabs: [], active: null };
  await transact(['projects', 'entries'], 'readwrite', ({ projects, entries }) => {
    projects.put(project);
    const seen = new Set();
    for (const [raw, data] of Object.entries(files)) {
      const path = normalizePath(raw);
      if (!path) continue;
      entries.put({ project: project.id, path, kind: 'file', data: compact(data), mtime: now });
      for (const d of parentDirs(path)) seen.add(d);
    }
    for (const d of dirs) seen.add(normalizePath(d));
    for (const d of seen) if (d) entries.put({ project: project.id, path: d, kind: 'dir', mtime: now });
  });
  return project;
}

export async function updateProject(id, patch) {
  return transact(['projects'], 'readwrite', async ({ projects }) => {
    const p = await asPromise(projects.get(id));
    if (!p) throw new Error('Project not found');
    Object.assign(p, patch);
    projects.put(p);
    return p;
  });
}

export async function deleteProject(id) {
  await transact(['projects', 'entries'], 'readwrite', async ({ projects, entries }) => {
    projects.delete(id);
    const keys = await asPromise(entries.index('project').getAllKeys(id));
    for (const k of keys) entries.delete(k);
  });
}

export async function duplicateProject(id, name) {
  const src = await getProject(id);
  const all = await listEntries(id);
  const files = {};
  const dirs = [];
  for (const e of all) {
    if (e.kind === 'dir') dirs.push(e.path);
    else files[e.path] = e.data;
  }
  return createProject(name || `${src.name} copy`, files, dirs);
}

// ---------------------------------------------------------------------------
// Entries

export async function listEntries(projectId) {
  const all = await transact(['entries'], 'readonly', ({ entries }) => asPromise(entries.index('project').getAll(projectId)));
  return all.sort((a, b) => a.path.localeCompare(b.path));
}

/** {path: data} for every file in the project. */
export async function getAllFiles(projectId) {
  const out = {};
  for (const e of await listEntries(projectId)) if (e.kind === 'file') out[e.path] = e.data;
  return out;
}

export async function readFile(projectId, path) {
  const e = await transact(['entries'], 'readonly', ({ entries }) => asPromise(entries.get([projectId, normalizePath(path)])));
  return e && e.kind === 'file' ? e.data : undefined;
}

function touch(projects, projectId, now) {
  const req = projects.get(projectId);
  req.onsuccess = () => {
    const p = req.result;
    if (p) {
      p.updated = now;
      projects.put(p);
    }
  };
}

/** Write several files at once: {path: data}. Creates parent folders. */
export async function writeFiles(projectId, files) {
  const now = Date.now();
  await transact(['projects', 'entries'], 'readwrite', ({ projects, entries }) => {
    const dirs = new Set();
    for (const [raw, data] of Object.entries(files)) {
      const path = normalizePath(raw);
      if (!path) continue;
      entries.put({ project: projectId, path, kind: 'file', data: compact(data), mtime: now });
      for (const d of parentDirs(path)) dirs.add(d);
    }
    for (const d of dirs) entries.put({ project: projectId, path: d, kind: 'dir', mtime: now });
    touch(projects, projectId, now);
  });
}

export function writeFile(projectId, path, data) {
  return writeFiles(projectId, { [path]: data });
}

export async function createDir(projectId, path) {
  path = normalizePath(path);
  const now = Date.now();
  await transact(['projects', 'entries'], 'readwrite', ({ projects, entries }) => {
    for (const d of [...parentDirs(path), path]) entries.put({ project: projectId, path: d, kind: 'dir', mtime: now });
    touch(projects, projectId, now);
  });
}

/** Delete a file, or a folder and everything in it. */
export async function deleteEntry(projectId, path) {
  path = normalizePath(path);
  await transact(['projects', 'entries'], 'readwrite', async ({ projects, entries }) => {
    const keys = await asPromise(entries.index('project').getAllKeys(projectId));
    for (const k of keys) if (k[1] === path || k[1].startsWith(`${path}/`)) entries.delete(k);
    touch(projects, projectId, Date.now());
  });
}

/** Rename/move a file or folder (with its contents). Returns [[old, new], ...] for files. */
export async function renameEntry(projectId, from, to) {
  from = normalizePath(from);
  to = normalizePath(to);
  if (from === to) return [];
  if (to.startsWith(`${from}/`)) throw new Error('A folder cannot be moved into itself.');
  const moved = [];
  await transact(['projects', 'entries'], 'readwrite', async ({ projects, entries }) => {
    if (await asPromise(entries.get([projectId, to]))) throw new Error(`"${to}" already exists.`);
    const all = await asPromise(entries.index('project').getAll(projectId));
    const now = Date.now();
    for (const e of all) {
      if (e.path !== from && !e.path.startsWith(`${from}/`)) continue;
      const np = to + e.path.slice(from.length);
      entries.delete([projectId, e.path]);
      entries.put({ ...e, path: np, mtime: now });
      if (e.kind === 'file') moved.push([e.path, np]);
    }
    for (const d of parentDirs(to)) entries.put({ project: projectId, path: d, kind: 'dir', mtime: now });
    touch(projects, projectId, now);
  });
  return moved;
}
