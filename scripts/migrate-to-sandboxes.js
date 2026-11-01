import { spawn } from "child_process";
import fs from "fs";
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

const streamFolder = async (sandbox, folder, dest, { sudo }) => {
  const tar = spawn("tar", ["-C", folder, "--warning=no-file-changed", "-I", "gzip -1", "-cf", "-", "."], { stdio: ["ignore", "pipe", "pipe"] });
  let tarErrors = "";
  tar.stderr.on("data", (chunk) => { tarErrors += chunk; });
  const tarExit = new Promise((resolve) => tar.on("close", resolve));

  let result;
  try {
    result = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", 'mkdir -p "$DEST" && tar -xzf - -C "$DEST" --no-same-owner'],
      env: { DEST: dest },
      sudo,
      stdin: tar.stdout,
      timeoutMs: THREE_HOURS_MS
    });
  } catch (err) {
    tar.kill();
    throw err;
  }

  if (result.exitCode !== 0) {
    tar.kill();
    const output = await result.output("both").catch(() => "");
    throw new Error(`unpacking in the sandbox failed (${result.exitCode}): ${output.slice(-500)}`);
  }

  const tarCode = await tarExit;
  if (tarCode !== 0 && tarCode !== 1) {
    throw new Error(`reading the folder failed (tar ${tarCode}): ${tarErrors.slice(-500)}`);
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
      await streamFolder(sandbox, space.volume_path, `${SANDBOX_ROOT}/config`, { sudo: true });
      await runOrThrow(sandbox, `chown -R 1000:1000 ${SANDBOX_ROOT}/config`, { sudo: true });
    } else {
      await streamFolder(sandbox, space.volume_path, SANDBOX_ROOT, { sudo: false });
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
    await source.destroy();
    await pg.destroy();
  });
