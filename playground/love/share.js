// Share links: small text-only projects packed into the URL hash.
// Format: #share=<base64url(deflate-raw(JSON {v, name, files}))>

export const SHARE_LIMIT = 32 * 1024; // compressed bytes

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Returns {url, size} or throws an Error with a user-facing message.
 * files: {path: string | Uint8Array}
 */
export async function createShareLink(name, files) {
  const binary = Object.entries(files).filter(([, d]) => typeof d !== 'string').map(([p]) => p);
  if (binary.length) {
    throw new Error(`Share links can only hold text files, but this project contains ${binary.length === 1 ? binary[0] : `${binary.length} binary files`}. Export a .love instead.`);
  }
  const json = JSON.stringify({ v: 1, name, files });
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  if (packed.length > SHARE_LIMIT) {
    throw new Error(`This project is too big for a link (${Math.round(packed.length / 1024)} KB compressed, the limit is ${SHARE_LIMIT / 1024} KB). Export a .love instead.`);
  }
  const url = new URL(location.href);
  url.search = '';
  url.hash = `share=${toBase64Url(packed)}`;
  return { url: url.toString(), size: packed.length };
}

/** Parse location.hash; returns {name, files} or null. Throws on corrupt data. */
export async function readShareHash(hash = location.hash) {
  const m = /^#share=([\w-]+)$/.exec(hash);
  if (!m) return null;
  const json = new TextDecoder().decode(await pipe(fromBase64Url(m[1]), new DecompressionStream('deflate-raw')));
  const data = JSON.parse(json);
  if (!data || typeof data.files !== 'object') throw new Error('The share link is not valid.');
  const files = {};
  for (const [p, t] of Object.entries(data.files)) if (typeof t === 'string') files[p] = t;
  return { name: String(data.name || 'Shared project').slice(0, 80), files };
}
