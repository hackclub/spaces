export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'hackatime_linked_at'))) {
    await knex.schema.alterTable('users', (table) => table.timestamp('hackatime_linked_at'));
  }
  if (!(await knex.schema.hasColumn('oauth_states', 'code_verifier'))) {
    await knex.schema.alterTable('oauth_states', (table) => table.string('code_verifier', 128));
  }
}

export async function down(knex) {
  await knex.schema.alterTable('oauth_states', (table) => table.dropColumn('code_verifier'));
  await knex.schema.alterTable('users', (table) => table.dropColumn('hackatime_linked_at'));
}
