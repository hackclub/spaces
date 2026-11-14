import express from 'express';
import pg from '../../utils/db.js';
import { requireSuperadmin } from '../../middlewares/admin.middleware.js';
import { logAdminAction } from '../../utils/admin-log.js';
import { PERMISSIONS, cleanPermissions, isStaffRole } from '../../utils/permissions.js';

const router = express.Router();

router.use(requireSuperadmin);

const MAX_NAME_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 200;

const listRoles = () => pg('roles')
  .leftJoin('user_roles', 'user_roles.role_id', 'roles.id')
  .select('roles.id', 'roles.name', 'roles.description', 'roles.permissions', 'roles.grants', pg.raw('count(user_roles.user_id)::int as "memberCount"'))
  .groupBy('roles.id')
  .orderBy('roles.name');

const findRole = async (req, res) => {
  const role = await pg('roles').where('id', req.params.roleId).first();
  if (!role) {
    res.status(404).json({ success: false, message: 'Role not found' });
    return null;
  }
  return role;
};

const readFields = async (req, res, { roleId = null, partial = false } = {}) => {
  const fields = {};

  if (!partial || req.body?.name !== undefined) {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
      res.status(400).json({ success: false, message: `Give the role a name, up to ${MAX_NAME_LENGTH} characters` });
      return null;
    }
    const taken = await pg('roles').whereRaw('lower(name) = ?', [name.toLowerCase()]).whereNot('id', roleId ?? 0).first();
    if (taken) {
      res.status(400).json({ success: false, message: 'Another role already has that name' });
      return null;
    }
    fields.name = name;
  }

  if (!partial || req.body?.description !== undefined) {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      res.status(400).json({ success: false, message: `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters` });
      return null;
    }
    fields.description = description || null;
  }

  if (!partial || req.body?.permissions !== undefined) {
    fields.permissions = cleanPermissions(req.body?.permissions);
  }

  if (!partial || req.body?.grants !== undefined) {
    const wanted = Array.isArray(req.body?.grants) ? [...new Set(req.body.grants)] : [];
    if (!wanted.every(Number.isInteger) || (roleId !== null && wanted.includes(roleId))) {
      res.status(400).json({ success: false, message: 'Pick the roles this role can give from the list' });
      return null;
    }
    const found = wanted.length ? await pg('roles').whereIn('id', wanted).select('id', 'name', 'permissions', 'grants') : [];
    if (found.length !== wanted.length) {
      res.status(400).json({ success: false, message: 'One of those roles no longer exists' });
      return null;
    }
    const staff = found.find(isStaffRole);
    if (staff) {
      res.status(400).json({ success: false, message: `${staff.name} has staff permissions, so only superadmins can give it` });
      return null;
    }
    fields.grants = wanted.sort((a, b) => a - b);
  }

  if (roleId !== null && (fields.permissions !== undefined || fields.grants !== undefined)) {
    const existing = await pg('roles').where('id', roleId).select('permissions', 'grants').first();
    const givenBy = await pg('roles').whereRaw('? = any(grants)', [roleId]).select('name').first();
    if (givenBy && isStaffRole({ permissions: fields.permissions ?? existing?.permissions, grants: fields.grants ?? existing?.grants })) {
      res.status(400).json({ success: false, message: `${givenBy.name} can give this role, so it can't have staff permissions or give roles itself. Take it off ${givenBy.name} first.` });
      return null;
    }
  }

  return fields;
};

router.post('/', async (req, res) => {
  try {
    res.status(200).json({ success: true, data: { roles: await listRoles(), permissions: PERMISSIONS } });
  } catch (error) {
    console.error('Error listing roles:', error);
    res.status(500).json({ success: false, message: 'Failed to load roles' });
  }
});

router.post('/create', async (req, res) => {
  try {
    const fields = await readFields(req, res);
    if (!fields) return;

    const [role] = await pg('roles').insert(fields).returning(['id', 'name', 'description', 'permissions', 'grants']);
    await logAdminAction(req.user, 'role.create', { details: { name: role.name, permissions: role.permissions, grants: role.grants } });

    res.status(200).json({ success: true, message: 'Role created', data: { ...role, memberCount: 0 } });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({ success: false, message: 'Failed to create the role' });
  }
});

router.post('/:roleId/update', async (req, res) => {
  try {
    const role = await findRole(req, res);
    if (!role) return;
    const fields = await readFields(req, res, { roleId: role.id, partial: true });
    if (!fields) return;

    const [updated] = await pg('roles')
      .where('id', role.id)
      .update({ ...fields, updated_at: pg.fn.now() })
      .returning(['id', 'name', 'description', 'permissions', 'grants']);

    const before = role.permissions || [];
    const after = updated.permissions || [];
    await logAdminAction(req.user, 'role.update', {
      details: {
        name: updated.name,
        ...(role.name !== updated.name ? { renamed_from: role.name } : {}),
        added: after.filter((key) => !before.includes(key)),
        removed: before.filter((key) => !after.includes(key)),
        ...((role.grants || []).join() !== (updated.grants || []).join() ? { grants: { from: role.grants, to: updated.grants } } : {})
      }
    });

    res.status(200).json({ success: true, message: 'Role saved', data: updated });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({ success: false, message: 'Failed to save the role' });
  }
});

router.post('/:roleId/delete', async (req, res) => {
  try {
    const role = await findRole(req, res);
    if (!role) return;

    const member = await pg('user_roles').where('role_id', role.id).first();
    if (member) {
      return res.status(400).json({ success: false, message: 'Remove everyone from this role before deleting it' });
    }

    await pg.transaction(async (trx) => {
      await trx('roles').where('id', role.id).delete();
      await trx('roles').whereRaw('? = any(grants)', [role.id]).update({ grants: pg.raw('array_remove(grants, ?)', [role.id]) });
    });
    await logAdminAction(req.user, 'role.delete', { details: { name: role.name, permissions: role.permissions } });

    res.status(200).json({ success: true, message: 'Role deleted' });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({ success: false, message: 'Failed to delete the role' });
  }
});

router.post('/:roleId/members', async (req, res) => {
  try {
    const role = await findRole(req, res);
    if (!role) return;

    const members = await pg('user_roles')
      .join('users', 'users.id', 'user_roles.user_id')
      .where('user_roles.role_id', role.id)
      .select('users.id', 'users.username', 'users.email', 'users.is_superadmin', 'user_roles.created_at as added_at')
      .orderBy('users.username');

    res.status(200).json({ success: true, data: members });
  } catch (error) {
    console.error('Error listing role members:', error);
    res.status(500).json({ success: false, message: 'Failed to load the members' });
  }
});

const changeMember = (adding) => async (req, res) => {
  try {
    const role = await findRole(req, res);
    if (!role) return;

    const target = await pg('users').where('id', req.body?.userId).first();
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const existing = await pg('user_roles').where({ user_id: target.id, role_id: role.id }).first();
    if (adding === Boolean(existing)) {
      return res.status(400).json({ success: false, message: adding ? 'They already have this role' : "They don't have this role" });
    }

    if (adding) {
      await pg('user_roles').insert({ user_id: target.id, role_id: role.id });
    } else {
      await pg('user_roles').where({ user_id: target.id, role_id: role.id }).delete();
    }

    await logAdminAction(req.user, 'user.roles', {
      targetUser: target,
      details: adding ? { added: [role.name], removed: [] } : { added: [], removed: [role.name] }
    });

    res.status(200).json({ success: true, message: adding ? `${target.username} added` : `${target.username} removed` });
  } catch (error) {
    console.error('Error changing role members:', error);
    res.status(500).json({ success: false, message: 'Failed to change the members' });
  }
};

router.post('/:roleId/members/add', changeMember(true));
router.post('/:roleId/members/remove', changeMember(false));

export default router;
