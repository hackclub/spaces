import pg from './db.js';

export const PERMISSIONS = [
  { key: 'stats.view', category: 'Insights', label: 'See stats and growth charts' },
  { key: 'usage.view', category: 'Insights', label: 'See how many hours each person uses spaces' },
  { key: 'users.view', category: 'User data', label: 'See the users list, including emails' },
  { key: 'spaces.view', category: 'User data', label: 'See the spaces list, including lock reasons' },
  { key: 'users.limits', category: 'User management', label: 'Change how many spaces someone can have and run' },
  { key: 'users.sign_out', category: 'User management', label: 'Sign someone out on every device' },
  { key: 'users.stop_spaces', category: 'User management', label: "Stop someone's running spaces" },
  { key: 'spaces.delete', category: 'User management', label: 'Delete spaces' },
  { key: 'users.delete', category: 'User management', label: 'Delete accounts and all their spaces' },
  { key: 'beta.manage', category: 'Access', label: 'Give or remove beta access' },
  { key: 'spaces.skip_verification', category: 'Access', label: 'Create spaces without Hack Club verification' },
  { key: 'moderation.lock', category: 'Moderation', label: 'Lock and unlock spaces' },
  { key: 'moderation.files', category: 'Moderation', label: "Browse and download a space's files" },
  { key: 'moderation.full_access', category: 'Moderation', label: 'Open any space' },
  { key: 'logs.view', category: 'Audit', label: 'Read the admin log' },
  { key: 'sandbox.view', category: 'Dev', label: 'See sandbox and snapshot stats' },
  { key: 'templates.manage', category: 'Dev', label: 'See and rebuild space templates' }
];

export const PERMISSION_KEYS = new Set(PERMISSIONS.map((permission) => permission.key));

export const cleanPermissions = (permissions) => [...new Set((Array.isArray(permissions) ? permissions : []).filter((key) => PERMISSION_KEYS.has(key)))]
  .sort((a, b) => PERMISSIONS.findIndex((p) => p.key === a) - PERMISSIONS.findIndex((p) => p.key === b));

export const getUserRoles = (userId) => pg('user_roles')
  .join('roles', 'roles.id', 'user_roles.role_id')
  .where('user_roles.user_id', userId)
  .select('roles.id', 'roles.name', 'roles.permissions')
  .orderBy('roles.name');

export const getPermissions = async (user) => {
  if (!user) return new Set();
  if (user.is_superadmin) return new Set(PERMISSION_KEYS);
  const roles = await getUserRoles(user.id);
  return new Set(roles.flatMap((role) => role.permissions || []).filter((key) => PERMISSION_KEYS.has(key)));
};

export const VIEW_AS_COOKIE = 'view_as';

export const resolveAccess = async (user, req) => {
  const roleIds = user?.is_superadmin
    ? String(req.cookies?.[VIEW_AS_COOKIE] ?? '').split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const roles = roleIds.length ? await pg('roles').whereIn('id', roleIds).select('id', 'name', 'permissions').orderBy('name') : [];

  if (!roles.length) {
    return { user, permissions: await getPermissions(user), viewingAs: null };
  }

  return {
    user: { ...user, is_superadmin: false },
    permissions: new Set(roles.flatMap((role) => role.permissions || []).filter((key) => PERMISSION_KEYS.has(key))),
    viewingAs: roles.map(({ id, name }) => ({ id, name }))
  };
};

export const hasPermission = async (user, permission) => (await getPermissions(user)).has(permission);

export const isStaff = async (user) => Boolean(user.is_superadmin)
  || Boolean(await pg('user_roles').where('user_id', user.id).first());

export const canManageUser = async (actor, target) => !target || Boolean(actor.is_superadmin) || !(await isStaff(target));

export const STAFF_ONLY_MESSAGE = 'Only superadmins can manage people with roles';
