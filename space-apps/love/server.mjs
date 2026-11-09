import http from "http";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const PORT = Number.parseInt(process.env.PORT, 10) || 8080;
const PASSWORD = process.env.SPACE_PASSWORD || "";
const SESSION_COOKIE = "spaces_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CUPID_DIR = path.resolve(process.env.CUPID_DIR || path.join(APP_DIR, "..", "cupid"));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "projects"));
const META_FILE = path.join(DATA_DIR, ".cupid-projects.json");
const WAKATIME_CLI = process.env.WAKATIME_CLI || "";
const WAKATIME_CONFIG = process.env.WAKATIME_CONFIG || path.join(os.homedir(), ".wakatime.cfg");
const PLUGIN = "hackclub-spaces/1.0 cupid/1.0";
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const FAILED_LOGIN_LIMIT = 20;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

const OVERRIDES = {
  "fs-store.js": path.join(APP_DIR, "fs-store.js"),
  "share.js": path.join(APP_DIR, "share.js"),
  "share.original.js": path.join(CUPID_DIR, "share.js"),
  "spaces-activity.js": path.join(APP_DIR, "activity.js")
};

const HIDDEN = new Set(["export.html", "export.js", "CUPID_VERSION"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".lua": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".love": "application/zip",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, "That address isn't valid.");
  }
};

const digest = (value) => crypto.createHash("sha256").update(value).digest();
const sessionToken = crypto.createHmac("sha256", PASSWORD).update("cupid-session").digest("hex");
const failedLogins = new Map();

const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

const matches = (given, expected) => crypto.timingSafeEqual(digest(String(given)), digest(expected));

const cookieValue = (req, name) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
};

const loggedIn = (req) => Boolean(PASSWORD) && matches(cookieValue(req, SESSION_COOKIE), sessionToken);

const sessionCookie = (req) => {
  const secure = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
};

const loginPage = (message = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in to your LÖVE space</title>
<meta name="color-scheme" content="dark light">
<link rel="icon" href="data:,">
<style>
  :root { --bg: #fff; --text: #1f2d3d; --muted: #5c6b7a; --line: #c9d2dc; --accent: #ec3750; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17171d; --text: #f2f4f7; --muted: #a3acb8; --line: #3a3a46; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: min(360px, 100% - 32px); }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { margin: 0 0 16px; color: var(--muted); }
  .error { color: var(--accent); }
  input { box-sizing: border-box; width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font: inherit; }
  button { width: 100%; padding: 10px 18px; border: 0; border-radius: 6px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<form method="POST" action="login">
  <h1>Your LÖVE space</h1>
  <p>Enter the password shown for this space on your Spaces dashboard.</p>
  ${message ? `<p class="error" role="alert">${message}</p>` : ""}
  <input type="password" name="password" autocomplete="current-password" aria-label="Password" required autofocus>
  <button type="submit">Log in</button>
</form>
</body>
</html>`;

const readForm = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 10 * 1024) {
      reject(httpError(413, "That's too long."));
      req.destroy();
    }
  });
  req.on("end", () => resolve(new URLSearchParams(body)));
  req.on("error", reject);
});

const handleLogin = async (req, res, ip) => {
  const html = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  if (req.method === "GET") {
    res.writeHead(200, html);
    return res.end(loginPage());
  }
  if (req.method !== "POST") throw httpError(405, "Method not allowed");
  const form = await readForm(req);
  if (PASSWORD && matches(form.get("password") || "", PASSWORD)) {
    failedLogins.delete(ip);
    res.writeHead(302, { "Set-Cookie": sessionCookie(req), Location: "./", "Cache-Control": "no-store" });
    return res.end();
  }
  recordFailure(ip);
  res.writeHead(401, html);
  return res.end(loginPage("That password isn't right."));
};

const tooManyFailures = (ip) => {
  const entry = failedLogins.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.since > FAILED_LOGIN_WINDOW_MS) {
    failedLogins.delete(ip);
    return false;
  }
  return entry.count >= FAILED_LOGIN_LIMIT;
};

const recordFailure = (ip) => {
  const entry = failedLogins.get(ip);
  if (!entry || Date.now() - entry.since > FAILED_LOGIN_WINDOW_MS) failedLogins.set(ip, { count: 1, since: Date.now() });
  else entry.count += 1;
};

let queue = Promise.resolve();
const exclusive = (task) => {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
};

let projects = null;

const slugify = (name) => String(name || "game")
  .normalize("NFKD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^\w-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .toLowerCase()
  .slice(0, 60) || "game";

const loadProjects = async () => {
  if (projects) return projects;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    projects = JSON.parse(await fsp.readFile(META_FILE, "utf8"));
    if (!Array.isArray(projects)) projects = [];
  } catch {
    projects = [];
  }
  const known = new Set(projects.map((project) => project.dir));
  for (const entry of await fsp.readdir(DATA_DIR, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".") && !known.has(entry.name)) {
      const now = Date.now();
      projects.push({ id: newId(), name: entry.name, dir: entry.name, created: now, updated: now, tabs: [], active: null });
    }
  }
  return projects;
};

const saveProjects = async () => {
  const temp = `${META_FILE}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(projects, null, 2));
  await fsp.rename(temp, META_FILE);
};

const newId = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");

const publicProject = ({ dir, ...project }) => project;

const findProject = async (id) => {
  const project = (await loadProjects()).find((item) => item.id === id);
  if (!project) throw httpError(404, "Project not found");
  return project;
};

const uniqueDir = async (name) => {
  const used = new Set((await loadProjects()).map((project) => project.dir));
  const base = slugify(name);
  for (let n = 1; ; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    if (!used.has(dir) && !fs.existsSync(path.join(DATA_DIR, dir))) return dir;
  }
};

const cleanPath = (value) => {
  const parts = String(value ?? "").replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
};

const projectRoot = (project) => path.join(DATA_DIR, project.dir);

const inside = (root, target) => target === root || target.startsWith(root + path.sep);

const resolveEntry = (project, value) => {
  const rel = cleanPath(value);
  if (!rel) throw httpError(400, "That path isn't valid.");
  const root = projectRoot(project);
  const full = path.join(root, ...rel.split("/"));
  if (!inside(root, full) || full === root) throw httpError(400, "That path isn't valid.");
  return { rel, full };
};

const checkRealPath = async (project, target) => {
  const root = await fsp.realpath(projectRoot(project));
  const real = await fsp.realpath(target);
  if (!inside(root, real)) throw httpError(400, "That path isn't valid.");
};

const ensureDir = async (project, dir) => {
  await fsp.mkdir(dir, { recursive: true });
  await checkRealPath(project, dir);
};

const writeAtomic = async (project, full, bytes) => {
  await ensureDir(project, path.dirname(full));
  const existing = await fsp.lstat(full).catch(() => null);
  if (existing && !existing.isFile()) throw httpError(409, "A folder with that name already exists.");
  const temp = path.join(path.dirname(full), `.${path.basename(full)}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  await fsp.writeFile(temp, bytes);
  await fsp.rename(temp, full);
};

const walk = async (root, prefix = "") => {
  const out = [];
  const entries = await fsp.readdir(path.join(root, ...prefix.split("/").filter(Boolean)), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink() || /^\..*\.tmp$/.test(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push({ path: rel, kind: "dir" });
      out.push(...await walk(root, rel));
    } else if (entry.isFile()) {
      out.push({ path: rel, kind: "file" });
    }
  }
  return out;
};

const decodeData = (data) => {
  if (data && typeof data.text === "string") return { bytes: Buffer.from(data.text, "utf8"), text: true };
  if (data && typeof data.base64 === "string") return { bytes: Buffer.from(data.base64, "base64"), text: false };
  throw httpError(400, "A file had no contents.");
};

const touch = (project) => {
  project.updated = Date.now();
};

let currentProject = null;
const lastHeartbeat = { entity: null, at: 0 };

const heartbeat = (project, rel, isWrite) => {
  if (!WAKATIME_CLI || !WAKATIME_CONFIG || !fs.existsSync(WAKATIME_CONFIG) || !rel) return;
  const entity = path.join(projectRoot(project), ...rel.split("/"));
  const now = Date.now();
  if (entity === lastHeartbeat.entity && now - lastHeartbeat.at < HEARTBEAT_INTERVAL_MS) return;
  lastHeartbeat.entity = entity;
  lastHeartbeat.at = now;
  const args = ["--entity", entity, "--project", project.name, "--plugin", PLUGIN, "--config", WAKATIME_CONFIG];
  if (isWrite) args.push("--write");
  const child = spawn(WAKATIME_CLI, args, { stdio: "ignore", detached: true });
  child.on("error", (err) => console.error("Failed to send a Hackatime heartbeat:", err.message));
  child.unref();
};

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(httpError(413, "That's too much to save at once."));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (!chunks.length) return resolve({});
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      reject(httpError(400, "The request wasn't valid JSON."));
    }
  });
  req.on("error", reject);
});

const sendJson = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};

const createProject = (body) => exclusive(async () => {
  const name = String(body.name || "My Game").slice(0, 100);
  const dir = await uniqueDir(name);
  const now = Date.now();
  const project = { id: newId(), name, dir, created: now, updated: now, tabs: [], active: null };
  await fsp.mkdir(projectRoot(project), { recursive: true });
  for (const value of Array.isArray(body.dirs) ? body.dirs : []) {
    if (cleanPath(value)) await ensureDir(project, resolveEntry(project, value).full);
  }
  for (const [value, data] of Object.entries(body.files || {})) {
    if (!cleanPath(value)) continue;
    await writeAtomic(project, resolveEntry(project, value).full, decodeData(data).bytes);
  }
  projects.push(project);
  await saveProjects();
  return publicProject(project);
});

const updateProject = (id, patch) => exclusive(async () => {
  const project = await findProject(id);
  if (typeof patch.name === "string" && patch.name.trim()) project.name = patch.name.trim().slice(0, 100);
  if (Array.isArray(patch.tabs)) project.tabs = patch.tabs.filter((tab) => typeof tab === "string" && cleanPath(tab)).slice(0, 200);
  if ("active" in patch) project.active = typeof patch.active === "string" && cleanPath(patch.active) ? patch.active : null;
  if (Number.isFinite(patch.updated)) project.updated = patch.updated;
  currentProject = project;
  await saveProjects();
  return publicProject(project);
});

const deleteProject = (id) => exclusive(async () => {
  const project = await findProject(id);
  await fsp.rm(projectRoot(project), { recursive: true, force: true });
  projects = projects.filter((item) => item !== project);
  if (currentProject === project) currentProject = null;
  await saveProjects();
});

const listEntries = async (id) => {
  const project = await findProject(id);
  currentProject = project;
  const root = projectRoot(project);
  const entries = await walk(root);
  for (const entry of entries) {
    if (entry.kind !== "file") continue;
    const full = path.join(root, ...entry.path.split("/"));
    const [bytes, stat] = await Promise.all([fsp.readFile(full), fsp.stat(full)]);
    entry.base64 = bytes.toString("base64");
    entry.mtime = stat.mtimeMs;
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
};

const readEntry = async (id, value) => {
  const project = await findProject(id);
  const { full } = resolveEntry(project, value);
  const stat = await fsp.lstat(full).catch(() => null);
  if (!stat?.isFile()) throw httpError(404, "File not found");
  await checkRealPath(project, full);
  return fsp.readFile(full);
};

const writeFiles = (id, files) => exclusive(async () => {
  const project = await findProject(id);
  let written = null;
  for (const [value, data] of Object.entries(files || {})) {
    const { rel, full } = resolveEntry(project, value);
    const { bytes, text } = decodeData(data);
    await writeAtomic(project, full, bytes);
    if (text) written = rel;
  }
  touch(project);
  currentProject = project;
  await saveProjects();
  if (written) heartbeat(project, written, true);
});

const createDir = (id, value) => exclusive(async () => {
  const project = await findProject(id);
  const { full } = resolveEntry(project, value);
  const existing = await fsp.lstat(full).catch(() => null);
  if (existing && !existing.isDirectory()) throw httpError(409, "A file with that name already exists.");
  await ensureDir(project, full);
  touch(project);
  await saveProjects();
});

const deleteEntry = (id, value) => exclusive(async () => {
  const project = await findProject(id);
  const { full } = resolveEntry(project, value);
  const existing = await fsp.lstat(full).catch(() => null);
  if (existing) {
    await checkRealPath(project, path.dirname(full));
    await fsp.rm(full, { recursive: true, force: true });
  }
  touch(project);
  await saveProjects();
});

const renameEntry = (id, fromValue, toValue) => exclusive(async () => {
  const project = await findProject(id);
  const from = resolveEntry(project, fromValue);
  const to = resolveEntry(project, toValue);
  if (from.rel === to.rel) return [];
  if (to.rel.startsWith(`${from.rel}/`)) throw httpError(400, "A folder cannot be moved into itself.");
  const source = await fsp.lstat(from.full).catch(() => null);
  if (!source || source.isSymbolicLink()) throw httpError(404, `"${from.rel}" doesn't exist.`);
  if (await fsp.lstat(to.full).catch(() => null)) throw httpError(409, `"${to.rel}" already exists.`);
  await checkRealPath(project, path.dirname(from.full));
  const moved = source.isDirectory()
    ? (await walk(from.full)).filter((entry) => entry.kind === "file").map((entry) => [`${from.rel}/${entry.path}`, `${to.rel}/${entry.path}`])
    : [[from.rel, to.rel]];
  await ensureDir(project, path.dirname(to.full));
  await fsp.rename(from.full, to.full);
  touch(project);
  await saveProjects();
  return moved;
});

const recordActivity = async () => {
  const project = currentProject;
  if (!project) return;
  const candidates = [project.active, "main.lua"].filter(Boolean);
  for (const candidate of candidates) {
    const rel = cleanPath(candidate);
    if (rel && fs.existsSync(path.join(projectRoot(project), ...rel.split("/")))) {
      heartbeat(project, rel, false);
      return;
    }
  }
};

const handleApi = async (req, res, url) => {
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decode);
  const method = req.method;

  if (parts[0] === "activity" && parts.length === 1 && method === "POST") {
    await recordActivity();
    return sendJson(res, 200, { ok: true });
  }

  if (parts[0] !== "projects") throw httpError(404, "Not found");

  if (parts.length === 1) {
    if (method === "GET") return sendJson(res, 200, (await loadProjects()).map(publicProject));
    if (method === "POST") return sendJson(res, 200, await createProject(await readBody(req)));
  }

  const id = parts[1];

  if (parts.length === 2) {
    if (method === "GET") {
      const project = (await loadProjects()).find((item) => item.id === id);
      return sendJson(res, 200, project ? publicProject(project) : null);
    }
    if (method === "PATCH") return sendJson(res, 200, await updateProject(id, await readBody(req)));
    if (method === "DELETE") {
      await deleteProject(id);
      return sendJson(res, 200, { ok: true });
    }
  }

  if (parts.length === 3) {
    const action = parts[2];
    if (action === "entries" && method === "GET") return sendJson(res, 200, await listEntries(id));
    if (action === "entries" && method === "DELETE") {
      await deleteEntry(id, url.searchParams.get("path"));
      return sendJson(res, 200, { ok: true });
    }
    if (action === "file" && method === "GET") {
      const bytes = await readEntry(id, url.searchParams.get("path"));
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
      return res.end(bytes);
    }
    if (action === "files" && method === "PUT") {
      await writeFiles(id, (await readBody(req)).files);
      return sendJson(res, 200, { ok: true });
    }
    if (action === "dirs" && method === "POST") {
      await createDir(id, (await readBody(req)).path);
      return sendJson(res, 200, { ok: true });
    }
    if (action === "rename" && method === "POST") {
      const body = await readBody(req);
      return sendJson(res, 200, await renameEntry(id, body.from, body.to));
    }
  }

  throw httpError(404, "Not found");
};

const staticFile = (pathname) => {
  const rel = pathname === "/" ? "index.html" : cleanPath(decode(pathname));
  if (!rel) return null;
  if (OVERRIDES[rel]) return OVERRIDES[rel];
  if (HIDDEN.has(rel)) return null;
  const full = path.join(CUPID_DIR, ...rel.split("/"));
  return inside(CUPID_DIR, full) ? full : null;
};

const injectIndex = (html) => html
  .replace(/<script>window\.va = [^<]*<\/script>\s*/g, "")
  .replace(/<script defer src="\/_vercel\/insights\/script\.js"><\/script>\s*/g, "")
  .replace("</head>", "<style>#btn-share { display: none; }</style>\n</head>")
  .replace("</body>", '<script type="module" src="spaces-activity.js"></script>\n</body>');

const serveStatic = async (req, res, url) => {
  const file = staticFile(url.pathname);
  const stat = file ? await fsp.stat(file).catch(() => null) : null;
  if (!stat?.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  const etag = `W/"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const headers = { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache", ETag: etag };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  if (file === path.join(CUPID_DIR, "index.html")) {
    const html = injectIndex(await fsp.readFile(file, "utf8"));
    res.writeHead(200, headers);
    return res.end(req.method === "HEAD" ? undefined : html);
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
};

const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }

  const ip = clientIp(req);

  try {
    if (url.pathname === "/login") {
      if (req.method === "POST" && tooManyFailures(ip)) {
        res.writeHead(429, { "Content-Type": "text/html; charset=utf-8", "Retry-After": "900" });
        return res.end(loginPage("Too many wrong passwords. Try again in 15 minutes."));
      }
      return await handleLogin(req, res, ip);
    }

    if (!loggedIn(req)) {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(302, { Location: "login", "Cache-Control": "no-store" });
        return res.end();
      }
      throw httpError(401, "Log in to your space first.");
    }

    if (url.pathname.startsWith("/api/")) {
      const site = req.headers["sec-fetch-site"];
      if (site && site !== "same-origin") throw httpError(403, "That request came from another site.");
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "Method not allowed");
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? "Something went wrong in your space. Try again." : err.message });
    else res.destroy();
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Cupid is listening on port ${PORT}`);
});
