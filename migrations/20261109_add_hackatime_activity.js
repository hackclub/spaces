export async function up(knex) {
  if (!(await knex.schema.hasTable('hackatime_activity'))) {
    await knex.schema.createTable('hackatime_activity', (table) => {
      table.increments('id').primary();
      table.string('source').notNullable();
      table.string('machine').notNullable();
      table.string('hackatime_user_id').notNullable().index();
      table.integer('space_id').unsigned().references('id').inTable('spaces').onDelete('SET NULL').index();
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL').index();
      table.timestamp('hour').notNullable().index();
      table.integer('seconds').notNullable().defaultTo(0);
      table.integer('heartbeats').notNullable().defaultTo(0);
      table.timestamp('first_at');
      table.timestamp('last_at');
      table.unique(['machine', 'hackatime_user_id', 'hour']);
    });
  }

  if (!(await knex.schema.hasTable('hackatime_imports'))) {
    await knex.schema.createTable('hackatime_imports', (table) => {
      table.string('hackatime_user_id').notNullable();
      table.string('machine').notNullable().defaultTo('');
      table.string('status').notNullable().defaultTo('pending').index();
      table.text('error');
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['hackatime_user_id', 'machine']);
    });
  }

  if (!(await knex.schema.hasTable('hackatime_legacy_machines'))) {
    await knex.schema.createTable('hackatime_legacy_machines', (table) => {
      table.string('machine').primary();
      table.integer('space_id').unsigned().references('id').inTable('spaces').onDelete('SET NULL');
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('hackatime_legacy_machines');
  await knex.schema.dropTableIfExists('hackatime_imports');
  await knex.schema.dropTableIfExists('hackatime_activity');
}
