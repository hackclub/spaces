import Docker from "dockerode";
import getPort from "get-port";
import pg from "./db.js";
import { getUser, checkUserSpaceLimit } from "./user.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const docker = new Docker();

const containerConfigs = {
  "code-server": {
    image: "linuxserver/code-server",
    port: "8443/tcp",
    env: (password, port) => [
      `PASSWORD=${password}`,
      `DEFAULT_WORKSPACE=/config/workspace`
    ],
    description: "VS Code Server"
  },
  "blender": {
    image: "linuxserver/blender",
    port: "3000/tcp",
    env: (password) => [`PASSWORD=${password}`],
    description: "Blender 3D"
  },
  "kicad": {
    image: "linuxserver/kicad",
    port: "3001/tcp", 
    env: (password) => [`PASSWORD=${password}`],
    description: "KiCad PCB Design"
  }
};

export const createContainer = async (password, type, authorization) => {
  if (!type) {
    throw new Error("Missing container type");
  }

  if (!authorization) {
    throw new Error("Missing authorization token");
  }

  const user = await getUser(authorization);
  if (!user) {
    throw new Error("Invalid authorization token");
  }

  await checkUserSpaceLimit(user.id);

  const config = containerConfigs[type.toLowerCase()];
  if (!config) {
    const error = new Error("Invalid container type");
    error.validTypes = Object.keys(containerConfigs);
    throw error;
  }

  const typeLower = type.toLowerCase();
  if (typeLower === "kicad" || typeLower === "blender") {
    password = crypto.randomBytes(16).toString('hex');
  } else if (!password) {
    throw new Error("Missing container password");
  } else if (password.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }

  try {
    const port = await getPort();

    const container = await docker.createContainer({
      Image: config.image,
      Env: config.env(password, port),
      ExposedPorts: { [config.port]: {} },
      HostConfig: {
        PortBindings: { [config.port]: [{ HostPort: `${port}` }] },
        NetworkMode: "bridge",
        Dns: ["8.8.8.8", "8.8.4.4", "1.1.1.1"],
        PublishAllPorts: false,
        RestartPolicy: { Name: "unless-stopped" },
        Memory: 2 * 1024 * 1024 * 1024,
        MemorySwap: 2 * 1024 * 1024 * 1024,
        NanoCpus: 2000000000,
        CpuShares: 1024,
        PidsLimit: 512,
        SecurityOpt: ["no-new-privileges:true"],
        ReadonlyRootfs: false,
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID", "NET_BIND_SERVICE"]
      },
    });

    await container.start();

    if (type.toLowerCase() === "code-server") {
      try {
        console.log("Running setup script for code-server container...");
        const setupScriptPath = path.join(__dirname, "../../code-server-setup.sh");
        const setupScript = fs.readFileSync(setupScriptPath, "utf8");
        
        const hackatimeApiKey = user.hackatime_api_key || "";
        const exec = await container.exec({
          Cmd: ["bash", "-c", `cat > /tmp/setup.sh << 'EOF'\n${setupScript}\nEOF\nchmod +x /tmp/setup.sh && /tmp/setup.sh '${hackatimeApiKey}' > /app/postinstall.log 2>&1`],
          AttachStdout: true,
          AttachStderr: true,
        });
        
        const stream = await exec.start();
        stream.pipe(process.stdout);
        
        console.log("Setup script executed successfully");
      } catch (setupErr) {
        console.error("Failed to run setup script (container will still be created):", setupErr);
      }
    }

    if (process.env.DOCKER === 'false') {
      console.log("Non-Docker environment detected, adjusting access URL");
      var access_url = `${process.env.SERVER_URL}:${port}`;
    } else {
      console.log("Docker environment detected, using standard access URL");
      if (type.toLowerCase() === 'kicad') {
        var access_url = `${process.env.SERVER_URL}/kicad/space/${port}/`;
      } else {
        var access_url = `${process.env.SERVER_URL}/space/${port}/`;
      }
    }

    if (typeLower === "kicad" || typeLower === "blender") {
      const urlObj = new URL(access_url);
      urlObj.username = "abc";
      urlObj.password = password;
      access_url = urlObj.toString();
    }

    const insertData = {
      user_id: user.id,
      container_id: container.id,
      type: type.toLowerCase(),
      description: config.description,
      image: config.image,
      port,
      access_url: access_url,
      running: true,
      started_at: new Date()
    };

    if (typeLower === "kicad" || typeLower === "blender") {
      insertData.password = password;
    }

    const [newSpace] = await pg('spaces')
      .insert(insertData)
      .returning(['id', 'container_id', 'type', 'description', 'image', 'port', 'access_url', 'password', 'running']);


    const result = {
      message: "Container created successfully",
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
    console.error("Docker error:", err);
    throw new Error("Failed to create container");
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

    // Check if user already has a running space
    const runningSpace = await pg('spaces')
      .where('user_id', user.id)
      .where('running', true)
      .whereNot('id', spaceId)
      .first();

    if (runningSpace) {
      const error = new Error("You can only have one space running at a time. Please stop your other space first.");
      error.statusCode = 400;
      throw error;
    }

    const container = docker.getContainer(space.container_id);
    
    await container.inspect();
    await container.start();

    if (space.type === "code-server" && user.hackatime_api_key) {
      try {
        console.log("Setting up Hackatime for code-server container...");
        const hackatimeApiKey = user.hackatime_api_key;
        const exec = await container.exec({
          Cmd: ["bash", "-c", `export HACKATIME_API_KEY='${hackatimeApiKey}' && export HACKATIME_API_URL="https://hackatime.hackclub.com/api/hackatime/v1" && export SUCCESS_URL="https://hackatime.hackclub.com//success.txt" && curl -sSL https://hackatime.hackclub.com/hackatime/setup.sh | bash`],
          AttachStdout: true,
          AttachStderr: true,
        });
        const stream = await exec.start();
        stream.pipe(process.stdout);
        console.log("Hackatime setup executed successfully");
      } catch (hackatimeErr) {
        console.error("Failed to set up Hackatime (container will still start):", hackatimeErr);
      }
    }
    
    // Update running status and started_at timestamp in database
    await pg('spaces')
      .where('id', spaceId)
      .update({ 
        running: true,
        started_at: new Date()
      });
    
    return {
      message: "Container started successfully",
      spaceId: space.id,
      containerId: space.container_id,
    };
  } catch (err) {
    console.error("Docker error:", err);
    
    if (err.statusCode === 404) {
      const error = new Error(err.message || "Container not found");
      error.statusCode = 404;
      throw error;
    }
    if (err.statusCode === 304) {
      const error = new Error("Container is already running");
      error.statusCode = 400;
      throw error;
    }
    if (err.statusCode === 400) {
      throw err;
    }
    
    throw new Error("Failed to start container");
  }
};

export const stopContainer = async (spaceId, authorization) => {
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

    const container = docker.getContainer(space.container_id);
    
    await container.inspect();
    await container.stop();
    
    // Update running status and clear started_at timestamp in database
    await pg('spaces')
      .where('id', spaceId)
      .update({ 
        running: false,
        started_at: null
      });
    
    return {
      message: "Container stopped successfully",
      spaceId: space.id,
      containerId: space.container_id,
    };
  } catch (err) {
    console.error("Docker error:", err);
    
    if (err.statusCode === 404) {
      const error = new Error(err.message || "Container not found");
      error.statusCode = 404;
      throw error;
    }
    if (err.statusCode === 304) {
      const error = new Error("Container is already stopped");
      error.statusCode = 400;
      throw error;
    }
    
    throw new Error("Failed to stop container");
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

    const container = docker.getContainer(space.container_id);
    const info = await container.inspect();
    
    return {
      spaceId: space.id,
      containerId: space.container_id,
      type: space.type,
      description: space.description,
      accessUrl: space.access_url,
      status: info.State.Status,
      running: info.State.Running,
      startedAt: info.State.StartedAt,
      finishedAt: info.State.FinishedAt,
    };
  } catch (err) {
    console.error("Docker error:", err);
    
    if (err.statusCode === 404) {
      const error = new Error(err.message || "Container not found");
      error.statusCode = 404;
      throw error;
    }
    
    throw new Error("Failed to get container status");
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
      .select(['id', 'container_id', 'type', 'description', 'image', 'port', 'access_url', 'password', 'created_at', 'running']);

    const spacesWithStatus = spaces.map((space) => {
      return {
        ...space,
        status: space.running ? 'running' : 'stopped'
      };
    });

    return spacesWithStatus;
  } catch (err) {
    console.error("Database error:", err);
    throw new Error("Failed to get user spaces");
  }
};

// Get spaces by user ID directly
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

export const deleteSpace = async (spaceId, authorization) => {
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

    const container = docker.getContainer(space.container_id);
    
    try {
      await container.inspect();
      await container.stop();
    } catch (err) {
      console.log("Container already stopped or doesn't exist, continuing with deletion");
    }
    
    try {
      await container.remove();
    } catch (err) {
      console.error("Failed to remove container:", err);
    }
    
    await pg('spaces')
      .where('id', spaceId)
      .delete();
    
    return {
      message: "Space deleted successfully",
      spaceId: space.id,
    };
  } catch (err) {
    console.error("Error deleting space:", err);
    
    if (err.statusCode === 404) {
      throw err;
    }
    
    throw new Error("Failed to delete space");
  }
}
