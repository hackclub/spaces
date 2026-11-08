const STARTING_ROLES = [
  {
    name: 'Admin',
    description: 'Everything admins could do before roles existed',
    permissions: ['stats.view', 'usage.view', 'users.view', 'spaces.view', 'users.limits', 'users.sign_out', 'users.stop_spaces', 'spaces.skip_verification', 'sandbox.view']
  },
  {
    name: 'Moderator',
    description: 'Looks into reports: locks spaces and checks their files',
    permissions: ['users.view', 'spaces.view', 'moderation.lock', 'moderation.files', 'moderation.full_access', 'logs.view']
  },
  {
    name: 'Dev',
    description: 'Keeps the machines and templates running',
    permissions: ['spaces.view', 'sandbox.view', 'templates.manage']
  }
];

export async function up(knex) {
  if (!(await knex.schema.hasTable('roles'))) {
    await knex.schema.createTable('roles', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable().unique();
      table.text('description');
      table.specificType('permissions', 'text[]').notNullable().defaultTo('{}');
      table.timestamps(true, true);
    });

    await knex('roles').insert(STARTING_ROLES);
  }

  if (!(await knex.schema.hasTable('user_roles'))) {
    await knex.schema.createTable('user_roles', (table) => {
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE').index();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['user_id', 'role_id']);
    });

    const admin = await knex('roles').where('name', 'Admin').first();
    const admins = await knex('users').where('is_admin', true).orWhere('is_superadmin', true).select('id');
    if (admin && admins.length) {
      await knex('user_roles').insert(admins.map((user) => ({ user_id: user.id, role_id: admin.id })));
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_roles');
  await knex.schema.dropTableIfExists('roles');
}
