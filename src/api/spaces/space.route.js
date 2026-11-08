import express from "express";
import { 
  createContainer, 
  startContainer, 
  stopContainer, 
  getContainerStatus,
  getUserSpaces,
  deleteSpace,
  changeSpacePassword,
  availableSpaceTypes,
  spaceConfigs
} from "../../utils/spaces.js";
import { getUser } from "../../utils/user.js";
import { readyTemplateTypes } from "../../utils/templates.js";
import { 
  getUserPrimaryMembership,
  shareSpaceWithClub,
  revokeSpaceClubShares,
  getSpaceShareStatus,
  getSpacesSharedWithLeader,
  getVerifiedLeaderMemberships
} from "../../utils/clubs.js";
import pg from "../../utils/db.js";
import { containerOpsLimiter, spaceShareLimiter } from "../../middlewares/rate-limit.middleware.js";
import { extractAuth } from "../../middlewares/auth.middleware.js";

const router = express.Router();

router.use(extractAuth);

const sendError = (res, err) => {
  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (/required|Missing|Invalid authorization/.test(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};

const withoutCredentials = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

router.post("/create", containerOpsLimiter, async (req, res) => {
  const { password, type, name, homeDir, repo } = req.body;
  const authorization = req.authToken;
  
  try {
    const result = await createContainer(password, type, authorization, name ?? homeDir, repo);
    res.json(result);
  } catch (err) {
    if (err.validTypes) {
      return res.status(400).json({ 
        error: err.message, 
        validTypes: err.validTypes
      });
    }
    
    sendError(res, err);
  }
});

router.post("/password/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const { password } = req.body;
  const authorization = req.authToken;

  try {
    const result = await changeSpacePassword(spaceId, password, authorization);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/start/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  
  try {
    const result = await startContainer(spaceId, authorization);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/stop/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  
  try {
    const result = await stopContainer(spaceId, authorization);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/status/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  
  try {
    const result = await getContainerStatus(spaceId, authorization);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/types", async (req, res) => {
  try {
    const user = await getUser(req.authToken);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const readyTypes = await readyTemplateTypes(spaceConfigs).catch(() => new Set());
    res.json({ types: availableSpaceTypes(user, readyTypes) });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/v1/spaces/list - List all spaces for authenticated user
router.get("/list", async (req, res) => {
  const authorization = req.authToken;
  
  try {
    const spaces = await getUserSpaces(authorization);
    res.json({
      message: "Spaces retrieved successfully",
      spaces
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/delete/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  
  try {
    const result = await deleteSpace(spaceId, authorization);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});
router.post("/:spaceId/favorite", async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  try {
    const user = await getUser(authorization);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const space = await pg('spaces')
      .where({ id: spaceId, user_id: user.id })
      .first();
    if (!space) return res.status(404).json({ error: "Space not found" });

    const [updated] = await pg('spaces')
      .where({ id: spaceId })
      .update({ is_favorite: !space.is_favorite })
      .returning(['id', 'is_favorite']);

    res.json({ success: true, is_favorite: updated.is_favorite });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/:spaceId/open", async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  try {
    const user = await getUser(authorization);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const updated = await pg('spaces')
      .where({ id: spaceId, user_id: user.id })
      .update({ last_opened_at: new Date() });
    if (!updated) return res.status(404).json({ error: "Space not found" });

    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/:spaceId/rename", async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;
  try {
    const user = await getUser(authorization);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const name = typeof req.body.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 64) {
      return res.status(400).json({ error: "Give your space a name of up to 64 characters." });
    }

    const [updated] = await pg('spaces')
      .where({ id: spaceId, user_id: user.id })
      .update({ name })
      .returning(['id', 'name']);
    if (!updated) return res.status(404).json({ error: "Space not found" });

    res.json({ success: true, name: updated.name });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/:spaceId/share/club", spaceShareLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const { share } = req.body;
  const authorization = req.authToken;

  try {
    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const space = await pg('spaces')
      .where('id', spaceId)
      .where('user_id', user.id)
      .first();

    if (!space) {
      return res.status(404).json({
        success: false,
        message: 'Space not found or not owned by you'
      });
    }

    if (share === true) {
      const membership = await getUserPrimaryMembership(user.id);
      if (!membership) {
        return res.status(400).json({
          success: false,
          message: 'You must be linked to a club to share spaces'
        });
      }

      await shareSpaceWithClub(space.id, membership.club_id, user.id);
      res.status(200).json({
        success: true,
        message: 'Space shared with your club leaders',
        data: {
          spaceId: space.id,
          clubName: membership.club_name,
          shared: true
        }
      });
    } else if (share === false) {
      await revokeSpaceClubShares(space.id);
      res.status(200).json({
        success: true,
        message: 'Space sharing revoked',
        data: {
          spaceId: space.id,
          shared: false
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid share value. Must be true or false.'
      });
    }
  } catch (err) {
    console.error('Error in share/club route:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update share status',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.get("/:spaceId/share/status", async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.authToken;

  try {
    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const space = await pg('spaces')
      .where('id', spaceId)
      .where('user_id', user.id)
      .first();

    if (!space) {
      return res.status(404).json({
        success: false,
        message: 'Space not found or not owned by you'
      });
    }

    const shareStatus = await getSpaceShareStatus(space.id);

    res.status(200).json({
      success: true,
      data: {
        spaceId: space.id,
        shared: !!shareStatus,
        clubName: shareStatus?.club_name || null,
        sharedAt: shareStatus?.created_at || null
      }
    });
  } catch (err) {
    console.error('Error in share/status route:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get share status',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

router.get("/shared-with-me", async (req, res) => {
  const authorization = req.authToken;

  try {
    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const { memberships: leaderMemberships, failed } = await getVerifiedLeaderMemberships(user.id);
    if (failed) {
      return res.status(503).json({
        success: false,
        message: "Couldn't check your club right now. Please try again in a few minutes."
      });
    }

    if (leaderMemberships.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          isLeader: false,
          spaces: [],
          message: 'You are not a leader of any club'
        }
      });
    }

    const sharedSpaces = await getSpacesSharedWithLeader(leaderMemberships);

    res.status(200).json({
      success: true,
      data: {
        isLeader: true,
        clubs: leaderMemberships.map(m => ({
          name: m.club_name,
          displayName: m.display_name
        })),
        spaces: sharedSpaces.map(space => ({
          id: space.space_id,
          type: space.type,
          name: space.name,
          description: space.description,
          accessUrl: withoutCredentials(space.access_url),
          running: space.running,
          createdAt: space.created_at,
          owner: {
            id: space.owner_id,
            username: space.owner_username
          },
          club: {
            name: space.club_name,
            displayName: space.club_display_name
          },
          permission: space.permission,
          sharedAt: space.shared_at
        }))
      }
    });
  } catch (err) {
    console.error('Error in shared-with-me route:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to get shared spaces',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

export default router;
