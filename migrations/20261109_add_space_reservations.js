export async function up(knex) {
  const hasReserved = await knex.schema.hasColumn('spaces', 'reserved_at');
  const hasCreating = await knex.schema.hasColumn('spaces', 'creating');
  if (!hasReserved || !hasCreating) {
    await knex.schema.alterTable('spaces', (table) => {
      if (!hasReserved) table.timestamp('reserved_at');
      if (!hasCreating) table.boolean('creating').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex) {
  const hasReserved = await knex.schema.hasColumn('spaces', 'reserved_at');
  const hasCreating = await knex.schema.hasColumn('spaces', 'creating');
  if (hasReserved || hasCreating) {
    await knex.schema.alterTable('spaces', (table) => {
      if (hasReserved) table.dropColumn('reserved_at');
      if (hasCreating) table.dropColumn('creating');
    });
  }
}
