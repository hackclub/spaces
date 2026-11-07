import pg from './db.js';

export const logAdminAction = async (actor, action, { targetUser = null, targetSpaceId = null, details = null, reason = null } = {}) => {
  await pg('admin_actions').insert({
    actor_id: actor.id,
    actor_email: actor.email,
    action,
    target_user_id: targetUser?.id ?? null,
    target_email: targetUser?.email ?? null,
    target_space_id: targetSpaceId,
    details: details ? JSON.stringify(details) : null,
    reason
  });
};

export const getAdminActions = async ({ limit = 100, before = null, action = null, search = null } = {}) => {
  const query = pg('admin_actions')
    .leftJoin('spaces', 'spaces.id', 'admin_actions.target_space_id')
    .select('admin_actions.*', 'spaces.name as target_space_name', 'spaces.type as target_space_type')
    .orderBy('admin_actions.id', 'desc')
    .limit(limit);

  if (before) query.where('admin_actions.id', '<', before);
  if (action) query.where('admin_actions.action', action);
  if (search) {
    const term = `%${search.toLowerCase()}%`;
    query.where((q) => q
      .whereRaw('lower(admin_actions.actor_email) like ?', [term])
      .orWhereRaw('lower(admin_actions.target_email) like ?', [term])
      .orWhereRaw('admin_actions.target_space_id::text = ?', [search]));
  }

  return query;
};

export const getAdminActionTypes = async () => (await pg('admin_actions').distinct('action').orderBy('action')).map((row) => row.action);
