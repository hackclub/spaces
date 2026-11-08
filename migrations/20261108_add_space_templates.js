export async function up(knex) {
  const exists = await knex.schema.hasTable('space_templates');
  if (!exists) {
    await knex.schema.createTable('space_templates', (table) => {
      table.string('type').primary();
      table.string('source').notNullable();
      table.string('snapshot_id').notNullable();
      table.bigInteger('size_bytes');
      table.timestamp('built_at').notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('space_templates');
}
