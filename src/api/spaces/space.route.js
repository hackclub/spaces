import express from "express";
import { 
  createContainer, 
  startContainer, 
  stopContainer, 
  getContainerStatus,
  getUserSpaces,
  deleteSpace
} from "../../utils/spaces.js";
import { getUser } from "../../utils/user.js";
import { 
  getUserPrimaryMembership,
  shareSpaceWithClub,
  revokeSpaceClubShare,
  getSpaceShareStatus,
  getSpacesSharedWithLeader,
  getLeaderMemberships
} from "../../utils/clubs.js";
import pg from "../../utils/db.js";
import { containerOpsLimiter, spaceShareLimiter } from "../../middlewares/rate-limit.middleware.js";

const router = express.Router();

router.post("/create", containerOpsLimiter, async (req, res) => {
  const { password, type } = req.body;
  const authorization = req.headers.authorization;
  
  try {
    const result = await createContainer(password, type, authorization);
    res.json(result);
  } catch (err) {
    if (err.validTypes) {
      return res.status(400).json({ 
        error: err.message, 
        validTypes: err.validTypes
      });
    }
    
    const statusCode = err.statusCode || (err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.post("/start/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await startContainer(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.post("/stop/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await stopContainer(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.get("/status/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await getContainerStatus(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

// GET /api/v1/spaces/list - List all spaces for authenticated user
router.get("/list", async (req, res) => {
  const authorization = req.headers.authorization;
  
  try {
    const spaces = await getUserSpaces(authorization);
    res.json({
      message: "Spaces retrieved successfully",
      spaces
    });
  } catch (err) {
    const statusCode = err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

router.delete("/delete/:spaceId", containerOpsLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const authorization = req.headers.authorization;
  
  try {
    const result = await deleteSpace(spaceId, authorization);
    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes("required") || err.message.includes("Missing") || err.message.includes("Invalid authorization") ? 400 : 500);
    res.status(statusCode).json({ error: err.message });
  }
});

router.post("/:spaceId/share/club", spaceShareLimiter, async (req, res) => {
  const { spaceId } = req.params;
  const { share } = req.body;
  const authorization = req.headers.authorization;

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

    const membership = await getUserPrimaryMembership(user.id);
    if (!membership) {
      return res.status(400).json({
        success: false,
        message: 'You must be linked to a club to share spaces'
      });
    }

    if (share === true) {
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
      await revokeSpaceClubShare(space.id, membership.club_id);
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
  const authorization = req.headers.authorization;

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
  const authorization = req.headers.authorization;

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

    const leaderMemberships = await getLeaderMemberships(user.id);
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

    const sharedSpaces = await getSpacesSharedWithLeader(user.id);

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
          description: space.description,
          accessUrl: space.access_url,
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
