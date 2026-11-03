// Zip import/export: .love files, "export for web" bundles and archive import.
//
// Uses fflate from a CDN. If it cannot be loaded (offline), falls back to a
// tiny built-in zip writer (stored, uncompressed) and a reader that inflates
// with the browser's DecompressionStream.

import { classifyBytes } from './file-types.js';

const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js';
let fflatePromise = null;

export function loadFflate() {
  if (!fflatePromise) {
    fflatePromise = import(FFLATE_URL).catch((e) => {
      console.warn('fflate unavailable, using the built-in zip fallback:', e);
      return null;
    });
  }
  return fflatePromise;
}

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

// ---------------------------------------------------------------------------
// Fallback zip writer / reader

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function storeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [path, data] of Object.entries(files)) {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipFallback(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip directory.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    if (name.endsWith('/')) { out[name] = new Uint8Array(0); continue; }
    if (method === 0) out[name] = raw.slice();
    else if (method === 8) out[name] = await inflateRaw(raw);
    else throw new Error(`Unsupported compression in ${name}.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API

/** files: {path: string | Uint8Array} -> Uint8Array (zip) */
export async function zipFiles(files) {
  const fflate = await loadFflate();
  const bytes = {};
  for (const [path, data] of Object.entries(files)) bytes[path] = toBytes(data);
  if (fflate) {
    const input = {};
    for (const [path, data] of Object.entries(bytes)) {
      // Already-compressed formats are stored as-is; text gets deflated.
      const stored = /\.(png|jpe?g|ogg|oga|opus|mp3|webp|zip|love|woff2?)$/i.test(path);
      input[path] = [data, { level: stored ? 0 : 6 }];
    }
    return fflate.zipSync(input, { mtime: new Date() });
  }
  return storeZip(bytes);
}

/** Unzip -> {path: Uint8Array}, without directories and OS junk. */
export async function unzipBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fflate = await loadFflate();
  const raw = fflate ? fflate.unzipSync(u8) : await readZipFallback(u8);
  const out = {};
  for (const [path, data] of Object.entries(raw)) {
    if (path.endsWith('/')) continue;
    if (/(^|\/)(__MACOSX|\.DS_Store$|Thumbs\.db$)/.test(path)) continue;
    out[path] = data;
  }
  // A .love made by zipping the folder (instead of its contents) has everything
  // under one directory; strip it so main.lua ends up at the root.
  const paths = Object.keys(out);
  if (paths.length && !out['main.lua']) {
    const first = paths[0].split('/')[0];
    if (paths.every((p) => p.startsWith(`${first}/`)) && out[`${first}/main.lua`]) {
      const stripped = {};
      for (const p of paths) stripped[p.slice(first.length + 1)] = out[p];
      return stripped;
    }
  }
  return out;
}

/** Unzip into {path: string | Uint8Array} using the editor's text detection. */
export async function unzipToProjectFiles(bytes) {
  const files = {};
  for (const [path, data] of Object.entries(await unzipBytes(bytes))) files[path] = classifyBytes(path, data);
  return files;
}

export async function buildLove(files) {
  return zipFiles(files);
}

const WEB_ASSETS = ['player.html', 'player.js', 'player.css', 'love.mjs', 'love.wasm'];

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * A zip that can be uploaded to itch.io as an HTML game: index.html (the
 * player, pointed at game.love), the engine files and the game itself.
 */
export async function buildWebExport(files, title) {
  const assets = {};
  await Promise.all(WEB_ASSETS.map(async (name) => {
    const res = await fetch(name, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not fetch ${name} (${res.status}).`);
    assets[name] = new Uint8Array(await res.arrayBuffer());
  }));
  let html = new TextDecoder().decode(assets['player.html']);
  const meta = '<meta name="love-game" content="game.love">';
  html = html.replace(/<head>/i, `<head>\n${meta}`);
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  const out = {
    'index.html': html,
    'player.js': assets['player.js'],
    'player.css': assets['player.css'],
    'love.mjs': assets['love.mjs'],
    'love.wasm': assets['love.wasm'],
    'game.love': await buildLove(files),
  };
  return zipFiles(out);
}

export function slugify(name) {
  return (name || 'game').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'game';
}
