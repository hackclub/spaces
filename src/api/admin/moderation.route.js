import express from 'express';
import pg from '../../utils/db.js';
import { requireSuperadmin } from '../../middlewares/admin.middleware.js';
import { logAdminAction } from '../../utils/admin-log.js';
import path from 'path';
import {
  lockSpace,
  unlockSpace,
  stopSandbox,
  cleanPath,
  listDirectory,
  readSpaceFile,
  looksLikeText,
  openForModeration,
  MAX_PREVIEW_BYTES,
  MAX_DOWNLOAD_BYTES
} from '../../utils/moderation.js';

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

const sendFileError = (res, error, fallback) => {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error(fallback, error);
  res.status(500).json({ success: false, message: fallback });
};

router.post('/spaces/:spaceId/files', async (req, res) => {
  try {
    const found = await findSpace(req, res);
    if (!found) return;
    const dir = cleanPath(req.body?.path);

    await logAdminAction(req.user, 'space.browse', {
      targetUser: found.owner,
      targetSpaceId: found.space.id,
      details: { path: dir }
    });

    const entries = await listDirectory(found.space, dir);
    res.status(200).json({
      success: true,
      data: { path: dir, parent: dir === '/' ? null : path.posix.dirname(dir), entries }
    });
  } catch (error) {
    sendFileError(res, error, 'Failed to list files');
  }
});

router.post('/spaces/:spaceId/file', async (req, res) => {
  try {
    const found = await findSpace(req, res);
    if (!found) return;
    const file = cleanPath(req.body?.path);
    const download = req.body?.download === true;

    await logAdminAction(req.user, download ? 'space.download' : 'space.read', {
      targetUser: found.owner,
      targetSpaceId: found.space.id,
      details: { path: file }
    });

    const content = await readSpaceFile(found.space, file, { maxBytes: download ? MAX_DOWNLOAD_BYTES : MAX_PREVIEW_BYTES });

    if (download) {
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${path.posix.basename(file).replace(/[^\w.\- ]/g, '_')}"`);
      return res.status(200).send(content);
    }

    res.status(200).json({
      success: true,
      data: looksLikeText(content)
        ? { path: file, text: content.toString('utf8') }
        : { path: file, binary: true, size: content.length }
    });
  } catch (error) {
    sendFileError(res, error, 'Failed to read the file');
  }
});

router.post('/spaces/:spaceId/full-access', async (req, res) => {
  try {
    const found = await findSpace(req, res);
    if (!found) return;
    const reason = reasonFrom(req, res, { required: true });
    if (reason === undefined) return;

    await logAdminAction(req.user, 'space.full_access', {
      targetUser: found.owner,
      targetSpaceId: found.space.id,
      details: { name: found.space.name, type: found.space.type, was_running: Boolean(found.space.running), locked: Boolean(found.space.locked_at) },
      reason
    });

    res.status(200).json({ success: true, data: await openForModeration(found.space) });
  } catch (error) {
    sendFileError(res, error, 'Failed to open the space');
  }
});

router.post('/spaces/:spaceId/release', async (req, res) => {
  try {
    const found = await findSpace(req, res);
    if (!found) return;

    if (found.space.running) {
      return res.status(200).json({ success: true, message: 'The owner is using this space, so it was left running' });
    }

    await stopSandbox(found.space);
    await logAdminAction(req.user, 'space.release', {
      targetUser: found.owner,
      targetSpaceId: found.space.id
    });

    res.status(200).json({ success: true, message: 'Space stopped again' });
  } catch (error) {
    console.error('Error stopping space after moderation:', error);
    res.status(500).json({ success: false, message: 'Failed to stop the space' });
  }
});

export default router;
