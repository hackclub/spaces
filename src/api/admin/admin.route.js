import express from 'express';
import fs from 'fs';
import Docker from 'dockerode';
import pg from '../../utils/db.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { deleteSpace } from '../../utils/spaces.js';

const router = express.Router();
const docker = new Docker();

const INACTIVE_DAYS = 90;

const getDiskUsage = async (mountPath) => {
  try {
    const stats = await fs.promises.statfs(mountPath);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    return { path: mountPath, total, free, used: total - free };
  } catch (err) {
    console.error(`Failed to read disk usage for ${mountPath}:`, err.message);
    return null;
  }
};

const getDockerUsage = async () => {
  try {
    const df = await docker.df();
    const sum = (items, key) => (items || []).reduce((acc, item) => acc + (item[key] || 0), 0);
    return {
      images: { count: (df.Images || []).length, size: sum(df.Images, 'Size') },
      containers: { count: (df.Containers || []).length, size: sum(df.Containers, 'SizeRw') },
      volumes: {
        count: (df.Volumes || []).length,
        size: (df.Volumes || []).reduce((acc, v) => acc + (v.UsageData?.Size > 0 ? v.UsageData.Size : 0), 0)
      }
    };
  } catch (err) {
    console.error('Failed to read docker disk usage:', err.message);
    return null;
  }
};

router.post('/analytics', requireAdmin, async (req, res) => {
  try {
    const [userCount] = await pg('users').count('id as count');
    const [spaceCount] = await pg('spaces').count('id as count');
    const [activeSpaces] = await pg('spaces')
      .where('running', true)
      .count('id as count');
    const [inactiveSpaces] = await pg('spaces')
      .where('running', false)
      .whereRaw('COALESCE(last_opened_at, started_at, created_at) < ?', [
        new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000)
      ])
      .count('id as count');

    const volumePath = process.env.VOLUME_BASE_PATH;
    const [rootDisk, volumeDisk, dockerUsage] = await Promise.all([
      getDiskUsage('/'),
      volumePath ? getDiskUsage(volumePath) : Promise.resolve(null),
      getDockerUsage()
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers: parseInt(userCount.count),
        totalSpaces: parseInt(spaceCount.count),
        activeSpaces: parseInt(activeSpaces.count),
        inactiveSpaces: parseInt(inactiveSpaces.count),
        inactiveDays: INACTIVE_DAYS,
        storage: {
          root: rootDisk,
          volume: volumeDisk,
          docker: dockerUsage
        }
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const users = await pg('users')
      .select('id', 'email', 'username', 'max_spaces', 'is_admin')
      .orderBy('id', 'desc');

    const usersWithSpaces = await Promise.all(
      users.map(async (user) => {
        const [spaceCount] = await pg('spaces')
          .where('user_id', user.id)
          .count('id as count');
        return {
          ...user,
          spaceCount: parseInt(spaceCount.count)
        };
      })
    );

    res.status(200).json({
      success: true,
      data: usersWithSpaces
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

router.post('/spaces', requireAdmin, async (req, res) => {
  try {
    const spaces = await pg('spaces')
      .select('spaces.id', 'spaces.type', 'spaces.port', 'spaces.running', 'spaces.started_at', 'spaces.user_id', 'users.username', 'users.email')
      .join('users', 'spaces.user_id', 'users.id')
      .orderBy('spaces.id', 'desc');

    res.status(200).json({
      success: true,
      data: spaces
    });
  } catch (error) {
    console.error('Error fetching spaces:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch spaces'
    });
  }
});

router.post('/users/:userId/update', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { max_spaces, is_admin } = req.body;

    const updates = {};
    if (max_spaces !== undefined) updates.max_spaces = max_spaces;
    if (is_admin !== undefined) updates.is_admin = is_admin;

    const [updatedUser] = await pg('users')
      .where('id', userId)
      .update(updates)
      .returning(['id', 'email', 'username', 'max_spaces', 'is_admin']);

    res.status(200).json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user'
    });
  }
});

router.post('/users/:userId/delete', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    const userSpaces = await pg('spaces').where('user_id', userId);
    for (const space of userSpaces) {
      try {
        await deleteSpace(space.id);
      } catch (error) {
        console.error(`Error deleting space ${space.id}:`, error);
      }
    }

    await pg('users').where('id', userId).delete();

    res.status(200).json({
      success: true,
      message: 'User and associated spaces deleted'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

router.post('/spaces/delete-inactive', requireAdmin, async (req, res) => {
  try {
    const cutoffDate = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);

    const inactiveSpaces = await pg('spaces')
      .where('running', false)
      .whereRaw('COALESCE(last_opened_at, started_at, created_at) < ?', [cutoffDate])
      .select('id');

    const deletedIds = [];
    const errors = [];

    for (const space of inactiveSpaces) {
      try {
        await deleteSpace(space.id, null, { isAdmin: true });
        deletedIds.push(space.id);
      } catch (err) {
        console.error(`Error deleting inactive space ${space.id}:`, err);
        errors.push({ id: space.id, error: err.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Deleted ${deletedIds.length} space(s) inactive for ${INACTIVE_DAYS} days or more successfully`,
      deletedCount: deletedIds.length,
      errors
    });
  } catch (error) {
    console.error('Error deleting inactive spaces:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete inactive spaces'
    });
  }
});

router.post('/spaces/:spaceId/delete', requireAdmin, async (req, res) => {
  try {
    const { spaceId } = req.params;

    await deleteSpace(spaceId, null, { isAdmin: true });

    res.status(200).json({
      success: true,
      message: 'Space deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting space:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete space'
    });
  }
});

export default router;
