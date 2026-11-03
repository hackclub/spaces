// File type detection: what is text, what can be previewed, which language.

const TEXT_EXT = new Set([
  'lua', 'txt', 'md', 'markdown', 'json', 'glsl', 'frag', 'vert', 'fs', 'vs', 'shader', 'hlsl', 'conf', 'cfg', 'ini',
  'csv', 'tsv', 'xml', 'tmx', 'tsx', 'tsj', 'tmj', 'ldtk', 'yaml', 'yml', 'toml', 'html', 'htm', 'css', 'js', 'mjs',
  'fnt', 'svg', 'gitignore', 'editorconfig', 'license', 'fnl', 'moon', 'atlas', 'log', 'po', 'lst', 'sh', 'bat',
]);

const IMAGE_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
  ico: 'image/x-icon', avif: 'image/avif',
};
const AUDIO_MIME = {
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac',
};
const FONT_MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
const OTHER_BINARY = new Set(['tga', 'dds', 'ktx', 'pkm', 'astc', 'xm', 'mod', 's3m', 'it', 'ogv', 'zip', 'love', 'exr', 'hdr', 'dat', 'bin']);

export function extOf(path) {
  const name = path.split('/').pop().toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : (dot === 0 ? name.slice(1) : '');
}

export function baseName(path) {
  return path.split('/').pop();
}

export function dirName(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** 'text' | 'image' | 'audio' | 'font' | 'binary' */
export function kindOf(path, data) {
  const ext = extOf(path);
  if (typeof data === 'string') return 'text';
  if (IMAGE_MIME[ext]) return 'image';
  if (AUDIO_MIME[ext]) return 'audio';
  if (FONT_MIME[ext]) return 'font';
  if (data === undefined && TEXT_EXT.has(ext)) return 'text';
  return 'binary';
}

export function mimeOf(path) {
  const ext = extOf(path);
  return IMAGE_MIME[ext] || AUDIO_MIME[ext] || FONT_MIME[ext]
    || (ext === 'svg' ? 'image/svg+xml' : TEXT_EXT.has(ext) ? 'text/plain' : 'application/octet-stream');
}

export function isKnownText(path) {
  return TEXT_EXT.has(extOf(path)) || !extOf(path).length;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decide how to store imported bytes: as a string for text files, otherwise
 * as Uint8Array. Unknown extensions are sniffed (valid UTF-8, no NULs).
 */
export function classifyBytes(path, bytes) {
  const ext = extOf(path);
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (IMAGE_MIME[ext] || AUDIO_MIME[ext] || FONT_MIME[ext] || OTHER_BINARY.has(ext)) return u8;
  if (TEXT_EXT.has(ext) || u8.length < 8 * 1024 * 1024) {
    if (u8.indexOf(0) !== -1 && !TEXT_EXT.has(ext)) return u8;
    try {
      let text = decoder.decode(u8);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      return text;
    } catch {
      return u8;
    }
  }
  return u8;
}

export function languageOf(path) {
  const ext = extOf(path);
  if (ext === 'lua') return 'lua';
  if (['glsl', 'frag', 'vert', 'fs', 'vs', 'shader', 'hlsl'].includes(ext)) return 'glsl';
  if (['json', 'tsj', 'tmj', 'ldtk'].includes(ext)) return 'json';
  return null;
}

export function languageLabel(path, data) {
  const lang = languageOf(path);
  if (lang === 'lua') return 'Lua';
  if (lang === 'glsl') return 'GLSL';
  if (lang === 'json') return 'JSON';
  const kind = kindOf(path, data);
  return { text: 'Plain text', image: 'Image', audio: 'Audio', font: 'Font', binary: 'Binary' }[kind];
}

export function iconFor(path, data) {
  const lang = languageOf(path);
  if (lang) return 'code';
  return { text: 'file', image: 'image', audio: 'music', font: 'font', binary: 'binary' }[kindOf(path, data)];
}

export function byteSize(data) {
  if (data == null) return 0;
  return typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
}
