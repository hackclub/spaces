const DB_NAME = '/home/web_user';
const STORE_NAME = 'FILE_DATA';
const ROOT = `${DB_NAME}/`;

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function openExisting() {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
  const databases = await indexedDB.databases();
  if (!databases.some((database) => database.name === DB_NAME)) return null;

  const db = await request(indexedDB.open(DB_NAME));
  if (!db.objectStoreNames.contains(STORE_NAME)) {
    db.close();
    return null;
  }
  return db;
}

const isHidden = (path) => path.slice(ROOT.length).split('/').some((part) => part.startsWith('.'));

function projectRoots(keys) {
  return keys
    .filter((key) => typeof key === 'string' && key.startsWith(ROOT) && key.endsWith('/project.godot') && !isHidden(key))
    .map((key) => key.slice(0, -'/project.godot'.length))
    .sort();
}

export async function findLegacyGodotProjects() {
  try {
    const db = await openExisting();
    if (!db) return [];
    try {
      const keys = await request(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys());
      return projectRoots(keys).map((root) => root.split('/').pop());
    } finally {
      db.close();
    }
  } catch (err) {
    console.error('Failed to look for old Godot projects:', err);
    return [];
  }
}

const DOS_DATE = (1 << 5) | 1;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { path, data } of files) {
    const name = encoder.encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local, name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry, name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((size, part) => size + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

export async function downloadLegacyGodotProjects() {
  const db = await openExisting();
  if (!db) throw new Error('No saved Godot projects were found in this browser.');

  let entries;
  try {
    const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    entries = keys.map((key, index) => ({ key, value: values[index] }));
  } finally {
    db.close();
  }

  const roots = projectRoots(entries.map((entry) => entry.key));
  const files = entries
    .filter(({ key, value }) => value?.contents && roots.some((root) => key.startsWith(`${root}/`) && !key.slice(root.length + 1).startsWith('.godot/')))
    .map(({ key, value }) => ({ path: key.slice(ROOT.length), data: new Uint8Array(value.contents.buffer ?? value.contents, value.contents.byteOffset ?? 0, value.contents.byteLength ?? value.contents.length) }));

  if (!files.length) throw new Error('No saved Godot projects were found in this browser.');

  const url = URL.createObjectURL(zip(files));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'godot-playground-projects.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return files.length;
}
