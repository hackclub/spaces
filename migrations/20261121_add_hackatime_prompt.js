export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'hackatime_prompt_answered_at'))) {
    await knex.schema.alterTable('users', (table) => table.timestamp('hackatime_prompt_answered_at'));
  }
}

export async function down(knex) {
  await knex.schema.alterTable('users', (table) => table.dropColumn('hackatime_prompt_answered_at'));
}
