import pg from './db.js';

export const applyRoleInvites = async (userId) => {
  try {
    const user = await pg('users').where('id', userId).first('id', 'email');
    if (!user?.email) return;
    const invites = await pg('role_invites').where('email', user.email.trim().toLowerCase());
    if (!invites.length) return;
    await pg.transaction(async (trx) => {
      await trx('user_roles')
        .insert(invites.map((invite) => ({ user_id: user.id, role_id: invite.role_id })))
        .onConflict(['user_id', 'role_id'])
        .ignore();
      await trx('role_invites').whereIn('id', invites.map((invite) => invite.id)).delete();
    });
  } catch (err) {
    console.error('Failed to apply roles waiting for this email:', err.message);
  }
};
