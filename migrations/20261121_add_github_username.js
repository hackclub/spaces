export async function up(knex) {
  if (!(await knex.schema.hasColumn('users', 'github_username'))) {
    await knex.schema.alterTable('users', (table) => {
      table.string('github_username');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('users', 'github_username')) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('github_username');
    });
  }
}
