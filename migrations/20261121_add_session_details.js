export async function up(knex) {
  if (!(await knex.schema.hasColumn('sessions', 'method'))) {
    await knex.schema.alterTable('sessions', (table) => table.string('method', 20));
  }
  if (!(await knex.schema.hasColumn('sessions', 'user_agent'))) {
    await knex.schema.alterTable('sessions', (table) => table.string('user_agent', 512));
  }
}

export async function down(knex) {
  await knex.schema.alterTable('sessions', (table) => {
    table.dropColumn('method');
    table.dropColumn('user_agent');
  });
}
