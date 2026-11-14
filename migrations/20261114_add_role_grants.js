export async function up(knex) {
  await knex.schema.alterTable('roles', (table) => {
    table.specificType('grants', 'integer[]').notNullable().defaultTo('{}');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('roles', (table) => {
    table.dropColumn('grants');
  });
}
