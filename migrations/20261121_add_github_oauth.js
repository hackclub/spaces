export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'github_token'))) {
    await knex.schema.alterTable('users', (table) => table.text('github_token'));
  }
  if (!(await knex.schema.hasColumn('users', 'github_user_id'))) {
    await knex.schema.alterTable('users', (table) => table.string('github_user_id'));
  }
  if (!(await knex.schema.hasColumn('users', 'github_linked_at'))) {
    await knex.schema.alterTable('users', (table) => table.timestamp('github_linked_at'));
  }
}

export async function down(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('github_token');
    table.dropColumn('github_user_id');
    table.dropColumn('github_linked_at');
  });
}
