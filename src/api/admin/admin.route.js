import express from 'express';
import pg from '../../utils/db.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { deleteSpace, spaceNameFor } from '../../utils/spaces.js';
import { getSandboxStats } from '../../utils/sandboxes.js';

const router = express.Router();

const INACTIVE_DAYS = 90;

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

    res.status(200).json({
      success: true,
      data: {
        totalUsers: parseInt(userCount.count),
        totalSpaces: parseInt(spaceCount.count),
        activeSpaces: parseInt(activeSpaces.count),
        inactiveSpaces: parseInt(inactiveSpaces.count),
        inactiveDays: INACTIVE_DAYS
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

router.post('/sandbox-stats', requireAdmin, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: await getSandboxStats()
    });
  } catch (error) {
    console.error('Error fetching sandbox stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sandbox stats'
    });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const users = await pg('users')
      .leftJoin('spaces', 'spaces.user_id', 'users.id')
      .select(
        'users.id',
        'users.email',
        'users.username',
        'users.max_spaces',
        'users.is_admin',
        'users.hackclub_verification_status',
        pg.raw('users.hackclub_id is not null as hackclub_linked'),
        pg.raw('users.password_hash is not null as has_password'),
        pg.raw("exists (select 1 from user_club_memberships m where m.user_id = users.id and m.role = 'leader') as club_leader"),
        pg.raw('exists (select 1 from user_club_memberships m where m.user_id = users.id) as in_club'),
        pg.raw('count(spaces.id)::int as "spaceCount"'),
        pg.raw('(count(spaces.id) filter (where spaces.running))::int as "runningCount"'),
        pg.raw('max(coalesce(spaces.last_opened_at, spaces.started_at)) as last_active')
      )
      .groupBy('users.id')
      .orderBy('users.id', 'desc');

    res.status(200).json({
      success: true,
      data: users
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
      .select('spaces.id', 'spaces.type', 'spaces.container_id', 'spaces.running', 'spaces.started_at', 'spaces.last_opened_at', 'spaces.created_at', 'spaces.workspace_dir', 'spaces.is_favorite', 'spaces.user_id', 'users.username', 'users.email')
      .join('users', 'spaces.user_id', 'users.id')
      .orderBy('spaces.id', 'desc');

    res.status(200).json({
      success: true,
      data: spaces.map(({ workspace_dir, ...space }) => ({
        ...space,
        name: space.type === 'code-server' && workspace_dir ? spaceNameFor(workspace_dir) : null
      }))
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
        await deleteSpace(space.id, null, { isAdmin: true });
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
