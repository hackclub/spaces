import express from 'express';
import pg from '../../utils/db.js';
import { requirePermission, requireSuperadmin } from '../../middlewares/admin.middleware.js';
import { isStaff, getUserRoles } from '../../utils/permissions.js';
import { deleteSpace, stopContainer, spaceConfigs } from '../../utils/spaces.js';
import { listTemplates, rebuildTemplates } from '../../utils/templates.js';
import { getSandboxStats } from '../../utils/sandboxes.js';
import { getUsage } from '../../utils/space-runs.js';
import { getStats } from '../../utils/stats.js';
import { logAdminAction, getAdminActions, getAdminActionTypes } from '../../utils/admin-log.js';

const router = express.Router();

const INACTIVE_DAYS = 90;

const canManage = async (actor, target) => Boolean(actor.is_superadmin) || !(await isStaff(target));

const findTarget = async (req, res) => {
  const target = await pg('users').where('id', req.params.userId).first();
  if (!target) {
    res.status(404).json({ success: false, message: 'User not found' });
    return null;
  }
  if (!(await canManage(req.user, target))) {
    res.status(403).json({ success: false, message: 'Only superadmins can manage people with roles' });
    return null;
  }
  return target;
};

router.post('/analytics', requirePermission('stats.view'), async (req, res) => {
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

router.post('/usage', requirePermission('usage.view'), async (req, res) => {
  try {
    const days = [1, 7, 30].includes(Number(req.body?.days)) ? Number(req.body.days) : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    res.status(200).json({
      success: true,
      data: {
        days,
        users: await getUsage(since)
      }
    });
  } catch (error) {
    console.error('Error fetching usage:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch usage'
    });
  }
});

router.post('/stats', requirePermission('stats.view'), async (req, res) => {
  try {
    const days = [7, 30, 90].includes(Number(req.body?.days)) ? Number(req.body.days) : 30;

    res.status(200).json({
      success: true,
      data: await getStats(days)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats'
    });
  }
});

router.post('/sandbox-stats', requirePermission('sandbox.view'), async (req, res) => {
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

router.post('/users', requirePermission('users.view'), async (req, res) => {
  try {
    const users = await pg('users')
      .leftJoin('spaces', 'spaces.user_id', 'users.id')
      .select(
        'users.id',
        'users.email',
        'users.username',
        'users.max_spaces',
        'users.max_running',
        'users.beta_access',
        'users.is_superadmin',
        pg.raw(`coalesce((select json_agg(json_build_object('id', r.id, 'name', r.name) order by r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = users.id), '[]'::json) as roles`),
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

router.post('/spaces', requirePermission('spaces.view'), async (req, res) => {
  try {
    const spaces = await pg('spaces')
      .select('spaces.id', 'spaces.type', 'spaces.container_id', 'spaces.running', 'spaces.started_at', 'spaces.last_opened_at', 'spaces.created_at', 'spaces.name', 'spaces.is_favorite', 'spaces.locked_at', 'spaces.locked_reason', 'spaces.user_id', 'users.username', 'users.email')
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

router.post('/users/:userId/update', requirePermission('users.limits'), async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    const limits = {
      max_spaces: { max: 100, label: 'Max spaces' },
      max_running: { max: 10, label: 'Max running spaces' }
    };
    const updates = {};
    for (const [field, { max, label }] of Object.entries(limits)) {
      if (req.body[field] === undefined) continue;
      const value = Number(req.body[field]);
      if (!Number.isInteger(value) || value < 0 || value > max) {
        return res.status(400).json({ success: false, message: `${label} must be a whole number from 0 to ${max}` });
      }
      updates[field] = value;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const [updatedUser] = await pg('users')
      .where('id', target.id)
      .update(updates)
      .returning(['id', 'email', 'username', 'max_spaces', 'max_running', 'is_superadmin']);

    await logAdminAction(req.user, 'user.limits', {
      targetUser: target,
      details: Object.fromEntries(Object.entries(updates).map(([field, value]) => [field, { from: target[field], to: value }]))
    });

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

router.post('/users/:userId/roles', requireSuperadmin, async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    const roleIds = req.body?.roleIds;
    if (!Array.isArray(roleIds) || !roleIds.every(Number.isInteger)) {
      return res.status(400).json({ success: false, message: 'Pick roles from the list' });
    }

    const wanted = await pg('roles').whereIn('id', roleIds).select('id', 'name');
    if (wanted.length !== new Set(roleIds).size) {
      return res.status(400).json({ success: false, message: 'One of those roles no longer exists' });
    }

    const current = await getUserRoles(target.id);
    const added = wanted.filter((role) => !current.some((existing) => existing.id === role.id));
    const removed = current.filter((role) => !roleIds.includes(role.id));
    if (!added.length && !removed.length) {
      return res.status(400).json({ success: false, message: 'Nothing to change' });
    }

    await pg.transaction(async (trx) => {
      if (removed.length) {
        await trx('user_roles').where('user_id', target.id).whereIn('role_id', removed.map((role) => role.id)).delete();
      }
      if (added.length) {
        await trx('user_roles').insert(added.map((role) => ({ user_id: target.id, role_id: role.id })));
      }
    });

    await logAdminAction(req.user, 'user.roles', {
      targetUser: target,
      details: { added: added.map((role) => role.name), removed: removed.map((role) => role.name) }
    });

    const roles = (await getUserRoles(target.id)).map(({ id, name }) => ({ id, name }));
    res.status(200).json({ success: true, message: 'Roles saved', data: { roles } });
  } catch (error) {
    console.error('Error updating roles:', error);
    res.status(500).json({ success: false, message: 'Failed to update roles' });
  }
});

router.post('/users/:userId/superadmin', requireSuperadmin, async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    if (target.id === req.user.id) {
      return res.status(400).json({ success: false, message: "You can't change your own superadmin" });
    }
    if (typeof req.body?.is_superadmin !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Superadmin must be true or false' });
    }
    if (Boolean(target.is_superadmin) === req.body.is_superadmin) {
      return res.status(400).json({ success: false, message: 'Nothing to change' });
    }

    const [updatedUser] = await pg('users')
      .where('id', target.id)
      .update({ is_superadmin: req.body.is_superadmin })
      .returning(['id', 'is_superadmin']);

    await logAdminAction(req.user, 'user.superadmin', {
      targetUser: target,
      details: { from: Boolean(target.is_superadmin), to: req.body.is_superadmin }
    });

    res.status(200).json({
      success: true,
      message: req.body.is_superadmin ? 'They are now a superadmin' : 'Superadmin removed',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error updating superadmin:', error);
    res.status(500).json({ success: false, message: 'Failed to update superadmin' });
  }
});

router.post('/users/:userId/beta', requirePermission('beta.manage'), async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    if (typeof req.body.beta_access !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Beta access must be true or false' });
    }

    const [updatedUser] = await pg('users')
      .where('id', target.id)
      .update({ beta_access: req.body.beta_access })
      .returning(['id', 'beta_access']);

    await logAdminAction(req.user, 'user.beta', {
      targetUser: target,
      details: { from: Boolean(target.beta_access), to: req.body.beta_access }
    });

    res.status(200).json({
      success: true,
      message: req.body.beta_access ? 'Beta access given' : 'Beta access removed',
      data: updatedUser
    });
  } catch (error) {
    console.error('Error updating beta access:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update beta access'
    });
  }
});

router.post('/users/:userId/sign-out', requirePermission('users.sign_out'), async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    const sessions = await pg('sessions').where('user_id', target.id).delete();

    await logAdminAction(req.user, 'user.sign_out', { targetUser: target, details: { sessions } });

    res.status(200).json({
      success: true,
      message: `Signed out of ${sessions} device${sessions === 1 ? '' : 's'}`
    });
  } catch (error) {
    console.error('Error signing user out:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sign the user out'
    });
  }
});

router.post('/users/:userId/stop-spaces', requirePermission('users.stop_spaces'), async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    const running = await pg('spaces').where({ user_id: target.id, running: true }).select('id');
    const stopped = [];
    for (const space of running) {
      try {
        await stopContainer(space.id, null, { isAdmin: true, reason: 'admin' });
        stopped.push(space.id);
      } catch (error) {
        console.error(`Error stopping space ${space.id}:`, error);
      }
    }

    await logAdminAction(req.user, 'user.stop_spaces', { targetUser: target, details: { spaces: stopped } });

    res.status(200).json({
      success: true,
      message: `Stopped ${stopped.length} space${stopped.length === 1 ? '' : 's'}`
    });
  } catch (error) {
    console.error('Error stopping spaces:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop spaces'
    });
  }
});

router.post('/users/:userId/delete', requirePermission('users.delete'), async (req, res) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return;

    if (target.id === req.user.id) {
      return res.status(400).json({ success: false, message: "You can't delete your own account here" });
    }
    if (target.is_superadmin) {
      return res.status(400).json({ success: false, message: 'Remove superadmin before deleting this user' });
    }

    const userSpaces = await pg('spaces').where('user_id', target.id).select('id', 'name', 'type');

    await logAdminAction(req.user, 'user.delete', {
      targetUser: target,
      details: { username: target.username, spaces: userSpaces }
    });

    for (const space of userSpaces) {
      try {
        await deleteSpace(space.id, null, { isAdmin: true });
      } catch (error) {
        console.error(`Error deleting space ${space.id}:`, error);
      }
    }

    await pg('users').where('id', target.id).delete();

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

router.post('/templates', requirePermission('templates.manage'), async (req, res) => {
  try {
    res.status(200).json({ success: true, data: await listTemplates(spaceConfigs) });
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ success: false, message: 'Failed to list templates' });
  }
});

router.post('/templates/rebuild', requirePermission('templates.manage'), async (req, res) => {
  try {
    const results = await rebuildTemplates(spaceConfigs, { force: true });
    await logAdminAction(req.user, 'rebuild_templates', {
      details: { templates: results.map(({ type, ok, error }) => (ok ? { type, ok } : { type, ok, error })) }
    });
    res.status(200).json({
      success: results.every((result) => result.ok),
      data: { results, templates: await listTemplates(spaceConfigs) }
    });
  } catch (error) {
    console.error('Error rebuilding templates:', error);
    res.status(500).json({ success: false, message: 'Failed to rebuild templates' });
  }
});

router.post('/logs', requirePermission('logs.view'), async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.body?.limit) || 100, 1), 500);
    const before = Number.isInteger(req.body?.before) ? req.body.before : null;
    const action = typeof req.body?.action === 'string' && req.body.action ? req.body.action : null;
    const search = typeof req.body?.search === 'string' && req.body.search.trim() ? req.body.search.trim() : null;

    const [entries, actions] = await Promise.all([
      getAdminActions({ limit, before, action, search }),
      getAdminActionTypes()
    ]);

    res.status(200).json({
      success: true,
      data: { entries, actions, hasMore: entries.length === limit }
    });
  } catch (error) {
    console.error('Error fetching admin log:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch the admin log'
    });
  }
});

router.post('/spaces/:spaceId/delete', requirePermission('spaces.delete'), async (req, res) => {
  try {
    const space = await pg('spaces').where('id', req.params.spaceId).first();
    if (!space) {
      return res.status(404).json({ success: false, message: 'Space not found' });
    }

    const owner = await pg('users').where('id', space.user_id).first();

    await logAdminAction(req.user, 'space.delete', {
      targetUser: owner,
      targetSpaceId: space.id,
      details: { name: space.name, type: space.type, sandbox: space.container_id }
    });

    await deleteSpace(space.id, null, { isAdmin: true });

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
