import express from 'express';
import pg from '../../utils/db.js';
import { requireSuperadmin } from '../../middlewares/admin.middleware.js';
import { logAdminAction } from '../../utils/admin-log.js';
import { lockSpace, unlockSpace } from '../../utils/moderation.js';

const router = express.Router();

router.use(requireSuperadmin);

const MAX_REASON_LENGTH = 1000;

const findSpace = async (req, res) => {
  const space = await pg('spaces').where('id', req.params.spaceId).first();
  if (!space) {
    res.status(404).json({ success: false, message: 'Space not found' });
    return null;
  }
  const owner = await pg('users').where('id', space.user_id).first();
  return { space, owner };
};

const reasonFrom = (req, res, { required }) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (required && !reason) {
    res.status(400).json({ success: false, message: 'Give a reason' });
    return undefined;
  }
  if (reason.length > MAX_REASON_LENGTH) {
    res.status(400).json({ success: false, message: `Keep the reason under ${MAX_REASON_LENGTH} characters` });
    return undefined;
  }
  return reason || null;
};

router.post('/spaces/:spaceId/lock', async (req, res) => {
  try {
    const found = await findSpace(req, res);
    if (!found) return;
    const reason = reasonFrom(req, res, { required: true });
    if (reason === undefined) return;

    if (found.space.locked_at) {
      return res.status(400).json({ success: false, message: 'This space is already locked' });
    }

    await lockSpace(found.space, req.user, reason);
    await logAdminAction(req.user, 'space.lock', {
      targetUser: found.owner,
      targetSpaceId: found.space.id,
      details: { name: found.space.name, type: found.space.type, was_running: Boolean(found.space.running) },
      reason
    });

    res.status(200).json({ success: true, message: 'Space locked' });
  } catch (error) {
    console.error('Error locking space:', error);
    res.status(500).json({ success: false, message: 'Failed to lock the space' });
  }
});

router.post('/spaces/:spaceId/unlock', async (req, res) => {
  try {
    const found = await findSpace(req, res);
    if (!found) return;
    const reason = reasonFrom(req, res, { required: false });
    if (reason === undefined) return;

    if (!found.space.locked_at) {
      return res.status(400).json({ success: false, message: "This space isn't locked" });
    }

    await unlockSpace(found.space);
    await logAdminAction(req.user, 'space.unlock', {
      targetUser: found.owner,
      targetSpaceId: found.space.id,
      details: { name: found.space.name, locked_reason: found.space.locked_reason },
      reason
    });

    res.status(200).json({ success: true, message: 'Space unlocked' });
  } catch (error) {
    console.error('Error unlocking space:', error);
    res.status(500).json({ success: false, message: 'Failed to unlock the space' });
  }
});

export default router;
