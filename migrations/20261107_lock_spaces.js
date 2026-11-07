export async function up(knex) {
  const hasLock = await knex.schema.hasColumn('spaces', 'locked_at');
  if (!hasLock) {
    await knex.schema.alterTable('spaces', (table) => {
      table.timestamp('locked_at');
      table.text('locked_reason');
      table.integer('locked_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    });
  }
}

export async function down(knex) {
  const hasLock = await knex.schema.hasColumn('spaces', 'locked_at');
  if (hasLock) {
    await knex.schema.alterTable('spaces', (table) => {
      table.dropColumn('locked_by');
      table.dropColumn('locked_reason');
      table.dropColumn('locked_at');
    });
  }
}
