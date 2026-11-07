import crypto from 'crypto';
import pg from './db.js';
import { findSandbox } from './sandboxes.js';
import { recordRunStop } from './space-runs.js';

export const stopSandbox = async (space) => {
  const sandbox = await findSandbox(space.container_id);
  if (sandbox && sandbox.status === 'running') {
    await sandbox.stop();
  }
};

export const lockSpace = async (space, actor, reason) => {
  await stopSandbox(space);

  await pg('spaces')
    .where('id', space.id)
    .update({
      running: false,
      access_url: null,
      password: crypto.randomBytes(16).toString('hex'),
      locked_at: new Date(),
      locked_reason: reason,
      locked_by: actor.id
    });

  if (space.running) {
    await recordRunStop(space.id, 'locked');
  }
};

export const unlockSpace = (space) => pg('spaces')
  .where('id', space.id)
  .update({ locked_at: null, locked_reason: null, locked_by: null });
