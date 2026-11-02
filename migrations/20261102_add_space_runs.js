export async function up(knex) {
  const exists = await knex.schema.hasTable('space_runs');
  if (!exists) {
    await knex.schema.createTable('space_runs', (table) => {
      table.increments('id').primary();
      table.integer('space_id').unsigned().references('id').inTable('spaces').onDelete('SET NULL').index();
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE').index();
      table.string('type');
      table.timestamp('started_at').notNullable().defaultTo(knex.fn.now()).index();
      table.timestamp('stopped_at');
      table.string('stop_reason');
    });

    await knex.raw(`
      insert into space_runs (space_id, user_id, type, started_at)
      select id, user_id, type, coalesce(started_at, now())
      from spaces
      where running and user_id is not null
    `);
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('space_runs');
}
