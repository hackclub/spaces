export async function up(knex) {
  const hasBeta = await knex.schema.hasColumn('users', 'beta_access');
  if (!hasBeta) {
    await knex.schema.alterTable('users', (table) => {
      table.boolean('beta_access').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex) {
  const hasBeta = await knex.schema.hasColumn('users', 'beta_access');
  if (hasBeta) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('beta_access');
    });
  }
}
