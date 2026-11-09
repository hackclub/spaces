import { classifyBytes } from './file-types.js';

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/');
}

async function call(method, url, body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Couldn't reach your space (${response.status}).`);
  }
  return response.json();
}

const projectUrl = (id, rest = '') => `api/projects/${encodeURIComponent(id)}${rest}`;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encode(data) {
  if (typeof data === 'string') return { text: data };
  return { base64: toBase64(data instanceof Uint8Array ? data : new Uint8Array(data)) };
}

function encodeFiles(files) {
  const out = {};
  for (const [path, data] of Object.entries(files)) {
    const clean = normalizePath(path);
    if (clean) out[clean] = encode(data);
  }
  return out;
}

export async function listProjects() {
  const all = await call('GET', 'api/projects');
  return all.sort((a, b) => b.updated - a.updated);
}

export async function getProject(id) {
  return (await call('GET', projectUrl(id))) ?? undefined;
}

export function createProject(name, files = {}, dirs = []) {
  return call('POST', 'api/projects', { name, files: encodeFiles(files), dirs: dirs.map(normalizePath).filter(Boolean) });
}

export function updateProject(id, patch) {
  return call('PATCH', projectUrl(id), patch);
}

export async function deleteProject(id) {
  await call('DELETE', projectUrl(id));
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

export async function listEntries(projectId) {
  const all = await call('GET', projectUrl(projectId, '/entries'));
  return all.map((e) => (e.kind === 'file'
    ? { project: projectId, path: e.path, kind: 'file', data: classifyBytes(e.path, fromBase64(e.base64)), mtime: e.mtime }
    : { project: projectId, path: e.path, kind: 'dir' }));
}

export async function getAllFiles(projectId) {
  const out = {};
  for (const e of await listEntries(projectId)) if (e.kind === 'file') out[e.path] = e.data;
  return out;
}

export async function readFile(projectId, path) {
  path = normalizePath(path);
  const response = await fetch(projectUrl(projectId, `/file?path=${encodeURIComponent(path)}`));
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Couldn't read ${path} (${response.status}).`);
  return classifyBytes(path, new Uint8Array(await response.arrayBuffer()));
}

export async function writeFiles(projectId, files) {
  await call('PUT', projectUrl(projectId, '/files'), { files: encodeFiles(files) });
}

export function writeFile(projectId, path, data) {
  return writeFiles(projectId, { [path]: data });
}

export async function createDir(projectId, path) {
  await call('POST', projectUrl(projectId, '/dirs'), { path: normalizePath(path) });
}

export async function deleteEntry(projectId, path) {
  await call('DELETE', projectUrl(projectId, `/entries?path=${encodeURIComponent(normalizePath(path))}`));
}

export function renameEntry(projectId, from, to) {
  from = normalizePath(from);
  to = normalizePath(to);
  if (from === to) return Promise.resolve([]);
  return call('POST', projectUrl(projectId, '/rename'), { from, to });
}
