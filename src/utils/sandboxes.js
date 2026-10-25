import { Sandbox } from "@vercel/sandbox";

export const CODE_SERVER_PORT = 8080;
export const SANDBOX_IMAGE = "vercel/sandbox/universal";
export const SANDBOX_ROOT = "/vercel/sandbox";

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

export const createSandbox = (name) => Sandbox.create({
  ...credentials(),
  name,
  image: SANDBOX_IMAGE,
  ports: [CODE_SERVER_PORT],
  timeout: SESSION_TIMEOUT_MS,
  resources: { vcpus: VCPUS },
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
