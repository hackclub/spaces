export async function up(knex) {
  if (!(await knex.schema.hasColumn('space_templates', 'version'))) {
    await knex.schema.alterTable('space_templates', (table) => {
      table.string('version');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('space_templates', 'version')) {
    await knex.schema.alterTable('space_templates', (table) => {
      table.dropColumn('version');
    });
  }
}
