import express from 'express';
import pg from '../../utils/db.js';
import { requireAdmin } from '../../middlewares/admin.middleware.js';
import { deleteSpace } from '../../utils/spaces.js';

const router = express.Router();

router.post('/analytics', requireAdmin, async (req, res) => {
  try {
    const [userCount] = await pg('users').count('id as count');
    const [spaceCount] = await pg('spaces').count('id as count');
    const [activeSpaces] = await pg('spaces')
      .where('running', true)
      .count('id as count');

    res.status(200).json({
      success: true,
      data: {
        totalUsers: parseInt(userCount.count),
        totalSpaces: parseInt(spaceCount.count),
        activeSpaces: parseInt(activeSpaces.count)
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
      .select('spaces.*', 'users.username', 'users.email')
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
