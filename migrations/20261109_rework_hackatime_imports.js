export async function up(knex) {
  await knex.schema.dropTableIfExists('hackatime_imports');
  await knex.schema.createTable('hackatime_imports', (table) => {
    table.integer('user_id').unsigned().primary().references('id').inTable('users').onDelete('CASCADE');
    table.string('status').notNullable().defaultTo('pending').index();
    table.text('error');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  if (!(await knex.schema.hasColumn('users', 'hackatime_user_id'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('hackatime_user_id').index();
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'hackatime_user_id')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('hackatime_user_id');
    });
  }
  await knex.schema.dropTableIfExists('hackatime_imports');
  await knex.schema.createTable('hackatime_imports', (table) => {
    table.string('hackatime_user_id').notNullable();
    table.string('machine').notNullable().defaultTo('');
    table.string('status').notNullable().defaultTo('pending').index();
    table.text('error');
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.primary(['hackatime_user_id', 'machine']);
  });
}
