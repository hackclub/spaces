export async function up(knex) {
  if (!(await knex.schema.hasColumn('spaces', 'hackatime_excluded'))) {
    await knex.schema.alterTable('spaces', (table) => {
      table.boolean('hackatime_excluded').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('spaces', 'hackatime_excluded')) {
    await knex.schema.alterTable('spaces', (table) => {
      table.dropColumn('hackatime_excluded');
    });
  }
}
