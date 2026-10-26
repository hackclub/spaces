import { Sandbox } from "@vercel/sandbox";

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

export const createSandbox = (name, { port = CODE_SERVER_PORT, vcpus = VCPUS } = {}) => Sandbox.create({
  ...credentials(),
  name,
  image: SANDBOX_IMAGE,
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

export const ensureHackatime = async (sandbox, apiKey) => {
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
  } catch (err) {
    console.error("Failed to set up Hackatime:", err.message);
  }
};

export const setupCodeServer = async (sandbox, { workspacePath, hackatimeApiKey, extensions }) => {
  await run(sandbox, "command -v code-server >/dev/null 2>&1 || curl -fsSL https://code-server.dev/install.sh | sh", { sudo: true });
  await run(sandbox, 'mkdir -p "$WORKSPACE"', { env: { WORKSPACE: workspacePath } });

  if (sanitizeHackatimeKey(hackatimeApiKey)) {
    await ensureHackatime(sandbox, hackatimeApiKey);
    await installExtension(sandbox, "wakatime.vscode-wakatime");
  }

  for (const extension of sanitizeExtensions(extensions)) {
    await installExtension(sandbox, extension);
  }
};

export const startCodeServer = async (sandbox, { password, workspacePath }) => {
  await run(sandbox, "pkill -f '[/]usr/lib/code-server/' || true");

  await sandbox.runCommand({
    cmd: "code-server",
    args: [
      "--bind-addr", `0.0.0.0:${CODE_SERVER_PORT}`,
      "--auth", "password",
      "--disable-telemetry",
      "--disable-update-check",
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
  url.username = "abc";
  url.password = password;
  return url.toString();
};

export const setupGuiApp = async (sandbox, { image }) => {
  await run(
    sandbox,
    "command -v dockerd >/dev/null 2>&1 || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io)",
    { sudo: true }
  );
  await run(sandbox, START_DOCKER, { sudo: true, timeoutMs: 2 * MINUTE });
  await run(sandbox, 'docker pull -q "$IMAGE"', { sudo: true, env: { IMAGE: image }, timeoutMs: 10 * MINUTE });
  await run(sandbox, 'mkdir -p "$CONFIG" && chown 1000:1000 "$CONFIG"', { sudo: true, env: { CONFIG: GUI_CONFIG_PATH } });
};

export const startGuiApp = async (sandbox, { image, password }) => {
  await run(sandbox, START_DOCKER, { sudo: true, timeoutMs: 2 * MINUTE });

  await run(
    sandbox,
    [
      `docker rm -f ${GUI_CONTAINER} >/dev/null 2>&1 || true`,
      `docker run -d --name ${GUI_CONTAINER} -p ${GUI_PORT}:3000 -e PUID=1000 -e PGID=1000 -e PASSWORD="$SPACE_PASSWORD" -e SELKIES_FILE_TRANSFERS=upload,download -e SELKIES_UI_SIDEBAR_SHOW_FILES=True --shm-size=1g -v "$CONFIG":/config "$IMAGE" >/dev/null`
    ].join("; "),
    { sudo: true, env: { SPACE_PASSWORD: password, CONFIG: GUI_CONFIG_PATH, IMAGE: image }, timeoutMs: 2 * MINUTE }
  );

  try {
    await run(
      sandbox,
      [
        `for i in $(seq 1 120); do code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${GUI_PORT}/); [ "$code" != 000 ] && break; sleep 0.5; done`,
        `[ "$code" = 401 ] || { echo "desktop answered $code without a password"; exit 2; }`,
        `[ "$(curl -s -o /dev/null -w '%{http_code}' -u "abc:$SPACE_PASSWORD" http://127.0.0.1:${GUI_PORT}/)" = 200 ] || { echo "desktop rejected the space password"; exit 3; }`
      ].join("; "),
      { env: { SPACE_PASSWORD: password }, timeoutMs: 2 * MINUTE }
    );
  } catch (err) {
    await run(sandbox, `docker rm -f ${GUI_CONTAINER} >/dev/null 2>&1 || true`, { sudo: true }).catch(() => {});
    throw err;
  }

  return guiAccessUrl(sandbox.domain(GUI_PORT), password);
};
