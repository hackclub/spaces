export async function up(knex) {
  const exists = await knex.schema.hasTable('verification_codes');
  if (!exists) {
    await knex.schema.createTable('verification_codes', (table) => {
      table.increments('id').primary();
      table.string('email').notNullable().index();
      table.string('airtable_record_id').notNullable().unique();
      table.integer('attempts').notNullable().defaultTo(0);
      table.timestamp('used_at');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('verification_codes');
}
