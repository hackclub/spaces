export async function up(knex) {
  const exists = await knex.schema.hasTable('rate_limits');
  if (!exists) {
    await knex.schema.createTable('rate_limits', (table) => {
      table.text('key').primary();
      table.integer('hits').notNullable().defaultTo(0);
      table.timestamp('reset_at').notNullable().index();
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('rate_limits');
}
