import { spawn, execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import https from "https";
import net from "net";
import os from "os";
import path from "path";
import knex from "knex";
import pg from "../src/utils/db.js";
import { spaceConfigs, toSandboxPath } from "../src/utils/spaces.js";
import {
  CODE_SERVER_PORT,
  GUI_PORT,
  GUI_VCPUS,
  SANDBOX_IMAGE,
  SANDBOX_ROOT,
  sandboxNameFor,
  createSandbox,
  findSandbox,
  writeWelcomeFile
} from "../src/utils/sandboxes.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const DRY_RUN = flag("--dry-run");
const LINK = flag("--link");
const CONCURRENCY = Number(value("--concurrency") || 6);
const LIMIT = value("--limit") ? Number(value("--limit")) : null;
const ONLY_ID = value("--id") ? Number(value("--id")) : null;
const REDO_SINCE = value("--redo-since") ? new Date(value("--redo-since")) : null;
const LOG_FILE = value("--log") || "migration-log.jsonl";
const FILE_SERVER_HOST = process.env.FILE_SERVER_HOST;
const FILE_SERVER_PORT = Number(process.env.FILE_SERVER_PORT || 8443);

const MIGRATED_TAGS = { app: "spaces", migrated: "yes" };
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const MOVE_EDITOR_STATE = `
S=${SANDBOX_ROOT}
CS="$HOME/.local/share/code-server"
if [ -d "$S/data" ] && [ ! -e "$CS" ]; then mkdir -p "$(dirname "$CS")" && mv "$S/data" "$CS"; fi
if [ -d "$S/extensions" ] && [ ! -e "$CS/extensions" ]; then mkdir -p "$CS" && mv "$S/extensions" "$CS/extensions"; fi
for f in .ssh .gitconfig .git-credentials .bash_history .zsh_history .wakatime.cfg; do
  if [ -e "$S/$f" ] && [ ! -e "$HOME/$f" ]; then ln -s "$S/$f" "$HOME/$f"; fi
done
`;

const source = knex({ client: "pg", connection: process.env.SOURCE_PG_CONNECTION_STRING });

const configFor = (type) => spaceConfigs[(type || "").toLowerCase()];
const nameFor = (space) => sandboxNameFor(path.basename(space.volume_path));

const logResult = (entry) => {
  fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

const runOrThrow = async (sandbox, script, { sudo = false } = {}) => {
  const result = await sandbox.runCommand({ cmd: "bash", args: ["-c", script], sudo, timeoutMs: 30 * 60 * 1000 });
  if (result.exitCode !== 0) {
    const output = await result.output("both").catch(() => "");
    throw new Error(`exited ${result.exitCode}: ${output.slice(-500)}`);
  }
};

const fileServer = {
  token: crypto.randomBytes(32).toString("hex"),
  folders: new Map(),
  cert: null,
  server: null
};

const makeCertificate = (host) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaces-migration-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  const altName = net.isIP(host) ? `IP:${host}` : `DNS:${host}`;
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2",
    "-subj", "/CN=spaces-migration", "-addext", `subjectAltName=${altName}`,
    "-keyout", keyPath, "-out", certPath
  ], { stdio: "ignore" });
  const pair = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath, "utf8") };
  fs.rmSync(dir, { recursive: true, force: true });
  return pair;
};

const hasToken = (header) => {
  const expected = Buffer.from(`Bearer ${fileServer.token}`);
  const given = Buffer.from(header || "");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

const serveFolder = (req, res) => {
  const match = /^\/spaces\/(\d+)$/.exec(req.url || "");
  const folder = match ? fileServer.folders.get(Number(match[1])) : null;
  if (req.method !== "GET" || !hasToken(req.headers.authorization) || !folder) {
    res.writeHead(404).end();
    return;
  }

  const tar = spawn("tar", ["-C", folder, "--warning=no-file-changed", "-I", "gzip -1", "-cf", "-", "."], { stdio: ["ignore", "pipe", "pipe"] });
  let tarErrors = "";
  tar.stderr.on("data", (chunk) => { tarErrors += chunk; });
  res.writeHead(200, { "content-type": "application/gzip" });
  tar.stdout.pipe(res, { end: false });
  req.on("close", () => tar.kill());
  tar.on("close", (code) => {
    if (code === 0 || code === 1) {
      res.end();
    } else {
      console.error(`reading ${folder} failed (tar ${code}): ${tarErrors.slice(-500)}`);
      res.destroy();
    }
  });
};

const startFileServer = async (spaces) => {
  if (!FILE_SERVER_HOST) {
    throw new Error("FILE_SERVER_HOST must be set to this server's public address");
  }
  for (const space of spaces) {
    fileServer.folders.set(space.id, space.volume_path);
  }
  const { key, cert } = makeCertificate(FILE_SERVER_HOST);
  fileServer.cert = cert;
  fileServer.server = https.createServer({ key, cert }, serveFolder);
  await new Promise((resolve, reject) => {
    fileServer.server.once("error", reject);
    fileServer.server.listen(FILE_SERVER_PORT, "0.0.0.0", resolve);
  });
  console.log(`serving files on https://${FILE_SERVER_HOST}:${FILE_SERVER_PORT}`);
};

const stopFileServer = () => {
  if (fileServer.server) {
    fileServer.server.closeAllConnections();
    fileServer.server.close();
  }
};

const DOWNLOAD_FOLDER = `
set -o pipefail
CA_FILE=$(mktemp)
printf '%s' "$CA" > "$CA_FILE"
mkdir -p "$DEST" && curl -fsS --connect-timeout 20 --cacert "$CA_FILE" -H "Authorization: Bearer $TOKEN" "$URL" | tar -xzf - -C "$DEST" --no-same-owner
status=$?
rm -f "$CA_FILE"
exit $status
`;

const downloadFolder = async (sandbox, space, dest, { sudo }) => {
  const url = `https://${net.isIPv6(FILE_SERVER_HOST) ? `[${FILE_SERVER_HOST}]` : FILE_SERVER_HOST}:${FILE_SERVER_PORT}/spaces/${space.id}`;
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", DOWNLOAD_FOLDER],
    env: { DEST: dest, CA: fileServer.cert, TOKEN: fileServer.token, URL: url },
    sudo,
    timeoutMs: THREE_HOURS_MS
  });

  if (result.exitCode !== 0) {
    const output = await result.output("both").catch(() => "");
    throw new Error(`downloading the folder failed (${result.exitCode}): ${output.slice(-500)}`);
  }
};

const isMigrated = (sandbox) => sandbox?.tags?.migrated === "yes";

const copySpace = async (space, { redo }) => {
  const config = configFor(space.type);
  if (!config) {
    throw new Error(`unknown space type "${space.type}"`);
  }
  if (!fs.existsSync(space.volume_path)) {
    throw new Error(`folder ${space.volume_path} does not exist`);
  }

  const name = nameFor(space);
  const existing = await findSandbox(name);
  if (existing && isMigrated(existing) && !redo) {
    return "skipped";
  }
  if (existing) {
    await existing.delete();
  }

  const isGui = config.kind === "gui";
  const sandbox = await createSandbox(name, isGui ? { port: GUI_PORT, vcpus: GUI_VCPUS } : {});

  try {
    if (isGui) {
      await downloadFolder(sandbox, space, `${SANDBOX_ROOT}/config`, { sudo: true });
      await runOrThrow(sandbox, `chown -R 1000:1000 ${SANDBOX_ROOT}/config`, { sudo: true });
    } else {
      await downloadFolder(sandbox, space, SANDBOX_ROOT, { sudo: false });
      await runOrThrow(sandbox, MOVE_EDITOR_STATE);
      await writeWelcomeFile(sandbox, toSandboxPath(space.workspace_dir), "WELCOME.md");
    }
    await sandbox.update({ tags: MIGRATED_TAGS });
    await sandbox.stop();
  } catch (err) {
    await sandbox.delete().catch(() => {});
    throw err;
  }

  return "copied";
};

const linkSpace = async (space) => {
  const config = configFor(space.type);
  const sandbox = config ? await findSandbox(nameFor(space)) : null;
  if (!isMigrated(sandbox)) {
    return "missing";
  }

  const isGui = config.kind === "gui";
  await pg("spaces").where("id", space.id).update({
    container_id: nameFor(space),
    image: isGui ? config.image : SANDBOX_IMAGE,
    port: isGui ? GUI_PORT : CODE_SERVER_PORT,
    access_url: null,
    running: false
  });
  return "linked";
};

const runPool = async (items, worker) => {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  }));
};

const selectSpaces = (db) => {
  let query = db("spaces").whereNotNull("volume_path");

  if (ONLY_ID) {
    query = query.where("id", ONLY_ID);
  } else if (REDO_SINCE) {
    query = query.whereRaw("coalesce(last_opened_at, started_at) >= ?", [REDO_SINCE]);
  }

  query = query.orderByRaw("coalesce(last_opened_at, started_at, created_at) asc nulls first");
  if (LIMIT) {
    query = query.limit(LIMIT);
  }

  return query.select(["id", "user_id", "type", "volume_path", "container_id", "workspace_dir"]);
};

const main = async () => {
  const db = LINK ? pg : source;
  const spaces = await selectSpaces(db);
  const mode = LINK ? "link" : REDO_SINCE ? "re-copy" : "copy";
  console.log(`${spaces.length} space(s) to ${mode}${DRY_RUN ? " (dry run)" : ""}`);

  if (DRY_RUN) {
    for (const space of spaces) {
      console.log(`${space.id} ${space.type} ${space.volume_path} -> ${nameFor(space)}`);
    }
    return;
  }

  if (!LINK) {
    await startFileServer(spaces);
  }

  const counts = {};
  let finished = 0;

  await runPool(spaces, async (space) => {
    const started = Date.now();
    let outcome;
    try {
      outcome = LINK ? await linkSpace(space) : await copySpace(space, { redo: Boolean(REDO_SINCE) });
      logResult({ id: space.id, type: space.type, outcome, seconds: Math.round((Date.now() - started) / 1000) });
    } catch (err) {
      outcome = "failed";
      logResult({ id: space.id, type: space.type, outcome, error: err.message });
      console.error(`space ${space.id} failed: ${err.message}`);
    }
    counts[outcome] = (counts[outcome] || 0) + 1;
    finished++;
    if (finished % 10 === 0 || finished === spaces.length) {
      console.log(`${finished}/${spaces.length} ${JSON.stringify(counts)}`);
    }
  });

  console.log(`done: ${JSON.stringify(counts)}`);
};

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    stopFileServer();
    await source.destroy();
    await pg.destroy();
  });
