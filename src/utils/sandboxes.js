import fs from "fs";
import { Sandbox, Snapshot } from "@vercel/sandbox";

export const CODE_SERVER_PORT = 8080;
export const SANDBOX_IMAGE = "vercel/sandbox/universal";
export const SANDBOX_ROOT = "/vercel/sandbox";
export const SANDBOX_REGION = "arn1";
export const SANDBOX_FAILOVER_REGIONS = ["fra1"];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const SESSION_TIMEOUT_MS = 3 * HOUR;

const VCPUS = Number.parseInt(process.env.SANDBOX_VCPUS, 10) || 2;

const credentials = () => {
  if (!process.env.VERCEL_TOKEN) {
    return {};
  }

  return {
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID
  };
};

export const sandboxNameFor = (uuid) => `space-${uuid}`;

export const hackatimeMachineFor = (spaceId) => `hackclub-spaces-${spaceId}`;

const TAG_HACKATIME_HOSTNAME = '[ -z "$MACHINE" ] || { if grep -q "^hostname" "$FILE"; then sed -i "s/^hostname.*/hostname = $MACHINE/" "$FILE"; else sed -i "/^\\[settings\\]/a hostname = $MACHINE" "$FILE"; fi; }';

export const createSandbox = (name, { port = CODE_SERVER_PORT, vcpus = VCPUS, snapshotId = null } = {}) => Sandbox.create({
  ...credentials(),
  name,
  ...(snapshotId ? { source: { type: "snapshot", snapshotId } } : { image: SANDBOX_IMAGE }),
  region: SANDBOX_REGION,
  failoverRegions: SANDBOX_FAILOVER_REGIONS,
  ports: [port],
  timeout: SESSION_TIMEOUT_MS,
  resources: { vcpus },
  persistent: true,
  snapshotExpiration: 0,
  keepLastSnapshots: { count: 1, deleteEvicted: true },
  tags: { app: "spaces" }
});

export const getSandboxStats = async () => {
  const [sandboxes, snapshots] = await Promise.all([
    Sandbox.list({ ...credentials(), tags: { app: "spaces" } }).then((result) => result.toArray()),
    Snapshot.list({ ...credentials() }).then((result) => result.toArray())
  ]);
  const stored = snapshots.filter((snapshot) => snapshot.status === "created");

  return {
    sandboxes: sandboxes.length,
    running: sandboxes.filter((sandbox) => sandbox.status === "running").length,
    snapshots: stored.length,
    snapshotBytes: stored.reduce((total, snapshot) => total + snapshot.sizeBytes, 0)
  };
};

export const findSandbox = async (name) => {
  if (!name) {
    return null;
  }

  try {
    return await Sandbox.get({ ...credentials(), name });
  } catch (err) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
};

const run = async (sandbox, script, { env, sudo = false, timeoutMs = 5 * MINUTE } = {}) => {
  const result = await sandbox.runCommand({ cmd: "bash", args: ["-lc", script], env, sudo, timeoutMs });

  if (result.exitCode !== 0) {
    const output = await result.output("both").catch(() => "");
    throw new Error(`Sandbox command exited with ${result.exitCode}: ${script}\n${output.slice(-2000)}`);
  }

  return result;
};

const sanitizeExtensions = (extensions) => (extensions || "")
  .split(/\r?\n/)
  .map((extension) => extension.trim().replace(/[^a-zA-Z0-9.-]/g, ""))
  .filter(Boolean);

const sanitizeHackatimeKey = (apiKey) => (apiKey || "").replace(/[^a-zA-Z0-9\-_]/g, "");

const installExtension = async (sandbox, extension) => {
  try {
    await run(sandbox, 'code-server --install-extension "$EXTENSION" --force', { env: { EXTENSION: extension } });
  } catch (err) {
    console.error(`Failed to install extension ${extension}:`, err.message);
  }
};

export const ensureHackatime = async (sandbox, apiKey, machine = "") => {
  const key = sanitizeHackatimeKey(apiKey);
  if (!key) {
    return;
  }

  try {
    await run(
      sandbox,
      'command -v terminal-wakatime >/dev/null 2>&1 || curl -fsSL https://hack.club/setup/install.sh | bash -s -- "$HACKATIME_API_KEY" --yes',
      { env: { HACKATIME_API_KEY: key } }
    );
    await run(sandbox, `FILE="$HOME/.wakatime.cfg"; [ -f "$FILE" ] || exit 0; ${TAG_HACKATIME_HOSTNAME}`, { env: { MACHINE: machine } });
  } catch (err) {
    console.error("Failed to set up Hackatime:", err.message);
  }
};

const INSTALL_CODE_SERVER = "command -v code-server >/dev/null 2>&1 || curl -fsSL https://code-server.dev/install.sh | sh";

const WELCOME_FILE = new URL("../../in-space.md", import.meta.url);

export const writeWelcomeFile = async (sandbox, workspacePath, fileName) => {
  try {
    const content = fs.readFileSync(WELCOME_FILE, "utf8");
    await run(sandbox, 'mkdir -p "$WORKSPACE" && { [ -e "$WORKSPACE/$FILE" ] || printf "%s" "$CONTENT" > "$WORKSPACE/$FILE"; }', {
      env: { WORKSPACE: workspacePath, FILE: fileName, CONTENT: content }
    });
  } catch (err) {
    console.error(`Failed to write ${fileName}:`, err.message);
  }
};

const cloneRepo = async (sandbox, { repoUrl, workspacePath }) => {
  try {
    await run(sandbox, 'git clone --quiet -- "$REPO" "$WORKSPACE"', {
      env: { REPO: repoUrl, WORKSPACE: workspacePath, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 5 * MINUTE
    });
  } catch (err) {
    console.error(`Failed to clone ${repoUrl}:`, err.message);
    const error = new Error(`Couldn't clone ${repoUrl}`);
    error.userMessage = "Couldn't copy that repo. Check the link, and make sure the repo is public.";
    throw error;
  }
};

export const setupCodeServer = async (sandbox, { workspacePath, hackatimeApiKey, extensions, hackatimeMachine = "", repoUrl = null }) => {
  await run(sandbox, INSTALL_CODE_SERVER, { sudo: true });
  if (repoUrl) {
    await cloneRepo(sandbox, { repoUrl, workspacePath });
  } else {
    await run(sandbox, 'mkdir -p "$WORKSPACE"', { env: { WORKSPACE: workspacePath } });
    await writeWelcomeFile(sandbox, workspacePath, "README.md");
  }

  if (sanitizeHackatimeKey(hackatimeApiKey)) {
    await ensureHackatime(sandbox, hackatimeApiKey, hackatimeMachine);
    await installExtension(sandbox, "wakatime.vscode-wakatime");
  }

  for (const extension of sanitizeExtensions(extensions)) {
    await installExtension(sandbox, extension);
  }
};

export const startCodeServer = async (sandbox, { password, workspacePath }) => {
  await run(sandbox, INSTALL_CODE_SERVER, { sudo: true });
  await run(sandbox, 'mkdir -p "$WORKSPACE"', { env: { WORKSPACE: workspacePath } });
  await run(sandbox, "pkill -f '[/]usr/lib/code-server/' || true");

  await sandbox.runCommand({
    cmd: "code-server",
    args: [
      "--bind-addr", `0.0.0.0:${CODE_SERVER_PORT}`,
      "--auth", "password",
      "--disable-telemetry",
      "--disable-update-check",
      "--ignore-last-opened",
      workspacePath
    ],
    env: { PASSWORD: password },
    detached: true
  });

  await run(
    sandbox,
    `for i in $(seq 1 120); do curl -fs -o /dev/null http://127.0.0.1:${CODE_SERVER_PORT}/healthz && exit 0; sleep 0.5; done; exit 1`,
    { timeoutMs: 2 * MINUTE }
  );

  return sandbox.domain(CODE_SERVER_PORT);
};

export const GUI_PORT = 3000;
export const GUI_VCPUS = 2;
export const GUI_USERNAME = "abc";
const GUI_CONFIG_PATH = `${SANDBOX_ROOT}/config`;
const GUI_CONTAINER = "space-app";

const START_DOCKER = [
  "pgrep -x containerd >/dev/null || (containerd >/var/log/containerd.log 2>&1 &)",
  "for i in $(seq 1 40); do [ -S /run/containerd/containerd.sock ] && break; sleep 0.25; done",
  "pgrep -x dockerd >/dev/null || (dockerd --containerd=/run/containerd/containerd.sock >/var/log/dockerd.log 2>&1 &)",
  "for i in $(seq 1 60); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done",
  "exit 1"
].join("; ");

const guiAccessUrl = (domain, password) => {
  const url = new URL(domain);
  url.username = GUI_USERNAME;
  url.password = password;
  return url.toString();
};

export const setupGuiApp = async (sandbox, { image, build }) => {
  await run(
    sandbox,
    "command -v dockerd >/dev/null 2>&1 || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io)",
    { sudo: true }
  );
  await run(sandbox, START_DOCKER, { sudo: true, timeoutMs: 2 * MINUTE });
  await run(sandbox, 'docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull -q "$IMAGE"', { sudo: true, env: { IMAGE: image }, timeoutMs: 10 * MINUTE });
  await run(sandbox, 'mkdir -p "$CONFIG" && chown 1000:1000 "$CONFIG"', { sudo: true, env: { CONFIG: GUI_CONFIG_PATH } });
  if (build) {
    await run(
      sandbox,
      'docker image inspect "$TAG" >/dev/null 2>&1 || { dir=$(mktemp -d) && printf "%s" "$DOCKERFILE" > "$dir/Dockerfile" && docker build -q -t "$TAG" "$dir" >/dev/null && rm -rf "$dir"; }',
      { sudo: true, env: { TAG: build.tag, DOCKERFILE: build.dockerfile }, timeoutMs: 10 * MINUTE }
    );
  }
  return build?.tag ?? image;
};

const HACKATIME_API_URL = "https://hackatime.hackclub.com/api/hackatime/v1";

export const writeHackatimeConfig = async (sandbox, apiKey, machine = "") => {
  const key = sanitizeHackatimeKey(apiKey);
  const write = 'rm -f "$FILE" && printf "[settings]\\napi_url = %s\\n" "$URL" > "$FILE" && { [ -z "$KEY" ] || printf "api_key = %s\\n" "$KEY" >> "$FILE"; } && printf "heartbeat_rate_limit_seconds = 30\\n" >> "$FILE"';

  try {
    await run(sandbox, `{ [ ! -L "$FILE" ] || rm -f "$FILE"; } && ${key ? write : `{ [ -e "$FILE" ] || { ${write}; }; }`} && ${TAG_HACKATIME_HOSTNAME} && chown -h 1000:1000 "$FILE" && chmod 600 "$FILE"`, {
      sudo: true,
      env: { FILE: `${GUI_CONFIG_PATH}/.wakatime.cfg`, URL: HACKATIME_API_URL, KEY: key, MACHINE: machine }
    });
  } catch (err) {
    console.error("Failed to set up Hackatime:", err.message);
  }
};

const STOP_DOCKER = [
  "pkill -x dockerd",
  "for i in $(seq 1 60); do pgrep -x dockerd >/dev/null || break; sleep 0.5; done",
  "pkill -x containerd",
  "for i in $(seq 1 60); do pgrep -x containerd >/dev/null || break; sleep 0.5; done",
  "sync"
].join("; ");

export const buildTemplateSnapshot = async (type, { image, build, vcpus }) => {
  const sandbox = await Sandbox.create({
    ...credentials(),
    name: `spaces-template-${type}-${Date.now()}`,
    image: SANDBOX_IMAGE,
    region: SANDBOX_REGION,
    timeout: 30 * MINUTE,
    resources: { vcpus: vcpus ?? GUI_VCPUS },
    persistent: false,
    tags: { app: "spaces-template" }
  });

  try {
    await setupGuiApp(sandbox, { image, build });
    await run(sandbox, STOP_DOCKER, { sudo: true, timeoutMs: 2 * MINUTE });
    const snapshot = await sandbox.snapshot({ expiration: 0 });
    return { snapshotId: snapshot.snapshotId, sizeBytes: snapshot.sizeBytes };
  } finally {
    await sandbox.delete().catch((err) => {
      console.error(`Failed to clean up template sandbox for ${type}:`, err.message);
    });
  }
};

export const deleteSnapshot = async (snapshotId) => {
  try {
    const snapshot = await Snapshot.get({ ...credentials(), snapshotId });
    await snapshot.delete();
  } catch (err) {
    if (err?.response?.status !== 404) {
      throw err;
    }
  }
};

export const startGuiApp = async (sandbox, { image, password, build, env = {}, resetFiles = [] }) => {
  const runImage = await setupGuiApp(sandbox, { image, build });
  const extraEnv = Object.keys(env).map((name) => `-e ${name}="$${name}"`).join(" ");

  await run(
    sandbox,
    [
      `docker rm -f ${GUI_CONTAINER} >/dev/null 2>&1 || true`,
      ...resetFiles.map((file) => `dir=$(realpath -m "$(dirname "$CONFIG"/${JSON.stringify(file)})"); case "$dir/" in "$(realpath -m "$CONFIG")"/*) rm -f "$dir"/${JSON.stringify(file.split("/").pop())} ;; esac`),
      `docker run -d --name ${GUI_CONTAINER} -p ${GUI_PORT}:3000 -e PUID=1000 -e PGID=1000 -e PASSWORD="$SPACE_PASSWORD" -e SELKIES_FILE_TRANSFERS=upload,download -e SELKIES_UI_SIDEBAR_SHOW_FILES=True --shm-size=1g ${extraEnv} -v "$CONFIG":/config "$IMAGE" >/dev/null`
    ].join("; "),
    { sudo: true, env: { ...env, SPACE_PASSWORD: password, CONFIG: GUI_CONFIG_PATH, IMAGE: runImage }, timeoutMs: 2 * MINUTE }
  );

  try {
    await run(
      sandbox,
      [
        `for i in $(seq 1 120); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${GUI_PORT}/); [ "$code" != 000 ] && break; sleep 0.5; done`,
        `[ "$code" = 401 ] || { echo "desktop answered $code without a password"; exit 2; }`,
        `[ "$(curl -s -o /dev/null -w '%{http_code}' -u "${GUI_USERNAME}:$SPACE_PASSWORD" http://127.0.0.1:${GUI_PORT}/)" = 200 ] || { echo "desktop rejected the space password"; exit 3; }`
      ].join("; "),
      { env: { SPACE_PASSWORD: password }, timeoutMs: 2 * MINUTE }
    );
  } catch (err) {
    await run(sandbox, `docker rm -f ${GUI_CONTAINER} >/dev/null 2>&1 || true`, { sudo: true }).catch(() => {});
    throw err;
  }

  return guiAccessUrl(sandbox.domain(GUI_PORT), password);
};
