import pg from "./db.js";
import { getUser, checkUserSpaceLimit, ensureHackclubVerified } from "./user.js";
import { getUserPrimaryMembership } from "./clubs.js";
import { recordRunStart, recordRunStop } from "./space-runs.js";
import path from "path";
import crypto from "crypto";
import {
  CODE_SERVER_PORT,
  GUI_PORT,
  GUI_VCPUS,
  GUI_USERNAME,
  SANDBOX_IMAGE,
  SANDBOX_ROOT,
  sandboxNameFor,
  createSandbox,
  findSandbox,
  setupCodeServer,
  startCodeServer,
  setupGuiApp,
  startGuiApp,
  ensureHackatime
} from "./sandboxes.js";

const DEFAULT_WORKSPACE_DIR = "/config/workspace";

const sanitizeWorkspaceDir = (homeDir) => {
  if (!homeDir || typeof homeDir !== "string" || !homeDir.trim()) {
    return DEFAULT_WORKSPACE_DIR;
  }

  let dir = homeDir.trim().replace(/[^a-zA-Z0-9/_.\-]/g, "");
  if (!dir.startsWith("/")) {
    dir = `/config/${dir}`;
  }

  dir = path.posix.normalize(dir);

  if (dir !== "/config" && !dir.startsWith("/config/")) {
    return DEFAULT_WORKSPACE_DIR;
  }

  return dir;
};

const sanitizeSpaceName = (name) => {
  const cleaned = (typeof name === "string" ? name : "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .replace(/^\.+/, "")
    .slice(0, 64);
  return cleaned;
};

export const spaceNameFor = (workspaceDir) => path.posix.basename(sanitizeWorkspaceDir(workspaceDir));

export const toSandboxPath = (workspaceDir) => `${SANDBOX_ROOT}${sanitizeWorkspaceDir(workspaceDir).slice("/config".length)}`;

export const spaceConfigs = {
  "code-server": {
    kind: "editor",
    title: "VS Code Server",
    summary: "Web-based code editor",
    description: "VS Code Server"
  },
  "blender": {
    kind: "gui",
    image: "linuxserver/blender",
    label: "Blender",
    title: "Blender 3D",
    summary: "3D modeling and animation",
    description: "Blender 3D"
  },
  "kicad": {
    kind: "gui",
    image: "linuxserver/kicad",
    label: "KiCad",
    title: "KiCad",
    summary: "PCB design software",
    description: "KiCad PCB Design"
  },
  "godot": {
    kind: "gui",
    image: "linuxserver/webtop:debian-xfce",
    label: "Godot",
    title: "Godot",
    summary: "Game engine, the full desktop editor",
    description: "Godot Engine",
    beta: true,
    vcpus: 4,
    setup: [
      "set -e",
      "GODOT_VERSION=4.7.2-stable",
      'DIR="$CONFIG/godot"',
      'if [ "$(cat "$DIR/VERSION" 2>/dev/null)" != "$GODOT_VERSION" ] || [ ! -x "$DIR/godot" ]; then',
      '  tmp=$(mktemp -d)',
      '  curl -fsSL -o "$tmp/godot.zip" "https://github.com/godotengine/godot/releases/download/$GODOT_VERSION/Godot_v${GODOT_VERSION}_linux.x86_64.zip"',
      '  python3 -m zipfile -e "$tmp/godot.zip" "$tmp/out"',
      '  mkdir -p "$DIR"',
      '  mv "$tmp"/out/Godot_v*_linux.x86_64 "$DIR/godot"',
      '  chmod +x "$DIR/godot"',
      '  echo "$GODOT_VERSION" > "$DIR/VERSION"',
      '  rm -rf "$tmp"',
      "fi",
      'mkdir -p "$CONFIG/.config/autostart" "$CONFIG/Desktop" "$CONFIG/projects"',
      'printf "%s\\n" "[Desktop Entry]" "Type=Application" "Name=Godot" "Exec=/config/godot/godot --rendering-driver opengl3 --project-manager" "Terminal=false" > "$CONFIG/.config/autostart/godot.desktop"',
      'cp "$CONFIG/.config/autostart/godot.desktop" "$CONFIG/Desktop/godot.desktop"',
      'chmod +x "$CONFIG/Desktop/godot.desktop"',
      'chown -R 1000:1000 "$DIR" "$CONFIG/.config" "$CONFIG/Desktop" "$CONFIG/projects"'
    ].join("\n")
  },
  "freecad": {
    kind: "gui",
    image: "linuxserver/freecad",
    label: "FreeCAD",
    title: "FreeCAD",
    summary: "CAD software",
    description: "FreeCAD is a general-purpose parametric 3D computer-aided design (CAD) modeler and a building information modeling (BIM) software application with finite element method (FEM) support."
  }
};

const configFor = (type) => spaceConfigs[(type || "").toLowerCase()];

export const hasBetaAccess = (user) => Boolean(user?.beta_access || user?.is_superadmin);

export const availableSpaceTypes = (user) => Object.entries(spaceConfigs)
  .filter(([, config]) => !config.beta || hasBetaAccess(user))
  .map(([value, config]) => ({
    value,
    label: config.title,
    description: config.summary,
    kind: config.kind,
    beta: Boolean(config.beta)
  }));

export const lockedError = (space, action = "used") => {
  const error = new Error(`This space was paused by Hack Club moderators and can't be ${action}${space.locked_reason ? `. Reason: ${space.locked_reason}` : "."}`);
  error.statusCode = 403;
  return error;
};

export const startSpaceApp = (sandbox, space, password) => {
  const config = configFor(space.type);
  if (config?.kind === "gui") {
    return startGuiApp(sandbox, { image: config.image, password, setup: config.setup });
  }
  return startCodeServer(sandbox, { password, workspacePath: toSandboxPath(space.workspace_dir) });
};

export const changeSpacePassword = async (spaceId, newPassword, authorization) => {
  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  if (!authorization) {
    throw new Error("Missing authorization token");
  }

  if (!newPassword || typeof newPassword !== "string") {
    const error = new Error("A new password is required");
    error.statusCode = 400;
    throw error;
  }

  if (newPassword.length < 8) {
    const error = new Error("Password must be at least 8 characters long");
    error.statusCode = 400;
    throw error;
  }

  if (newPassword.length > 128) {
    const error = new Error("Password must be 128 characters or fewer");
    error.statusCode = 400;
    throw error;
  }

  const user = await getUser(authorization);
  if (!user) {
    throw new Error("Invalid authorization token");
  }

  const space = await pg('spaces')
    .where('id', spaceId)
    .where('user_id', user.id)
    .first();

  if (!space) {
    const error = new Error("Space not found or not owned by user");
    error.statusCode = 404;
    throw error;
  }

  if (space.locked_at) {
    throw lockedError(space, "changed");
  }

  const wasRunning = Boolean(space.running);
  const updateData = { password: newPassword };

  if (wasRunning) {
    const sandbox = await findSandbox(space.container_id);
    if (sandbox) {
      updateData.access_url = await startSpaceApp(sandbox, space, newPassword);
    }
  }

  const [updated] = await pg('spaces')
    .where('id', space.id)
    .update(updateData)
    .returning(['id', 'access_url', 'running']);

  return {
    message: wasRunning
      ? "Password changed. Your space was restarted for the change to take effect."
      : "Password changed.",
    spaceId: updated.id,
    accessUrl: updated.access_url,
    running: updated.running
  };
};

export const createContainer = async (password, type, authorization, name) => {
  if (process.env.SPACES_CREATION_PAUSED === 'true') {
    const error = new Error("Space creation is temporarily paused for maintenance. Your existing spaces are unaffected.");
    error.statusCode = 503;
    throw error;
  }

  if (!type) {
    throw new Error("Missing space type");
  }

  if (!authorization) {
    throw new Error("Missing authorization token");
  }

  const user = await getUser(authorization);
  if (!user) {
    throw new Error("Invalid authorization token");
  }

  if (!user.is_admin) {
    const membership = await getUserPrimaryMembership(user.id);
    if (!membership) {
      const verificationStatus = await ensureHackclubVerified(user);
      if (!['verified', 'verified_eligible', 'verified_but_over_18'].includes(verificationStatus)) {
        const error = new Error("You must be a verified Hack Club member or a club member to create a space. Please link your Hack Club account and complete verification, or link to a club.");
        error.statusCode = 403;
        throw error;
      }
    }
  }

  await checkUserSpaceLimit(user.id);

  const typeLower = type.toLowerCase();

  const config = spaceConfigs[typeLower];
  if (!config || (config.beta && !hasBetaAccess(user))) {
    const error = new Error("Invalid space type");
    error.validTypes = availableSpaceTypes(user).map((spaceType) => spaceType.value);
    throw error;
  }

  const isGui = config.kind === "gui";
  password = crypto.randomBytes(16).toString('hex');
  const spaceName = isGui ? null : sanitizeSpaceName(name);
  if (!isGui && !spaceName) {
    const error = new Error("Give your space a name, using letters, numbers, dashes, underscores or dots.");
    error.statusCode = 400;
    throw error;
  }
  const workspaceDir = isGui ? DEFAULT_WORKSPACE_DIR : `/config/${spaceName}`;
  const sandboxName = sandboxNameFor(crypto.randomUUID());

  let sandbox = null;

  try {
    sandbox = await createSandbox(sandboxName, isGui ? { port: GUI_PORT, vcpus: config.vcpus ?? GUI_VCPUS } : {});

    if (isGui) {
      await setupGuiApp(sandbox, { image: config.image, setup: config.setup });
    } else {
      await setupCodeServer(sandbox, {
        workspacePath: toSandboxPath(workspaceDir),
        hackatimeApiKey: user.hackatime_api_key,
        extensions: user.vscode_extensions
      });
    }

    const access_url = await startSpaceApp(sandbox, { type: typeLower, workspace_dir: workspaceDir }, password);

    const [newSpace] = await pg('spaces')
      .insert({
        user_id: user.id,
        container_id: sandboxName,
        type: typeLower,
        name: isGui ? config.label : spaceName,
        description: config.description,
        image: isGui ? config.image : SANDBOX_IMAGE,
        port: isGui ? GUI_PORT : CODE_SERVER_PORT,
        access_url,
        running: true,
        started_at: new Date(),
        last_opened_at: new Date(),
        workspace_dir: workspaceDir,
        password
      })
      .returning(['id', 'container_id', 'type', 'description', 'image', 'port', 'access_url', 'password', 'running']);

    await recordRunStart({ id: newSpace.id, user_id: user.id, type: newSpace.type });

    const result = {
      message: "Space created successfully",
      spaceId: newSpace.id,
      containerId: newSpace.container_id,
      type: newSpace.type,
      description: newSpace.description,
      image: newSpace.image,
      port: newSpace.port,
      accessUrl: newSpace.access_url
    };

    if (newSpace.password) {
      result.password = newSpace.password;
    }

    return result;
  } catch (err) {
    console.error("Sandbox error:", err);

    if (sandbox) {
      await sandbox.delete().catch((deleteErr) => {
        console.error(`Failed to clean up sandbox ${sandboxName}:`, deleteErr.message);
      });
    }

    throw new Error("Failed to create space");
  }
};

export const startContainer = async (spaceId, authorization) => {
  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  if (!authorization) {
    throw new Error("Missing authorization token");
  }

  const user = await getUser(authorization);
  if (!user) {
    throw new Error("Invalid authorization token");
  }

  try {
    const space = await pg('spaces')
      .where('id', spaceId)
      .where('user_id', user.id)
      .first();

    if (!space) {
      const error = new Error("Space not found or not owned by user");
      error.statusCode = 404;
      throw error;
    }

    if (space.locked_at) {
      throw lockedError(space, "started");
    }

    const maxRunning = user.max_running ?? 1;
    const { n: runningCount } = await pg('spaces')
      .where('user_id', user.id)
      .where('running', true)
      .whereNot('id', spaceId)
      .count('id as n')
      .first();

    if (Number(runningCount) >= maxRunning) {
      const error = new Error(maxRunning === 1
        ? "You can only have one space running at a time. Please stop your other space first."
        : maxRunning === 0
          ? "You can't start spaces right now."
          : `You can only have ${maxRunning} spaces running at a time. Please stop one first.`);
      error.statusCode = 400;
      throw error;
    }

    const sandbox = await findSandbox(space.container_id);
    if (!sandbox) {
      const error = new Error("This space's machine could not be found");
      error.statusCode = 404;
      throw error;
    }

    const password = space.password || crypto.randomBytes(16).toString('hex');

    const access_url = await startSpaceApp(sandbox, space, password);

    if (configFor(space.type)?.kind !== "gui" && user.hackatime_api_key) {
      await ensureHackatime(sandbox, user.hackatime_api_key);
    }

    await pg('spaces')
      .where('id', spaceId)
      .update({
        running: true,
        started_at: new Date(),
        last_opened_at: new Date(),
        access_url,
        password
      });

    await recordRunStart(space);

    return {
      message: "Space started successfully",
      spaceId: space.id,
      containerId: space.container_id,
    };
  } catch (err) {
    console.error("Sandbox error:", err);

    if (err.statusCode) {
      throw err;
    }

    throw new Error("Failed to start space");
  }
};

export const stopContainer = async (spaceId, authorization, { isAdmin = false, reason = 'user' } = {}) => {
  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  let spaceQuery = pg('spaces').where('id', spaceId);

  if (!isAdmin) {
    if (!authorization) {
      throw new Error("Missing authorization token");
    }

    const user = await getUser(authorization);
    if (!user) {
      throw new Error("Invalid authorization token");
    }

    spaceQuery = spaceQuery.where('user_id', user.id);
  }

  try {
    const space = await spaceQuery.first();

    if (!space) {
      const error = new Error("Space not found or not owned by user");
      error.statusCode = 404;
      throw error;
    }

    const sandbox = await findSandbox(space.container_id);
    if (sandbox) {
      await sandbox.stop();
    }

    await pg('spaces')
      .where('id', spaceId)
      .update({
        running: false
      });

    await recordRunStop(space.id, reason);

    return {
      message: "Space stopped successfully",
      spaceId: space.id,
      containerId: space.container_id,
    };
  } catch (err) {
    console.error("Sandbox error:", err);

    if (err.statusCode === 404) {
      throw err;
    }

    throw new Error("Failed to stop space");
  }
};

export const getContainerStatus = async (spaceId, authorization) => {
  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  if (!authorization) {
    throw new Error("Missing authorization token");
  }

  const user = await getUser(authorization);
  if (!user) {
    throw new Error("Invalid authorization token");
  }

  try {
    const space = await pg('spaces')
      .where('id', spaceId)
      .where('user_id', user.id)
      .first();

    if (!space) {
      const error = new Error("Space not found or not owned by user");
      error.statusCode = 404;
      throw error;
    }

    const sandbox = await findSandbox(space.container_id);
    if (!sandbox) {
      const error = new Error("This space's machine could not be found");
      error.statusCode = 404;
      throw error;
    }

    return {
      spaceId: space.id,
      containerId: space.container_id,
      type: space.type,
      description: space.description,
      accessUrl: space.access_url,
      status: sandbox.status,
      running: sandbox.status === "running",
      startedAt: space.started_at,
      finishedAt: null,
    };
  } catch (err) {
    console.error("Sandbox error:", err);

    if (err.statusCode === 404) {
      throw err;
    }

    throw new Error("Failed to get space status");
  }
};

export const getUserSpaces = async (authorization) => {
  if (!authorization) {
    throw new Error("Missing authorization token");
  }

  const user = await getUser(authorization);
  if (!user) {
    throw new Error("Invalid authorization token");
  }

  try {
    const spaces = await pg('spaces')
      .where('user_id', user.id)
      .select(['id', 'container_id', 'type', 'description', 'image', 'port', 'access_url', 'password', 'created_at', 'running', 'is_favorite', 'last_opened_at', 'name', 'workspace_dir', 'locked_at', 'locked_reason']);

    const spacesWithStatus = spaces.map(({ workspace_dir, locked_at, locked_reason, ...space }) => {
      if (locked_at) {
        return {
          ...space,
          access_url: null,
          password: null,
          running: false,
          folder: space.type === "code-server" ? spaceNameFor(workspace_dir) : null,
          login_username: null,
          locked: true,
          locked_reason,
          status: 'locked'
        };
      }
      return {
        ...space,
        folder: space.type === "code-server" ? spaceNameFor(workspace_dir) : null,
        login_username: configFor(space.type)?.kind === "gui" ? GUI_USERNAME : null,
        status: space.running ? 'running' : 'stopped'
      };
    });

    return spacesWithStatus;
  } catch (err) {
    console.error("Database error:", err);
    throw new Error("Failed to get user spaces");
  }
};

export const getSpacesByUserId = async (userId) => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  try {
    const spaces = await pg('spaces')
      .where('user_id', userId)
      .select(['id', 'container_id', 'type', 'description', 'image', 'port', 'access_url', 'created_at', 'updated_at']);

    return spaces;
  } catch (err) {
    console.error("Database error:", err);
    throw new Error("Failed to get spaces for user");
  }
};

export const deleteSpace = async (spaceId, authorization, { isAdmin = false } = {}) => {
  if (!spaceId) {
    throw new Error("Space ID is required");
  }

  if (!isAdmin) {
    if (!authorization) {
      throw new Error("Missing authorization token");
    }

    const user = await getUser(authorization);
    if (!user) {
      throw new Error("Invalid authorization token");
    }
  }

  try {
    let spaceQuery = pg('spaces').where('id', spaceId);

    if (!isAdmin) {
      const user = await getUser(authorization);
      spaceQuery = spaceQuery.where('user_id', user.id);
    }

    const space = await spaceQuery.first();

    if (!space) {
      const error = new Error(isAdmin ? "Space not found" : "Space not found or not owned by user");
      error.statusCode = 404;
      throw error;
    }

    if (space.locked_at && !isAdmin) {
      throw lockedError(space, "deleted");
    }

    const sandbox = await findSandbox(space.container_id);
    if (sandbox) {
      await sandbox.delete();
    }

    await recordRunStop(space.id, 'deleted');

    await pg('spaces')
      .where('id', spaceId)
      .delete();

    return {
      message: "Space deleted successfully",
      spaceId: space.id,
    };
  } catch (err) {
    console.error("Error deleting space:", err);

    if (err.statusCode) {
      throw err;
    }

    throw new Error("Failed to delete space");
  }
}
