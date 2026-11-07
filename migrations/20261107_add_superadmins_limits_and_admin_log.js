export async function up(knex) {
  const hasSuperadmin = await knex.schema.hasColumn('users', 'is_superadmin');
  if (!hasSuperadmin) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('is_superadmin').notNullable().defaultTo(false);
    });
  }

  const hasMaxRunning = await knex.schema.hasColumn('users', 'max_running');
  if (!hasMaxRunning) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('max_running').notNullable().defaultTo(1);
    });
  }

  const hasLog = await knex.schema.hasTable('admin_actions');
  if (!hasLog) {
    await knex.schema.createTable('admin_actions', (table) => {
      table.increments('id').primary();
      table.integer('actor_id').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
      table.string('actor_email');
      table.string('action').notNullable().index();
      table.integer('target_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
      table.string('target_email');
      table.integer('target_space_id').unsigned().references('id').inTable('spaces').onDelete('SET NULL').index();
      table.jsonb('details');
      table.text('reason');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('admin_actions');

  const hasMaxRunning = await knex.schema.hasColumn('users', 'max_running');
  if (hasMaxRunning) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('max_running');
    });
  }

  const hasSuperadmin = await knex.schema.hasColumn('users', 'is_superadmin');
  if (hasSuperadmin) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('is_superadmin');
    });
  }
}
