export async function up(knex) {
  const exists = await knex.schema.hasTable('playground_visits');
  if (!exists) {
    await knex.schema.createTable('playground_visits', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE').index();
      table.string('tool');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now()).index();
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('playground_visits');
}
