import crypto from 'crypto';
import path from 'path';
import pg from './db.js';
import { findSandbox, SANDBOX_ROOT, GUI_USERNAME, hasLoginInUrl } from './sandboxes.js';
import { startSpaceApp, spaceConfigs } from './spaces.js';
import { recordRunStop } from './space-runs.js';

export const stopSandbox = async (space) => {
  const sandbox = await findSandbox(space.container_id);
  if (sandbox && sandbox.status === 'running') {
    await sandbox.stop();
  }
};

export const lockSpace = async (space, actor, reason) => {
  await stopSandbox(space);

  await pg('spaces')
    .where('id', space.id)
    .update({
      running: false,
      access_url: null,
      password: crypto.randomBytes(16).toString('hex'),
      locked_at: new Date(),
      locked_reason: reason,
      locked_by: actor.id
    });

  if (space.running) {
    await recordRunStop(space.id, 'locked');
  }
};

export const unlockSpace = (space) => pg('spaces')
  .where('id', space.id)
  .update({ locked_at: null, locked_reason: null, locked_by: null });

export const MAX_PREVIEW_BYTES = 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
export const DEFAULT_BROWSE_PATH = SANDBOX_ROOT;

const fileError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const cleanPath = (value) => {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_BROWSE_PATH;
  if (!raw.startsWith('/') || raw.includes('\0')) {
    throw fileError(`Use a path inside ${SANDBOX_ROOT}`, 400);
  }
  const clean = path.posix.normalize(raw);
  if (clean !== SANDBOX_ROOT && !clean.startsWith(`${SANDBOX_ROOT}/`)) {
    throw fileError(`Only the space's own files, inside ${SANDBOX_ROOT}, can be browsed here`, 403);
  }
  return clean;
};

export const parentPath = (dir) => (dir === SANDBOX_ROOT ? null : path.posix.dirname(dir));

const PROTECTED = '*/.wakatime.cfg|*/.config/gh|*/.config/gh/*|*/.ssh|*/.ssh/*|*/.git-credentials';

const RESOLVE = [
  'real=$(realpath -e -- "$TARGET" 2>/dev/null) || exit 3',
  'case "$real" in "$ROOT"|"$ROOT"/*) ;; *) exit 5 ;; esac',
  `case "$real" in ${PROTECTED}) exit 6 ;; esac`
].join('; ');

const pathErrors = (exitCode) => {
  if (exitCode === 5) throw fileError(`That leads outside ${SANDBOX_ROOT}, so it can't be opened here`, 403);
  if (exitCode === 6) throw fileError("That's a login or key file, so it can't be opened here", 403);
};

const sandboxFor = async (space) => {
  const sandbox = await findSandbox(space.container_id);
  if (!sandbox) {
    throw fileError("This space's machine could not be found", 404);
  }
  return sandbox;
};

const runAsRoot = async (sandbox, script, env) => {
  const result = await sandbox.runCommand({ cmd: 'bash', args: ['-c', script], env, sudo: true });
  return { exitCode: result.exitCode, stdout: await result.stdout() };
};

export const listDirectory = async (space, dir) => {
  const sandbox = await sandboxFor(space);
  const { exitCode, stdout } = await runAsRoot(
    sandbox,
    `${RESOLVE}; test -d "$real" || exit 3; find "$real" -mindepth 1 -maxdepth 1 -printf "%y\\t%s\\t%T@\\t%f\\n" 2>/dev/null | head -n 2000`,
    { TARGET: dir, ROOT: SANDBOX_ROOT }
  );
  pathErrors(exitCode);
  if (exitCode === 3) {
    throw fileError('That folder does not exist', 404);
  }

  const kinds = { d: 'folder', f: 'file', l: 'link' };
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [kind, size, modified, ...name] = line.split('\t');
      return { name: name.join('\t'), type: kinds[kind] ?? 'other', size: Number(size), modified: new Date(Number(modified) * 1000).toISOString() };
    })
    .sort((x, y) => (x.type === 'folder') === (y.type === 'folder') ? x.name.localeCompare(y.name) : x.type === 'folder' ? -1 : 1);
};

export const readSpaceFile = async (space, file, { maxBytes }) => {
  const sandbox = await sandboxFor(space);
  const { exitCode, stdout } = await runAsRoot(
    sandbox,
    `${RESOLVE}; test -f "$real" || exit 3; size=$(stat -c %s "$real"); [ "$size" -le "$MAX" ] || { echo "$size"; exit 4; }; head -c "$((MAX + 1))" "$real" | base64 -w0`,
    { TARGET: file, ROOT: SANDBOX_ROOT, MAX: String(maxBytes) }
  );
  pathErrors(exitCode);
  const tooBig = (size) => fileError(`That file is ${size ? `${Math.ceil(size / 1024 / 1024)} MB, ` : ''}over the ${Math.round(maxBytes / 1024 / 1024)} MB limit here. Use full access to get it.`, 413);
  if (exitCode === 3) {
    throw fileError('That file does not exist', 404);
  }
  if (exitCode === 4) {
    throw tooBig(Number(stdout.trim()));
  }
  if (exitCode !== 0) {
    throw new Error(`Reading ${file} failed with exit code ${exitCode}`);
  }
  const content = Buffer.from(stdout.trim(), 'base64');
  if (content.length > maxBytes) {
    throw tooBig(null);
  }
  return content;
};

export const looksLikeText = (buffer) => !buffer.subarray(0, 8000).includes(0);

export const openForModeration = async (space) => {
  const gui = spaceConfigs[(space.type || '').toLowerCase()]?.kind === 'gui';
  const login = (accessUrl, password) => ({
    type: space.type,
    access_url: accessUrl,
    password,
    login_username: gui && hasLoginInUrl(accessUrl) ? GUI_USERNAME : null
  });

  if (space.running && space.access_url && space.password) {
    return { ...login(space.access_url, space.password), started: false };
  }

  const sandbox = await sandboxFor(space);
  const password = space.password || crypto.randomBytes(16).toString('hex');
  const accessUrl = await startSpaceApp(sandbox, space, password);

  await pg('spaces')
    .where('id', space.id)
    .update({ access_url: space.locked_at ? null : accessUrl, password });

  return { ...login(accessUrl, password), started: true };
};
