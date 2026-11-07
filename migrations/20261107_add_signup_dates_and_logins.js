export async function up(knex) {
  const hasCreatedAt = await knex.schema.hasColumn('users', 'created_at');
  if (!hasCreatedAt) {
    await knex.schema.alterTable('users', (table) => {
      table.timestamp('created_at');
    });
    await knex.raw('alter table users alter column created_at set default now()');
  }

  const hasLogins = await knex.schema.hasTable('logins');
  if (!hasLogins) {
    await knex.schema.createTable('logins', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE').index();
      table.string('method');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('logins');
}
