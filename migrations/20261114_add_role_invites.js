export async function up(knex) {
  await knex.schema.createTable('role_invites', (table) => {
    table.increments('id').primary();
    table.string('email', 254).notNullable();
    table.integer('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    table.integer('granted_by').references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['email', 'role_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('role_invites');
}
